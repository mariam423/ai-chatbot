import { Prisma } from '@/generated/client'
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Liveness/readiness endpoint for an ALB, Nginx, or uptime monitor.
 *
 * Anonymous callers get a bare `{ status: 'ok' }` — no database detail, and no
 * database connection is even attempted (a public endpoint that probes the DB
 * lets any scanner learn "database reachable".) The detailed readiness check
 * runs only for requests carrying the `HEALTH_CHECK_TOKEN` env secret as a
 * Bearer token, so internal monitors get real up/down signal without exposing
 * infrastructure state to the internet.
 */
export async function GET(request: Request) {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
  const expected = process.env.HEALTH_CHECK_TOKEN
  const authorized =
    !!expected &&
    !!supplied &&
    supplied.length === expected.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))

  if (!authorized) {
    return NextResponse.json({ status: 'ok' })
  }

  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1`)
    return NextResponse.json({
      status: 'ok',
      checks: { database: 'ok' },
      timestamp: new Date().toISOString(),
    })
  } catch {
    return NextResponse.json(
      {
        status: 'degraded',
        checks: { database: 'error' },
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    )
  }
}
