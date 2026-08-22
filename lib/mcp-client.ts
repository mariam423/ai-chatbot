import { z } from 'zod'

const MAX_TOOL_RESPONSE_LENGTH = 64_000
const MCP_TIMEOUT_MS = 12_000
const MAX_MCP_SERVERS = 20

const McpServerSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(32),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
})

const McpConfigSchema = z.array(McpServerSchema).max(MAX_MCP_SERVERS)
const JsonRpcResponseSchema = z.object({
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
})

const ToolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(2_000).optional(),
  inputSchema: z.record(z.string(), z.unknown()).default({}),
})

export interface McpTool {
  serverId: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface McpSession {
  config: z.infer<typeof McpServerSchema>
  sessionId?: string
}

function configuredServers(): Array<z.infer<typeof McpServerSchema>> {
  const raw = process.env.MCP_SERVERS_JSON
  if (!raw) return []
  try {
    const parsed = McpConfigSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function rpcHeaders(session: McpSession, accept = 'application/json, text/event-stream') {
  return {
    Accept: accept,
    'Content-Type': 'application/json',
    ...session.config.headers,
    ...(session.sessionId ? { 'Mcp-Session-Id': session.sessionId } : {}),
  }
}

function parseSsePayload(raw: string): unknown {
  const data = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .at(-1)
  return data ? JSON.parse(data) : JSON.parse(raw)
}

async function requestRpc(
  session: McpSession,
  method: string,
  params: Record<string, unknown> | undefined,
  id: number | null,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS)
  try {
    const response = await fetch(session.config.url, {
      method: 'POST',
      headers: rpcHeaders(session),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`MCP server returned ${response.status}.`)
    const sessionId = response.headers.get('Mcp-Session-Id')
    if (sessionId) session.sessionId = sessionId
    const raw = (await response.text()).slice(0, MAX_TOOL_RESPONSE_LENGTH)
    if (id === null) return null
    const parsed = JsonRpcResponseSchema.safeParse(parseSsePayload(raw))
    if (!parsed.success) throw new Error('MCP server returned an invalid JSON-RPC response.')
    if (parsed.data.error) throw new Error(`MCP tool error: ${parsed.data.error.message}`)
    return parsed.data.result
  } finally {
    clearTimeout(timeout)
  }
}

async function openSession(config: z.infer<typeof McpServerSchema>): Promise<McpSession> {
  const session: McpSession = { config }
  await requestRpc(
    session,
    'initialize',
    {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'chatbot-agent', version: '1.0.0' },
    },
    1,
  )
  await requestRpc(session, 'notifications/initialized', undefined, null)
  return session
}

/** Discover tools from every configured MCP server; unavailable servers are skipped. */
export async function listMcpTools(): Promise<McpTool[]> {
  const servers = configuredServers()
  const results = await Promise.allSettled(
    servers.map(async (config) => {
      const session = await openSession(config)
      const result = (await requestRpc(session, 'tools/list', {}, 2)) as { tools?: unknown }
      const tools = z.array(ToolSchema).safeParse(result?.tools ?? [])
      if (!tools.success) return []
      return tools.data.map((tool) => ({
        serverId: config.id,
        name: tool.name,
        description: tool.description ?? `Tool provided by MCP server ${config.id}.`,
        inputSchema: tool.inputSchema,
      }))
    }),
  )
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
}

function exposedToolName(tool: McpTool): string {
  return `mcp__${tool.serverId}__${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

/** Convert MCP tool metadata to the OpenAI-compatible function-tool shape. */
export function toOpenAITools(tools: McpTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: exposedToolName(tool),
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))
}

/** Execute one tool call against its configured MCP server. */
export async function callMcpTool(
  tools: McpTool[],
  name: string,
  argumentsJson: string,
): Promise<unknown> {
  const tool = tools.find((candidate) => exposedToolName(candidate) === name)
  if (!tool) throw new Error(`Unknown MCP tool: ${name}`)
  let argumentsValue: unknown
  try {
    argumentsValue = JSON.parse(argumentsJson || '{}')
  } catch {
    throw new Error('MCP tool arguments were not valid JSON.')
  }
  const args = z.record(z.string(), z.unknown()).safeParse(argumentsValue)
  if (!args.success) throw new Error('MCP tool arguments must be a JSON object.')
  const config = configuredServers().find((server) => server.id === tool.serverId)
  if (!config) throw new Error(`MCP server is not configured: ${tool.serverId}`)
  const session = await openSession(config)
  return requestRpc(session, 'tools/call', { name: tool.name, arguments: args.data }, 3)
}
