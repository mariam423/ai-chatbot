import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Candidate + circuit-breaker unit tests for lib/gateway.ts (Phase 4).
//
// With no REDIS_URL the breaker degrades to a per-process memory store — the
// same contract as the cache and rate limiter — so most tests exercise that
// path deterministically. A separate describe swaps in a fake ioredis client
// to prove the Redis-backed path (state shared across "instances", TTLs,
// pattern cleanup) behaves the same.

const { getRedisClientMock, fakeRedis, clearFakeRedisStore } = vi.hoisted(() => {
  type Entry = { value: string; expiresAt: number }
  const store = new Map<string, Entry>()
  const getRedisClientMock = vi.fn<() => unknown>(() => null)
  const fakeRedis = {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiresAt <= Date.now()) {
        store.delete(key)
        return null
      }
      return entry.value
    },
    async set(key: string, value: string, _mode: string, ttlSeconds: number): Promise<'OK'> {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
      return 'OK'
    },
    async keys(pattern: string): Promise<string[]> {
      const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
      return [...store.keys()].filter((key) => re.test(key))
    },
    async del(...keys: string[]): Promise<number> {
      let removed = 0
      for (const key of keys) if (store.delete(key)) removed++
      return removed
    },
  }
  return { getRedisClientMock, fakeRedis, clearFakeRedisStore: () => store.clear() }
})

vi.mock('@/lib/redis', () => ({
  getRedisClient: () => getRedisClientMock(),
}))

import {
  GATEWAY_FAILURE_THRESHOLD,
  isGatewayProviderOpen,
  listGatewayCandidates,
  recordGatewayProviderFailure,
  recordGatewayProviderSuccess,
  resetGatewayBreakers,
} from '../lib/gateway'

afterEach(() => {
  vi.unstubAllEnvs()
  getRedisClientMock.mockReturnValue(null)
  clearFakeRedisStore()
  vi.useRealTimers()
})

describe('listGatewayCandidates', () => {
  it('returns an empty list when no key at all is configured', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(listGatewayCandidates()).toEqual([])
    // A whitespace-only per-user key is ignored too.
    expect(listGatewayCandidates('   ')).toEqual([])
  })

  it('ranks configured server env keys OpenRouter → Gemini → OpenAI', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-a')
    vi.stubEnv('GEMINI_API_KEY', 'AIza-b')
    vi.stubEnv('OPENAI_API_KEY', 'sk-c')
    const candidates = listGatewayCandidates()
    expect(candidates.map((c) => c.provider)).toEqual(['openrouter', 'gemini', 'openai'])
    expect(candidates[0]!.apiKey).toBe('sk-or-v1-a')
    // Each candidate carries its own endpoint (OpenAI-compatible everywhere).
    expect(candidates[0]!.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(candidates[1]!.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    expect(candidates[2]!.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('puts a per-user key first and drops the same-provider env key', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-server')
    vi.stubEnv('GEMINI_API_KEY', 'AIza-gemini')
    const candidates = listGatewayCandidates('sk-or-v1-user')
    expect(candidates.map((c) => c.provider)).toEqual(['openrouter', 'gemini'])
    // The user key replaced the server's OpenRouter key (no duplicate).
    expect(candidates[0]!.apiKey).toBe('sk-or-v1-user')
    expect(candidates[1]!.apiKey).toBe('AIza-gemini')
  })

  it('prepends a user OpenAI-style key ahead of remaining server env keys', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-server')
    vi.stubEnv('GEMINI_API_KEY', 'AIza-g')
    vi.stubEnv('OPENAI_API_KEY', 'sk-server-openai')
    const candidates = listGatewayCandidates('sk-user-openai')
    expect(candidates.map((c) => c.provider)).toEqual(['openai', 'openrouter', 'gemini'])
    expect(candidates[0]!.apiKey).toBe('sk-user-openai')
  })

  it('honors base-url overrides per provider', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-a')
    vi.stubEnv('OPENROUTER_BASE_URL', 'https://router.example.com/v1/')
    vi.stubEnv('OPENAI_API_KEY', 'sk-b')
    vi.stubEnv('OPENAI_BASE_URL', 'https://self-hosted.example.com/v1/')
    const candidates = listGatewayCandidates()
    expect(candidates[0]!.baseUrl).toBe('https://router.example.com/v1')
    expect(candidates[1]!.baseUrl).toBe('https://self-hosted.example.com/v1')
  })
})

describe('circuit breaker (memory fallback)', () => {
  beforeEach(async () => {
    await resetGatewayBreakers()
  })
  afterEach(async () => {
    await resetGatewayBreakers()
  })

  it('stays closed below the failure threshold', async () => {
    for (let i = 0; i < GATEWAY_FAILURE_THRESHOLD - 1; i++) {
      await recordGatewayProviderFailure('openrouter')
    }
    expect(await isGatewayProviderOpen('openrouter')).toBe(false)
  })

  it('opens after GATEWAY_FAILURE_THRESHOLD failures inside the window', async () => {
    for (let i = 0; i < GATEWAY_FAILURE_THRESHOLD; i++) {
      await recordGatewayProviderFailure('openrouter')
    }
    expect(await isGatewayProviderOpen('openrouter')).toBe(true)
  })

  it('isolates breaker state per provider', async () => {
    await recordGatewayProviderFailure('openai')
    await recordGatewayProviderFailure('openai')
    expect(await isGatewayProviderOpen('openai')).toBe(false)
    await recordGatewayProviderFailure('openai')
    expect(await isGatewayProviderOpen('openai')).toBe(true)
    // Unrelated providers are untouched by the open one.
    expect(await isGatewayProviderOpen('openrouter')).toBe(false)
    expect(await isGatewayProviderOpen('gemini')).toBe(false)
  })

  it('slides the failure window so old failures stop counting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    await recordGatewayProviderFailure('gemini')
    await recordGatewayProviderFailure('gemini')
    // Advance past the window — the recorded failures age out.
    vi.setSystemTime(new Date(Date.now() + 61_000))
    await recordGatewayProviderFailure('gemini')
    expect(await isGatewayProviderOpen('gemini')).toBe(false)
    vi.useRealTimers()
  })

  it('reopens on a failed half-open probe and closes on success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    for (let i = 0; i < GATEWAY_FAILURE_THRESHOLD; i++) {
      await recordGatewayProviderFailure('openai')
    }
    expect(await isGatewayProviderOpen('openai')).toBe(true)
    // Cooldown elapses → the breaker is implicitly half-open.
    vi.setSystemTime(new Date(Date.now() + 31_000))
    expect(await isGatewayProviderOpen('openai')).toBe(false)
    // The half-open probe fails → immediate reopen for a full new cooldown.
    await recordGatewayProviderFailure('openai')
    expect(await isGatewayProviderOpen('openai')).toBe(true)
    // A successful probe closes the breaker and clears failures.
    await recordGatewayProviderSuccess('openai')
    expect(await isGatewayProviderOpen('openai')).toBe(false)
    vi.useRealTimers()
  })

  it('ignores failures recorded while already open', async () => {
    for (let i = 0; i < GATEWAY_FAILURE_THRESHOLD; i++) {
      await recordGatewayProviderFailure('openrouter')
    }
    expect(await isGatewayProviderOpen('openrouter')).toBe(true)
    // Further failures while open do not extend the state.
    await recordGatewayProviderFailure('openrouter')
    expect(await isGatewayProviderOpen('openrouter')).toBe(true)
    await recordGatewayProviderSuccess('openrouter')
    expect(await isGatewayProviderOpen('openrouter')).toBe(false)
  })

  it('resetGatewayBreakers clears all per-provider state', async () => {
    for (let i = 0; i < GATEWAY_FAILURE_THRESHOLD; i++) {
      await recordGatewayProviderFailure('openrouter')
    }
    expect(await isGatewayProviderOpen('openrouter')).toBe(true)
    await resetGatewayBreakers()
    expect(await isGatewayProviderOpen('openrouter')).toBe(false)
  })
})

describe('circuit breaker (Redis-backed)', () => {
  beforeEach(() => {
    getRedisClientMock.mockReturnValue(fakeRedis)
  })

  it('shares state through the Redis store and expires stale keys', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    for (let i = 0; i < GATEWAY_FAILURE_THRESHOLD; i++) {
      await recordGatewayProviderFailure('gemini')
    }
    expect(await isGatewayProviderOpen('gemini')).toBe(true)
    // The TTL is window + cooldown — after it elapses the key self-expires.
    vi.setSystemTime(new Date(Date.now() + 90_001))
    expect(await isGatewayProviderOpen('gemini')).toBe(false)
    vi.useRealTimers()
  })

  it('resetGatewayBreakers removes the Redis keys by pattern', async () => {
    for (let i = 0; i < GATEWAY_FAILURE_THRESHOLD; i++) {
      await recordGatewayProviderFailure('openrouter')
      await recordGatewayProviderFailure('openai')
    }
    expect(await isGatewayProviderOpen('openrouter')).toBe(true)
    expect(await isGatewayProviderOpen('openai')).toBe(true)
    await resetGatewayBreakers()
    expect(await isGatewayProviderOpen('openrouter')).toBe(false)
    expect(await isGatewayProviderOpen('openai')).toBe(false)
  })
})
