import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../app/api/chat/route'
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../lib/llm-config'
import { DEFAULT_OPENROUTER_FALLBACK_MODEL, OPENROUTER_FREE_MODELS } from '../lib/models'
import { getCurrentUserId } from '@/lib/auth-context'
import { checkTierLimits, getCachedDailyUsage } from '@/lib/billing/tier-rate-limit'
import { recordGatewayProviderFailure, resetGatewayBreakers } from '../lib/gateway'

// The route resolves the current user for per-user skill credentials;
// next-auth can't run in vitest, so fall through to anonymous access.
vi.mock('@/lib/auth-context', () => ({
  getCurrentUserId: vi.fn().mockResolvedValue(null),
}))

// The route dynamically imports the tier limiter for signed-in users. Every
// other test runs anonymous (userId null), so the tier block never fires;
// the denial-shape test below overrides checkTierLimits per call.
vi.mock('@/lib/billing/tier-rate-limit', () => ({
  checkTierLimits: vi.fn(async () => ({ allowed: true })),
  getCachedDailyUsage: vi.fn(async () => null),
  setCachedDailyUsage: vi.fn(async () => {}),
}))

// The chat guard requires a session (ROUTE_GUARDS.chat → requireSession),
// which lazily imports next-auth. next-auth imports 'next/server', which only
// resolves inside Next's bundler — it can't be loaded raw in vitest — so mock
// it the same way tests/security.test.ts does.
vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: 'test-user' } }),
}))

// The free-plan clamp tests run signed-in, which walks the tier + usage DB
// path (plan read, usage increment) and the per-user credential lookup.
const { dbUserFindUnique, dbUserUpdate, dbPrefFindUnique } = vi.hoisted(() => ({
  dbUserFindUnique: vi.fn(),
  dbUserUpdate: vi.fn(),
  dbPrefFindUnique: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => dbUserFindUnique(...args),
      update: (...args: unknown[]) => dbUserUpdate(...args),
    },
    userPreference: {
      findUnique: (...args: unknown[]) => dbPrefFindUnique(...args),
    },
  },
}))
// usage.ts + the route fire-and-forget cache invalidations; keep them no-ops
// so the signed-in path never needs real Redis.
vi.mock('@/lib/cache', () => ({
  getCachedUserMeta: vi.fn(async () => null),
  getCachedBillingStatus: vi.fn(async () => null),
  invalidateCachedBillingStatus: vi.fn(async () => {}),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.mocked(getCurrentUserId).mockResolvedValue(null)
  // Restore the tier-limiter defaults — the bundled-limits test replaces
  // getCachedDailyUsage/checkTierLimits per call and never resets them.
  vi.mocked(getCachedDailyUsage).mockResolvedValue(null)
  vi.mocked(checkTierLimits).mockResolvedValue({ allowed: true })
  dbUserFindUnique.mockReset()
  dbUserUpdate.mockReset()
  dbPrefFindUnique.mockReset()
})

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function chatRequest(messages: unknown): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
}

describe('POST /api/chat', () => {
  it('returns 500 with a clear error when no API key is configured', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('OPENAI_API_KEY')
  })

  it('rejects a non-JSON body with 400', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const res = await POST(
      new Request('http://localhost/api/chat', { method: 'POST', body: 'not json' }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects invalid messages payloads with 400', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    for (const messages of [undefined, 'nope', [], [{ role: 'user' }]]) {
      const res = await POST(chatRequest(messages))
      expect(res.status, JSON.stringify(messages)).toBe(400)
    }
  })

  it('rejects oversized message bodies (bounded zod caps)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    // More than 200 messages in one request.
    const tooMany = Array.from({ length: 201 }, () => ({ role: 'user', content: 'x' }))
    expect((await POST(chatRequest(tooMany))).status).toBe(400)
    // A single message over the 50k content cap.
    const tooLong = [{ role: 'user', content: 'x'.repeat(50_001) }]
    expect((await POST(chatRequest(tooLong))).status).toBe(400)
  })

  it('rejects messages with invalid roles or content types (zod)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const bad = [
      [{ role: 'admin', content: 'x' }],
      [{ role: 'user', content: 42 }],
      [{ role: 'user', content: 'x' }, 'not a message'],
    ]
    for (const messages of bad) {
      const res = await POST(chatRequest(messages))
      expect(res.status, JSON.stringify(messages)).toBe(400)
    }
  })

  it('returns structured validation issues with the 400', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const res = await POST(chatRequest([{ role: 'admin', content: 'x' }]))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string; issues?: Array<{ path: string }> }
    expect(body.error).toContain('user, assistant, system')
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'messages.0.role' })]),
    )
  })

  it('rejects a valid-role message with an unknown extra body field shape', async () => {
    // Extra fields on the message object are stripped, not rejected — only
    // the envelope shape matters.
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi', extraField: 'ignored' }]))
    expect(res.status).toBe(200)
    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      messages: Array<{ extraField?: string }>
    }
    expect(payload.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('returns 502 when the upstream LLM API is unreachable', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(502)
  })

  it('returns a guard-shaped 429 with Retry-After when the tier burst limit denies', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.mocked(getCurrentUserId).mockResolvedValue('tier-user-1')
    // A cached same-day usage count keeps the route off the DB before the
    // denial; the plan defaults to free when the user-meta cache is empty.
    const today = new Date().toISOString().slice(0, 10)
    vi.mocked(getCachedDailyUsage).mockResolvedValue({ count: 1, date: today })
    vi.mocked(checkTierLimits).mockResolvedValueOnce({
      allowed: false,
      reason: 'burst',
      retryAfterMs: 42_000,
      error: 'Rate limit exceeded. You can make 20 requests per minute. Please wait 42s.',
    })

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(429)
    // Parity with the guardRoute denials: JSON { error } body + Retry-After.
    expect(res.headers.get('retry-after')).toBe('42')
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('Rate limit exceeded')
    expect(checkTierLimits).toHaveBeenCalledWith('tier-user-1', 'free', 1)
  })

  it('passes through upstream error statuses', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate limited' })))
    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('429')
  })

  it('supports OPENROUTER_API_KEY with OpenRouter defaults', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('OPENROUTER_APP_NAME', 'Pulse AI')
    // The dev .env.local may export MODEL_NAME — pin it so the resolved
    // default (the verified live free pool head) is asserted, not the override.
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const payload = JSON.parse(init!.body as string) as { model: string }
    // Free-first: the provider default is the genuinely free, live
    // `poolside/laguna-s-2.1:free` route (fastest measured first-token in
    // the verified free pool — verified against the catalog + live API).
    expect(payload.model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
    expect(init!.headers).toMatchObject({
      Authorization: 'Bearer sk-or-v1-test',
      'X-Title': 'Pulse AI',
    })
    // The streaming response reports the served model back to the client —
    // and, with no swap in play, the override flag stays false.
    expect(res.headers.get('x-served-model')).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
    expect(res.headers.get('x-served-model-overridden')).toBe('false')
  })

  it('auto-routes image attachments to a vision-capable OpenRouter model', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Describe the photo.' }],
          imageDataUrl: 'data:image/jpeg;base64,AAAA',
        }),
      }),
    )
    expect(res.status).toBe(200)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const payload = JSON.parse(init!.body as string) as {
      model: string
      messages: Array<{ role: string; content: unknown }>
    }
    // The text-only provider default is swapped for the free vision fallback
    // (poolside/laguna-s-2.1:free is 0-cost, vision-capable, and the fastest
    // content streamer in the verified pool — verified live).
    expect(payload.model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
    // The image rides along as a multimodal part on the user message.
    expect(payload.messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Describe the photo.' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      ],
    })
  })

  it('keeps the override header false when media swaps a text-only selection (vision routing stays neutral)', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The text-only `provider-default` selection is swapped to the
          // vision fallback when media is attached. (DeepSeek is now
          // vision-capable, so it no longer exercises the swap path.)
          model: 'provider-default',
          messages: [{ role: 'user', content: 'Describe the photo.' }],
          imageDataUrl: 'data:image/jpeg;base64,AAAA',
        }),
      }),
    )
    expect(res.status).toBe(200)
    // The text-only default selection was swapped to the vision fallback —
    // the served model differs from the selection, but this is routing, not
    // a failure: the override flag stays false so the caption stays neutral.
    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string }
    expect(payload.model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
    expect(res.headers.get('x-served-model')).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
    expect(res.headers.get('x-served-model-overridden')).toBe('false')
  })

  it('keeps an explicitly selected vision-capable model for media requests', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Describe the photo.' }],
          model: 'gpt-5-6',
          imageDataUrl: 'data:image/png;base64,BBBB',
        }),
      }),
    )
    expect(res.status).toBe(200)

    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string }
    expect(payload.model).toBe('openai/gpt-5.6-luna')
  })

  it('retries with the free fallback when the selected OpenRouter model 404s', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    // A stale MODEL_* override pointing at a genuinely dead slug
    // (google/gemini-2.0-flash-lite-001 — verified 404 against the live
    // OpenRouter API) is retried with the free backup model instead of
    // failing the chat.
    vi.stubEnv('MODEL_GEMINI_2_FLASH', 'google/gemini-2.0-flash-lite-001')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: 'model not found' }))
      .mockResolvedValueOnce(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-2-flash',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string }
    const second = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as {
      model: string
      max_tokens?: number
    }
    expect(first.model).toBe('google/gemini-2.0-flash-lite-001')
    expect(second.model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
    // The retry keeps the explicit conservative cap (pre-auth stays tiny).
    expect(second.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    // The response reports the model that actually served the reply — the
    // fallback, not the dead selection — and flags the swap for the UI's
    // amber warning caption.
    expect(res.headers.get('x-served-model')).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
    expect(res.headers.get('x-served-model-overridden')).toBe('true')
  })

  it('uses the FALLBACK_MODEL env override as the retry target', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    // Pin the dev .env.local MODEL_NAME override so the provider default
    // resolution follows FALLBACK_MODEL below.
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    vi.stubEnv('FALLBACK_MODEL', 'custom/backup')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })

    // A dead slug selected via a stale MODEL_* override 404s; the retry uses
    // the FALLBACK_MODEL override instead of the default backup.
    vi.stubEnv('MODEL_GEMINI_2_FLASH', 'google/gemini-2.0-flash-lite-001')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: 'model not found' }))
      .mockResolvedValueOnce(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-2-flash',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const second = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as { model: string }
    expect(second.model).toBe('custom/backup')

    // The provider default follows the override too (no dead slug in play,
    // so no no-loop guard interference).
    vi.stubEnv('MODEL_GEMINI_2_FLASH', undefined)
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(new Response(sse, { status: 200 }))
    await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    const defaultPayload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      model: string
    }
    expect(defaultPayload.model).toBe('custom/backup')
  })

  it('routes Kimi K3 to its verified slug and retries 404/402/429 with the provider backup', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('MODEL_KIMI_K3', undefined)

    for (const status of [404, 402, 429]) {
      const sse = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\\n\\n'))
          controller.close()
        },
      })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(status, { error: 'kimi rejected' }))
        .mockResolvedValueOnce(new Response(sse, { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      const response = await POST(
        new Request('http://localhost/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'kimi-k3',
            messages: [{ role: 'user', content: 'hi' }],
          }),
        }),
      )

      expect(response.status, `status ${status}`).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const first = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string }
      const second = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as { model: string }
      expect(first.model).toBe('moonshotai/kimi-k3')
      expect(second.model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
      expect(response.headers.get('x-served-model')).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
      expect(response.headers.get('x-served-model-overridden')).toBe('true')
    }
  })

  it('retries with the fallback model on OpenRouter 402 and 429 rejections', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    for (const status of [402, 429]) {
      const sse = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(status, { error: 'rejected' }))
        .mockResolvedValueOnce(new Response(sse, { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      const res = await POST(
        new Request('http://localhost/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-5-6',
            messages: [{ role: 'user', content: 'hi' }],
          }),
        }),
      )
      expect(res.status, `status ${status}`).toBe(200)
      expect(fetchMock, `status ${status}`).toHaveBeenCalledTimes(2)
      const second = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as { model: string }
      expect(second.model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
    }
  })

  it('retries with the provider backup on direct Gemini and OpenAI 404s', async () => {
    const cases = [
      {
        key: 'GEMINI_API_KEY',
        providerKey: 'AIza-test',
        staleOverride: 'MODEL_GEMINI_2_FLASH',
        deadSlug: 'gemini-2.0-flash',
        backup: 'gemini-3.5-flash-lite',
        modelKey: 'gemini-2-flash',
      },
      {
        key: 'OPENAI_API_KEY',
        providerKey: 'sk-openai-test',
        staleOverride: 'MODEL_GPT_5_6',
        deadSlug: 'gpt-4.1-preview',
        backup: 'gpt-4o-mini',
        modelKey: 'gpt-5-6',
      },
    ]
    for (const c of cases) {
      vi.stubEnv('OPENROUTER_API_KEY', '')
      vi.stubEnv('OPENROUTER_BASE_URL', undefined)
      vi.stubEnv('GEMINI_API_KEY', '')
      vi.stubEnv('OPENAI_API_KEY', '')
      vi.stubEnv('MODEL_NAME', undefined)
      vi.stubEnv('OPENAI_MODEL', undefined)
      vi.stubEnv(c.key, c.providerKey)
      // A stale MODEL_* override pointing at a dead model name 404s on the
      // direct endpoint; the retry uses the provider's own backup id — never
      // an OpenRouter slug the endpoint can't resolve.
      vi.stubEnv(c.staleOverride, c.deadSlug)
      const sse = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(404, { error: 'not found' }))
        .mockResolvedValueOnce(new Response(sse, { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      const res = await POST(
        new Request('http://localhost/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: c.modelKey,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        }),
      )
      expect(res.status, `provider ${c.key}`).toBe(200)
      expect(fetchMock, `provider ${c.key}`).toHaveBeenCalledTimes(2)
      const first = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string }
      const second = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as { model: string }
      expect(first.model, `provider ${c.key}`).toBe(c.deadSlug)
      expect(second.model, `provider ${c.key}`).toBe(c.backup)
    }
  })

  it('honors GEMINI_FALLBACK_MODEL / OPENAI_FALLBACK_MODEL overrides', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('OPENROUTER_BASE_URL', undefined)
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    vi.stubEnv('GEMINI_API_KEY', 'AIza-test')
    vi.stubEnv('GEMINI_FALLBACK_MODEL', 'custom/gemini-backup')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const second = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as { model: string }
    expect(second.model).toBe('custom/gemini-backup')
  })

  it('recovers across the verified free pool when the default free model is dead', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    vi.stubEnv('FALLBACK_MODEL', undefined)
    // The provider default is a `:free` route, so the verified-free-pool
    // cascade kicks in: a permanent 404 on the default hops to the next free
    // model instead of failing the chat — the fix for the retired
    // `minimax/minimax-m3:free` (404 "unavailable for free") and reasoning-only
    // streamers like `dots-studio/dots-3-note-preview:free` which drop
    // `delta.content`.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: 'model unavailable' }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(404)
    // Every pool member answered 404; 404 is retryable, so the chain
    // exhausted after each pool id was tried exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(OPENROUTER_FREE_MODELS.length)
    const bodies = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init!.body as string) as { model: string },
    )
    expect(bodies.map((b) => b.model)).toEqual([...OPENROUTER_FREE_MODELS])
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe(
      `LLM API error (404) from openrouter (${OPENROUTER_FREE_MODELS[OPENROUTER_FREE_MODELS.length - 1]}).`,
    )
  })

  it('does not duplicate an attempt when the chosen model is already the provider fallback', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('MODEL_NAME', 'custom/paid-model')
    vi.stubEnv('OPENAI_MODEL', undefined)
    vi.stubEnv('FALLBACK_MODEL', 'custom/paid-model')
    // A paid configuration: selected AND backup are the same id — no duplicate
    // attempt (the no-loop guard) and no free-pool cascade (neither id is a
    // `:free` route). The single attempt 429s (retryable through the bounded
    // re-probes) and then surfaces.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate limited' }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(429)
    // Initial probe + MAX_429_RETRIES re-probes — never a duplicate model call.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const bodies = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init!.body as string) as { model: string },
    )
    expect(bodies.every((b) => b.model === 'custom/paid-model')).toBe(true)
  })

  it('hops to the next verified free model after honoring Retry-After when the default 429s', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    // A transient shared-pool 429 on the default is exactly the free-tier
    // failure mode. Instead of burning a same-model re-probe (the old
    // sole-model behavior), the cascade hops straight to the next free model.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, 'ok'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The pool's second member served — a real swap, so it IS flagged (a
    // throttled free route is a failure, unlike neutral vision routing).
    expect(res.headers.get('x-served-model')).toBe(OPENROUTER_FREE_MODELS[1])
    expect(res.headers.get('x-served-model-overridden')).toBe('true')
  })

  it('surfaces 429 only after the free pool and bounded re-probes are exhausted', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '0' }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(429)
    // The whole free pool 429s (3 attempts), then the final attempt re-probes
    // MAX_429_RETRIES times.
    expect(fetchMock).toHaveBeenCalledTimes(OPENROUTER_FREE_MODELS.length + 2)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe(
      `LLM API error (429) from openrouter (${OPENROUTER_FREE_MODELS[OPENROUTER_FREE_MODELS.length - 1]}).`,
    )
  })

  it('falls back to OPENAI_API_KEY and OpenAI defaults when OPENROUTER_API_KEY is unset', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('OPENROUTER_BASE_URL', undefined)
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    const payload = JSON.parse(init!.body as string) as { model: string }
    expect(payload.model).toBe('gpt-4o-mini')
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer sk-openai-test' })
  })

  it('routes via the Gemini OpenAI-compatible endpoint when GEMINI_API_KEY is set', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('OPENROUTER_BASE_URL', undefined)
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    vi.stubEnv('MAX_OUTPUT_TOKENS', undefined)
    vi.stubEnv('GEMINI_API_KEY', 'AIza-test')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    const payload = JSON.parse(init!.body as string) as { model: string; max_tokens?: number }
    // Provider-default selection sends a plain Gemini model name on the direct
    // endpoint, not an OpenRouter-namespaced id.
    expect(payload.model).toBe('gemini-3.5-flash-lite')
    // Every provider gets the conservative completion cap.
    expect(payload.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer AIza-test' })
  })

  it('resolves the Gemini option to the stable OpenRouter model id when routing via OpenRouter', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-2-flash',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )
    expect(res.status).toBe(200)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const payload = JSON.parse(init!.body as string) as { model: string }
    expect(payload.model).toBe('google/gemini-3.5-flash-lite')
  })

  it('uses MODEL_NAME and OPENROUTER_BASE_URL env vars when set', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('MODEL_NAME', 'deepseek/deepseek-v4')
    vi.stubEnv('OPENROUTER_BASE_URL', 'https://custom-router.example.com/api/v1')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://custom-router.example.com/api/v1/chat/completions')
    const payload = JSON.parse(init!.body as string) as { model: string }
    expect(payload.model).toBe('deepseek/deepseek-v4')
  })

  it('sends the conservative max_tokens cap to OpenRouter by default (402 fix)', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('MAX_OUTPUT_TOKENS', undefined)
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    // No client maxTokens → the conservative default (200) is sent. The tiny
    // cap keeps OpenRouter's pre-authorization cost near zero, so a low-credit
    // key streams instead of 402ing (verified live: omitting the field made
    // OpenRouter pre-authorize ~16k tokens and reject the key; an explicit
    // tiny cap pre-authorizes cents).
    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    let payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      max_tokens?: number
    }
    expect(payload.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)

    // An explicit per-user maxTokens is still forwarded verbatim.
    fetchMock.mockClear()
    const tuned = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hi' }],
          maxTokens: 4096,
        }),
      }),
    )
    expect(tuned.status).toBe(200)
    payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { max_tokens?: number }
    expect(payload.max_tokens).toBe(4096)
  })

  it('sends the conservative max_tokens default to non-OpenRouter providers', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('OPENROUTER_BASE_URL', undefined)
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    vi.stubEnv('MAX_OUTPUT_TOKENS', undefined)
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    // No client maxTokens → the conservative default (200) is sent so the
    // request never falls back to the model's own maximum.
    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    let payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      max_tokens?: number
    }
    expect(payload.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)

    // MAX_OUTPUT_TOKENS env override applies for non-OpenRouter providers.
    vi.stubEnv('MAX_OUTPUT_TOKENS', '1024')
    fetchMock.mockClear()
    await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { max_tokens?: number }
    expect(payload.max_tokens).toBe(1024)
  })

  it('forwards validated temperature and maxTokens tuning to the provider body', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'tune me' }],
          temperature: 0.3,
          maxTokens: 4096,
        }),
      }),
    )
    expect(res.status).toBe(200)

    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      temperature?: number
      max_tokens?: number
    }
    expect(payload.temperature).toBe(0.3)
    expect(payload.max_tokens).toBe(4096)
  })

  it('clamps free-plan output to the operator budget even when the client asks for more', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    const today = new Date().toISOString().slice(0, 10)
    dbUserFindUnique.mockResolvedValue({ plan: 'free', usageCount: 0, usageDate: today })
    dbUserUpdate.mockResolvedValue({ id: 'user-1' })
    dbPrefFindUnique.mockResolvedValue(null)
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'long reply please' }],
          maxTokens: 4096,
        }),
      }),
    )
    expect(res.status).toBe(200)
    // 4096 requested → clamped to the operator's free-plan budget so a client
    // knob can't bill the operator's key for a full-length completion.
    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      max_tokens?: number
    }
    expect(payload.max_tokens).toBe(2000)
  })

  it('does not clamp pro-plan or bring-your-own-key requests', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    const today = new Date().toISOString().slice(0, 10)
    dbUserFindUnique.mockResolvedValue({ plan: 'pro', usageCount: 0, usageDate: today })
    dbUserUpdate.mockResolvedValue({ id: 'user-1' })
    dbPrefFindUnique.mockResolvedValue(null)
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'pro tier' }],
          maxTokens: 4096,
        }),
      }),
    )
    expect(res.status).toBe(200)
    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      max_tokens?: number
    }
    expect(payload.max_tokens).toBe(4096)
  })

  it('rejects out-of-range temperature and maxTokens with 400', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    for (const body of [
      { messages: [{ role: 'user', content: 'x' }], temperature: 2.5 },
      { messages: [{ role: 'user', content: 'x' }], maxTokens: -10 },
    ]) {
      const res = await POST(
        new Request('http://localhost/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('truncates long history to the last N messages before the upstream call', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const longHistory = Array.from({ length: 30 }, (_, i) => ({
      role: 'user' as const,
      content: `message number ${i}`,
    }))
    const res = await POST(chatRequest(longHistory))
    expect(res.status).toBe(200)

    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      messages: Array<{ role: string; content: string }>
    }
    // system prompt + last 20 history messages (default truncation).
    expect(payload.messages).toHaveLength(21)
    expect(payload.messages[1]!.content).toBe('message number 10')
    expect(payload.messages[20]!.content).toBe('message number 29')
  })

  it('sends the system prompt, history, and key server-side, and streams back', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test')
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
              'data: [DONE]\n\n',
          ),
        )
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const payload = JSON.parse(init!.body as string) as {
      stream: boolean
      messages: Array<{ role: string; content: string }>
    }
    expect(payload.stream).toBe(true)
    expect(payload.messages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant.',
    })
    expect(payload.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer sk-or-test' })

    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const chunk = new TextDecoder().decode(value)
    expect(chunk).toContain('[DONE]')
  })
})

describe('POST /api/chat — multi-provider failover (Phase 4)', () => {
  const OR_URL = 'https://openrouter.ai/api/v1'
  const GEM_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

  beforeEach(async () => {
    // Fresh breaker state per test (the gateway keeps a per-process memory
    // fallback when REDIS_URL is unset, which leaks across tests otherwise).
    await resetGatewayBreakers()
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-primary')
    vi.stubEnv('GEMINI_API_KEY', 'AIza-fallback')
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    vi.stubEnv('OPENROUTER_BASE_URL', undefined)
    vi.stubEnv('FALLBACK_MODEL', undefined)
    vi.stubEnv('GEMINI_FALLBACK_MODEL', undefined)
    vi.stubEnv('OPENAI_FALLBACK_MODEL', undefined)
    vi.stubEnv('MODEL_KIMI_K3', undefined)
  })

  afterEach(async () => {
    await resetGatewayBreakers()
  })

  function sseResponse(status = 200): Response {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        },
      }),
      { status },
    )
  }

  it('fails over to the next provider when the primary returns 5xx pre-stream', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: 'upstream down' }))
      .mockResolvedValueOnce(sseResponse())
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]![0]).toBe(`${OR_URL}/chat/completions`)
    expect(fetchMock.mock.calls[1]![0]).toBe(`${GEM_URL}/chat/completions`)
    // The reply is stamped with who actually served it so the UI can say
    // "fell back to Gemini".
    expect(res.headers.get('x-served-provider')).toBe('gemini')
    expect(res.headers.get('x-served-model')).toBe('gemini-3.5-flash-lite')
    expect(res.headers.get('x-served-model-overridden')).toBe('true')
  })

  it('hops to the next provider when the primary throws a connect error pre-stream', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(sseResponse())
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]![0]).toBe(`${OR_URL}/chat/completions`)
    expect(fetchMock.mock.calls[1]![0]).toBe(`${GEM_URL}/chat/completions`)
    expect(res.headers.get('x-served-provider')).toBe('gemini')
  })

  it('skips a circuit-open primary and serves the next provider without a first attempt on it', async () => {
    // Three failures inside the window open the OpenRouter breaker.
    for (let i = 0; i < 3; i++) {
      await recordGatewayProviderFailure('openrouter')
    }
    const fetchMock = vi.fn().mockResolvedValue(sseResponse())
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    // The open provider is never called — the request goes straight to Gemini.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(`${GEM_URL}/chat/completions`)
    expect(res.headers.get('x-served-provider')).toBe('gemini')
    // The request started in failover (primary skipped), so the reply is
    // flagged as overridden even though Gemini served on its first attempt.
    expect(res.headers.get('x-served-model-overridden')).toBe('true')
  })

  it('surfaces a non-retryable 401 without trying the backup provider', async () => {
    // 401 = bad key: a configuration error, never provider sickness. It must
    // surface immediately, not burn backup attempts.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'bad key' }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = (await res.json()) as { error?: string; detail?: string }
    expect(body.error).toBe('LLM API error (401).')
    // Upstream error text is never relayed to the client (it can echo request
    // data) — the status-only message is the contract.
    expect(body.detail).toBeUndefined()
  })

  it('surfaces 400 only after the attempt chain exhausts (final attempt stays fatal)', async () => {
    // 400 is recoverable only while a different attempt remains — a chain
    // that 400s end-to-end surfaces the status once the final attempt fails.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'bad request' }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(400)
    // OpenRouter primary 400 → Gemini backup 400 (mid-chain) → remaining free
    // pool 400s → final attempt stays fatal.
    expect(fetchMock).toHaveBeenCalledTimes(2 + OPENROUTER_FREE_MODELS.length - 1)
    const body = (await res.json()) as { error?: string; detail?: string }
    expect(body.error).toBe('LLM API error (400).')
    expect(body.detail).toBeUndefined()
  })

  it('recovers from a primary 400 by falling to the backup (Gemini 400s unknown models)', async () => {
    // Gemini's OpenAI-compatible endpoint answers unknown models with 400
    // INVALID_ARGUMENT — its analogue of OpenRouter's 404. A 400 on the
    // primary must fall through to the next attempt instead of failing the
    // chat (the same recovery path as a dead-model 404).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: 'invalid argument' }))
      .mockResolvedValueOnce(sseResponse())
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res.headers.get('x-served-provider')).toBe('gemini')
    expect(res.headers.get('x-served-model')).toBe('gemini-3.5-flash-lite')
    expect(res.headers.get('x-served-model-overridden')).toBe('true')
  })

  it('logs provider/model/status/body server-side on a non-retryable 4xx (never relays it)', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(400, { error: 'model not found or params invalid' })),
      )
    vi.stubGlobal('fetch', fetchMock)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error?: string; detail?: string }
      expect(body.error).toBe('LLM API error (400).')
      // The upstream body is drained for the ops log and never echoed to the
      // client — the status-only comment stays the wire contract.
      expect(body.detail).toBeUndefined()
      const logged = errorSpy.mock.calls
        .map((call) => call[1] as string | undefined)
        .filter((arg): arg is string => typeof arg === 'string')
        .map((arg) => JSON.parse(arg) as Record<string, unknown>)
      expect(logged[0]).toMatchObject({
        provider: 'openrouter',
        model: OPENROUTER_FREE_MODELS[OPENROUTER_FREE_MODELS.length - 1],
        status: 400,
      })
      expect(logged[0]!.body).toContain('model not found or params invalid')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('treats 408 as retryable: retries with the same provider backup model', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(408, { error: 'upstream timeout' }))
      .mockResolvedValueOnce(sseResponse())
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'kimi-k3', messages: [{ role: 'user', content: 'hi' }] }),
      }),
    )
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string }
    const second = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as { model: string }
    expect(first.model).toBe('moonshotai/kimi-k3')
    expect(second.model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
    expect(res.headers.get('x-served-provider')).toBe('openrouter')
    expect(res.headers.get('x-served-model-overridden')).toBe('true')
  })

  it('escapes a 403 harness-gated free model by hopping to the verified pool', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    // A forced agentic-harness-only free route (e.g.
    // `thinkingmachines/inkling:free`) 403s plain chat clients. Because it is
    // a `:free` route the pool cascade is in play, so the 403 — treated as
    // mid-chain retryable — hops to a pool member instead of failing.
    vi.stubEnv('MODEL_NAME', 'thinkingmachines/inkling:free')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(403, { error: 'harness-gated' }))
      .mockResolvedValueOnce(sseResponse())
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { model: string }
    const second = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as { model: string }
    expect(first.model).toBe('thinkingmachines/inkling:free')
    expect(second.model).toBe(DEFAULT_OPENROUTER_FALLBACK_MODEL)
    expect(res.headers.get('x-served-provider')).toBe('openrouter')
    expect(res.headers.get('x-served-model-overridden')).toBe('true')
  })

  it('returns the last retryable status when every provider fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'all down' }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(503)
    // OpenRouter default 503 → Gemini 503 → remaining free pool 503s → the
    // last retryable status surfaces once every attempt is spent.
    expect(fetchMock).toHaveBeenCalledTimes(2 + OPENROUTER_FREE_MODELS.length - 1)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('503')
  })

  it('still probes when the only configured provider has an open breaker (half-open test)', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    for (let i = 0; i < 3; i++) {
      await recordGatewayProviderFailure('openrouter')
    }
    const fetchMock = vi.fn().mockResolvedValue(sseResponse())
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(`${OR_URL}/chat/completions`)
    expect(res.headers.get('x-served-provider')).toBe('openrouter')
    expect(res.headers.get('x-served-model-overridden')).toBe('false')
  })
})
