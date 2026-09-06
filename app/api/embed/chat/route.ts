import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getLlmConfig } from '@/lib/llm-config'
import { getProviderFallbackModel, ModelKeySchema, resolveModel } from '@/lib/models'
import { ChatWireMessageSchema } from '@/lib/types'
import { rateLimit } from '@/lib/security'
import { verifyEmbedToken } from '@/lib/embed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EmbedRequestSchema = z.object({
  messages: z.array(ChatWireMessageSchema).min(1).max(40),
})
const RETRYABLE_STATUSES = new Set([404, 402, 429])
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000

/** Per-agent daily message budget (the real cost-abuse brake when a scraped
 * token reaches an attacker). Overridable via EMBED_DAILY_LIMIT. */
function dailyEmbedBudget(): number {
  const raw = Number(process.env.EMBED_DAILY_LIMIT)
  if (Number.isInteger(raw) && raw >= 1) return raw
  return 500
}

/** CORS is only meaningful for browser cross-origin calls, which always carry
 * an Origin header — echo it instead of handing out `*` to origin-less
 * (server-side or scanner) callers. */
function corsHeaders(origin: string | null): HeadersInit {
  const headers: HeadersInit = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Embed-Parent-Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (origin) return { ...headers, 'Access-Control-Allow-Origin': origin }
  return headers
}

/** Token channel is the Authorization header only — the `?token=` query string
 * was removed because it lands the bearer in server access logs and Referer
 * chains. */
function tokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim()
  return null
}

/** Origin signals the token's origin claim is checked against. */
function originSignals(request: Request): Array<string | null | undefined> {
  const referrer = request.headers.get('referer')
  return [
    request.headers.get('origin'),
    request.headers.get('x-embed-parent-origin'),
    referrer ? new URL(referrer).origin : null,
  ]
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  })
}

/** Stream a deliberately small, token-authenticated assistant surface for iframe embeds. */
export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const token = tokenFromRequest(request)
  const agentId = new URL(request.url).searchParams.get('agentId') || ''
  const payload = verifyEmbedToken(token, agentId, originSignals(request))
  const headers = corsHeaders(origin)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired embed token.' }, { status: 401, headers })
  }
  const limited = await rateLimit(
    `embed:${agentId}:ip:${request.headers.get('x-forwarded-for') ?? 'unknown'}`,
    {
      limit: 30,
      windowMs: 60_000,
    },
  )
  if (!limited.ok)
    return new NextResponse(JSON.stringify({ error: 'Too many embed requests.' }), {
      status: 429,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Retry-After': String(limited.retryAfterSeconds),
      },
    })

  const daily = await rateLimit(`embed:${agentId}:day`, {
    limit: dailyEmbedBudget(),
    windowMs: DAILY_WINDOW_MS,
  })
  if (!daily.ok)
    return new NextResponse(
      JSON.stringify({ error: 'This assistant has reached its daily limit.' }),
      {
        status: 429,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Retry-After': String(daily.retryAfterSeconds),
        },
      },
    )

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers })
  }
  const parsed = EmbedRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Messages must be a non-empty list.' },
      { status: 400, headers },
    )
  }

  const agent = await prisma.customAgent.findFirst({
    where: { id: payload.agentId, userId: payload.userId },
    select: { name: true, systemPrompt: true, baselineModel: true },
  })
  if (!agent) return NextResponse.json({ error: 'Assistant not found.' }, { status: 404, headers })

  const llm = getLlmConfig()
  if (!llm.apiKey)
    return NextResponse.json({ error: 'Assistant is not configured.' }, { status: 503, headers })
  const selected = agent.baselineModel ? ModelKeySchema.safeParse(agent.baselineModel) : null
  const model = resolveModel(selected?.success ? selected.data : undefined, llm.provider)
  const fallbackModel = getProviderFallbackModel(llm.provider)
  const requestBody = (modelId: string) =>
    JSON.stringify({
      model: modelId,
      stream: true,
      messages: [{ role: 'system', content: agent.systemPrompt }, ...parsed.data.messages],
      max_tokens: 200,
    })
  const fetchModel = (modelId: string) =>
    fetch(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: requestBody(modelId),
      signal: request.signal,
    })

  let upstream = await fetchModel(model)
  let servedModel = model
  let overridden = false
  if (!upstream.ok && RETRYABLE_STATUSES.has(upstream.status) && model !== fallbackModel) {
    await upstream.body?.cancel().catch(() => undefined)
    upstream = await fetchModel(fallbackModel)
    servedModel = fallbackModel
    overridden = true
  }
  if (!upstream.ok || !upstream.body) {
    // Drain so the connection is reusable; the body is never relayed to the
    // client — provider error text can echo request data.
    await upstream.text().catch(() => '')
    return NextResponse.json(
      { error: `Assistant service error (${upstream.status}).` },
      { status: upstream.status, headers },
    )
  }

  return new Response(upstream.body, {
    headers: {
      ...headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Served-Model': servedModel,
      'X-Served-Model-Overridden': String(overridden),
    },
  })
}
