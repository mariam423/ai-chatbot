import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Fake BullMQ Queue ──────────────────────────────────────────────

const addedJobs: Array<{ name: string; data: unknown; opts?: unknown }> = []

// Captures the BullMQ Queue constructor's second argument so tests can
// assert the connection tuning (dedicated client, maxRetriesPerRequest null).
const queueConstructorOpts: Array<{
  connection?: { maxRetriesPerRequest?: number | null }
}> = []

function createFakeQueue() {
  return {
    add: vi.fn(async (name: string, data: unknown, opts?: unknown) => {
      addedJobs.push({ name, data, opts })
      return { id: `job-${addedJobs.length}` }
    }),
    getWaitingCount: vi.fn(async () => 1),
    getActiveCount: vi.fn(async () => 0),
    getCompletedCount: vi.fn(async () => 42),
    getFailedCount: vi.fn(async () => 2),
    getDelayedCount: vi.fn(async () => 0),
    close: vi.fn(async () => undefined),
  }
}

let fakeQueue: ReturnType<typeof createFakeQueue>

beforeEach(async () => {
  vi.resetModules()
  addedJobs.length = 0
  queueConstructorOpts.length = 0
  fakeQueue = createFakeQueue()
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379')

  vi.doMock('bullmq', () => ({
    Queue: vi.fn().mockImplementation(function (_name: string, opts?: unknown) {
      queueConstructorOpts.push(opts as { connection?: { maxRetriesPerRequest?: number | null } })
      return fakeQueue
    }),
  }))

  vi.doMock('../lib/redis', () => ({
    requireRedis: vi.fn(() => ({})),
    getRedisClient: vi.fn(() => ({})),
    // BullMQ requires maxRetriesPerRequest: null (blocking commands) —
    // assert the queue receives this dedicated connection.
    createBullMqConnection: vi.fn(() => ({ maxRetriesPerRequest: null })),
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('bullmq')
  vi.doUnmock('../lib/redis')
  vi.unstubAllEnvs()
})

describe('addTask', () => {
  it('adds a job to the queue and returns the job id', async () => {
    const { addTask } = await import('../lib/queues/task-queue')
    const jobId = await addTask('document:process', {
      sessionId: 's1',
      documentId: 'd1',
      userId: 'u1',
      fileName: 'test.pdf',
    })
    expect(jobId).toBe('job-1')
    expect(addedJobs).toHaveLength(1)
    // The queue must use a dedicated connection (maxRetriesPerRequest null)
    // because BullMQ issues blocking commands.
    expect(queueConstructorOpts[0]?.connection?.maxRetriesPerRequest).toBeNull()
    expect(addedJobs[0]!.name).toBe('document:process')
    expect(addedJobs[0]!.data).toEqual({
      sessionId: 's1',
      documentId: 'd1',
      userId: 'u1',
      fileName: 'test.pdf',
    })
  })

  it('returns null when Redis is unavailable', async () => {
    // Must delete REDIS_URL so getQueue() returns null before requiring redis.
    delete process.env.REDIS_URL
    vi.doMock('../lib/redis', () => ({
      requireRedis: vi.fn(() => {
        throw new Error('REDIS_URL not set')
      }),
      getRedisClient: vi.fn(() => null),
    }))

    const { addTask } = await import('../lib/queues/task-queue')
    const jobId = await addTask('document:process', {
      sessionId: 's1',
      documentId: 'd1',
      userId: 'u1',
      fileName: 'test.pdf',
    })
    expect(jobId).toBeNull()
    expect(addedJobs).toHaveLength(0)
  })

  it('passes job options through to BullMQ', async () => {
    const { addTask } = await import('../lib/queues/task-queue')
    await addTask(
      'webhook:stripe:post-process',
      { userId: 'u1', eventType: 'checkout.session.completed' },
      { delay: 5000, priority: 1 },
    )
    expect(addedJobs[0]!.opts).toEqual({ delay: 5000, priority: 1 })
  })

  it('handles BullMQ queue add failure gracefully', async () => {
    fakeQueue.add.mockRejectedValueOnce(new Error('Redis connection lost'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { addTask } = await import('../lib/queues/task-queue')
    const jobId = await addTask('document:process', {
      sessionId: 's1',
      documentId: 'd1',
      userId: 'u1',
      fileName: 'test.pdf',
    })
    expect(jobId).toBeNull()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[task-queue] Failed to add job'),
      expect.any(Error),
    )
    error.mockRestore()
  })

  it('adds different job types with correct names', async () => {
    const { addTask } = await import('../lib/queues/task-queue')

    await addTask('document:embed', { documentId: 'd1', chunks: [] })
    await addTask('analytics:aggregate', { userId: 'u1', event: 'chat_message_sent' })
    await addTask('cache:invalidate', { pattern: 'user:meta:*' })

    expect(addedJobs[0]!.name).toBe('document:embed')
    expect(addedJobs[1]!.name).toBe('analytics:aggregate')
    expect(addedJobs[2]!.name).toBe('cache:invalidate')
  })

  it('handles queue creation failure gracefully', async () => {
    // Throw from the constructor via the already-installed mock rather than
    // swapping vi.doMock mid-file (which can race under parallel load).
    const { Queue } = await import('bullmq')
    vi.mocked(Queue).mockImplementationOnce(() => {
      throw new Error('Connection refused')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { addTask } = await import('../lib/queues/task-queue')
    const jobId = await addTask('document:process', {
      sessionId: 's1',
      documentId: 'd1',
      userId: 'u1',
      fileName: 'test.pdf',
    })
    expect(jobId).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[task-queue] Failed to create queue'),
      expect.any(Error),
    )
    warn.mockRestore()
    vi.mocked(Queue).mockReset()
  })
})

describe('getQueueMetrics', () => {
  it('returns counts from the queue', async () => {
    // Trigger queue creation by adding a job first.
    const { addTask, getQueueMetrics } = await import('../lib/queues/task-queue')
    await addTask('document:process', {
      sessionId: 's1',
      documentId: 'd1',
      userId: 'u1',
      fileName: 'test.pdf',
    })
    const metrics = await getQueueMetrics()
    expect(metrics).toEqual({
      waiting: 1,
      active: 0,
      completed: 42,
      failed: 2,
      delayed: 0,
    })
  })

  it('returns null when Redis is unavailable', async () => {
    delete process.env.REDIS_URL
    vi.doMock('../lib/redis', () => ({
      requireRedis: vi.fn(() => {
        throw new Error('REDIS_URL not set')
      }),
      getRedisClient: vi.fn(() => null),
    }))
    const { getQueueMetrics } = await import('../lib/queues/task-queue')
    expect(await getQueueMetrics()).toBeNull()
  })

  it('returns null when metrics call fails', async () => {
    const { addTask, getQueueMetrics } = await import('../lib/queues/task-queue')
    await addTask('document:process', {
      sessionId: 's1',
      documentId: 'd1',
      userId: 'u1',
      fileName: 'test.pdf',
    })
    // Make all count methods throw.
    fakeQueue.getWaitingCount.mockRejectedValue(new Error('DISCONNECTED'))
    fakeQueue.getActiveCount.mockRejectedValue(new Error('DISCONNECTED'))
    fakeQueue.getCompletedCount.mockRejectedValue(new Error('DISCONNECTED'))
    fakeQueue.getFailedCount.mockRejectedValue(new Error('DISCONNECTED'))
    fakeQueue.getDelayedCount.mockRejectedValue(new Error('DISCONNECTED'))
    const result = await getQueueMetrics()
    expect(result).toBeNull()
  })
})

describe('closeTaskQueue', () => {
  it('closes the queue connection', async () => {
    const { addTask, closeTaskQueue } = await import('../lib/queues/task-queue')
    await addTask('document:process', {
      sessionId: 's1',
      documentId: 'd1',
      userId: 'u1',
      fileName: 'test.pdf',
    })
    await closeTaskQueue()
    expect(fakeQueue.close).toHaveBeenCalled()
  })

  it('is a no-op when no queue was created', async () => {
    delete process.env.REDIS_URL
    vi.doMock('../lib/redis', () => ({
      requireRedis: vi.fn(() => {
        throw new Error('REDIS_URL not set')
      }),
      getRedisClient: vi.fn(() => null),
    }))
    const { closeTaskQueue } = await import('../lib/queues/task-queue')
    // Should not throw.
    await closeTaskQueue()
  })
})
