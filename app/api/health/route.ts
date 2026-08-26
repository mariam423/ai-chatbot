import { Prisma } from '@/generated/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public liveness/readiness endpoint for an ALB, Nginx, or uptime monitor.
 * It deliberately exposes only status metadata, never database details.
 */
export async function GET() {
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
