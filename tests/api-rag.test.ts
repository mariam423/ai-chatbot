import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/auth-context', () => ({
  getCurrentUserId: vi.fn().mockResolvedValue(null),
}))

// The chat guard requires a session (requireSession), which lazily imports
// next-auth; next-auth imports 'next/server', which only resolves inside
// Next's bundler, so mock it (same as tests/security.test.ts).
vi.mock('../lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: 'test-user' } }),
}))

vi.mock('../lib/rag', () => ({
  getSessionRagContext: vi
    .fn()
    .mockResolvedValue('[Document: handbook.txt, section 2]\nThe refund window is 30 days.'),
}))

import { POST } from '../app/api/chat/route'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('RAG chat prompt composition', () => {
  it('injects bounded document context and citation instructions', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(upstream, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'session-1',
          messages: [{ role: 'user', content: 'What is the refund window?' }],
        }),
      }),
    )

    expect(response.status).toBe(200)
    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(payload.messages[0]!.content).toContain('The refund window is 30 days.')
    expect(payload.messages[0]!.content).toContain('cite supporting excerpts')
    expect(payload.messages[0]!.content).toContain('[Document: ..., section N]')
  })
})
