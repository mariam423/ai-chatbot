import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../app/api/transcribe/route'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** A tiny valid audio File (bytes are opaque to the route). */
function audioFile(name = 'recording.webm', size = 64): File {
  return new File([new Uint8Array(size)], name, { type: 'audio/webm' })
}

function transcribeRequest(file: File | undefined, language?: string): Request {
  const form = new FormData()
  if (file) form.append('file', file)
  if (language) form.append('language', language)
  return new Request('http://localhost/api/transcribe', { method: 'POST', body: form })
}

function okJson(text: string): Response {
  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/transcribe', () => {
  /** Force OpenAI as the active provider so OpenRouter's lack of STT
   * doesn't make every test need a stub override. */
  function useOpenAiKey() {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
  }

  it('returns 500 with a clear error when no API key is configured', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    const res = await POST(transcribeRequest(audioFile()))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('OPENAI_API_KEY')
  })

  it('returns 400 when the audio file is missing', async () => {
    useOpenAiKey()
    const res = await POST(transcribeRequest(undefined))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('Missing audio')
  })

  it('returns 400 for an oversized audio upload', async () => {
    useOpenAiKey()
    const big = new File([new Uint8Array(2_000_001)], 'recording.webm', { type: 'audio/webm' })
    const res = await POST(transcribeRequest(big))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('between')
  })

  it('forwards the clip to the provider and returns the transcript', async () => {
    useOpenAiKey()
    vi.stubEnv('TRANSCRIBE_MODEL', undefined)
    const fetchMock = vi.fn().mockResolvedValue(okJson('Hello world'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(transcribeRequest(audioFile(), 'en'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ transcript: 'Hello world' })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(init!.headers).not.toHaveProperty('Content-Type')
    const body = init!.body as FormData
    expect(await body.get('model')).toBe('whisper-1')
    expect(await body.get('language')).toBe('en')
    expect(body.get('file')).toBeInstanceOf(File)
  })

  it('returns 503 when only OPENROUTER_API_KEY is set (OpenRouter does not proxy Whisper)', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('TRANSCRIBE_MODEL', 'openai/whisper-large-v3')
    const fetchMock = vi.fn().mockResolvedValue(okJson('Transcribed'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(transcribeRequest(audioFile()))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error?: string; code?: string }
    expect(body.code).toBe('transcription_provider_unsupported')
    expect(body.error).toMatch(/OPENAI_API_KEY|GEMINI_API_KEY|speech recognition/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prefers OPENAI_API_KEY over OPENROUTER_API_KEY for transcription (chains are independent)', async () => {
    // Production has OPENROUTER_API_KEY set as the chat provider, but the
    // user added OPENAI_API_KEY for STT. The transcribe route should jump
    // to OpenAI Whisper, not OpenRouter (which returns 402 for audio).
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('OPENAI_BASE_URL', undefined)
    const fetchMock = vi.fn().mockResolvedValue(okJson('Hello'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(transcribeRequest(audioFile()))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
  })

  it('falls back to Gemini when OPENAI_API_KEY is unset but GEMINI_API_KEY is present', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', 'gem-test')
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('GEMINI_BASE_URL', undefined)
    const fetchMock = vi.fn().mockResolvedValue(okJson('ok'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(transcribeRequest(audioFile()))
    expect(res.status).toBe(200)
    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).toMatch(/generativelanguage\.googleapis\.com\/.+\/audio\/transcriptions$/)
  })

  it('passes through upstream error statuses with a friendly message', async () => {
    useOpenAiKey()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid file' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const res = await POST(transcribeRequest(audioFile()))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('400')
  })

  it('returns 502 when the transcription service is unreachable', async () => {
    useOpenAiKey()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const res = await POST(transcribeRequest(audioFile()))
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('transcription service')
  })

  it('returns 502 when the provider returns no transcript text', async () => {
    useOpenAiKey()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson('   ')))
    const res = await POST(transcribeRequest(audioFile()))
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('no text')
  })
})
