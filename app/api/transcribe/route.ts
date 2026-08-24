import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/http'
import { getLlmConfig } from '@/lib/llm-config'
import { guardRoute, ROUTE_GUARDS } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Upper bound for a transcribed voice clip (matches the in-app audio cap). */
const MAX_AUDIO_BYTES = 2_000_000
const TRANSCRIBE_TIMEOUT_MS = 20_000

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

  const { apiKey, baseUrl } = getLlmConfig()
  if (!apiKey) {
    return errorResponse(
      'Server is not configured with an LLM API key (OPENROUTER_API_KEY or OPENAI_API_KEY). Voice transcription requires one.',
      500,
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
