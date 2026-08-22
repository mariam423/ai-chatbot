import { z } from 'zod'
import {
  callMcpTool,
  listMcpTools,
  toOpenAITools,
  type McpTool,
  type OpenAITool,
} from '@/lib/mcp-client'
import {
  executeBuiltInAgentTool,
  hasBuiltInToolIntent,
  listBuiltInAgentTools,
  type AgentToolDefinition,
} from '@/lib/agent-tools'

export const MAX_AGENT_STEPS = 4
const ToolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1).max(128),
    arguments: z.string().max(16_000),
  }),
})

export interface AgentContentPart {
  type: 'text' | 'image_url' | 'input_audio'
  text?: string
  image_url?: { url: string }
  input_audio?: { data: string; format: 'mp3' | 'wav' }
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | AgentContentPart[] | null
  tool_call_id?: string
  tool_calls?: Array<z.infer<typeof ToolCallSchema>>
}

interface CompletionResult {
  message?: {
    role?: string
    content?: string | null
    tool_calls?: unknown
  }
}

export interface AgentInputMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | AgentContentPart[]
}

export interface AgentRunOptions {
  apiKey: string
  baseUrl: string
  model: string
  messages: AgentInputMessage[]
  systemPrompt: string
  tools?: McpTool[]
  builtInTools?: AgentToolDefinition[]
  signal?: AbortSignal
  headers?: Record<string, string>
}

export interface AgentRunResult {
  /** Full execution trace, including the last non-streaming planning answer. */
  finalMessages: AgentMessage[]
  /** History to continue with a streamed final answer without replaying that answer. */
  continuationMessages: AgentMessage[]
  toolCount: number
}

function builtInDefinitions(tools: AgentToolDefinition[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(argumentsJson || '{}')
    const parsed = z.record(z.string(), z.unknown()).safeParse(value)
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

async function complete(
  options: AgentRunOptions,
  messages: AgentMessage[],
  tools: OpenAITool[],
): Promise<CompletionResult> {
  const response = await fetch(`${options.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
      ...options.headers,
    },
    body: JSON.stringify({
      model: options.model,
      stream: false,
      messages: [{ role: 'system', content: options.systemPrompt }, ...messages],
      ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    }),
    signal: options.signal,
  })
  if (!response.ok) throw new Error(`LLM API error (${response.status}).`)
  const payload = (await response.json()) as { choices?: Array<{ message?: unknown }> }
  const message = payload.choices?.[0]?.message
  const parsed = z
    .object({
      role: z.string().optional(),
      content: z.string().nullable().optional(),
      tool_calls: z.unknown().optional(),
    })
    .safeParse(message)
  return parsed.success ? { message: parsed.data } : {}
}

async function executeTool(
  tools: McpTool[],
  builtInTools: AgentToolDefinition[],
  name: string,
  argumentsJson: string,
): Promise<unknown> {
  if (name.startsWith('mcp__')) return callMcpTool(tools, name, argumentsJson)
  if (builtInTools.some((tool) => tool.name === name)) {
    return executeBuiltInAgentTool({ name, arguments: parseToolArguments(argumentsJson) })
  }
  throw new Error(`Unknown agent tool: ${name}`)
}

/** Whether the request should pay the planning-call cost for built-in tools. */
export { hasBuiltInToolIntent }

/**
 * Run bounded sequential tool-calling steps. Every assistant/tool message is
 * retained in `finalMessages`, providing execution memory for later steps.
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const mcpTools = options.tools ?? (await listMcpTools())
  const builtInTools = options.builtInTools ?? listBuiltInAgentTools()
  const availableTools = [...toOpenAITools(mcpTools), ...builtInDefinitions(builtInTools)]
  const execution: AgentMessage[] = options.messages.map(({ role, content }) => ({
    role,
    content,
  }))
  let toolCount = 0

  for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
    const result = await complete(options, execution, availableTools)
    const assistant = result.message
    if (!assistant) break
    const toolCalls = z.array(ToolCallSchema).safeParse(assistant.tool_calls ?? [])
    const assistantMessage: AgentMessage = {
      role: 'assistant',
      content: assistant.content ?? null,
      ...(toolCalls.success && toolCalls.data.length > 0 ? { tool_calls: toolCalls.data } : {}),
    }
    execution.push(assistantMessage)
    if (!toolCalls.success || toolCalls.data.length === 0) break

    for (const toolCall of toolCalls.data) {
      toolCount += 1
      let output: unknown
      try {
        output = await executeTool(
          mcpTools,
          builtInTools,
          toolCall.function.name,
          toolCall.function.arguments,
        )
      } catch (error) {
        output = { error: error instanceof Error ? error.message : 'Tool execution failed.' }
      }
      execution.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(output).slice(0, 64_000),
      })
    }
  }

  const lastMessage = execution.at(-1)
  const continuationMessages =
    toolCount > 0 && lastMessage?.role === 'assistant' && !lastMessage.tool_calls
      ? execution.slice(0, -1)
      : execution
  return { finalMessages: execution, continuationMessages, toolCount }
}
