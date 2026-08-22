import { z } from 'zod'

// ─── Skill Domains ───────────────────────────────────────────────────────────

export const SKILL_DOMAINS = [
  'planning',
  'system-design',
  'frontend-ui-ux',
  'debugging',
  'testing',
  'ai-mcp',
  'docs',
  'general-utilities',
] as const

export type SkillDomain = (typeof SKILL_DOMAINS)[number]

// ─── Tool Schemas (Zod — single source of truth) ─────────────────────────────

/** Render a diagram from a textual spec (Mermaid, D2, PlantUML, or ASCII). */
export const DiagramRenderSchema = z.object({
  language: z.enum(['mermaid', 'd2', 'plantuml', 'ascii']),
  spec: z.string().trim().min(1).max(8_000),
  title: z.string().trim().max(200).optional(),
})

/** Retrieve current weather for a location, with optional unit preference. */
export const WeatherLookupSchema = z.object({
  location: z.string().trim().min(1).max(200),
  units: z.enum(['metric', 'imperial']).default('metric'),
})

/** Rewrite text to remove stock AI phrasing and read more naturally. */
export const HumanizeTextSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  tone: z.enum(['casual', 'professional', 'warm']).default('casual'),
})

/** Propose a concrete calendar block; end time is computed from duration. */
export const ScheduleBlockSchema = z.object({
  title: z.string().trim().min(1).max(200),
  start: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(480),
  notes: z.string().max(2_000).optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

/** Statically analyze code for complexity, security, and style findings. */
export const CodeAnalyzeSchema = z.object({
  code: z.string().min(1).max(50_000),
  language: z.string().max(40).optional(),
  checks: z
    .array(z.enum(['complexity', 'security', 'style']))
    .max(3)
    .default(['complexity']),
})

// ─── Tool Metadata ───────────────────────────────────────────────────────────

export type SkillToolName =
  'diagram_render' | 'weather_lookup' | 'humanize_text' | 'schedule_block' | 'code_analyze'

/**
 * Browser-safe tool metadata (name, description, JSON-schema parameters).
 * Executors live in `lib/skills/tools.ts` (server-only: they use node
 * builtins and call external providers) — this module must stay importable
 * from client components.
 */
export interface SkillToolMetadata {
  name: SkillToolName
  description: string
  /** OpenAI-compatible JSON schema derived from the Zod schema. */
  parameters: Record<string, unknown>
}

/** Strip the JSON-Schema `$schema` annotation for OpenAI compatibility. */
function toToolParameters(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema)
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { type: 'object', properties: {} }
  }
  const parameters = { ...(json as Record<string, unknown>) }
  delete parameters.$schema
  return parameters
}

export const SKILL_TOOL_METADATA: SkillToolMetadata[] = [
  {
    name: 'diagram_render',
    description:
      'Render a diagram from a textual spec (Mermaid, D2, PlantUML, or ASCII). Uses a Kroki-compatible service when DIAGRAM_RENDER_URL is configured, otherwise returns a text preview.',
    parameters: toToolParameters(DiagramRenderSchema),
  },
  {
    name: 'weather_lookup',
    description:
      'Retrieve current weather for a location. Uses WEATHER_API_URL/WEATHER_API_KEY when configured, otherwise returns a clearly marked placeholder forecast.',
    parameters: toToolParameters(WeatherLookupSchema),
  },
  {
    name: 'humanize_text',
    description:
      'Rewrite text to remove stock AI phrasing and read more naturally. Returns the revised text with a list of applied replacements.',
    parameters: toToolParameters(HumanizeTextSchema),
  },
  {
    name: 'schedule_block',
    description:
      'Propose a calendar block from a title, ISO start time, and duration in minutes. Creates the event via Google Calendar (service account) when configured, otherwise confirms the computed end time locally.',
    parameters: toToolParameters(ScheduleBlockSchema),
  },
  {
    name: 'code_analyze',
    description:
      'Statically analyze code and return metrics plus findings for complexity, security, and style checks.',
    parameters: toToolParameters(CodeAnalyzeSchema),
  },
]

// ─── Skill Metadata ───────────────────────────────────────────────────────────

export interface Skill {
  id: string
  domain: SkillDomain
  name: string
  description: string
  /** Injected verbatim into the system prompt when the skill is active. */
  systemInstructions: string
  /** Registered tools this skill unlocks; every name must exist in SKILL_TOOLS. */
  toolNames: SkillToolName[]
}

export const SKILLS: Skill[] = [
  {
    id: 'planning',
    domain: 'planning',
    name: 'Planning',
    description: 'Phase-based task decomposition, estimates, and scheduling.',
    systemInstructions:
      'You structure work into explicit phases and small, verifiable tasks with dependencies and done-criteria. Before proposing a schedule, confirm scope and constraints, then estimate in ranges. Use the schedule_block tool to propose concrete calendar blocks when the user asks to plan or schedule work.',
    toolNames: ['schedule_block'],
  },
  {
    id: 'system-design',
    domain: 'system-design',
    name: 'System Design',
    description: 'Architecture design with boundaries, tradeoffs, and diagrams.',
    systemInstructions:
      'You design pragmatic architectures: clear component boundaries, explicit contracts, documented data flow, and honest tradeoffs. Prefer the simplest design that meets the requirements. Use diagram_render to produce diagrams (Mermaid, D2, PlantUML, or ASCII) that communicate proposed or existing architecture.',
    toolNames: ['diagram_render'],
  },
  {
    id: 'frontend-ui-ux',
    domain: 'frontend-ui-ux',
    name: 'Frontend UI/UX',
    description: 'React/Next.js best practices, accessibility, and motion.',
    systemInstructions:
      'You follow modern React and Next.js best practices: components over effects, composition over prop drilling, and accessibility (WCAG 2.2) as a baseline. When reviewing or building UI, call out usability, accessibility, motion, and performance concerns with concrete suggestions.',
    toolNames: [],
  },
  {
    id: 'debugging',
    domain: 'debugging',
    name: 'Debugging',
    description: 'Systematic root-cause analysis with code metrics.',
    systemInstructions:
      'You debug systematically: reproduce the failure, form hypotheses ranked by likelihood, verify with targeted checks, and fix with the smallest change. Use code_analyze to gather objective metrics and risky-pattern findings about the code under investigation.',
    toolNames: ['code_analyze'],
  },
  {
    id: 'testing',
    domain: 'testing',
    name: 'Testing',
    description: 'Behavior-first test design and reliable suites.',
    systemInstructions:
      'You design behavior-first tests with edge-case coverage and fast, reliable suites. Match the existing test conventions, prefer integration over mocks at boundaries, and keep tests deterministic and quick to run.',
    toolNames: [],
  },
  {
    id: 'ai-mcp',
    domain: 'ai-mcp',
    name: 'AI & MCP',
    description: 'LLM tool calling, function calling, and MCP conventions.',
    systemInstructions:
      'You are knowledgeable about LLM tool calling, function calling, and the Model Context Protocol (MCP). When a tool is available, prefer calling it over guessing, and interpret tool results honestly, flagging uncertainty and provider fallbacks.',
    toolNames: [],
  },
  {
    id: 'docs',
    domain: 'docs',
    name: 'Documentation',
    description: 'Clear, skimmable writing and text humanization.',
    systemInstructions:
      'You write clear, accurate, skimmable documentation: short sentences, concrete examples, and consistent structure. Use humanize_text to remove jargon and stock phrasing from drafts before presenting them.',
    toolNames: ['humanize_text'],
  },
  {
    id: 'general-utilities',
    domain: 'general-utilities',
    name: 'General Utilities',
    description: 'Everyday lookups with graceful provider fallbacks.',
    systemInstructions:
      'You handle everyday lookups and requests pragmatically. Use weather_lookup for current conditions when requested, and be explicit when a result is a placeholder because no live provider is configured.',
    toolNames: ['weather_lookup'],
  },
]

// ─── Activation ───────────────────────────────────────────────────────────────

/** Whether an id names a registered skill. */
export function isValidSkillId(id: string): boolean {
  return SKILLS.some((skill) => skill.id === id)
}

/** Keep only known skill ids, deduplicated and in registry order. */
export function normalizeSkillIds(ids: string[]): string[] {
  return [...new Set(ids.filter(isValidSkillId))]
}

/**
 * Resolve the active skill ids. An explicit per-session list wins; otherwise
 * SKILLS_ENABLED (comma-separated env var) narrows the catalog; otherwise the
 * full catalog is active.
 */
export function resolveSkillIds(enabledIds?: string[] | null): string[] {
  if (enabledIds) return normalizeSkillIds(enabledIds)
  const raw = process.env.SKILLS_ENABLED
  if (!raw) return SKILLS.map((skill) => skill.id)
  const allowed = raw
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean)
  return allowed.length > 0 ? normalizeSkillIds(allowed) : SKILLS.map((skill) => skill.id)
}

/**
 * Active skills. An explicit per-session list wins; otherwise SKILLS_ENABLED
 * (comma-separated skill ids) narrows the catalog; otherwise all are active.
 */
export function getActiveSkills(enabledIds?: string[] | null): Skill[] {
  const allowed = new Set(resolveSkillIds(enabledIds))
  return SKILLS.filter((skill) => allowed.has(skill.id))
}

/** System-prompt section describing every active skill and its tools. */
export function getSkillSystemInstructions(enabledIds?: string[] | null): string {
  return getActiveSkills(enabledIds)
    .map((skill) => {
      const tools =
        skill.toolNames.length > 0
          ? `\nTools: ${skill.toolNames.map((name) => `\`${name}\``).join(', ')}.`
          : ''
      return `### Skill: ${skill.name}\n${skill.systemInstructions}${tools}`
    })
    .join('\n\n')
}

/** Whether a user message plausibly needs one of the registered skill tools. */
export function hasSkillToolIntent(text: string): boolean {
  return (
    /(diagram|mermaid|\bd2\b|plantuml|flowchart|flow chart|architecture map)/i.test(text) ||
    /\b(weather|forecast|temperature|humidity|rain)\b/i.test(text) ||
    /(humaniz|less robotic|more natural|make it sound)/i.test(text) ||
    /\b(schedule|calendar|block|meeting|appointment)\b/i.test(text) ||
    /(analy[sz]e (?:the )?(?:code|this)|code analysis|code review|review this code|\blint\b)/i.test(
      text,
    )
  )
}

// ─── Client Catalog ───────────────────────────────────────────────────────────

/** Serializable skill shape for the client (no executors or schemas). */
export interface ClientSkill {
  id: string
  name: string
  domain: SkillDomain
  description: string
  systemInstructions: string
  toolNames: SkillToolName[]
}

/** Serializable tool shape for the client, including its JSON-schema params. */
export interface ClientSkillTool {
  name: SkillToolName
  description: string
  parameters: Record<string, unknown>
}

/**
 * The catalog a client needs to advertise capabilities: every skill with its
 * instructions and tools, plus the ids currently active for the given
 * override (or env/defaults when none is provided).
 */
export interface SkillCatalog {
  skills: ClientSkill[]
  tools: ClientSkillTool[]
  activeSkillIds: string[]
}

export function getSkillCatalog(enabledIds?: string[] | null): SkillCatalog {
  const active = new Set(resolveSkillIds(enabledIds))
  return {
    skills: SKILLS.map(({ id, name, domain, description, systemInstructions, toolNames }) => ({
      id,
      name,
      domain,
      description,
      systemInstructions,
      toolNames,
    })),
    tools: SKILL_TOOL_METADATA.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    activeSkillIds: SKILLS.filter((skill) => active.has(skill.id)).map((skill) => skill.id),
  }
}
