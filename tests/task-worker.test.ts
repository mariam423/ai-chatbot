import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture points for the mocked BullMQ Worker constructor — the factory is
// hoisted above the imports, so these must live in vi.hoisted too.
const bull = vi.hoisted(() => ({
  processor: null as ((job: unknown) => Promise<void>) | null,
  constructorOpts: null as unknown,
  // Event handlers registered via worker.on(...) — keyed by event name so
  // tests can drive the completed/failed/error callbacks directly.
  handlers: {} as Record<string, (job?: unknown, error?: Error) => void>,
  on: vi.fn((event: string, cb: (job?: unknown, error?: Error) => void) => {
    bull.handlers[event] = cb
    return bull
  }),
  close: vi.fn(async () => {}),
}))

const mocks = vi.hoisted(() => ({
  createBullMqConnection: vi.fn(),
  invalidateCachedSessionMeta: vi.fn(),
  invalidateCachedUserMeta: vi.fn(),
  invalidateCachedBillingStatus: vi.fn(),
  invalidateCachedDailyUsage: vi.fn(),
  chunkDocumentText: vi.fn(),
  storeDocumentChunks: vi.fn(),
  createEmbedding: vi.fn(),
  upsertDocumentChunk: vi.fn(),
  logSecurityEvent: vi.fn(),
}))

vi.mock('../lib/redis', () => ({
  createBullMqConnection: mocks.createBullMqConnection,
}))
vi.mock('../lib/cache', () => ({
  invalidateCachedSessionMeta: mocks.invalidateCachedSessionMeta,
  invalidateCachedUserMeta: mocks.invalidateCachedUserMeta,
  invalidateCachedBillingStatus: mocks.invalidateCachedBillingStatus,
}))
vi.mock('../lib/billing/tier-rate-limit', () => ({
  invalidateCachedDailyUsage: mocks.invalidateCachedDailyUsage,
}))
vi.mock('../lib/documents', () => ({
  chunkDocumentText: mocks.chunkDocumentText,
}))
vi.mock('../lib/rag', () => ({
  storeDocumentChunks: mocks.storeDocumentChunks,
  createEmbedding: mocks.createEmbedding,
}))
vi.mock('../lib/db', () => ({
  prisma: { documentChunk: { upsert: mocks.upsertDocumentChunk } },
}))
vi.mock('../lib/audit', () => ({
  logSecurityEvent: mocks.logSecurityEvent,
}))
vi.mock('bullmq', () => ({
  // Regular `function` (not an arrow) so `new Worker(...)` works.
  Worker: vi.fn().mockImplementation(function (_name: string, processor: unknown, opts: unknown) {
    bull.processor = processor as (job: unknown) => Promise<void>
    bull.constructorOpts = opts
    return { on: bull.on, close: bull.close }
  }),
}))

beforeEach(() => {
  vi.resetModules()
  bull.processor = null
  bull.constructorOpts = null
  bull.handlers = {}
  vi.clearAllMocks()
  mocks.createBullMqConnection.mockReturnValue({ maxRetriesPerRequest: null })
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

async function start() {
  const { startWorker } = await import('../lib/workers/task-worker')
  startWorker()
}

describe('startWorker', () => {
  it('is a no-op when REDIS_URL is unset', async () => {
    vi.stubEnv('REDIS_URL', '')
    await start()
    expect(mocks.createBullMqConnection).not.toHaveBeenCalled()
    expect(bull.processor).toBeNull()
  })

  it('uses a dedicated connection with maxRetriesPerRequest: null', async () => {
    await start()
    expect(mocks.createBullMqConnection).toHaveBeenCalledTimes(1)
    const opts = bull.constructorOpts as { connection?: { maxRetriesPerRequest?: unknown } }
    expect(opts.connection?.maxRetriesPerRequest).toBeNull()
  })

  it('is idempotent — a second start does not create another worker', async () => {
    await start()
    await start()
    expect(mocks.createBullMqConnection).toHaveBeenCalledTimes(1)
  })
})

describe('worker tuning env knobs', () => {
  function workerOpts() {
    return bull.constructorOpts as { concurrency?: number; limiter?: { max?: number } }
  }

  it('defaults to concurrency 5 and limiter 30/s when no env is set', async () => {
    await start()
    expect(workerOpts().concurrency).toBe(5)
    expect(workerOpts().limiter?.max).toBe(30)
  })

  it('honors WORKER_CONCURRENCY and WORKER_LIMITER_MAX', async () => {
    vi.stubEnv('WORKER_CONCURRENCY', '2')
    vi.stubEnv('WORKER_LIMITER_MAX', '7')
    await start()
    expect(workerOpts().concurrency).toBe(2)
    expect(workerOpts().limiter?.max).toBe(7)
  })

  it('falls back to defaults for garbage env values', async () => {
    vi.stubEnv('WORKER_CONCURRENCY', 'not-a-number')
    vi.stubEnv('WORKER_LIMITER_MAX', '-3')
    await start()
    expect(workerOpts().concurrency).toBe(5)
    expect(workerOpts().limiter?.max).toBe(30)
  })
})

describe('worker job events', () => {
  it('emits an audit event with attempt count when a job permanently fails', async () => {
    await start()
    bull.handlers['failed']?.(
      {
        id: 'job-9',
        name: 'document:process',
        attemptsMade: 3,
      },
      new Error('boom'),
    )
    expect(mocks.logSecurityEvent).toHaveBeenCalledWith('worker_job_failed', {
      jobId: 'job-9',
      jobName: 'document:process',
      attempts: 3,
    })
  })

  it('registers completed/failed/error listeners', async () => {
    await start()
    expect(Object.keys(bull.handlers).sort()).toEqual(['completed', 'error', 'failed'])
  })
})

describe('document:process', () => {
  it('ingests chunks from the extracted text, then invalidates caches', async () => {
    mocks.chunkDocumentText.mockReturnValue(['chunk A', 'chunk B'])
    await start()
    await bull.processor?.({
      name: 'document:process',
      data: {
        sessionId: 's1',
        documentId: 'd1',
        userId: 'u1',
        fileName: 'a.pdf',
        text: 'hello world',
      },
    })
    expect(mocks.chunkDocumentText).toHaveBeenCalledWith('hello world')
    expect(mocks.storeDocumentChunks).toHaveBeenCalledWith('d1', [
      { chunkIndex: 0, content: 'chunk A' },
      { chunkIndex: 1, content: 'chunk B' },
    ])
    expect(mocks.invalidateCachedSessionMeta).toHaveBeenCalledWith('s1')
    expect(mocks.invalidateCachedUserMeta).toHaveBeenCalledWith('u1')
  })

  it('without text is post-processing only (cache invalidation)', async () => {
    await start()
    await bull.processor?.({
      name: 'document:process',
      data: { sessionId: 's1', documentId: 'd1', userId: 'u1', fileName: 'a.pdf' },
    })
    expect(mocks.chunkDocumentText).not.toHaveBeenCalled()
    expect(mocks.storeDocumentChunks).not.toHaveBeenCalled()
    expect(mocks.invalidateCachedSessionMeta).toHaveBeenCalledWith('s1')
    expect(mocks.invalidateCachedUserMeta).toHaveBeenCalledWith('u1')
  })
})

describe('document:embed', () => {
  it('upserts a computed embedding for every chunk', async () => {
    mocks.createEmbedding.mockReturnValue([0.25, 0.75])
    await start()
    await bull.processor?.({
      name: 'document:embed',
      data: {
        documentId: 'd1',
        chunks: [
          { chunkIndex: 0, content: 'first' },
          { chunkIndex: 1, content: 'second' },
        ],
      },
    })
    expect(mocks.createEmbedding).toHaveBeenCalledTimes(2)
    expect(mocks.upsertDocumentChunk).toHaveBeenCalledTimes(2)
    expect(mocks.upsertDocumentChunk).toHaveBeenNthCalledWith(1, {
      where: { documentId_chunkIndex: { documentId: 'd1', chunkIndex: 0 } },
      create: { documentId: 'd1', chunkIndex: 0, content: 'first', embedding: '[0.25,0.75]' },
      update: { embedding: '[0.25,0.75]' },
    })
  })
})

describe('webhook:stripe:post-process', () => {
  it('invalidates billing, user, and daily-usage caches', async () => {
    await start()
    await bull.processor?.({
      name: 'webhook:stripe:post-process',
      data: { userId: 'u1', eventType: 'checkout.session.completed', subscriptionId: 'sub_1' },
    })
    expect(mocks.invalidateCachedBillingStatus).toHaveBeenCalledWith('u1')
    expect(mocks.invalidateCachedUserMeta).toHaveBeenCalledWith('u1')
    expect(mocks.invalidateCachedDailyUsage).toHaveBeenCalledWith('u1')
  })
})

describe('unknown jobs', () => {
  it('are skipped without throwing', async () => {
    await start()
    await expect(bull.processor?.({ name: 'nope', data: {} })).resolves.toBeUndefined()
    expect(mocks.storeDocumentChunks).not.toHaveBeenCalled()
    expect(mocks.invalidateCachedUserMeta).not.toHaveBeenCalled()
  })
})
