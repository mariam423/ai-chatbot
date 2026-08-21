import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../app/api/chat/route'

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
    vi.stubEnv('OPENROUTER_APP_NAME', 'Chatbot')
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
    expect(payload.model).toBe('stealth/ox-alpha')
    expect(init!.headers).toMatchObject({
      Authorization: 'Bearer sk-or-v1-test',
      'X-Title': 'Chatbot',
    })
  })

  it('falls back to OPENAI_API_KEY and OpenAI defaults when OPENROUTER_API_KEY is unset', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
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
