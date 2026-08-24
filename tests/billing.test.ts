import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { parsePlanKey, getPlan, isOverDailyLimit, PLANS, type PlanKey } from '../lib/billing/plans'
import { verifyStripeWebhookSignature } from '../lib/billing/stripe'

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
