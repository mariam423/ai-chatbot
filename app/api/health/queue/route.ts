import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { guardRoute, ROUTE_GUARDS } from '@/lib/security'
import { getQueueMetrics } from '@/lib/queues/task-queue'
import { normalizeUserRole } from '@/lib/roles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Admin-gated queue metrics for operators: BullMQ depths (waiting / active /
 * completed / failed / delayed) for the `pulse-tasks` queue.
 *
 * The guard config (ROUTE_GUARDS['health-queue']) requires a session and
 * skips CSRF (read-only GET); the ADMIN role is enforced here against the
 * signed-in user, mirroring the role check getDashboardData uses. Under
 * AUTH_DISABLED (local dev / e2e) there are no roles, so the check is
 * bypassed the same way requireSession is.
 *
 * getQueueMetrics() returns `null` when Redis is not configured or
 * unreachable — the response then carries `queue: null` (a clean 200 for a
 * single-process deploy with no queue) instead of inventing numbers.
 */
export async function GET(request: Request) {
  const guard = await guardRoute(request, ROUTE_GUARDS['health-queue'])
  if (!guard.ok) return guard.response

  if (process.env.AUTH_DISABLED !== 'true') {
    const user = await prisma.user.findUnique({
      where: { id: guard.userId },
      select: { role: true },
    })
    if (normalizeUserRole(user?.role) !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
  }

  const queue = await getQueueMetrics()
  return NextResponse.json({
    status: 'ok',
    // `null` (never an error) when Redis is absent/unreachable — the caller
    // distinguishes "no queue configured" from real queue depths.
    queue,
    timestamp: new Date().toISOString(),
  })
}
