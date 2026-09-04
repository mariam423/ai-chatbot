import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Fake Redis client ──────────────────────────────────────────────
// Mimics the ioredis surface that lib/cache.ts actually uses.

function createFakeRedis() {
  const store = new Map<string, string>()
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, _ex?: string, _ttl?: number) => {
      store.set(key, value)
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    scan: vi.fn(async (_cursor: string, _cmd: string, _pattern: string, _count: string) => {
      return ['0', [] as string[]]
    }),
    pipeline: vi.fn(() => ({
      del: vi.fn(),
      exec: vi.fn(async () => [] as unknown[]),
    })),
    quit: vi.fn(async () => undefined),
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    status: 'ready',
  }
}

let fakeRedis: ReturnType<typeof createFakeRedis>

beforeEach(async () => {
  vi.resetModules()
  fakeRedis = createFakeRedis()

  vi.doMock('../lib/redis', () => ({
    getRedisClient: () => fakeRedis,
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('../lib/redis')
})

describe('cacheGet / cacheSet / cacheDel', () => {
  it('returns null on cache miss', async () => {
    const { cacheGet } = await import('../lib/cache')
    const result = await cacheGet<{ name: string }>('nonexistent')
    expect(result).toBeNull()
  })

  it('round-trips a JSON value through set/get', async () => {
    const { cacheGet, cacheSet } = await import('../lib/cache')
    await cacheSet('test:key', { name: 'Alice', age: 30 }, 60)
    expect(fakeRedis.set).toHaveBeenCalledWith(
      'pulse:cache:test:key',
      JSON.stringify({ name: 'Alice', age: 30 }),
      'EX',
      60,
    )
    fakeRedis.get.mockImplementation(async (key: string) => fakeRedis.store.get(key) ?? null)
    const result = await cacheGet<{ name: string; age: number }>('test:key')
    expect(result).toEqual({ name: 'Alice', age: 30 })
  })

  it('returns null when Redis throws (degraded mode)', async () => {
    fakeRedis.get.mockRejectedValueOnce(new Error('ECONNRESET'))
    const { cacheGet } = await import('../lib/cache')
    const result = await cacheGet('broken:key')
    expect(result).toBeNull()
  })

  it('returns null when cached value is corrupted JSON', async () => {
    fakeRedis.get.mockResolvedValueOnce('not-valid-json{{{')
    const { cacheGet } = await import('../lib/cache')
    const result = await cacheGet('corrupted:key')
    expect(result).toBeNull()
  })

  it('cacheDel calls redis.del with the prefixed key', async () => {
    const { cacheDel } = await import('../lib/cache')
    await cacheDel('my:key')
    expect(fakeRedis.del).toHaveBeenCalledWith('pulse:cache:my:key')
  })

  it('cacheDel no-ops when Redis is unavailable', async () => {
    vi.doMock('../lib/redis', () => ({
      getRedisClient: () => null,
    }))
    const { cacheDel } = await import('../lib/cache')
    await cacheDel('missing:key')
  })

  it('cacheSet ignores Redis failures (non-fatal)', async () => {
    fakeRedis.set.mockRejectedValueOnce(new Error('WRITEONLY'))
    const { cacheSet } = await import('../lib/cache')
    await cacheSet('fail:key', { data: 1 }, 30)
  })

  it('cacheDel ignores Redis failures (non-fatal)', async () => {
    fakeRedis.del.mockRejectedValueOnce(new Error('READONLY'))
    const { cacheDel } = await import('../lib/cache')
    await cacheDel('fail:key')
  })

  it('cacheGet handles empty string from Redis as miss', async () => {
    fakeRedis.get.mockResolvedValueOnce('')
    const { cacheGet } = await import('../lib/cache')
    // Empty string is falsy, should be treated as miss.
    const result = await cacheGet('empty:key')
    expect(result).toBeNull()
  })
})

describe('cacheDelPattern', () => {
  it('scans and deletes matching keys', async () => {
    fakeRedis.scan.mockResolvedValueOnce(['0', ['pulse:cache:user:meta:u1', 'pulse:cache:user:meta:u2']])
    const pipelineInstance = { del: vi.fn(), exec: vi.fn(async () => []) }
    fakeRedis.pipeline.mockReturnValueOnce(pipelineInstance)

    const { cacheDelPattern } = await import('../lib/cache')
    await cacheDelPattern('user:meta:*')

    expect(fakeRedis.scan).toHaveBeenCalledWith(
      '0', 'MATCH', 'pulse:cache:user:meta:*', 'COUNT', 100,
    )
    expect(fakeRedis.pipeline).toHaveBeenCalled()
    expect(pipelineInstance.del).toHaveBeenCalledWith('pulse:cache:user:meta:u1')
    expect(pipelineInstance.del).toHaveBeenCalledWith('pulse:cache:user:meta:u2')
    expect(pipelineInstance.exec).toHaveBeenCalled()
  })

  it('handles multiple pages of SCAN results', async () => {
    const pipelineInstance = { del: vi.fn(), exec: vi.fn(async () => []) }
    fakeRedis.pipeline.mockReturnValue(pipelineInstance)

    // First page returns cursor "42" with 2 keys, second page returns "0" with 1 key.
    fakeRedis.scan
      .mockResolvedValueOnce(['42', ['pulse:cache:batch:1', 'pulse:cache:batch:2']])
      .mockResolvedValueOnce(['0', ['pulse:cache:batch:3']])

    const { cacheDelPattern } = await import('../lib/cache')
    await cacheDelPattern('batch:*')

    expect(fakeRedis.scan).toHaveBeenCalledTimes(2)
    expect(pipelineInstance.del).toHaveBeenCalledTimes(3)
    expect(pipelineInstance.exec).toHaveBeenCalledTimes(2)
  })

  it('handles empty SCAN results', async () => {
    fakeRedis.scan.mockResolvedValueOnce(['0', []])
    const { cacheDelPattern } = await import('../lib/cache')
    await cacheDelPattern('nothing:*')
    expect(fakeRedis.pipeline).not.toHaveBeenCalled()
  })

  it('no-ops when Redis is unavailable', async () => {
    vi.doMock('../lib/redis', () => ({
      getRedisClient: () => null,
    }))
    const { cacheDelPattern } = await import('../lib/cache')
    await cacheDelPattern('user:*')
  })

  it('handles SCAN failure gracefully', async () => {
    fakeRedis.scan.mockRejectedValueOnce(new Error('DISCONNECTED'))
    const { cacheDelPattern } = await import('../lib/cache')
    await cacheDelPattern('user:*')
  })
})

describe('domain-specific cache accessors', () => {
  it('getCachedUserMeta / setCachedUserMeta', async () => {
    const { getCachedUserMeta, setCachedUserMeta } = await import('../lib/cache')
    const meta = { id: 'u1', plan: 'free', role: 'FREE', usageCount: 5, usageTokens: 1200, usageDate: '2026-09-04' }
    await setCachedUserMeta('u1', meta)
    fakeRedis.get.mockImplementation(async (key: string) => fakeRedis.store.get(key) ?? null)
    const cached = await getCachedUserMeta('u1')
    expect(cached).toEqual(meta)
  })

  it('invalidateCachedUserMeta deletes the key', async () => {
    const { invalidateCachedUserMeta } = await import('../lib/cache')
    await invalidateCachedUserMeta('u1')
    expect(fakeRedis.del).toHaveBeenCalledWith('pulse:cache:user:meta:u1')
  })

  it('getCachedBillingStatus / setCachedBillingStatus', async () => {
    const { getCachedBillingStatus, setCachedBillingStatus } = await import('../lib/cache')
    const status = { plan: 'pro', planLabel: 'Pro', dailyLimit: null, usedToday: 42, overLimit: false, stripeConfigured: true }
    await setCachedBillingStatus('u1', status)
    fakeRedis.get.mockImplementation(async (key: string) => fakeRedis.store.get(key) ?? null)
    const cached = await getCachedBillingStatus('u1')
    expect(cached).toEqual(status)
  })

  it('invalidateCachedBillingStatus deletes the key', async () => {
    const { invalidateCachedBillingStatus } = await import('../lib/cache')
    await invalidateCachedBillingStatus('u1')
    expect(fakeRedis.del).toHaveBeenCalledWith('pulse:cache:billing:u1')
  })

  it('getCachedSessionMeta / setCachedSessionMeta', async () => {
    const { getCachedSessionMeta, setCachedSessionMeta } = await import('../lib/cache')
    const meta = { id: 's1', title: 'Hello', messageCount: 10, lastModel: 'gpt-4o' }
    await setCachedSessionMeta('s1', meta)
    fakeRedis.get.mockImplementation(async (key: string) => fakeRedis.store.get(key) ?? null)
    const cached = await getCachedSessionMeta('s1')
    expect(cached).toEqual(meta)
  })

  it('invalidateCachedSessionMeta deletes the key', async () => {
    const { invalidateCachedSessionMeta } = await import('../lib/cache')
    await invalidateCachedSessionMeta('s1')
    expect(fakeRedis.del).toHaveBeenCalledWith('pulse:cache:session:meta:s1')
  })

  it('invalidateAllUserCache clears user meta, billing, and sessions', async () => {
    const { invalidateAllUserCache } = await import('../lib/cache')
    fakeRedis.scan.mockResolvedValueOnce(['0', []])
    await invalidateAllUserCache('u1')
    expect(fakeRedis.del).toHaveBeenCalledWith('pulse:cache:user:meta:u1')
    expect(fakeRedis.del).toHaveBeenCalledWith('pulse:cache:billing:u1')
  })

  it('returns null when domain accessor gets corrupted JSON', async () => {
    fakeRedis.get.mockResolvedValueOnce('{broken')
    const { getCachedUserMeta } = await import('../lib/cache')
    const result = await getCachedUserMeta('u1')
    expect(result).toBeNull()
  })
})

describe('cache accessors degrade when Redis is null', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../lib/redis', () => ({
      getRedisClient: () => null,
    }))
  })

  it('getCachedUserMeta returns null', async () => {
    const { getCachedUserMeta } = await import('../lib/cache')
    expect(await getCachedUserMeta('u1')).toBeNull()
  })

  it('setCachedUserMeta is a no-op', async () => {
    const { setCachedUserMeta } = await import('../lib/cache')
    await setCachedUserMeta('u1', { id: 'u1', plan: 'free', role: 'FREE', usageCount: 0, usageTokens: 0, usageDate: '' })
  })

  it('invalidateCachedUserMeta is a no-op', async () => {
    const { invalidateCachedUserMeta } = await import('../lib/cache')
    await invalidateCachedUserMeta('u1')
  })

  it('invalidateAllUserCache is a no-op', async () => {
    const { invalidateAllUserCache } = await import('../lib/cache')
    await invalidateAllUserCache('u1')
  })

  it('getCachedBillingStatus returns null', async () => {
    const { getCachedBillingStatus } = await import('../lib/cache')
    expect(await getCachedBillingStatus('u1')).toBeNull()
  })

  it('getCachedSessionMeta returns null', async () => {
    const { getCachedSessionMeta } = await import('../lib/cache')
    expect(await getCachedSessionMeta('s1')).toBeNull()
  })
})
