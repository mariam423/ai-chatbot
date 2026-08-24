import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { guardRoute, ROUTE_GUARDS } from '@/lib/security'
import { verifyStripeWebhookSignature } from '@/lib/billing/stripe'
import { parsePlanKey } from '@/lib/billing/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Stripe webhook endpoint (POST /api/webhooks/stripe).
 *
 * Handles the events that drive plan changes:
 *  - checkout.session.completed        → a subscription started; store the
 *    Stripe customer + subscription ids and upgrade the user to Pro.
 *  - customer.subscription.updated     → reflect plan changes (downgrade to
 *    free when the subscription cancels/pauses).
 *  - customer.subscription.deleted     → subscription ended; back to Free.
 *
 * Signature verification (STRIPE_WEBHOOK_SECRET) is mandatory — unverified
 * requests are rejected with 401. When Stripe is not configured the route
 * responds 501 so callers can tell the endpoint is intentionally inert.
 *
 * Guarded with a per-IP flood brake (generous: Stripe delivers bursts and
 * retries with backoff). Signature verification is the real authentication;
 * the CSRF check is harmless defense in depth — Stripe's server-to-server
 * calls carry no Origin header, and any browser cross-site POST would fail
 * signature verification anyway.
 */
export async function POST(request: Request) {
  const guard = await guardRoute(request, ROUTE_GUARDS['stripe-webhook'])
  if (!guard.ok) return guard.response

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe webhook is not configured.' }, { status: 501 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!verifyStripeWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  let event: {
    type: string
    data: { object: Record<string, unknown> }
  }
  try {
    event = JSON.parse(rawBody) as typeof event
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const object = event.data?.object ?? {}
  const metadata =
    object.metadata && typeof object.metadata === 'object'
      ? (object.metadata as Record<string, unknown>)
      : {}
  const userId =
    typeof object.client_reference_id === 'string'
      ? object.client_reference_id
      : typeof metadata.userId === 'string'
        ? metadata.userId
        : null

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        if (!userId) return NextResponse.json({ received: true })
        await prisma.user.update({
          where: { id: userId },
          data: {
            plan: 'pro',
            stripeCustomerId: typeof object.customer === 'string' ? object.customer : null,
            stripeSubscriptionId:
              typeof object.subscription === 'string' ? object.subscription : null,
          },
        })
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        if (!userId) return NextResponse.json({ received: true })
        const status = typeof object.status === 'string' ? object.status : ''
        const active = ['active', 'trialing'].includes(status)
        await prisma.user.update({
          where: { id: userId },
          data: {
            plan: active ? 'pro' : parsePlanKey('free'),
            stripeSubscriptionId: typeof object.id === 'string' ? object.id : null,
          },
        })
        break
      }
      default:
        // Acknowledge events we don't act on (invoice.*, payment_intent.*, …).
        break
    }
    return NextResponse.json({ received: true })
  } catch {
    return NextResponse.json({ error: 'Could not update billing state.' }, { status: 500 })
  }
}
