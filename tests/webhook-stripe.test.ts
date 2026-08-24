import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../app/api/webhooks/stripe/route'

// The webhook only touches prisma.user; mock the client so no DB is needed.
const userUpdate = vi.fn()
vi.mock('../lib/db', () => ({
  prisma: {
    user: { update: (...args: unknown[]) => userUpdate(...args) },
  },
}))

afterEach(() => {
  vi.unstubAllEnvs()
  userUpdate.mockClear()
})

function signedHeader(
  payload: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

function webhookRequest(payload: string, header: string | null): Request {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: header ? { 'stripe-signature': header } : {},
    body: payload,
  })
}

describe('POST /api/webhooks/stripe', () => {
  it('returns 501 when the webhook is not configured', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    const res = await POST(webhookRequest('{}', 't=1,v1=x'))
    expect(res.status).toBe(501)
  })

  it('rejects an unverified signature with 401', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    const payload = JSON.stringify({ type: 'checkout.session.completed' })
    const res = await POST(webhookRequest(payload, 't=1,v1=forged'))
    expect(res.status).toBe(401)
  })

  it('upgrades the user to pro on checkout.session.completed', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user-123',
          customer: 'cus_abc',
          subscription: 'sub_xyz',
        },
      },
    })
    const res = await POST(webhookRequest(payload, signedHeader(payload, 'whsec_test')))
    expect(res.status).toBe(200)
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: {
        plan: 'pro',
        stripeCustomerId: 'cus_abc',
        stripeSubscriptionId: 'sub_xyz',
      },
    })
  })

  it('downgrades to free on subscription.deleted', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    const payload = JSON.stringify({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_xyz',
          status: 'canceled',
          metadata: { userId: 'user-123' },
        },
      },
    })
    const res = await POST(webhookRequest(payload, signedHeader(payload, 'whsec_test')))
    expect(res.status).toBe(200)
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: { plan: 'free', stripeSubscriptionId: 'sub_xyz' },
    })
  })

  it('acknowledges unhandled event types without touching the DB', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    const payload = JSON.stringify({ type: 'invoice.paid', data: { object: {} } })
    const res = await POST(webhookRequest(payload, signedHeader(payload, 'whsec_test')))
    expect(res.status).toBe(200)
    expect(userUpdate).not.toHaveBeenCalled()
  })
})
