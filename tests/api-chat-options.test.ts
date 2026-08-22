import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../app/api/chat/route'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('chat model and structured-output options', () => {
  it('forwards the selected model and strict JSON schema response format', async () => {
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
          model: 'deepseek-v4-flash',
          structuredOutput: 'code',
          messages: [{ role: 'user', content: 'Write a TypeScript function' }],
        }),
      }),
    )

    expect(response.status).toBe(200)
    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      model: string
      response_format?: {
        type: string
        json_schema: { name: string; strict: boolean; schema: { required: string[] } }
      }
    }
    expect(payload.model).toBe('deepseek/deepseek-v4-flash')
    expect(payload.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'structured_chat_response',
        strict: true,
      },
    })
    expect(payload.response_format?.json_schema.schema.required).toContain('citations')
  })
})
