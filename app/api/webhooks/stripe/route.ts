import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { guardRoute, ROUTE_GUARDS, clientIp } from '@/lib/security'
import { logSecurityEvent } from '@/lib/audit'
import { verifyStripeWebhookSignature } from '@/lib/billing/stripe'
import { parsePlanKey } from '@/lib/billing/plans'
import { DEFAULT_USER_ROLE } from '@/lib/roles'
import { sendSubscriptionActivatedEmail, sendSubscriptionCancelledEmail } from '@/lib/email'

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
    // A08/A09: an unverifiable webhook is integrity-relevant — log the event
    // (ip + signature presence only, never the body or the signature value).
    logSecurityEvent('webhook_invalid_signature', {
      ip: clientIp(request),
      signaturePresent: signature !== null,
    })
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
  const explicitUserId =
    typeof object.client_reference_id === 'string'
      ? object.client_reference_id
      : typeof metadata.userId === 'string'
        ? metadata.userId
        : typeof metadata.user_id === 'string'
          ? metadata.user_id
          : null
  const customerId = typeof object.customer === 'string' ? object.customer : null
  const subscriptionId = typeof object.id === 'string' ? object.id : null

  try {
    // Subscription events may not contain Checkout's client_reference_id.
    // Resolve the user from the stable Stripe ids saved at checkout time so
    // renewals, cancellations, and dashboard-triggered updates are applied.
    let userId = explicitUserId
    if (!userId && (customerId || subscriptionId)) {
      const matched = await prisma.user.findFirst({
        where: {
          OR: [
            ...(customerId ? [{ stripeCustomerId: customerId }] : []),
            ...(subscriptionId ? [{ stripeSubscriptionId: subscriptionId }] : []),
          ],
        },
        select: { id: true },
      })
      userId = matched?.id ?? null
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        if (!userId) return NextResponse.json({ received: true })
        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            plan: 'pro',
            role: 'PRO',
            stripeCustomerId: customerId,
            stripeSubscriptionId:
              typeof object.subscription === 'string' ? object.subscription : null,
          },
        })
        if (updatedUser?.email) void sendSubscriptionActivatedEmail(updatedUser.email)
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        if (!userId) return NextResponse.json({ received: true })
        const status = typeof object.status === 'string' ? object.status : ''
        const active = ['active', 'trialing'].includes(status)
        const updateData = {
          plan: active ? 'pro' : parsePlanKey('free'),
          role: active ? 'PRO' : DEFAULT_USER_ROLE,
          // A deleted subscription must be cleared so the portal cannot be
          // opened against a stale customer subscription. For updates, retain
          // the current subscription id when Stripe supplied one.
          stripeSubscriptionId:
            event.type === 'customer.subscription.deleted' ? null : subscriptionId,
          ...(customerId ? { stripeCustomerId: customerId } : {}),
        }
        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: updateData,
        })
        // Stripe can emit several inactive subscription.updated events while
        // a cancellation settles. Send the lifecycle notification once, on
        // the definitive deleted event, to avoid duplicate emails.
        if (updatedUser?.email && event.type === 'customer.subscription.deleted') {
          void sendSubscriptionCancelledEmail(updatedUser.email)
        }
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
