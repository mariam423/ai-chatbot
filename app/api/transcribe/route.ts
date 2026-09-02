import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/http'
import { guardRoute, ROUTE_GUARDS } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Upper bound for a transcribed voice clip. This is the composer-mic
 * fallback (short recordings only) and is deliberately separate from the
 * 20 MB media-attachment cap on the chat composer.
 */
const MAX_AUDIO_BYTES = 2_000_000
const TRANSCRIBE_TIMEOUT_MS = 20_000

/**
 * Provider note: only OpenAI + Gemini expose an OpenAI-compatible
 * `/audio/transcriptions` endpoint. OpenRouter does not proxy Whisper and
 * returns 402 with a "requires at least $0.50 in balance for audio" error
 * if you call that path through it.
 *
 * We deliberately pick the transcription provider independently of the
 * chat provider: the chat route keeps using whatever's cheapest for text
 * (OpenRouter in production) but a request to transcribe should jump to
 * OpenAI or Gemini when those keys are present, even if OpenRouter is the
 * chat provider. That way one OPENAI_API_KEY (or GEMINI_API_KEY) on the
 * server enables voice transcription regardless of the chat key, instead
 * of forcing the user to clear OPENROUTER_API_KEY to use the mic.
 *
 * Fallback chain: OPENAI_API_KEY → GEMINI_API_KEY → OPENROUTER_API_KEY
 * (the last only reaches `/audio/transcriptions` if and when OpenRouter
 * adds support; right now it returns 402). The explicit STT provider is
 * resolved by `resolveTranscriptionProvider` so the chosen key + base URL
 * stay consistent.
 */
type TranscriptionProvider = 'openai' | 'gemini' | 'openrouter'

function resolveTranscriptionProvider(): {
  provider: TranscriptionProvider
  apiKey: string | null
  baseUrl: string
} {
  const openAiKey = process.env.OPENAI_API_KEY?.trim() || null
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || null
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || null

  if (openAiKey) {
    return {
      provider: 'openai',
      apiKey: openAiKey,
      baseUrl: (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(
        /\/+$/,
        '',
      ),
    }
  }
  if (geminiKey) {
    return {
      provider: 'gemini',
      apiKey: geminiKey,
      baseUrl: (
        process.env.GEMINI_BASE_URL?.trim() ||
        'https://generativelanguage.googleapis.com/v1beta/openai'
      ).replace(/\/+$/, ''),
    }
  }
  if (openRouterKey) {
    return {
      provider: 'openrouter',
      apiKey: openRouterKey,
      baseUrl: (process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(
        /\/+$/,
        '',
      ),
    }
  }
  return { provider: 'openrouter', apiKey: null, baseUrl: 'https://api.openai.com/v1' }
}

function supportsTranscription(provider: TranscriptionProvider): boolean {
  return provider === 'openai' || provider === 'gemini'
}

/**
 * Server-side speech-to-text fallback (used by the composer mic on browsers
 * without the Web Speech API). Accepts a multipart audio `file` and forwards it
 * to the configured provider's OpenAI-compatible `/audio/transcriptions`
 * endpoint, returning `{ transcript }`. The LLM key never reaches the client.
 */
export async function POST(request: Request) {
  // Guardrails: same-origin check + per-IP rate limit (transcription is a
  // paid provider call, so it gets the same cost-control treatment as chat).
  const guard = await guardRoute(request, ROUTE_GUARDS.transcribe)
  if (!guard.ok) return guard.response

  const { provider, apiKey, baseUrl } = resolveTranscriptionProvider()

  if (!apiKey) {
    return errorResponse(
      'Server is not configured with an LLM API key for transcription. Set OPENAI_API_KEY or GEMINI_API_KEY in the environment.',
      500,
    )
  }
  if (!supportsTranscription(provider)) {
    // OpenRouter does not proxy Whisper — fail fast with a 503 so the
    // client knows the configured provider can't transcribe. The composer
    // falls back to the browser's Web Speech API on Chrome/Edge; on
    // Firefox/Safari the mic button is hidden in that case (see
    // `pickVoiceEngine`).
    return NextResponse.json(
      {
        error:
          'Voice transcription is not available with the current provider. Configure OPENAI_API_KEY or GEMINI_API_KEY, or use a browser with built-in speech recognition.',
        code: 'transcription_provider_unsupported',
      },
      { status: 503 },
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return errorResponse('Invalid audio upload.')
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return errorResponse('Missing audio file.')
  }
  if (file.size === 0 || file.size > MAX_AUDIO_BYTES) {
    return errorResponse(`Audio must be between 1 byte and ${MAX_AUDIO_BYTES} bytes.`)
  }

  const model = process.env.TRANSCRIBE_MODEL || 'whisper-1'

  const upstream = new FormData()
  upstream.append('file', file, file.name || 'recording.webm')
  upstream.append('model', model)
  const language = form.get('language')
  if (typeof language === 'string' && language.trim()) upstream.append('language', language.trim())

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS)
  try {
    // Content-Type is intentionally unset — fetch derives the multipart
    // boundary, which the provider requires.
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return NextResponse.json(
        {
          error: `Transcription service error (${response.status}).`,
          detail: detail.slice(0, 500),
        },
        { status: response.status },
      )
    }
    const data = (await response.json()) as { text?: string }
    const transcript = (data.text ?? '').trim()
    if (!transcript) {
      return errorResponse('The transcription returned no text.', 502)
    }
    return NextResponse.json({ transcript })
  } catch {
    if (controller.signal.aborted) {
      return errorResponse('Transcription timed out.', 504)
    }
    return errorResponse('Could not reach the transcription service.', 502)
  } finally {
    clearTimeout(timeout)
  }
}
