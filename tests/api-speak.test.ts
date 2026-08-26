import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../app/api/speak/route'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/speak', () => {
  it('returns 503 when no compatible speech provider is configured', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    const response = await POST(request({ text: 'Hello' }))
    expect(response.status).toBe(503)
  })

  it('validates and bounds the text input before calling the provider', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await POST(request({ text: ' ' }))
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies provider audio and preserves an audio content type', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const audio = new Uint8Array([1, 2, 3])
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(audio, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(request({ text: 'Read this', voice: 'alloy', format: 'mp3' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('audio/mpeg')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(audio)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'gpt-4o-mini-tts',
      input: 'Read this',
      voice: 'alloy',
      response_format: 'mp3',
    })
  })

  it('returns the upstream status without exposing provider secrets', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('provider detail', { status: 429 })),
    )
    const response = await POST(request({ text: 'Try again' }))
    expect(response.status).toBe(429)
    const body = (await response.json()) as { detail?: string }
    expect(body.detail).toBe('provider detail')
    expect(JSON.stringify(body)).not.toContain('test-key')
  })
})
