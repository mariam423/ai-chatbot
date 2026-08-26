import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../app/api/webhooks/stripe/route'

// The webhook only touches prisma.user; mock the client so no DB is needed.
const userUpdate = vi.fn()
const userFindFirst = vi.fn()
vi.mock('../lib/db', () => ({
  prisma: {
    user: {
      update: (...args: unknown[]) => userUpdate(...args),
      findFirst: (...args: unknown[]) => userFindFirst(...args),
    },
  },
}))

afterEach(() => {
  vi.unstubAllEnvs()
  userUpdate.mockClear()
  userFindFirst.mockReset()
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
        role: 'PRO',
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
      data: { plan: 'free', role: 'FREE', stripeSubscriptionId: null },
    })
  })

  it('resolves subscription updates by stored Stripe customer id', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    userFindFirst.mockResolvedValue({ id: 'user-456' })
    const payload = JSON.stringify({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_new',
          customer: 'cus_existing',
          status: 'active',
        },
      },
    })
    const res = await POST(webhookRequest(payload, signedHeader(payload, 'whsec_test')))
    expect(res.status).toBe(200)
    expect(userFindFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ stripeCustomerId: 'cus_existing' }, { stripeSubscriptionId: 'sub_new' }],
      },
      select: { id: true },
    })
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-456' },
      data: {
        plan: 'pro',
        role: 'PRO',
        stripeSubscriptionId: 'sub_new',
        stripeCustomerId: 'cus_existing',
      },
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
