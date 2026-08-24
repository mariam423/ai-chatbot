import { NextResponse } from 'next/server'
import { z } from 'zod'
import { trackEvent } from '@/lib/analytics'
import { guardRoute, ROUTE_GUARDS } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/analytics — thin client bridge for user-activity events.
 *
 * The client posts `{ event, properties }` and the route forwards it to the
 * configured provider (PostHog) server-side, so the tracking key never
 * reaches the browser. Accepts a bounded, shape-validated payload; events
 * are dropped silently when tracking is not configured (no-op by default).
 */
const AnalyticsEventSchema = z.object({
  event: z.string().trim().min(1).max(100),
  properties: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .refine((value) => !value || Object.keys(value).length <= 25, {
      message: 'At most 25 properties.',
    }),
})

export async function POST(request: Request) {
  // Same-origin guard for consistency with the other state-changing routes;
  // tracking must never accept cross-site events.
  const guard = await guardRoute(request, ROUTE_GUARDS.analytics)
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const parsed = AnalyticsEventSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  await trackEvent({ event: parsed.data.event, properties: parsed.data.properties })
  return NextResponse.json({ ok: true })
}
