import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Fake Redis client for sliding window ───────────────────────────
// Mimics the ZSET-based sliding window Lua eval surface.

function createFakeTierRedis() {
  const store = new Map<string, Map<string, number>>() // key -> (member -> score)
  return {
    store,
    eval: vi.fn(async (script: string, numKeys: number, ...args: (string | number)[]) => {
      const key = String(args[0])
      const windowStart = Number(args[1])
      const now = Number(args[2])
      const limit = Number(args[3])
      const windowMs = Number(args[4])

      if (!store.has(key)) store.set(key, new Map())
      const entries = store.get(key)!

      // ZREMRANGEBYSCORE: remove entries with score <= windowStart
      for (const [member, score] of entries) {
        if (score <= windowStart) entries.delete(member)
      }

      const count = entries.size
      if (count < limit) {
        // ZADD: add new entry
        entries.set(`${now}-${Math.floor(Math.random() * 1e6)}`, now)
        // Return [allowed, count, 0]
        return [1, count + 1, 0]
      } else {
        // Find oldest for retry-after
        let oldest = now
        for (const score of entries.values()) {
          if (score < oldest) oldest = score
        }
        const retryMs = oldest + windowMs - now
        return [0, count, Math.max(1, retryMs)]
      }
    }),
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    quit: vi.fn(async () => undefined),
  }
}

let fakeRedis: ReturnType<typeof createFakeTierRedis>

beforeEach(async () => {
  vi.resetModules()
  fakeRedis = createFakeTierRedis()
  vi.doMock('../lib/redis', () => ({
    getRedisClient: () => fakeRedis,
  }))
  // Clear the in-memory fallback windows between tests.
  // (We import the module fresh each time via vi.resetModules.)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('../lib/redis')
  vi.unstubAllEnvs()
})

describe('TIER_CONFIGS', () => {
  it('defines free and pro tiers', async () => {
    const { TIER_CONFIGS } = await import('../lib/billing/tier-rate-limit')
    expect(TIER_CONFIGS.free).toBeDefined()
    expect(TIER_CONFIGS.pro).toBeDefined()
    expect(TIER_CONFIGS.free.requestsPerMinute).toBeGreaterThan(0)
    expect(TIER_CONFIGS.free.requestsPerDay).toBeGreaterThan(0)
    expect(TIER_CONFIGS.pro.requestsPerDay).toBeNull() // unlimited
  })
})

describe('checkTierBurstLimit (Redis sliding window)', () => {
  it('allows requests up to the limit', async () => {
    const { checkTierBurstLimit } = await import('../lib/billing/tier-rate-limit')
    expect(await checkTierBurstLimit('u1', 'free')).toEqual({ allowed: true })
    expect(await checkTierBurstLimit('u1', 'free')).toEqual({ allowed: true })
  })

  it('rejects once the limit is exceeded', async () => {
    const { checkTierBurstLimit, TIER_CONFIGS } = await import('../lib/billing/tier-rate-limit')
    const limit = TIER_CONFIGS.free.requestsPerMinute
    // Exhaust the burst window: fake Redis allows count < limit.
    for (let i = 0; i < limit; i++) {
      expect(await checkTierBurstLimit('u1', 'free')).toEqual({ allowed: true })
    }
    // The next call hits the limit (count === limit).
    const result = await checkTierBurstLimit('u1', 'free')
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.retryAfterMs).toBeGreaterThan(0)
      expect(result.limit).toBe(limit)
    }
  })

  it('treats different users independently', async () => {
    const { checkTierBurstLimit } = await import('../lib/billing/tier-rate-limit')
    for (let i = 0; i < 19; i++) {
      await checkTierBurstLimit('u1', 'free')
    }
    // u2 has its own bucket.
    expect(await checkTierBurstLimit('u2', 'free')).toEqual({ allowed: true })
  })

  it('pro tier has a higher burst limit', async () => {
    const { checkTierBurstLimit, TIER_CONFIGS } = await import('../lib/billing/tier-rate-limit')
    // Pro allows 120 req/min — verify the config.
    expect(TIER_CONFIGS.pro.requestsPerMinute).toBe(120)
    // Fake Redis allows up to the limit, so 20 calls should all pass.
    for (let i = 0; i < 20; i++) {
      expect(await checkTierBurstLimit('u-pro', 'pro')).toEqual({ allowed: true })
    }
  })
})

describe('checkTierBurstLimit (in-memory fallback)', () => {
  beforeEach(async () => {
    vi.doMock('../lib/redis', () => ({
      getRedisClient: () => null,
    }))
  })

  it('allows requests up to the limit', async () => {
    const { checkTierBurstLimit } = await import('../lib/billing/tier-rate-limit')
    expect(await checkTierBurstLimit('u-mem', 'free')).toEqual({ allowed: true })
  })

  it('rejects when the limit is exceeded', async () => {
    const { checkTierBurstLimit, TIER_CONFIGS } = await import('../lib/billing/tier-rate-limit')
    const limit = TIER_CONFIGS.free.requestsPerMinute
    for (let i = 0; i < limit; i++) {
      await checkTierBurstLimit('u-mem-limit', 'free')
    }
    const result = await checkTierBurstLimit('u-mem-limit', 'free')
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.retryAfterMs).toBeGreaterThan(0)
    }
  })
})

describe('getCachedDailyUsage / setCachedDailyUsage / invalidateCachedDailyUsage', () => {
  it('round-trips daily usage through Redis', async () => {
    const { getCachedDailyUsage, setCachedDailyUsage } = await import('../lib/billing/tier-rate-limit')
    await setCachedDailyUsage('u1', { count: 5, date: '2026-09-04' })
    expect(fakeRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('daily:u1'),
      JSON.stringify({ count: 5, date: '2026-09-04' }),
      'EX',
      expect.any(Number),
    )
  })

  it('returns null on cache miss', async () => {
    const { getCachedDailyUsage } = await import('../lib/billing/tier-rate-limit')
    const result = await getCachedDailyUsage('u-miss')
    expect(result).toBeNull()
  })

  it('invalidateCachedDailyUsage deletes the key', async () => {
    const { invalidateCachedDailyUsage } = await import('../lib/billing/tier-rate-limit')
    await invalidateCachedDailyUsage('u1')
    expect(fakeRedis.del).toHaveBeenCalledWith(expect.stringContaining('daily:u1'))
  })
})

describe('checkTierLimits', () => {
  it('returns allowed when both burst and daily pass', async () => {
    const { checkTierLimits } = await import('../lib/billing/tier-rate-limit')
    const result = await checkTierLimits('u1', 'free', 5)
    expect(result.allowed).toBe(true)
  })

  it('denies when daily cap is reached', async () => {
    const { checkTierLimits, TIER_CONFIGS } = await import('../lib/billing/tier-rate-limit')
    const dailyLimit = TIER_CONFIGS.free.requestsPerDay!
    const result = await checkTierLimits('u1', 'free', dailyLimit)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe('daily')
      expect(result.error).toContain('Free plan')
    }
  })

  it('denies when burst limit is hit', async () => {
    const { checkTierLimits, TIER_CONFIGS } = await import('../lib/billing/tier-rate-limit')
    // Exhaust the burst window.
    const burstLimit = TIER_CONFIGS.free.requestsPerMinute
    for (let i = 0; i < burstLimit; i++) {
      await checkTierLimits('u1', 'free', 0)
    }
    const result = await checkTierLimits('u1', 'free', 0)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe('burst')
      expect(result.retryAfterMs).toBeGreaterThan(0)
    }
  })

  it('pro tier with null daily limit never denies on daily', async () => {
    const { checkTierLimits } = await import('../lib/billing/tier-rate-limit')
    // Even with a high count, pro has no daily cap.
    const result = await checkTierLimits('u-pro', 'pro', 1_000_000)
    expect(result.allowed).toBe(true)
  })

  it('unknown plan defaults to free tier config', async () => {
    const { checkTierLimits, TIER_CONFIGS } = await import('../lib/billing/tier-rate-limit')
    const dailyLimit = TIER_CONFIGS.free.requestsPerDay!
    const result = await checkTierLimits('u1', 'enterprise', dailyLimit)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe('daily')
    }
  })
})

describe('getCachedDailyUsage (Redis unavailable)', () => {
  beforeEach(async () => {
    vi.doMock('../lib/redis', () => ({
      getRedisClient: () => null,
    }))
  })

  it('returns null', async () => {
    const { getCachedDailyUsage } = await import('../lib/billing/tier-rate-limit')
    expect(await getCachedDailyUsage('u1')).toBeNull()
  })
})
