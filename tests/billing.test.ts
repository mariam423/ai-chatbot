import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { parsePlanKey, getPlan, isOverDailyLimit, PLANS, type PlanKey } from '../lib/billing/plans'
import {
  createBillingPortalSession,
  createCheckoutSession,
  verifyStripeWebhookSignature,
} from '../lib/billing/stripe'

describe('plans', () => {
  it('normalizes stored plan values to valid keys', () => {
    expect(parsePlanKey('pro')).toBe('pro')
    expect(parsePlanKey('free')).toBe('free')
    expect(parsePlanKey(null)).toBe('free')
    expect(parsePlanKey(undefined)).toBe('free')
    expect(parsePlanKey('enterprise')).toBe('free')
  })

  it('free plan has a daily cap, pro is unlimited', () => {
    const free = getPlan('free')
    const pro = getPlan('pro')
    expect(free.dailyChatRequests).toBeGreaterThan(0)
    expect(pro.dailyChatRequests).toBeNull()
  })

  it('isOverDailyLimit respects the cap boundary', () => {
    const freeLimit = getPlan('free').dailyChatRequests as number
    expect(isOverDailyLimit('free', freeLimit - 1)).toBe(false)
    expect(isOverDailyLimit('free', freeLimit)).toBe(true)
    // Pro is never over the limit regardless of usage.
    expect(isOverDailyLimit('pro', 1_000_000)).toBe(false)
  })

  it('exposes every plan key through the PLANS table', () => {
    for (const key of ['free', 'pro'] as PlanKey[]) {
      expect(PLANS[key].key).toBe(key)
      expect(PLANS[key].label.length).toBeGreaterThan(0)
    }
  })
})

describe('Stripe session helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('degrades cleanly when Stripe is not configured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    expect(
      await createCheckoutSession({ customerId: null, userId: 'u1', email: 'u@example.com' }),
    ).toEqual({
      ok: false,
      notConfigured: true,
    })
    expect(await createBillingPortalSession({ customerId: 'cus_123' })).toEqual({
      ok: false,
      notConfigured: true,
    })
  })

  it('creates a subscription checkout session with server-side parameters', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret')
    vi.stubEnv('STRIPE_PRICE_PRO', 'price_pro')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ id: 'cs_test', url: 'https://checkout.stripe.com/cs_test' }),
          {
            status: 200,
          },
        ),
      ),
    )

    const result = await createCheckoutSession({
      customerId: null,
      userId: 'user-123',
      email: 'user@example.com',
    })
    expect(result).toEqual({
      ok: true,
      data: { url: 'https://checkout.stripe.com/cs_test', sessionId: 'cs_test' },
    })
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    const params = new URLSearchParams(init?.body as string)
    expect(params.get('mode')).toBe('subscription')
    expect(params.get('line_items[0][price]')).toBe('price_pro')
    expect(params.get('client_reference_id')).toBe('user-123')
    expect(params.get('customer_email')).toBe('user@example.com')
  })

  it('rejects malformed Stripe session responses and provider failures', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret')
    vi.stubEnv('STRIPE_PRICE_PRO', 'price_pro')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ id: 'missing-url' }), { status: 200 })),
    )
    expect(
      (await createCheckoutSession({ customerId: 'cus_123', userId: 'u1', email: 'u@example.com' }))
        .ok,
    ).toBe(false)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })))
    const failed = await createBillingPortalSession({ customerId: 'cus_123' })
    expect(failed).toEqual({ ok: false, error: 'Stripe portal failed (502).' })
  })
})

describe('verifyStripeWebhookSignature', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function signedHeader(payload: string, secret: string, timestamp: number): string {
    const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
    return `t=${timestamp},v1=${signature}`
  }

  it('accepts a valid signature', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    const payload = '{"type":"checkout.session.completed"}'
    const header = signedHeader(payload, 'whsec_test', Math.floor(Date.now() / 1000))
    expect(verifyStripeWebhookSignature(payload, header)).toBe(true)
  })

  it('accepts any valid v1 signature during secret rotation', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    const payload = '{"type":"checkout.session.completed"}'
    const timestamp = Math.floor(Date.now() / 1000)
    const valid = signedHeader(payload, 'whsec_test', timestamp).split(',')[1]
    expect(verifyStripeWebhookSignature(payload, `t=${timestamp},v1=old-signature,${valid}`)).toBe(
      true,
    )
  })

  it('rejects a tampered payload', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    const payload = '{"type":"checkout.session.completed"}'
    const header = signedHeader(payload, 'whsec_test', Math.floor(Date.now() / 1000))
    expect(verifyStripeWebhookSignature(payload + ' ', header)).toBe(false)
  })

  it('rejects a stale signature beyond the 5-minute window', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    const payload = '{"type":"checkout.session.completed"}'
    const old = Math.floor(Date.now() / 1000) - 400
    const header = signedHeader(payload, 'whsec_test', old)
    expect(verifyStripeWebhookSignature(payload, header)).toBe(false)
  })

  it('rejects when the webhook secret is not configured', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    const payload = '{"type":"checkout.session.completed"}'
    const header = signedHeader(payload, 'whsec_test', Math.floor(Date.now() / 1000))
    expect(verifyStripeWebhookSignature(payload, header)).toBe(false)
    expect(verifyStripeWebhookSignature(payload, null)).toBe(false)
  })
})
