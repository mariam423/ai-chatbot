import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../app/api/chat/route'
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../lib/llm-config'

// The route resolves the current user for per-user skill credentials;
// next-auth can't run in vitest, so fall through to anonymous access.
vi.mock('@/lib/auth-context', () => ({
  getCurrentUserId: vi.fn().mockResolvedValue(null),
}))

// The chat guard requires a session (ROUTE_GUARDS.chat → requireSession),
// which lazily imports next-auth. next-auth imports 'next/server', which only
// resolves inside Next's bundler — it can't be loaded raw in vitest — so mock
// it the same way tests/security.test.ts does.
vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: 'test-user' } }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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
    // default (minimax/minimax-m3:free) is asserted, not the override.
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
    // `minimax/minimax-m3:free` route (verified against the catalog + live API).
    expect(payload.model).toBe('minimax/minimax-m3:free')
    expect(init!.headers).toMatchObject({
      Authorization: 'Bearer sk-or-v1-test',
      'X-Title': 'Pulse AI',
    })
    // The streaming response reports the served model back to the client —
    // and, with no swap in play, the override flag stays false.
    expect(res.headers.get('x-served-model')).toBe('minimax/minimax-m3:free')
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
    // (minimax/minimax-m3:free is 0-cost AND vision-capable — verified live).
    expect(payload.model).toBe('minimax/minimax-m3:free')
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
    expect(payload.model).toBe('minimax/minimax-m3:free')
    expect(res.headers.get('x-served-model')).toBe('minimax/minimax-m3:free')
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
    expect(second.model).toBe('minimax/minimax-m3:free')
    // The retry keeps the explicit conservative cap (pre-auth stays tiny).
    expect(second.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    // The response reports the model that actually served the reply — the
    // fallback, not the dead selection — and flags the swap for the UI's
    // amber warning caption.
    expect(res.headers.get('x-served-model')).toBe('minimax/minimax-m3:free')
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
      expect(second.model).toBe('minimax/minimax-m3:free')
      expect(response.headers.get('x-served-model')).toBe('minimax/minimax-m3:free')
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
      expect(second.model).toBe('minimax/minimax-m3:free')
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

  it('does not loop when the chosen model is already the fallback', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    // The provider default resolves to minimax/minimax-m3:free — if IT 404s, there
    // is no backup left to retry with (and the guard prevents a loop).
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: 'not found' }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(chatRequest([{ role: 'user', content: 'hi' }]))
    expect(res.status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
