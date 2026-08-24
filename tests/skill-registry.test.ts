import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The SSRF guard (lib/ssrf.ts) resolves configured endpoints before fetching.
// The fake `*.example.com` hosts won't resolve offline, so stub DNS to a
// public address — the guard stays active, only resolution is deterministic.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}))

import { runAgent } from '../lib/agent'
import {
  SKILLS,
  SKILL_DOMAINS,
  SKILL_TOOL_METADATA,
  getActiveSkills,
  getSkillCatalog,
  getSkillSystemInstructions,
  hasSkillToolIntent,
  isValidSkillId,
  normalizeSkillIds,
} from '../lib/skills/registry'
import {
  SKILL_TOOLS,
  executeSkillTool,
  listSkillTools,
  parseGoogleServiceAccountKey,
  resolveGoogleCredentials,
  toOpenAISkillTools,
} from '../lib/skills/tools'
import { POST } from '../app/api/chat/route'

// The route resolves the current user for per-user skill credentials;
// next-auth can't run in vitest, so fall through to anonymous access.
vi.mock('@/lib/auth-context', () => ({
  getCurrentUserId: vi.fn().mockResolvedValue(null),
}))

// The chat guard requires a session (requireSession), which lazily imports
// next-auth; next-auth imports 'next/server', which only resolves inside
// Next's bundler, so mock it (same as tests/security.test.ts).
vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: 'test-user' } }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('skill registry', () => {
  it('defines the eight requested domains with unique skills', () => {
    expect(SKILL_DOMAINS).toEqual([
      'planning',
      'system-design',
      'frontend-ui-ux',
      'debugging',
      'testing',
      'ai-mcp',
      'docs',
      'general-utilities',
    ])
    expect(SKILLS).toHaveLength(8)
    expect(new Set(SKILLS.map((skill) => skill.id)).size).toBe(8)
    expect(SKILLS.map((skill) => skill.domain)).toEqual(SKILL_DOMAINS)
    for (const skill of SKILLS) {
      expect(skill.name.length).toBeGreaterThan(0)
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.systemInstructions.length).toBeGreaterThan(60)
    }
  })

  it('references only registered tools and covers every tool by a skill', () => {
    const toolNames = new Set(SKILL_TOOL_METADATA.map((tool) => tool.name))
    for (const skill of SKILLS) {
      for (const tool of skill.toolNames) expect(toolNames.has(tool)).toBe(true)
    }
    const referenced = new Set(SKILLS.flatMap((skill) => skill.toolNames))
    for (const tool of SKILL_TOOL_METADATA) expect(referenced.has(tool.name)).toBe(true)
  })

  it('exposes all skills and their tools by default', () => {
    expect(getActiveSkills().map((skill) => skill.id)).toEqual(SKILLS.map((skill) => skill.id))
    expect(listSkillTools().map((tool) => tool.name)).toEqual(SKILL_TOOLS.map((tool) => tool.name))
    const instructions = getSkillSystemInstructions()
    expect(instructions).toContain('### Skill: Planning')
    expect(instructions).toContain('### Skill: System Design')
  })
})

describe('Zod-driven tool binding', () => {
  it('derives OpenAI-compatible function schemas from the Zod schemas', () => {
    const openaiTools = toOpenAISkillTools(listSkillTools())
    expect(openaiTools).toHaveLength(5)
    expect(new Set(openaiTools.map((tool) => tool.function.name)).size).toBe(5)
    for (const tool of openaiTools) {
      expect(tool.type).toBe('function')
      expect(tool.function.description.length).toBeGreaterThan(0)
      expect(tool.function.parameters.type).toBe('object')
      expect(tool.function.parameters.properties).toBeTruthy()
      expect(tool.function.parameters.required).toBeTruthy()
    }
  })

  it('validates arguments against the registered schema before execution', async () => {
    const bad = await executeSkillTool(
      'schedule_block',
      JSON.stringify({ title: 'Standup', start: 'not-a-date', durationMinutes: 15 }),
    )
    expect(bad.ok).toBe(false)
    expect(bad.error).toBeTruthy()
    expect(bad.data).toBeNull()
  })

  it('rejects unknown tool names and invalid JSON with structured fallbacks', async () => {
    expect(await executeSkillTool('ghost_tool', '{}')).toMatchObject({
      ok: false,
      tool: 'ghost_tool',
      data: null,
    })
    const badJson = await executeSkillTool('diagram_render', '{not json')
    expect(badJson.ok).toBe(false)
    expect(badJson.error).toContain('JSON')
  })
})

describe('registered tool executors', () => {
  it('renders a diagram spec with a deterministic preview', async () => {
    const result = await executeSkillTool(
      'diagram_render',
      JSON.stringify({ language: 'mermaid', spec: 'flowchart TD\n  A --> B', title: 'Auth flow' }),
    )
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'mock-diagram',
      language: 'mermaid',
      title: 'Auth flow',
      rendered: false,
    })
  })

  it('renders a diagram through the configured Kroki service', async () => {
    vi.stubEnv('DIAGRAM_RENDER_URL', 'https://kroki.example.com')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeSkillTool(
      'diagram_render',
      JSON.stringify({ language: 'mermaid', spec: 'flowchart TD\n  A --> B', title: 'Auth flow' }),
    )
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'kroki',
      language: 'mermaid',
      title: 'Auth flow',
      rendered: true,
    })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://kroki.example.com/mermaid/svg')
    expect(fetchMock.mock.calls[0]![1]!.body).toContain('flowchart TD')
  })

  it('maps ascii diagrams to the svgbob provider type', async () => {
    vi.stubEnv('DIAGRAM_RENDER_URL', 'https://kroki.example.com')
    const fetchMock = vi.fn().mockResolvedValue(new Response('<svg/>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await executeSkillTool('diagram_render', JSON.stringify({ language: 'ascii', spec: '+---+' }))
    expect(fetchMock.mock.calls[0]![0]).toBe('https://kroki.example.com/svgbob/svg')
  })

  it('falls back to a text preview when the diagram provider fails', async () => {
    vi.stubEnv('DIAGRAM_RENDER_URL', 'https://kroki.example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))

    const result = await executeSkillTool(
      'diagram_render',
      JSON.stringify({ language: 'mermaid', spec: 'flowchart TD' }),
    )
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ provider: 'kroki', rendered: false })
    expect(result.data).toHaveProperty('preview')
  })

  it('returns a placeholder forecast when no weather provider is configured', async () => {
    const result = await executeSkillTool(
      'weather_lookup',
      JSON.stringify({ location: 'Berlin', units: 'metric' }),
    )
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'mock',
      location: 'Berlin',
      units: 'metric',
      condition: null,
    })
  })

  it('falls back to the remote weather provider when configured', async () => {
    vi.stubEnv('WEATHER_API_URL', 'https://weather.example.com')
    vi.stubEnv('WEATHER_API_KEY', 'wkey')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ condition: 'Sunny', temperature: 21 }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeSkillTool('weather_lookup', JSON.stringify({ location: 'Berlin' }))
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ condition: 'Sunny', temperature: 21 })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://weather.example.com')
  })

  it('humanizes stock AI phrasing deterministically', async () => {
    const result = await executeSkillTool(
      'humanize_text',
      JSON.stringify({ text: 'We leverage tools and delve into details to be robust.' }),
    )
    expect(result.ok).toBe(true)
    const data = result.data as {
      text: string
      replacements: Array<{ from: string; to: string; count: number }>
    }
    expect(data.text).toContain('use tools')
    expect(data.text).toContain('dig into details')
    expect(data.replacements.length).toBeGreaterThanOrEqual(2)
  })

  it('computes the end time for a scheduled block', async () => {
    const result = await executeSkillTool(
      'schedule_block',
      JSON.stringify({
        title: 'Design review',
        start: '2026-08-22T09:00:00Z',
        durationMinutes: 90,
        priority: 'high',
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'mock-calendar',
      block: {
        title: 'Design review',
        start: '2026-08-22T09:00:00.000Z',
        end: '2026-08-22T10:30:00.000Z',
        durationMinutes: 90,
        priority: 'high',
      },
    })
  })

  it('creates a calendar event through Google Calendar when configured', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    vi.stubEnv('GOOGLE_CALENDAR_ID', 'primary')
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'svc@example.com')
    vi.stubEnv(
      'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'tok-123' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'evt-1',
            htmlLink: 'https://calendar.google.com/event/evt-1',
            status: 'confirmed',
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeSkillTool(
      'schedule_block',
      JSON.stringify({
        title: 'Design review',
        start: '2026-08-22T09:00:00Z',
        durationMinutes: 90,
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'google-calendar',
      status: 'confirmed',
      event: { id: 'evt-1', url: 'https://calendar.google.com/event/evt-1' },
      block: { start: '2026-08-22T09:00:00.000Z', end: '2026-08-22T10:30:00.000Z' },
    })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://oauth2.googleapis.com/token')
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    )
    const eventBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as {
      summary: string
      start: { dateTime: string }
    }
    expect(eventBody.summary).toBe('Design review')
    expect(eventBody.start.dateTime).toBe('2026-08-22T09:00:00.000Z')
  })

  it('prefers per-user context credentials over env vars for the calendar', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
    // Env points at one calendar; the per-user context must win.
    vi.stubEnv('GOOGLE_CALENDAR_ID', 'env-calendar')
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'env@example.com')
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'env-key')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'tok-ctx' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'evt-ctx', status: 'confirmed' }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeSkillTool(
      'schedule_block',
      JSON.stringify({ title: 'Review', start: '2026-08-22T09:00:00Z', durationMinutes: 30 }),
      {
        googleCalendar: {
          calendarId: 'ctx-calendar',
          email: 'ctx@example.com',
          privateKey: pem,
        },
      },
    )
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ provider: 'google-calendar', status: 'confirmed' })
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/ctx-calendar/events',
    )
  })

  it('parses and resolves Google service-account credentials', () => {
    const key = JSON.stringify({
      client_email: 'svc@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
    })
    expect(parseGoogleServiceAccountKey(key)).toEqual({
      email: 'svc@example.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
    })
    expect(parseGoogleServiceAccountKey('not json')).toBeNull()
    expect(parseGoogleServiceAccountKey(JSON.stringify({ client_email: 'x@y' }))).toBeNull()

    expect(
      resolveGoogleCredentials({
        googleCalendar: { calendarId: 'c', email: 'e', privateKey: 'k' },
      }),
    ).toEqual({ calendarId: 'c', email: 'e', privateKey: 'k' })

    vi.stubEnv('GOOGLE_CALENDAR_ID', 'env-cal')
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'env@example.com')
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'env-key')
    expect(resolveGoogleCredentials()).toEqual({
      calendarId: 'env-cal',
      email: 'env@example.com',
      privateKey: 'env-key',
    })
    // An explicit null context still falls back to env vars.
    expect(resolveGoogleCredentials({ googleCalendar: null })).toEqual({
      calendarId: 'env-cal',
      email: 'env@example.com',
      privateKey: 'env-key',
    })
  })

  it('falls back to the local block when the calendar provider fails', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    vi.stubEnv('GOOGLE_CALENDAR_ID', 'primary')
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'svc@example.com')
    vi.stubEnv(
      'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'unauthorized_client' }), { status: 401 }),
        ),
    )

    const result = await executeSkillTool(
      'schedule_block',
      JSON.stringify({ title: 'Standup', start: '2026-08-22T09:00:00Z', durationMinutes: 15 }),
    )
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ provider: 'mock-calendar' })
    expect(result.data).toHaveProperty('message')
  })

  it('flags risky patterns when analyzing code', async () => {
    const result = await executeSkillTool(
      'code_analyze',
      JSON.stringify({ code: 'function run() {\n  eval(input)\n}', checks: ['security'] }),
    )
    expect(result.ok).toBe(true)
    const data = result.data as {
      findings: Array<{ severity: string; rule: string }>
      metrics: { lineCount: number; functionCount: number }
    }
    expect(
      data.findings.some((finding) => finding.rule === 'no-eval' && finding.severity === 'high'),
    ).toBe(true)
    expect(data.metrics.lineCount).toBe(3)
    expect(data.metrics.functionCount).toBe(1)
  })
})

describe('skill activation and intent detection', () => {
  it('filters active skills and tools from SKILLS_ENABLED', () => {
    vi.stubEnv('SKILLS_ENABLED', 'planning,testing')
    expect(getActiveSkills().map((skill) => skill.id)).toEqual(['planning', 'testing'])
    expect(listSkillTools().map((tool) => tool.name)).toEqual(['schedule_block'])
    const instructions = getSkillSystemInstructions()
    expect(instructions).toContain('### Skill: Planning')
    expect(instructions).not.toContain('### Skill: System Design')
  })

  it('detects skill tool intent from natural language', () => {
    expect(hasSkillToolIntent('Draw a mermaid diagram of our auth flow')).toBe(true)
    expect(hasSkillToolIntent('What is the weather in Berlin?')).toBe(true)
    expect(hasSkillToolIntent('Please humanize this paragraph')).toBe(true)
    expect(hasSkillToolIntent('Block 90 minutes tomorrow for deep work')).toBe(true)
    expect(hasSkillToolIntent('Analyze this code for security issues')).toBe(true)
    expect(hasSkillToolIntent('Tell me a short story')).toBe(false)
    expect(hasSkillToolIntent('Calculate 2 + 2')).toBe(false)
  })

  it('honors an explicit skill list over the env var', () => {
    vi.stubEnv('SKILLS_ENABLED', 'planning')
    const active = getActiveSkills(['docs', 'testing']).map((skill) => skill.id)
    expect([...active].sort()).toEqual(['docs', 'testing'])
    expect(listSkillTools(['docs']).map((tool) => tool.name)).toEqual(['humanize_text'])
    expect(listSkillTools([])).toEqual([])
    const instructions = getSkillSystemInstructions(['planning'])
    expect(instructions).toContain('### Skill: Planning')
    expect(instructions).not.toContain('### Skill: Docs')
  })

  it('normalizes unknown and duplicate skill ids', () => {
    expect(normalizeSkillIds(['planning', 'planning', 'ghost', 'docs'])).toEqual([
      'planning',
      'docs',
    ])
    expect(isValidSkillId('planning')).toBe(true)
    expect(isValidSkillId('ghost')).toBe(false)
  })

  it('builds a client catalog with instructions, tools, and the active set', () => {
    const catalog = getSkillCatalog(['planning'])
    expect(catalog.skills).toHaveLength(8)
    expect(catalog.tools).toHaveLength(5)
    expect(catalog.activeSkillIds).toEqual(['planning'])
    const planning = catalog.skills.find((skill) => skill.id === 'planning')
    expect(planning?.name).toBe('Planning')
    expect(planning?.toolNames).toEqual(['schedule_block'])
    expect(planning?.systemInstructions.length).toBeGreaterThan(60)
    const scheduleTool = catalog.tools.find((tool) => tool.name === 'schedule_block')
    expect(scheduleTool?.parameters.type).toBe('object')
  })
})

describe('agent dispatcher integration', () => {
  it('binds registered skill tools into the agent loop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'skill-1',
                      type: 'function',
                      function: {
                        name: 'humanize_text',
                        arguments: JSON.stringify({ text: 'We leverage tools.' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Done.' } }] }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runAgent({
      apiKey: 'test-key',
      baseUrl: 'https://llm.example.com/v1',
      model: 'test/model',
      messages: [{ role: 'user', content: 'Humanize this: We leverage tools.' }],
      systemPrompt: 'You are an agent.',
    })

    expect(result.toolCount).toBe(1)
    const toolMessage = result.finalMessages.find((message) => message.role === 'tool')
    expect(JSON.parse(toolMessage!.content as string)).toMatchObject({
      ok: true,
      tool: 'humanize_text',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const planningBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      tools: Array<{ function: { name: string } }>
    }
    expect(planningBody.tools.some((tool) => tool.function.name === 'diagram_render')).toBe(true)
  })
})

describe('route skill injection', () => {
  it('injects active skill instructions and tools when skill intent is detected', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(stream, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Draw a mermaid diagram of our auth flow' }],
        }),
      }),
    )
    expect(response.status).toBe(200)

    const planningBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      messages: Array<{ role: string; content: string }>
      tools: Array<{ function: { name: string } }>
    }
    expect(planningBody.messages[0]!.content).toContain('active enterprise skills')
    expect(planningBody.messages[0]!.content).toContain('### Skill: System Design')
    expect(planningBody.tools.some((tool) => tool.function.name === 'diagram_render')).toBe(true)
  })

  it('narrows the skill catalog to the session override', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(stream, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabledSkills: ['planning'],
          messages: [{ role: 'user', content: 'Draw a mermaid diagram of our auth flow' }],
        }),
      }),
    )
    expect(response.status).toBe(200)

    const planningBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      messages: Array<{ role: string; content: string }>
      tools: Array<{ function: { name: string } }>
    }
    expect(planningBody.messages[0]!.content).toContain('### Skill: Planning')
    expect(planningBody.messages[0]!.content).not.toContain('### Skill: System Design')
    const toolNames = planningBody.tools.map((tool) => tool.function.name)
    expect(toolNames).toContain('schedule_block')
    expect(toolNames).not.toContain('diagram_render')
  })

  it('skips the agent loop when the override disables every skill', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabledSkills: [],
          messages: [{ role: 'user', content: 'Draw a mermaid diagram of our auth flow' }],
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      messages: Array<{ role: string; content: string }>
      tools?: unknown
    }
    expect(payload.messages[0]!.content).toBe('You are a helpful assistant.')
    expect(payload.tools).toBeUndefined()
  })
})
