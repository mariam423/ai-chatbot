import { NextResponse } from 'next/server'
import { z } from 'zod'
import { truncateHistory } from '@/lib/context'
import { ChatWireMessageSchema, type ChatWireMessage } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = 'You are a helpful assistant.'

/** Request body schema: a non-empty list of chat messages, with optional system prompt override. */
const ChatRequestSchema = z.object({
  messages: z.array(ChatWireMessageSchema).min(1),
  systemPrompt: z.string().max(2000).optional(),
})

export async function POST(request: Request) {
  // OPENROUTER_API_KEY is the preferred var for OpenRouter; OPENAI_API_KEY
  // remains supported for other OpenAI-compatible endpoints.
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'Server is not configured with an LLM API key (OPENROUTER_API_KEY or OPENAI_API_KEY).',
      },
      { status: 500 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = ChatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'messages must be a non-empty array of { role, content }. Valid roles: user, assistant, system.',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || '<root>',
          message: issue.message,
        })),
      },
      { status: 400 },
    )
  }
  const messages: ChatWireMessage[] = parsed.data.messages
  const customSystemPrompt = parsed.data.systemPrompt?.trim() || SYSTEM_PROMPT

  // Compress history before sending upstream (FR-3 optimization): truncate to
  // the last N messages and drop the oldest until within the token budget.
  // The client's own message is always the newest and is never dropped.
  const maxHistoryMessages = Number(process.env.MAX_HISTORY_MESSAGES) || undefined
  const maxContextTokens = Number(process.env.MAX_CONTEXT_TOKENS) || undefined
  const history = truncateHistory(messages, {
    maxMessages: maxHistoryMessages,
    maxTokens: maxContextTokens,
  })

  // Default to OpenRouter when the OpenRouter key is configured, otherwise
  // keep the OpenAI defaults. MODEL_NAME / OPENROUTER_BASE_URL drive the
  // OpenRouter configuration; OPENAI_MODEL / OPENAI_BASE_URL override either.
  const usesOpenRouter = Boolean(process.env.OPENROUTER_API_KEY)
  const baseUrl = (
    process.env.OPENROUTER_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    (usesOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')
  ).replace(/\/+$/, '')
  const model =
    process.env.MODEL_NAME ??
    process.env.OPENAI_MODEL ??
    (usesOpenRouter ? 'stealth/ox-alpha' : 'gpt-4o-mini')

  // OpenRouter uses X-Title for app attribution (optional, OpenRouter only).
  const appTitle = process.env.OPENROUTER_APP_NAME
  const extraHeaders: Record<string, string> = appTitle ? { 'X-Title': appTitle } : {}

  let upstream: Response
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: customSystemPrompt } satisfies ChatWireMessage,
          ...history,
        ],
      }),
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach the LLM API.' }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    return NextResponse.json(
      {
        error: `LLM API error (${upstream.status}).`,
        detail: detail.slice(0, 500),
      },
      { status: upstream.status },
    )
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
