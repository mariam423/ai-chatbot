import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

describe('trackEvent', () => {
  let originalEnv: NodeJS.ProcessEnv
  let trackEvent: (input: {
    event: string
    properties?: Record<string, string | number | boolean>
    distinctId?: string
  }) => Promise<boolean>

  beforeEach(() => {
    originalEnv = { ...process.env }
    delete process.env.POSTHOG_API_KEY
    delete process.env.POSTHOG_HOST
    delete process.env.ANALYTICS_DEBUG
    // Re-import so module-level env reads happen per test.
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is a no-op when tracking is not configured', async () => {
    trackEvent = (await import('../lib/analytics')).trackEvent
    expect(await trackEvent({ event: 'pageview' })).toBe(false)
  })

  it('sends a capture request to PostHog when configured', async () => {
    process.env.POSTHOG_API_KEY = 'phc_test'
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com'
    trackEvent = (await import('../lib/analytics')).trackEvent

    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const emitted = await trackEvent({ event: 'chat_message_sent', distinctId: 'user-1' })
    expect(emitted).toBe(true)

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(url).toBe('https://eu.i.posthog.com/capture/')
    const body = JSON.parse(init.body)
    expect(body.api_key).toBe('phc_test')
    expect(body.event).toBe('chat_message_sent')
    expect(body.distinct_id).toBe('user-1')
  })

  it('returns false and swallows provider errors', async () => {
    process.env.POSTHOG_API_KEY = 'phc_test'
    trackEvent = (await import('../lib/analytics')).trackEvent

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    expect(await trackEvent({ event: 'chat_message_sent' })).toBe(false)
  })

  it('logs to the server console in debug mode', async () => {
    process.env.ANALYTICS_DEBUG = 'true'
    trackEvent = (await import('../lib/analytics')).trackEvent

    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(await trackEvent({ event: 'pageview' })).toBe(true)
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('[analytics:debug] pageview'),
      expect.anything(),
    )
  })
})
