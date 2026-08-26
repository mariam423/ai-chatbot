import { z } from 'zod'

export const StructuredOutputKindSchema = z.enum(['table', 'chart', 'code', 'citations'])
export type StructuredOutputKind = z.infer<typeof StructuredOutputKindSchema>

const CitationSchema = z
  .object({
    label: z.string().min(1).max(300),
    section: z.string().min(1).max(100),
    quote: z.string().max(2_000),
  })
  .strict()

export const ChartPointSchema = z
  .object({
    timestamp: z.string().min(1).max(200),
    value: z.number().finite(),
  })
  .strict()

/** The model envelope is intentionally simple so it can stream as JSON. */
export const StructuredResponseSchema = z
  .object({
    kind: StructuredOutputKindSchema,
    content: z.string().max(20_000),
    code: z.string().max(20_000),
    language: z.string().max(40),
    columns: z.array(z.string().max(200)).max(30),
    rows: z.array(z.array(z.string().max(1_000)).max(30)).max(500),
    chart: z.array(ChartPointSchema).max(500).default([]),
    citations: z.array(CitationSchema).max(30),
  })
  .strict()
export type StructuredResponse = z.infer<typeof StructuredResponseSchema>

/** Strict per-kind schemas used by agent planning and structured renderers. */
export const TableStructuredOutputSchema = StructuredResponseSchema.extend({
  kind: z.literal('table'),
})
export const CodeStructuredOutputSchema = StructuredResponseSchema.extend({
  kind: z.literal('code'),
})
/** Recharts consumes the validated `chart` points from this chart envelope. */
export const RechartsStructuredOutputSchema = StructuredResponseSchema.extend({
  kind: z.literal('chart'),
})
export const StructuredOutputSchema = z.discriminatedUnion('kind', [
  TableStructuredOutputSchema,
  CodeStructuredOutputSchema,
  RechartsStructuredOutputSchema,
  StructuredResponseSchema.extend({ kind: z.literal('citations') }),
])
export type StructuredOutput = z.infer<typeof StructuredOutputSchema>

export function structuredOutputSchemaFor(kind: StructuredOutputKind) {
  return {
    table: TableStructuredOutputSchema,
    code: CodeStructuredOutputSchema,
    chart: RechartsStructuredOutputSchema,
    citations: StructuredOutputSchema.options[3],
  }[kind]
}

/** Convert the strict per-kind Zod schema to an OpenAI-compatible schema. */
export function structuredOutputJsonSchemaFor(kind: StructuredOutputKind): Record<string, unknown> {
  const json = z.toJSONSchema(structuredOutputSchemaFor(kind))
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return STRUCTURED_RESPONSE_JSON_SCHEMA
  }
  const schema = { ...(json as Record<string, unknown>) }
  delete schema.$schema
  return schema
}

/** OpenAI-compatible strict JSON-schema payload for response_format. */
export const STRUCTURED_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'content', 'code', 'language', 'columns', 'rows', 'chart', 'citations'],
  properties: {
    kind: { type: 'string', enum: ['table', 'chart', 'code', 'citations'] },
    content: { type: 'string', description: 'Plain answer text.' },
    code: { type: 'string', description: 'Code body for code responses; empty otherwise.' },
    language: { type: 'string', description: 'Programming language for code; empty otherwise.' },
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    chart: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['timestamp', 'value'],
        properties: { timestamp: { type: 'string' }, value: { type: 'number' } },
      },
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'section', 'quote'],
        properties: {
          label: { type: 'string' },
          section: { type: 'string' },
          quote: { type: 'string' },
        },
      },
    },
  },
} as const

/** Detect when a response should use the strict structured envelope. */
export function detectStructuredOutputKind(
  question: string,
  hasDocumentContext: boolean,
): StructuredOutputKind | null {
  const normalized = question.toLocaleLowerCase()
  if (/\b(chart|graph|plot|time[- ]series|trend)\b/.test(normalized)) return 'chart'
  if (/\b(table|tabular|spreadsheet|columns?|rows?|csv)\b/.test(normalized)) return 'table'
  if (
    /\b(code|snippet|implementation|function|class|typescript|javascript|sql|python)\b/.test(
      normalized,
    )
  ) {
    return 'code'
  }
  if (hasDocumentContext || /\b(cite|citation|source|reference|according to)\b/.test(normalized)) {
    return 'citations'
  }
  return null
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

/** Convert a validated model envelope into the existing Markdown renderer's input. */
export function renderStructuredResponse(raw: string): string {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return raw
  }
  const parsed = StructuredResponseSchema.safeParse(parsedJson)
  if (!parsed.success) return raw
  const response = parsed.data

  if (response.kind === 'table') {
    if (response.columns.length === 0) return response.content
    const header = `| ${response.columns.map(escapeTableCell).join(' | ')} |`
    const divider = `| ${response.columns.map(() => '---').join(' | ')} |`
    const rows = response.rows.map(
      (row) =>
        `| ${response.columns.map((_, index) => escapeTableCell(row[index] ?? '')).join(' | ')} |`,
    )
    return [response.content, header, divider, ...rows].filter(Boolean).join('\n')
  }

  if (response.kind === 'chart') {
    if (response.chart.length === 0) return response.content
    const chartData = JSON.stringify(response.chart)
    return [response.content, `\`\`\`chart`, chartData, '```'].filter(Boolean).join('\n')
  }

  if (response.kind === 'code') {
    const language = response.language.replace(/[^a-zA-Z0-9+#.-]/g, '')
    return [response.content, `\`\`\`${language}`, response.code, '```'].filter(Boolean).join('\n')
  }

  const citations = response.citations.map(
    (citation) =>
      `- [Document: ${citation.label}, section ${citation.section}]: “${citation.quote}”`,
  )
  return [response.content, citations.join('\n')].filter(Boolean).join('\n\n')
}

export function parseStructuredResponse(raw: string): StructuredResponse | null {
  try {
    const parsed = StructuredResponseSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
