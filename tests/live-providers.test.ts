import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteGoogleCalendarEvent, executeSkillTool } from '../lib/skills/tools'

/**
 * LIVE integration tests for the skill tool providers. These hit real
 * services and are SKIPPED by default (including in CI). Run them manually
 * with real credentials:
 *
 *   RUN_LIVE_PROVIDER_TESTS=true npx vitest run tests/live-providers.test.ts
 *
 * - diagram_render hits the public Kroki service (or DIAGRAM_RENDER_URL).
 * - schedule_block creates an event in a SANDBOX Google Calendar — set
 *   GOOGLE_CALENDAR_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL /
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY and point GOOGLE_CALENDAR_ID at a
 *   throwaway calendar. The created event is deleted afterwards.
 */

const LIVE = process.env.RUN_LIVE_PROVIDER_TESTS === 'true'
const googleConfigured = Boolean(
  process.env.GOOGLE_CALENDAR_ID &&
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.skipIf(!LIVE)('live skill providers (manual — RUN_LIVE_PROVIDER_TESTS=true)', () => {
  it('renders a diagram through the live Kroki service', async () => {
    // Default to the public Kroki instance unless a sandbox URL is set.
    vi.stubEnv('DIAGRAM_RENDER_URL', process.env.DIAGRAM_RENDER_URL ?? 'https://kroki.io')

    const result = await executeSkillTool(
      'diagram_render',
      JSON.stringify({
        language: 'mermaid',
        spec: 'flowchart TD\n  A[Start] --> B[End]',
        title: 'Live check',
      }),
    )

    expect(
      result.ok && (result.data as { rendered?: boolean }).rendered,
      'Kroki render failed — check network access to DIAGRAM_RENDER_URL ' +
        'and that the service accepts the diagram spec',
    ).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'kroki',
      language: 'mermaid',
      rendered: true,
    })
    const data = result.data as { imageUrl: string }
    expect(data.imageUrl.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const svg = Buffer.from(data.imageUrl.split(',')[1]!, 'base64').toString('utf8')
    expect(svg).toContain('<svg')
  }, 30_000)

  it.skipIf(!googleConfigured)(
    'creates and deletes a test event in the sandbox calendar (needs GOOGLE_* env)',
    async () => {
      const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const startIso = start.toISOString()
      const result = await executeSkillTool(
        'schedule_block',
        JSON.stringify({
          title: `[integration-test] ${startIso}`,
          start: startIso,
          durationMinutes: 15,
        }),
      )

      const data = result.data as { event?: { id?: string } }
      const eventId = result.ok ? (data.event?.id ?? null) : null
      try {
        expect(result.ok).toBe(true)
        expect(result.data).toMatchObject({ provider: 'google-calendar' })
        expect(data.event?.id).toBeTruthy()
      } finally {
        // Keep the sandbox calendar clean even when assertions fail.
        if (eventId) await deleteGoogleCalendarEvent(eventId)
      }
    },
    30_000,
  )
})
