import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmbedToken } from '../lib/embed'

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }))
vi.mock('../lib/db', () => ({ prisma: { customAgent: { findFirst } } }))

import { POST } from '../app/api/embed/chat/route'

afterEach(() => {
  findFirst.mockReset()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function request(
  agentId: string,
  token: string,
  body: unknown,
  origin = 'https://example.com',
): Request {
  return new Request(`http://localhost/api/embed/chat?agentId=${agentId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/embed/chat', () => {
  it('rejects missing or invalid signed tokens before provider access', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const response = await POST(request('agent-1', 'bad-token', { messages: [] }))
    expect(response.status).toBe(401)
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('validates the owner, streams, and exposes CORS headers', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test')
    const token = createEmbedToken({ agentId: 'agent-1', userId: 'user-1', origin: '*' })
    findFirst.mockResolvedValue({
      name: 'Support bot',
      systemPrompt: 'Be concise.',
      baselineModel: null,
    })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      request('agent-1', token, { messages: [{ role: 'user', content: 'Hi' }] }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'agent-1', userId: 'user-1' },
      select: { name: true, systemPrompt: true, baselineModel: true },
    })
  })

  it('retries a dead assistant model with the provider fallback', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test')
    vi.stubEnv('FALLBACK_MODEL', 'backup/model')
    const token = createEmbedToken({ agentId: 'agent-1', userId: 'user-1', origin: '*' })
    findFirst.mockResolvedValue({
      name: 'Support bot',
      systemPrompt: 'Be concise.',
      baselineModel: 'kimi-k3',
    })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response(stream, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      request('agent-1', token, { messages: [{ role: 'user', content: 'Hi' }] }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Served-Model')).toBe('backup/model')
    expect(response.headers.get('X-Served-Model-Overridden')).toBe('true')
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string).model).toBe('backup/model')
  })
})
