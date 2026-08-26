import { NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/http'
import { getLlmConfig } from '@/lib/llm-config'
import { guardRoute, ROUTE_GUARDS } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SpeakRequestSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  voice: z.string().trim().min(1).max(50).optional(),
  format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional(),
})

/**
 * Server-side TTS adapter. It is intentionally OpenAI-compatible so OpenAI,
 * OpenRouter-compatible gateways, and local adapters can be selected by the
 * existing provider configuration. The browser SpeechSynthesis fallback in
 * `SpeechButton` keeps this feature useful when no audio API is configured.
 */
export async function POST(request: Request) {
  const guard = await guardRoute(request, ROUTE_GUARDS.transcribe)
  if (!guard.ok) return guard.response

  const { apiKey, baseUrl, provider } = getLlmConfig()
  if (!apiKey || provider === 'gemini') {
    return errorResponse('Server TTS is not configured for this provider.', 503)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid speech request.')
  }
  const parsed = SpeakRequestSchema.safeParse(body)
  if (!parsed.success) return errorResponse('Text must be between 1 and 4,000 characters.')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.TTS_MODEL || 'gpt-4o-mini-tts',
        input: parsed.data.text,
        voice: parsed.data.voice || process.env.TTS_VOICE || 'alloy',
        response_format: parsed.data.format || 'mp3',
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return NextResponse.json(
        { error: `Speech service error (${response.status}).`, detail: detail.slice(0, 300) },
        { status: response.status },
      )
    }
    const audio = await response.arrayBuffer()
    if (audio.byteLength === 0) return errorResponse('Speech service returned no audio.', 502)
    return new Response(audio, {
      headers: {
        'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return errorResponse(
      controller.signal.aborted ? 'Speech synthesis timed out.' : 'Could not reach speech service.',
      controller.signal.aborted ? 504 : 502,
    )
  } finally {
    clearTimeout(timeout)
  }
}
