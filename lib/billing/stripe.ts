import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Server-only Stripe integration (no SDK dependency — plain fetch against the
 * Stripe REST API, keeping the dependency footprint lean).
 *
 * Env configuration:
 *   STRIPE_SECRET_KEY      — required to create sessions (sk_test_... / sk_live_...)
 *   STRIPE_WEBHOOK_SECRET  — required to verify webhook signatures (whsec_...)
 *   STRIPE_PRICE_PRO       — the Pro price id billed via checkout (see plans.ts)
 *   STRIPE_PRICE_PRO_BILLING — optional; defaults to the same Pro price for
 *                              the billing portal (the portal uses the user's
 *                              live subscription, so this is not normally needed)
 *   NEXT_PUBLIC_APP_URL    — base URL for return/redirect URLs (defaults to
 *                            http://localhost:3000)
 *
 * Every function degrades gracefully: when STRIPE_SECRET_KEY is unset the
 * session helpers return `{ ok: false, notConfigured: true }` so the UI can
 * hide billing entirely instead of breaking.
 */

const STRIPE_API = 'https://api.stripe.com/v1'

function isConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

async function stripeFetch(path: string, params: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams(params)
  return fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
}

export interface BillingResult<T> {
  ok: boolean
  notConfigured?: boolean
  data?: T
  error?: string
}

/**
 * Create a Stripe Checkout session for a plan (currently only "pro").
 * Returns the session url the client should redirect to.
 */
export async function createCheckoutSession(input: {
  customerId: string | null
  userId: string
  email: string
}): Promise<BillingResult<{ url: string; sessionId: string }>> {
  if (!isConfigured()) return { ok: false, notConfigured: true }
  const priceId = process.env.STRIPE_PRICE_PRO
  if (!priceId) {
    return { ok: false, error: 'Pro plan price is not configured (STRIPE_PRICE_PRO).' }
  }
  try {
    const params: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${appUrl()}/settings?billing=success`,
      cancel_url: `${appUrl()}/settings?billing=cancelled`,
      client_reference_id: input.userId,
      'subscription_data[metadata][userId]': input.userId,
    }
    if (input.customerId) {
      params.customer = input.customerId
    } else {
      params.customer_email = input.email
    }
    const response = await stripeFetch('/checkout/sessions', params)
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return {
        ok: false,
        error: `Stripe checkout failed (${response.status}). ${detail.slice(0, 200)}`,
      }
    }
    const session = (await response.json()) as { id: string; url: string }
    return { ok: true, data: { url: session.url, sessionId: session.id } }
  } catch {
    return { ok: false, error: 'Could not reach Stripe checkout.' }
  }
}

/**
 * Create a billing-portal session so the user can manage/cancel their
 * subscription. Requires an existing Stripe customer id.
 */
export async function createBillingPortalSession(input: {
  customerId: string
}): Promise<BillingResult<{ url: string }>> {
  if (!isConfigured()) return { ok: false, notConfigured: true }
  try {
    const response = await stripeFetch('/billing_portal/sessions', {
      customer: input.customerId,
      return_url: `${appUrl()}/settings`,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return {
        ok: false,
        error: `Stripe portal failed (${response.status}). ${detail.slice(0, 200)}`,
      }
    }
    const session = (await response.json()) as { url: string }
    return { ok: true, data: { url: session.url } }
  } catch {
    return { ok: false, error: 'Could not reach Stripe billing portal.' }
  }
}

/**
 * Verify a Stripe webhook signature (Stripe-Signature header, t=... ,v1=...).
 * Uses the STRIPE_WEBHOOK_SECRET configured for the endpoint. Returns true
 * only for a valid signature over the raw body, within the 5-minute skew
 * tolerance Stripe allows.
 */
export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !signatureHeader) return false

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=')
      return [key, rest.join('=')]
    }),
  )
  const timestamp = parts['t']
  const signature = parts['v1']
  if (!timestamp || !signature) return false

  // Reject signatures older than 5 minutes (Stripe's documented tolerance).
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
