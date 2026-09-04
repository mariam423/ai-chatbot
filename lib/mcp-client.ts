import { z } from 'zod'
import { assertSafeUrl } from '@/lib/ssrf'

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
  // MCP servers send JSON Schema here. Keep it as data, then validate each
  // tool call against the discovered schema before it leaves this process.
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

/**
 * Validate the common JSON-Schema subset used by MCP tool inputSchema values.
 *
 * MCP schemas are supplied by remote servers, so converting them to executable
 * code or trusting them as Zod is unsafe. This bounded validator handles the
 * interoperable object/array/string/number/boolean subset, required fields,
 * enums, and additionalProperties without throwing on malformed schemas.
 */
export function validateMcpArguments(
  value: unknown,
  schema: Record<string, unknown>,
  path = 'arguments',
  depth = 0,
): string | null {
  if (depth > 12) return `${path} exceeds the schema nesting limit.`

  const enumValues = schema.enum
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => Object.is(candidate, value))) {
    return `${path} must be one of the allowed values.`
  }
  if ('const' in schema && !Object.is(schema.const, value)) {
    return `${path} must equal the schema constant.`
  }

  const type = schema.type
  if (type === undefined) return null
  if (Array.isArray(type)) {
    if (
      type.some(
        (candidate) =>
          validateMcpArguments(value, { ...schema, type: candidate }, path, depth + 1) === null,
      )
    ) {
      return null
    }
    return `${path} has an invalid type.`
  }

  switch (type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `${path} must be an object.`
      }
      const object = value as Record<string, unknown>
      const required = Array.isArray(schema.required) ? schema.required : []
      for (const key of required) {
        if (typeof key === 'string' && !(key in object)) return `${path}.${key} is required.`
      }
      const properties =
        schema.properties &&
        typeof schema.properties === 'object' &&
        !Array.isArray(schema.properties)
          ? (schema.properties as Record<string, unknown>)
          : {}
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!(key in object) || !propertySchema || typeof propertySchema !== 'object') continue
        const error = validateMcpArguments(
          object[key],
          propertySchema as Record<string, unknown>,
          `${path}.${key}`,
          depth + 1,
        )
        if (error) return error
      }
      if (schema.additionalProperties === false) {
        const unknown = Object.keys(object).find((key) => !(key in properties))
        if (unknown) return `${path}.${unknown} is not allowed.`
      }
      return null
    }
    case 'array': {
      if (!Array.isArray(value)) return `${path} must be an array.`
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
        return `${path} must contain at least ${schema.minItems} items.`
      }
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
        return `${path} must contain at most ${schema.maxItems} items.`
      }
      if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
        for (const [index, item] of value.entries()) {
          const error = validateMcpArguments(
            item,
            schema.items as Record<string, unknown>,
            `${path}[${index}]`,
            depth + 1,
          )
          if (error) return error
        }
      }
      return null
    }
    case 'string':
      if (typeof value !== 'string') return `${path} must be a string.`
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
        return `${path} is too short.`
      }
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
        return `${path} is too long.`
      }
      return null
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a number.`
      if (type === 'integer' && !Number.isInteger(value)) return `${path} must be an integer.`
      return null
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path} must be a boolean.`
    case 'null':
      return value === null ? null : `${path} must be null.`
    default:
      // Unknown JSON-Schema keywords/types are ignored rather than making a
      // valid MCP server unusable. The object boundary remains enforced.
      return null
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
  // SSRF guard (OWASP A10): the URL is operator config, but an unsafe entry
  // (private/loopback IP, non-http scheme, unresolvable host) is rejected
  // before any connection. listMcpTools treats this as an unavailable server
  // (skipped via allSettled); callMcpTool surfaces it as a tool error.
  const safe = await assertSafeUrl(config.url)
  if (!safe.ok) {
    throw new Error(`MCP server ${config.id} rejected: ${safe.reason}`)
  }
  const session: McpSession = { config }
  await requestRpc(
    session,
    'initialize',
    {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'pulse-ai-agent', version: '1.0.0' },
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
  const schemaError = validateMcpArguments(args.data, tool.inputSchema)
  if (schemaError) throw new Error(`MCP tool arguments failed validation: ${schemaError}`)
  const config = configuredServers().find((server) => server.id === tool.serverId)
  if (!config) throw new Error(`MCP server is not configured: ${tool.serverId}`)
  const session = await openSession(config)
  return requestRpc(session, 'tools/call', { name: tool.name, arguments: args.data }, 3)
}
