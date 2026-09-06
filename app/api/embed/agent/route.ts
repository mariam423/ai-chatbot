import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyEmbedToken } from '@/lib/embed'
import { rateLimit } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** CORS is only meaningful for browser cross-origin calls, which always carry
 * an Origin header — echo it instead of handing out `*` to origin-less
 * (server-side or scanner) callers. */
function corsHeaders(origin: string | null): HeadersInit {
  const headers: HeadersInit = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Embed-Parent-Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  }
  if (origin) return { ...headers, 'Access-Control-Allow-Origin': origin }
  return headers
}

function tokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim()
  return null
}

/**
 * Lightweight, token-authenticated lookup the embed page uses to verify a
 * bearer token (read from the URL *fragment* on the client, never a query
 * string) and fetch the assistant name. Same origin enforcement as the chat
 * route, so a scraped token fails here first with no LLM call.
 */
export async function GET(request: Request) {
  const origin = request.headers.get('origin')
  const headers = corsHeaders(origin)
  const agentId = new URL(request.url).searchParams.get('agentId') || ''
  const token = tokenFromRequest(request)
  const referrer = request.headers.get('referer')
  const payload = verifyEmbedToken(token, agentId, [
    origin,
    request.headers.get('x-embed-parent-origin'),
    referrer ? new URL(referrer).origin : null,
  ])
  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired embed token.' }, { status: 401, headers })
  }
  const limited = await rateLimit(
    `embed-check:${agentId}:ip:${request.headers.get('x-forwarded-for') ?? 'unknown'}`,
    { limit: 120, windowMs: 60_000 },
  )
  if (!limited.ok) {
    return new NextResponse(JSON.stringify({ error: 'Too many requests.' }), {
      status: 429,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Retry-After': String(limited.retryAfterSeconds),
      },
    })
  }
  const agent = await prisma.customAgent.findFirst({
    where: { id: payload.agentId, userId: payload.userId },
    select: { name: true },
  })
  if (!agent) {
    return NextResponse.json({ error: 'Assistant not found.' }, { status: 404, headers })
  }
  return NextResponse.json({ name: agent.name }, { headers })
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  })
}
