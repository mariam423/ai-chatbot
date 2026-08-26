import { z } from 'zod'
import { assertSafeUrl } from '@/lib/ssrf'
import {
  CodeStructuredOutputSchema,
  RechartsStructuredOutputSchema,
  TableStructuredOutputSchema,
  type StructuredOutput,
  type StructuredOutputKind,
} from '@/lib/structured-output'

const MAX_TOOL_TEXT = 8_000
const TOOL_TIMEOUT_MS = 8_000

export const AgentToolCallSchema = z.object({
  name: z.enum([
    'web_search',
    'code_interpreter',
    'image_inspect',
    'audio_transcribe',
    'audio_synthesize',
  ]),
  arguments: z.record(z.string(), z.unknown()).default({}),
})

export interface AgentToolDefinition {
  name: z.infer<typeof AgentToolCallSchema>['name']
  description: string
  parameters: Record<string, unknown>
  /** Optional strict output contract for tools returning structured data. */
  outputSchema?: z.ZodType
}

/** Strict Zod contracts available to the agent for rendered structured output. */
export const AgentStructuredOutputSchemas = {
  table: TableStructuredOutputSchema,
  code: CodeStructuredOutputSchema,
  chart: RechartsStructuredOutputSchema,
} as const

export function validateStructuredAgentOutput(
  kind: StructuredOutputKind,
  value: unknown,
): StructuredOutput | null {
  if (kind === 'citations') return null
  const parsed = AgentStructuredOutputSchemas[kind].safeParse(value)
  return parsed.success ? parsed.data : null
}

const CodeInterpreterOutputSchema = z
  .object({
    result: z.number().finite(),
    chart: z
      .array(z.object({ timestamp: z.string(), value: z.number().finite() }).strict())
      .max(500),
  })
  .strict()

export interface AgentToolResult {
  ok: boolean
  tool: string
  data: unknown
  error?: string
}

const TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: 'web_search',
    description:
      'Search the web for current public information. Returns titles, URLs, and snippets.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string', minLength: 2, maxLength: 300 } },
    },
  },
  {
    name: 'code_interpreter',
    description:
      'Evaluate a safe arithmetic expression or normalize chart points for time-series analysis.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['expression'],
      properties: {
        expression: { type: 'string', maxLength: 2_000 },
        points: { type: 'array', maxItems: 500 },
      },
    },
    outputSchema: CodeInterpreterOutputSchema,
  },
  {
    name: 'image_inspect',
    description:
      'Inspect an image data URL through a mock vision adapter when no vision service is configured.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['image'],
      properties: { image: { type: 'string', maxLength: 1_200_000 } },
    },
  },
  {
    name: 'audio_transcribe',
    description:
      'Transcribe audio through the configured adapter, or return a clearly marked mock result.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['audio'],
      properties: { audio: { type: 'string', maxLength: 2_000_000 } },
    },
  },
  {
    name: 'audio_synthesize',
    description: 'Synthesize speech through the configured adapter, or return a mock audio result.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string', minLength: 1, maxLength: 4_000 } },
    },
  },
]

export function listBuiltInAgentTools(): AgentToolDefinition[] {
  return TOOL_DEFINITIONS
}

/** Avoid paying for a planning call when a request cannot use a built-in tool. */
export function hasBuiltInToolIntent(text: string): boolean {
  return /\b(search the web|web search|latest|current news|look up|calculate|compute|plot|chart|graph|time[- ]series|transcribe|transcription|synthesize|text to speech|inspect image|describe image)\b/i.test(
    text,
  )
}

async function webSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = z.string().trim().min(2).max(300).parse(args.query)
  const endpoint = process.env.WEB_SEARCH_URL
  const apiKey = process.env.WEB_SEARCH_API_KEY
  if (!endpoint || !apiKey) {
    return {
      provider: 'mock',
      query,
      results: [
        {
          title: 'Web search is not configured',
          url: '',
          snippet: `Search requested for: ${query}`,
        },
      ],
    }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)
  try {
    // SSRF guard (OWASP A10): refuse to POST to a private/loopback destination
    // even when an operator misconfigures WEB_SEARCH_URL.
    const safe = await assertSafeUrl(endpoint)
    if (!safe.ok) throw new Error(`Search provider rejected: ${safe.reason}`)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Search provider returned ${response.status}.`)
    return JSON.parse((await response.text()).slice(0, MAX_TOOL_TEXT))
  } finally {
    clearTimeout(timeout)
  }
}

function codeInterpreter(args: Record<string, unknown>): unknown {
  const expression = z
    .string()
    .max(2_000)
    .parse(args.expression ?? '')
  if (
    /[a-zA-Z_$`'[\]{};]/.test(expression) ||
    /(?:constructor|window|global|process|require|import|eval|Function)/i.test(expression)
  ) {
    throw new Error('Only arithmetic expressions are allowed.')
  }
  const normalized = expression.replaceAll('^', '**')
  if (!/^[\d\s.+*/%()\-*,]+$/.test(normalized.replaceAll('**', '^'))) {
    throw new Error('Expression contains unsupported syntax.')
  }
  const result = Function(`"use strict"; return (${normalized})`)()
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('Expression did not produce a finite number.')
  }

  const pointSchema = z
    .array(z.object({ timestamp: z.union([z.string(), z.number()]), value: z.number().finite() }))
    .max(500)
  const points = pointSchema.safeParse(args.points)
  return {
    result,
    chart: points.success
      ? points.data.map((point) => ({ timestamp: String(point.timestamp), value: point.value }))
      : [],
  }
}

function imageInspect(args: Record<string, unknown>): unknown {
  const image = z
    .string()
    .regex(/^data:image\/(?:jpeg|jpg|png);base64,/)
    .max(1_200_000)
    .parse(args.image)
  return {
    provider: 'mock-vision',
    mimeType: image.slice(5, image.indexOf(';')),
    description:
      'Vision analysis is available through the configured model; this local adapter received the image safely.',
  }
}

function audioTranscribe(args: Record<string, unknown>): unknown {
  const audio = z.string().min(1).max(2_000_000).parse(args.audio)
  return {
    provider: 'mock-audio',
    duration: null,
    transcript: '[Mock transcription unavailable for this audio payload.]',
    payloadLength: audio.length,
  }
}

function audioSynthesize(args: Record<string, unknown>): unknown {
  const speech = z.string().trim().min(1).max(4_000).parse(args.text)
  return {
    provider: 'mock-audio',
    mimeType: 'audio/mpeg',
    audioUrl: null,
    text: speech,
    message: 'Configure an audio provider to synthesize audio.',
  }
}

/** Execute one built-in capability with strict argument and output boundaries. */
export async function executeBuiltInAgentTool(input: unknown): Promise<AgentToolResult> {
  const parsed = AgentToolCallSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, tool: 'unknown', data: null, error: 'Invalid built-in tool call.' }
  }
  try {
    const data =
      parsed.data.name === 'web_search'
        ? await webSearch(parsed.data.arguments)
        : parsed.data.name === 'code_interpreter'
          ? codeInterpreter(parsed.data.arguments)
          : parsed.data.name === 'image_inspect'
            ? imageInspect(parsed.data.arguments)
            : parsed.data.name === 'audio_transcribe'
              ? audioTranscribe(parsed.data.arguments)
              : audioSynthesize(parsed.data.arguments)
    const definition = TOOL_DEFINITIONS.find((tool) => tool.name === parsed.data.name)
    if (definition?.outputSchema) {
      const output = definition.outputSchema.safeParse(data)
      if (!output.success) {
        return {
          ok: false,
          tool: parsed.data.name,
          data: null,
          error: 'Built-in tool returned data outside its output schema.',
        }
      }
      return { ok: true, tool: parsed.data.name, data: output.data }
    }
    return { ok: true, tool: parsed.data.name, data }
  } catch (error) {
    return {
      ok: false,
      tool: parsed.data.name,
      data: null,
      error: error instanceof Error ? error.message : 'Tool failed.',
    }
  }
}
