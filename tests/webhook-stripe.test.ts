import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// Post-webhook side-effects: queue dispatch (BullMQ) + the cache invalidators
// it falls back to inline when Redis is unavailable (Phase 6 fault-injection
// coverage). Hoisted so the vi.mock factories below can reference them.
const { addTaskMock, invalidateBilling, invalidateUserMeta, invalidateDailyUsage } = vi.hoisted(
  () => ({
    // Promise<unknown> so mockResolvedValue accepts either a job id or null.
    addTaskMock: vi.fn(async (..._args: unknown[]) => null as unknown),
    invalidateBilling: vi.fn(async (..._args: unknown[]) => undefined as unknown),
    invalidateUserMeta: vi.fn(async (..._args: unknown[]) => undefined as unknown),
    invalidateDailyUsage: vi.fn(async (..._args: unknown[]) => undefined as unknown),
  }),
)

vi.mock('../lib/queues/task-queue', () => ({ addTask: addTaskMock }))
vi.mock('../lib/cache', () => ({
  invalidateCachedBillingStatus: invalidateBilling,
  invalidateCachedUserMeta: invalidateUserMeta,
}))
vi.mock('../lib/billing/tier-rate-limit', () => ({
  invalidateCachedDailyUsage: invalidateDailyUsage,
}))

beforeEach(() => {
  addTaskMock.mockReset()
  invalidateBilling.mockClear()
  invalidateUserMeta.mockClear()
  invalidateDailyUsage.mockClear()
  // Redis available by default — the queue accepts the job.
  addTaskMock.mockResolvedValue('job-1')
})

afterEach(() => {
  vi.unstubAllEnvs()
  userUpdate.mockClear()
  userFindFirst.mockReset()
  addTaskMock.mockReset()
  invalidateBilling.mockClear()
  invalidateUserMeta.mockClear()
  invalidateDailyUsage.mockClear()
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

  it('queues cache invalidation to the worker when Redis is available', async () => {
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
    // The post-process job was accepted…
    expect(addTaskMock).toHaveBeenCalledWith(
      'webhook:stripe:post-process',
      expect.objectContaining({ userId: 'user-123', eventType: 'checkout.session.completed' }),
    )
    // …so the caches are invalidated by the worker later, not inline now.
    expect(invalidateBilling).not.toHaveBeenCalled()
    expect(invalidateUserMeta).not.toHaveBeenCalled()
    expect(invalidateDailyUsage).not.toHaveBeenCalled()
  })

  it('invalidates caches inline when Redis is down (addTask returns null)', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    // Redis unavailable — the queue rejects the job.
    addTaskMock.mockResolvedValue(null)
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
    // The dispatch was attempted…
    expect(addTaskMock).toHaveBeenCalledWith('webhook:stripe:post-process', expect.any(Object))
    // …and every cache the worker would have cleared was invalidated inline,
    // so the plan change reflects immediately despite the Redis outage.
    expect(invalidateBilling).toHaveBeenCalledWith('user-123')
    expect(invalidateUserMeta).toHaveBeenCalledWith('user-123')
    expect(invalidateDailyUsage).toHaveBeenCalledWith('user-123')
  })

  it('also falls back inline for a subscription.deleted downgrade', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    addTaskMock.mockResolvedValue(null)
    const payload = JSON.stringify({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_xyz',
          status: 'canceled',
          metadata: { userId: 'user-456' },
        },
      },
    })
    const res = await POST(webhookRequest(payload, signedHeader(payload, 'whsec_test')))
    expect(res.status).toBe(200)
    expect(addTaskMock).toHaveBeenCalledWith(
      'webhook:stripe:post-process',
      expect.objectContaining({ userId: 'user-456', eventType: 'customer.subscription.deleted' }),
    )
    expect(invalidateBilling).toHaveBeenCalledWith('user-456')
    expect(invalidateUserMeta).toHaveBeenCalledWith('user-456')
    expect(invalidateDailyUsage).toHaveBeenCalledWith('user-456')
  })
})
