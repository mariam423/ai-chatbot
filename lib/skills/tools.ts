import { z } from 'zod'
import { createSign } from 'node:crypto'
import type { AgentToolResult } from '@/lib/agent-tools'
import type { OpenAITool } from '@/lib/mcp-client'
import { assertSafeUrl } from '@/lib/ssrf'
import {
  CodeAnalyzeSchema,
  DiagramRenderSchema,
  HumanizeTextSchema,
  ScheduleBlockSchema,
  SKILL_TOOL_METADATA,
  WeatherLookupSchema,
  getActiveSkills,
  type SkillToolName,
} from '@/lib/skills/registry'

/**
 * Skill tool EXECUTORS. This module is intentionally server-only: it imports
 * node builtins (node:crypto) and calls external providers, and must never be
 * imported from client components — `lib/skills/registry.ts` (browser-safe)
 * is the client-facing surface.
 */

const MAX_TOOL_TEXT = 8_000
const TOOL_TIMEOUT_MS = 8_000
/** Cap the diagram SVG so the tool result fits the bounded tool-message size. */
const MAX_DIAGRAM_SVG = 48_000

/** Per-user provider credentials resolved server-side (e.g. from Settings). */
export interface GoogleCalendarCredentials {
  calendarId: string
  email: string
  privateKey: string
}

/** Optional per-request context passed to tool executors. */
export interface SkillToolContext {
  googleCalendar?: GoogleCalendarCredentials | null
}

export interface SkillTool {
  name: SkillToolName
  description: string
  /** Zod schema that validates every call before `run` is invoked. */
  schema: z.ZodType
  /** OpenAI-compatible JSON schema derived from the Zod schema. */
  parameters: Record<string, unknown>
  /** Executes a validated call. `args` is the output of `schema` (already parsed). */
  run: (args: unknown, context?: SkillToolContext) => AgentToolResult | Promise<AgentToolResult>
}

type SkillToolExecutor = (
  args: unknown,
  context?: SkillToolContext,
) => AgentToolResult | Promise<AgentToolResult>

// ─── Shared helpers ───────────────────────────────────────────────────────────

function asciiPreview(title: string | undefined, spec: string): string {
  const lines = spec.split('\n').slice(0, 8)
  const width = Math.max(1, ...lines.map((line) => line.length), title?.length ?? 0)
  const border = '+' + '-'.repeat(width + 2) + '+'
  const body = [
    ...(title ? [`| ${title.padEnd(width)} |`] : []),
    ...lines.map((line) => `| ${line.padEnd(width)} |`),
  ]
  return [border, ...body, border].join('\n')
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

function maxBraceDepth(code: string): number {
  let depth = 0
  let max = 0
  for (const char of code) {
    if (char === '{' || char === '(' || char === '[') {
      depth += 1
      max = Math.max(max, depth)
    } else if (char === '}' || char === ')' || char === ']') {
      depth = Math.max(0, depth - 1)
    }
  }
  return max
}

// ─── diagram_render (Kroki-compatible service) ────────────────────────────────

type DiagramLanguage = z.output<typeof DiagramRenderSchema>['language']

/** Kroki diagram types for the supported languages; ASCII maps to svgbob. */
const DIAGRAM_KROKI_TYPES: Record<DiagramLanguage, string> = {
  mermaid: 'mermaid',
  d2: 'd2',
  plantuml: 'plantuml',
  ascii: 'svgbob',
}

async function renderDiagram(
  language: DiagramLanguage,
  spec: string,
): Promise<Record<string, unknown>> {
  const baseUrl = (process.env.DIAGRAM_RENDER_URL ?? 'https://kroki.io').replace(/\/+$/, '')
  const apiKey = process.env.DIAGRAM_RENDER_API_KEY
  // SSRF guard (OWASP A10): DIAGRAM_RENDER_URL is operator config, but an
  // unsafe destination is refused (the executor falls back to the preview).
  const safe = await assertSafeUrl(baseUrl)
  if (!safe.ok) throw new Error(`Diagram provider rejected: ${safe.reason}`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}/${DIAGRAM_KROKI_TYPES[language]}/svg`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Accept: 'image/svg+xml',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: spec,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Diagram provider returned ${response.status}.`)
    const svg = (await response.text()).slice(0, MAX_DIAGRAM_SVG)
    if (!svg.trim()) throw new Error('Diagram provider returned an empty image.')
    return {
      provider: 'kroki',
      language,
      rendered: true,
      mimeType: 'image/svg+xml',
      imageUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      message: 'Embed the imageUrl in a Markdown image to display the rendered diagram.',
    }
  } finally {
    clearTimeout(timeout)
  }
}

const diagramRenderExecutor: SkillToolExecutor = async (args) => {
  const input = args as z.output<typeof DiagramRenderSchema>
  const preview = asciiPreview(input.title, input.spec)
  if (!process.env.DIAGRAM_RENDER_URL) {
    return {
      ok: true,
      tool: 'diagram_render',
      data: {
        provider: 'mock-diagram',
        language: input.language,
        title: input.title ?? null,
        spec: input.spec,
        rendered: false,
        preview,
        message: 'No diagram provider is configured; the spec is returned with a text preview.',
      },
    }
  }
  try {
    const rendered = await renderDiagram(input.language, input.spec)
    return {
      ok: true,
      tool: 'diagram_render',
      data: { ...rendered, title: input.title ?? null, spec: input.spec },
    }
  } catch (error) {
    return {
      ok: true,
      tool: 'diagram_render',
      data: {
        provider: 'kroki',
        language: input.language,
        title: input.title ?? null,
        spec: input.spec,
        rendered: false,
        preview,
        message:
          error instanceof Error
            ? error.message
            : 'Diagram rendering failed; showing a text preview instead.',
      },
    }
  }
}

// ─── weather_lookup (optional WEATHER_API_URL provider) ───────────────────────

async function lookupWeather(location: string, units: 'metric' | 'imperial'): Promise<unknown> {
  const endpoint = process.env.WEATHER_API_URL
  const apiKey = process.env.WEATHER_API_KEY
  if (!endpoint || !apiKey) {
    return {
      provider: 'mock',
      location,
      units,
      condition: null,
      temperature: null,
      message: 'No weather provider is configured; returning a placeholder forecast.',
    }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)
  try {
    // SSRF guard (OWASP A10): refuse to POST to a private/loopback destination.
    const safe = await assertSafeUrl(endpoint)
    if (!safe.ok) throw new Error(`Weather provider rejected: ${safe.reason}`)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ location, units }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Weather provider returned ${response.status}.`)
    return JSON.parse((await response.text()).slice(0, MAX_TOOL_TEXT))
  } finally {
    clearTimeout(timeout)
  }
}

const weatherLookupExecutor: SkillToolExecutor = async (args) => {
  const input = args as z.output<typeof WeatherLookupSchema>
  try {
    const data = await lookupWeather(input.location, input.units)
    return { ok: true, tool: 'weather_lookup', data }
  } catch (error) {
    return {
      ok: false,
      tool: 'weather_lookup',
      data: null,
      error: error instanceof Error ? error.message : 'Weather lookup failed.',
    }
  }
}

// ─── humanize_text (deterministic) ────────────────────────────────────────────

const STOCK_PHRASE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bdelve into\b/gi, 'dig into'],
  [/\bleverage\b/gi, 'use'],
  [/\butilize\b/gi, 'use'],
  [/\bin order to\b/gi, 'to'],
  [/\bit is important to note that\b/gi, 'note that'],
  [/\bfurthermore\b/gi, 'also'],
  [/\badditionally\b/gi, 'also'],
  [/\bmoreover\b/gi, 'also'],
  [/\bcutting[- ]edge\b/gi, 'modern'],
  [/\bstate[- ]of[- ]the[- ]art\b/gi, 'modern'],
  [/\bseamless\b/gi, 'smooth'],
  [/\brobust\b/gi, 'solid'],
  [/\bgame[- ]changer\b/gi, 'big improvement'],
  [/\bat the end of the day\b/gi, 'in the end'],
  [/\bin conclusion\b/gi, 'in short'],
]

const humanizeTextExecutor: SkillToolExecutor = (args) => {
  const input = args as z.output<typeof HumanizeTextSchema>
  const replacements: Array<{ from: string; to: string; count: number }> = []
  let humanized = input.text
  for (const [pattern, replacement] of STOCK_PHRASE_REPLACEMENTS) {
    const count = countMatches(humanized, pattern)
    if (count === 0) continue
    humanized = humanized.replace(pattern, replacement)
    replacements.push({ from: pattern.source, to: replacement, count })
  }
  return {
    ok: true,
    tool: 'humanize_text',
    data: {
      text: humanized,
      originalLength: input.text.length,
      humanizedLength: humanized.length,
      replacements,
      tone: input.tone,
    },
  }
}

// ─── schedule_block (Google Calendar service account) ─────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'

function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.includes('-----BEGIN') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8')
}

/** Sign a Google service-account JWT (RS256) for the server-to-server flow. */
function createServiceAccountJwt(email: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: email,
    scope: GOOGLE_CALENDAR_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const signingInput = `${encode(header)}.${encode(claims)}`
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(normalizePrivateKey(privateKeyPem), 'base64url')
  return `${signingInput}.${signature}`
}

interface CalendarBlock {
  title: string
  notes: string | null
  start: string
  end: string
}

/** Exchange a signed service-account JWT for an access token; throws on failure. */
export async function exchangeGoogleAccessToken(
  email: string,
  privateKey: string,
): Promise<string> {
  const jwt = createServiceAccountJwt(email, privateKey)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)
  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
      signal: controller.signal,
    })
    if (!tokenResponse.ok)
      throw new Error(`Google token endpoint returned ${tokenResponse.status}.`)
    const tokenPayload = z
      .object({ access_token: z.string().min(1) })
      .safeParse(await tokenResponse.json())
    if (!tokenPayload.success) throw new Error('Google token endpoint returned no access token.')
    return tokenPayload.data.access_token
  } finally {
    clearTimeout(timeout)
  }
}

/** Parse a Google service-account key JSON; returns null when invalid. */
export function parseGoogleServiceAccountKey(
  raw: string,
): { email: string; privateKey: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const result = z
    .object({
      client_email: z.string().min(1),
      private_key: z.string().min(1),
    })
    .safeParse(parsed)
  return result.success
    ? { email: result.data.client_email, privateKey: result.data.private_key }
    : null
}

/** Resolve calendar credentials: per-user context wins, then env vars. */
export function resolveGoogleCredentials(
  context?: SkillToolContext,
): GoogleCalendarCredentials | null {
  if (context?.googleCalendar) return context.googleCalendar
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  if (!calendarId || !email || !privateKey) return null
  return { calendarId, email, privateKey }
}

/** Create a Google Calendar event via service-account auth; throws on failure. */
export async function createGoogleCalendarEvent(
  block: CalendarBlock,
  credentials: GoogleCalendarCredentials,
): Promise<Record<string, unknown>> {
  const { calendarId, email, privateKey } = credentials
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)
  try {
    const accessToken = await exchangeGoogleAccessToken(email, privateKey)

    const eventResponse = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          summary: block.title,
          ...(block.notes ? { description: block.notes } : {}),
          start: { dateTime: block.start, timeZone: 'UTC' },
          end: { dateTime: block.end, timeZone: 'UTC' },
        }),
        signal: controller.signal,
      },
    )
    if (!eventResponse.ok) throw new Error(`Google Calendar returned ${eventResponse.status}.`)
    const eventPayload = z
      .object({
        id: z.string().min(1).optional(),
        htmlLink: z.string().optional(),
        status: z.string().optional(),
      })
      .safeParse(await eventResponse.json())
    if (!eventPayload.success) throw new Error('Google Calendar returned an invalid event.')
    const event = eventPayload.data
    return {
      provider: 'google-calendar',
      status: event.status ?? 'created',
      event: { id: event.id ?? null, url: event.htmlLink ?? null },
    }
  } finally {
    clearTimeout(timeout)
  }
}

/** Delete a Google Calendar event by id (used by live integration tests). */
export async function deleteGoogleCalendarEvent(
  eventId: string,
  credentials?: GoogleCalendarCredentials,
): Promise<void> {
  const resolved = credentials ?? resolveGoogleCredentials()
  if (!resolved) throw new Error('Google Calendar is not configured.')
  const { calendarId, email, privateKey } = resolved
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)
  try {
    const accessToken = await exchangeGoogleAccessToken(email, privateKey)
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      },
    )
    if (!response.ok) throw new Error(`Google Calendar returned ${response.status}.`)
  } finally {
    clearTimeout(timeout)
  }
}
const scheduleBlockExecutor: SkillToolExecutor = async (args, context) => {
  const input = args as z.output<typeof ScheduleBlockSchema>
  const start = new Date(input.start)
  const end = new Date(start.getTime() + input.durationMinutes * 60_000)
  const block: CalendarBlock = {
    title: input.title,
    start: start.toISOString(),
    end: end.toISOString(),
    notes: input.notes ?? null,
  }
  const credentials = resolveGoogleCredentials(context)
  if (!credentials) {
    return {
      ok: true,
      tool: 'schedule_block',
      data: {
        provider: 'mock-calendar',
        block: { ...block, durationMinutes: input.durationMinutes, priority: input.priority },
        message:
          'No calendar provider is configured; the block is confirmed locally only. Configure a Google service account in Settings or GOOGLE_* env vars to create real events.',
      },
    }
  }
  try {
    const created = await createGoogleCalendarEvent(block, credentials)
    return {
      ok: true,
      tool: 'schedule_block',
      data: {
        provider: 'google-calendar',
        block: { ...block, durationMinutes: input.durationMinutes, priority: input.priority },
        ...created,
      },
    }
  } catch (error) {
    return {
      ok: true,
      tool: 'schedule_block',
      data: {
        provider: 'mock-calendar',
        block: { ...block, durationMinutes: input.durationMinutes, priority: input.priority },
        message:
          error instanceof Error
            ? `Calendar provider failed: ${error.message} The block is confirmed locally only.`
            : 'Calendar provider failed; the block is confirmed locally only.',
      },
    }
  }
}

// ─── code_analyze (deterministic) ─────────────────────────────────────────────

interface RiskPattern {
  regex: RegExp
  rule: string
  severity: 'high' | 'medium'
  message: string
}

const RISK_PATTERNS: RiskPattern[] = [
  {
    regex: /\beval\s*\(/g,
    rule: 'no-eval',
    severity: 'high',
    message: 'eval() executes arbitrary strings as code; avoid it.',
  },
  {
    regex: /innerHTML\s*=/g,
    rule: 'no-innerhtml',
    severity: 'high',
    message: 'Assigning innerHTML can enable XSS; use textContent or a safe renderer.',
  },
  {
    regex: /dangerouslySetInnerHTML/g,
    rule: 'no-dangerous-html',
    severity: 'high',
    message: 'dangerouslySetInnerHTML bypasses React escaping; sanitize any HTML input.',
  },
  {
    regex: /\bFunction\s*\(/g,
    rule: 'no-function-ctor',
    severity: 'high',
    message: 'The Function constructor compiles arbitrary strings; use a safe parser instead.',
  },
  {
    regex: /child_process/g,
    rule: 'no-child-process',
    severity: 'medium',
    message: 'Shelling out to child processes is risky in serverless or sandboxed contexts.',
  },
  {
    regex: /document\.write/g,
    rule: 'no-document-write',
    severity: 'medium',
    message: 'document.write can clobber the document; build the DOM with APIs instead.',
  },
]

const codeAnalyzeExecutor: SkillToolExecutor = (args) => {
  const input = args as z.output<typeof CodeAnalyzeSchema>
  const lines = input.code.split('\n')
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
  const metrics = {
    language: input.language ?? null,
    lineCount: lines.length,
    nonEmptyLines: nonEmptyLines.length,
    functionCount: countMatches(input.code, /\b(?:function|=>)\b/g),
    classCount: countMatches(input.code, /\bclass\s+\w+/g),
    maxDepth: maxBraceDepth(input.code),
    avgLineLength:
      nonEmptyLines.length > 0
        ? Math.round(
            nonEmptyLines.reduce((sum, line) => sum + line.length, 0) / nonEmptyLines.length,
          )
        : 0,
    todoCount: countMatches(input.code, /\b(?:TODO|FIXME|HACK)\b/g),
  }
  const findings: Array<{
    severity: string
    rule: string
    message: string
    line: number | null
  }> = []
  if (input.checks.includes('security')) {
    for (const pattern of RISK_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
      let match: RegExpExecArray | null
      while ((match = regex.exec(input.code)) !== null) {
        const line = input.code.slice(0, match.index).split('\n').length
        findings.push({
          severity: pattern.severity,
          rule: pattern.rule,
          line,
          message: pattern.message,
        })
        if (regex.lastIndex === match.index) regex.lastIndex += 1
      }
    }
  }
  if (input.checks.includes('complexity')) {
    if (metrics.maxDepth > 6) {
      findings.push({
        severity: 'medium',
        rule: 'deep-nesting',
        line: null,
        message: `Maximum nesting depth is ${metrics.maxDepth}; extract helpers to reduce it.`,
      })
    }
    if (metrics.functionCount > 12) {
      findings.push({
        severity: 'low',
        rule: 'many-functions',
        line: null,
        message: `File declares ${metrics.functionCount} functions; consider splitting it.`,
      })
    }
  }
  if (input.checks.includes('style')) {
    if (metrics.avgLineLength > 120) {
      findings.push({
        severity: 'low',
        rule: 'long-lines',
        line: null,
        message: `Average line length is ${metrics.avgLineLength} characters.`,
      })
    }
    if (metrics.todoCount > 0) {
      findings.push({
        severity: 'low',
        rule: 'todos-remaining',
        line: null,
        message: `${metrics.todoCount} TODO/FIXME markers remain.`,
      })
    }
  }
  return {
    ok: true,
    tool: 'code_analyze',
    data: { checks: input.checks, metrics, findings },
  }
}

// ─── Tool registry (metadata + executors) ─────────────────────────────────────

const TOOL_SCHEMAS: Record<SkillToolName, z.ZodType> = {
  diagram_render: DiagramRenderSchema,
  weather_lookup: WeatherLookupSchema,
  humanize_text: HumanizeTextSchema,
  schedule_block: ScheduleBlockSchema,
  code_analyze: CodeAnalyzeSchema,
}

const TOOL_EXECUTORS: Record<SkillToolName, SkillToolExecutor> = {
  diagram_render: diagramRenderExecutor,
  weather_lookup: weatherLookupExecutor,
  humanize_text: humanizeTextExecutor,
  schedule_block: scheduleBlockExecutor,
  code_analyze: codeAnalyzeExecutor,
}

export const SKILL_TOOLS: SkillTool[] = SKILL_TOOL_METADATA.map((metadata) => ({
  ...metadata,
  schema: TOOL_SCHEMAS[metadata.name],
  run: TOOL_EXECUTORS[metadata.name],
}))

/** Tools exposed by the currently active skills. */
export function listSkillTools(enabledIds?: string[] | null): SkillTool[] {
  const enabled = new Set(getActiveSkills(enabledIds).flatMap((skill) => skill.toolNames))
  return SKILL_TOOLS.filter((tool) => enabled.has(tool.name))
}

/** Bind registered Zod tool schemas to the OpenAI-compatible function shape. */
export function toOpenAISkillTools(tools: SkillTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

/**
 * Execute one registered skill tool. Arguments are JSON-validated against the
 * tool's Zod schema first; any failure — invalid JSON, schema mismatch, unknown
 * tool, or a throwing executor — returns a structured fallback result.
 */
export async function executeSkillTool(
  name: string,
  argumentsJson: string,
  context?: SkillToolContext,
): Promise<AgentToolResult> {
  const tool = SKILL_TOOLS.find((candidate) => candidate.name === name)
  if (!tool) {
    return { ok: false, tool: name, data: null, error: `Unknown skill tool: ${name}` }
  }
  let raw: unknown
  try {
    raw = JSON.parse(argumentsJson || '{}')
  } catch {
    return { ok: false, tool: name, data: null, error: 'Skill tool arguments were not valid JSON.' }
  }
  const parsed = tool.schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      tool: name,
      data: null,
      error: issue
        ? `Invalid arguments: ${issue.path.join('.') || '<root>'}: ${issue.message}`
        : 'Invalid arguments.',
    }
  }
  try {
    return await tool.run(parsed.data, context)
  } catch (error) {
    return {
      ok: false,
      tool: name,
      data: null,
      error: error instanceof Error ? error.message : 'Skill tool execution failed.',
    }
  }
}
