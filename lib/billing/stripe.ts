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
const STRIPE_REQUEST_TIMEOUT_MS = 10_000

function isConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

async function stripeFetch(path: string, params: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams(params)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), STRIPE_REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${STRIPE_API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_000) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
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
      // Do not echo Stripe's response body: it may contain account metadata or
      // provider diagnostics that are not useful to the browser.
      return { ok: false, error: `Stripe checkout failed (${response.status}).` }
    }
    const session = (await response.json()) as { id?: unknown; url?: unknown }
    if (typeof session.id !== 'string' || !isHttpsUrl(session.url)) {
      return { ok: false, error: 'Stripe returned an invalid checkout session.' }
    }
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
      return { ok: false, error: `Stripe portal failed (${response.status}).` }
    }
    const session = (await response.json()) as { url?: unknown }
    if (!isHttpsUrl(session.url)) {
      return { ok: false, error: 'Stripe returned an invalid billing portal session.' }
    }
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

  const parts = signatureHeader.split(',').map((part) => {
    const [key, ...rest] = part.trim().split('=')
    return { key, value: rest.join('=') }
  })
  const timestamp = parts.find((part) => part.key === 't')?.value
  const signatures = parts
    .filter((part) => part.key === 'v1' && part.value)
    .map((part) => part.value)
  if (!timestamp || signatures.length === 0) return false

  // Reject signatures older than 5 minutes (Stripe's documented tolerance).
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  const expectedBuffer = Buffer.from(expected)
  return signatures.some((signature) => {
    const candidate = Buffer.from(signature)
    return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer)
  })
}
