import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Fake BullMQ Worker ─────────────────────────────────────────────

let capturedProcessor: ((job: { name?: string; data: unknown }) => Promise<void>) | null = null

const fakeWorker = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn(async () => undefined),
}

// Track cache invalidation calls.
const cacheInvalidations: Array<{ fn: string; args: unknown[] }> = []

let mockInvalidateUserMeta: ReturnType<typeof vi.fn>
let mockInvalidateSessionMeta: ReturnType<typeof vi.fn>
let mockInvalidateBillingStatus: ReturnType<typeof vi.fn>
let mockInvalidateDailyUsage: ReturnType<typeof vi.fn>

// Mock BullMQ — use a class so `new` works correctly.
vi.mock('bullmq', () => {
  class FakeWorker {
    constructor(
      _name: string,
      processor: (job: { name?: string; data: unknown }) => Promise<void>,
      _opts: unknown,
    ) {
      capturedProcessor = processor
    }
    on = fakeWorker.on
    close = fakeWorker.close
  }
  return { Worker: FakeWorker }
})

vi.mock('../lib/redis', () => ({
  requireRedis: vi.fn(() => ({})),
  getRedisClient: vi.fn(() => ({})),
}))

vi.mock('../lib/cache', () => ({
  invalidateCachedUserMeta: vi.fn(async () => {}),
  invalidateCachedSessionMeta: vi.fn(async () => {}),
  invalidateCachedBillingStatus: vi.fn(async () => {}),
}))

vi.mock('../lib/billing/tier-rate-limit', () => ({
  invalidateCachedDailyUsage: vi.fn(async () => {}),
}))

beforeEach(async () => {
  vi.resetModules()
  cacheInvalidations.length = 0
  capturedProcessor = null
  fakeWorker.on.mockClear()
  fakeWorker.close.mockClear()

  vi.stubEnv('REDIS_URL', 'redis://localhost:6379')

  // Wire up the mock functions with tracking implementations.
  const cache = await import('../lib/cache')
  mockInvalidateUserMeta = cache.invalidateCachedUserMeta as ReturnType<typeof vi.fn>
  mockInvalidateSessionMeta = cache.invalidateCachedSessionMeta as ReturnType<typeof vi.fn>
  mockInvalidateBillingStatus = cache.invalidateCachedBillingStatus as ReturnType<typeof vi.fn>
  mockInvalidateUserMeta.mockClear()
  mockInvalidateSessionMeta.mockClear()
  mockInvalidateBillingStatus.mockClear()
  mockInvalidateUserMeta.mockImplementation(async (userId: string) => {
    cacheInvalidations.push({ fn: 'invalidateCachedUserMeta', args: [userId] })
  })
  mockInvalidateSessionMeta.mockImplementation(async (sessionId: string) => {
    cacheInvalidations.push({ fn: 'invalidateCachedSessionMeta', args: [sessionId] })
  })
  mockInvalidateBillingStatus.mockImplementation(async (userId: string) => {
    cacheInvalidations.push({ fn: 'invalidateCachedBillingStatus', args: [userId] })
  })

  const tierRateLimit = await import('../lib/billing/tier-rate-limit')
  mockInvalidateDailyUsage = tierRateLimit.invalidateCachedDailyUsage as ReturnType<typeof vi.fn>
  mockInvalidateDailyUsage.mockClear()
  mockInvalidateDailyUsage.mockImplementation(async (userId: string) => {
    cacheInvalidations.push({ fn: 'invalidateCachedDailyUsage', args: [userId] })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('startWorker', () => {
  it('creates a BullMQ Worker when REDIS_URL is set', async () => {
    const { startWorker } = await import('../lib/workers/task-worker')
    startWorker()
    expect(capturedProcessor).not.toBeNull()
  })

  it('does not create a worker when REDIS_URL is unset', async () => {
    delete process.env.REDIS_URL
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { startWorker } = await import('../lib/workers/task-worker')
    startWorker()
    expect(capturedProcessor).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[worker] REDIS_URL not set'),
    )
    warn.mockRestore()
  })
})

describe('worker job processing', () => {
  beforeEach(async () => {
    const { startWorker } = await import('../lib/workers/task-worker')
    startWorker()
  })

  it('processes document:process jobs and invalidates caches', async () => {
    expect(capturedProcessor).not.toBeNull()
    await capturedProcessor!({
      name: 'document:process',
      data: { sessionId: 's1', documentId: 'd1', userId: 'u1', fileName: 'test.pdf' },
    })
    expect(mockInvalidateSessionMeta).toHaveBeenCalledWith('s1')
    expect(mockInvalidateUserMeta).toHaveBeenCalledWith('u1')
  })

  it('processes webhook:stripe:post-process jobs', async () => {
    expect(capturedProcessor).not.toBeNull()
    await capturedProcessor!({
      name: 'webhook:stripe:post-process',
      data: { userId: 'u1', eventType: 'checkout.session.completed', subscriptionId: 'sub_123' },
    })
    expect(mockInvalidateBillingStatus).toHaveBeenCalledWith('u1')
    expect(mockInvalidateUserMeta).toHaveBeenCalledWith('u1')
    expect(mockInvalidateDailyUsage).toHaveBeenCalledWith('u1')
  })

  it('processes webhook:stripe:post-process without subscriptionId', async () => {
    expect(capturedProcessor).not.toBeNull()
    await capturedProcessor!({
      name: 'webhook:stripe:post-process',
      data: { userId: 'u1', eventType: 'customer.subscription.deleted' },
    })
    expect(mockInvalidateBillingStatus).toHaveBeenCalledWith('u1')
  })

  it('processes analytics:aggregate jobs without throwing', async () => {
    expect(capturedProcessor).not.toBeNull()
    await capturedProcessor!({
      name: 'analytics:aggregate',
      data: { userId: 'u1', event: 'chat_message_sent', metadata: { model: 'gpt-4o' } },
    })
    expect(cacheInvalidations).toHaveLength(0)
  })

  it('processes cache:invalidate jobs with userId', async () => {
    expect(capturedProcessor).not.toBeNull()
    await capturedProcessor!({
      name: 'cache:invalidate',
      data: { pattern: 'user:meta:*', userId: 'u1' },
    })
    expect(mockInvalidateUserMeta).toHaveBeenCalledWith('u1')
  })

  it('processes cache:invalidate jobs without userId', async () => {
    expect(capturedProcessor).not.toBeNull()
    await capturedProcessor!({
      name: 'cache:invalidate',
      data: { pattern: 'user:meta:*' },
    })
    expect(cacheInvalidations).toHaveLength(0)
  })

  it('logs a warning for unknown job types', async () => {
    expect(capturedProcessor).not.toBeNull()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await capturedProcessor!({ name: 'nonexistent:job', data: {} })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[worker] Unknown job type:'),
    )
    warn.mockRestore()
  })
})

describe('stopWorker', () => {
  it('closes the worker', async () => {
    const { startWorker, stopWorker } = await import('../lib/workers/task-worker')
    startWorker()
    await stopWorker()
    expect(fakeWorker.close).toHaveBeenCalled()
  })
})
