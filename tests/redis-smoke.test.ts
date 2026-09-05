import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { checkTierBurstLimit, TIER_CONFIGS } from '../lib/billing/tier-rate-limit'
import { POST as chatPost } from '../app/api/chat/route'

// Redis load smoke (Phase 6, optional): verifies the tier burst window and
// the /api/chat hot path hold their caps under concurrency against a REAL
// Redis (not the in-memory fallback). Gated like tests/live-providers.test.ts:
//
//   RUN_REDIS_SMOKE=true REDIS_URL=redis://127.0.0.1:6379 npm test
//
// Without the env it runs as skips so CI stays green. When the env IS set the
// suite fails loudly if Redis is unreachable — a smoke that silently degraded
// to the per-process memory limiter would prove nothing.
//
// Only the route's non-Redis dependencies are mocked (auth session + prisma +
// the LLM upstream fetch). The tier limiter, usage cache, and the guard's
// rate-limit store all hit the real Redis, which is what the smoke asserts.

const smokeEnabled = process.env.RUN_REDIS_SMOKE === 'true' && Boolean(process.env.REDIS_URL)

// --- Route-level mocks (kept narrow so the Redis-backed paths stay real) ---
const { authMock, getCurrentUserId } = vi.hoisted(() => ({
  authMock: vi.fn(async (..._args: unknown[]) => ({ user: { id: 'smoke-route-user' } })),
  getCurrentUserId: vi.fn(async (..._args: unknown[]) => 'smoke-route-user'),
}))
vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/auth-context', () => ({ getCurrentUserId }))

const userFindUnique = vi.fn(async (..._args: unknown[]) => null as unknown)
const userUpdate = vi.fn(async (..._args: unknown[]) => null as unknown)
const prefFindFirst = vi.fn(async (..._args: unknown[]) => null as unknown)
const prefFindUnique = vi.fn(async (..._args: unknown[]) => null as unknown)
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
    userPreference: {
      findFirst: (...args: unknown[]) => prefFindFirst(...args),
      findUnique: (...args: unknown[]) => prefFindUnique(...args),
    },
  },
}))

function sseResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    }),
    { status: 200 },
  )
}

function chatRequest(messages: Array<{ role: string; content: string }>): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
}

describe('Redis load smoke (RUN_REDIS_SMOKE=true)', () => {
  it.skipIf(!smokeEnabled)('__probe__ auth mock + concurrent POST stacks', async () => {
    const m = await import('../lib/auth')
    const authIsMocked = (m as { auth?: unknown }).auth === authMock
    const userId = 'smoke-probe'
    authMock.mockResolvedValue({ user: { id: userId } })
    getCurrentUserId.mockResolvedValue(userId)
    userFindUnique.mockResolvedValue({
      plan: 'free',
      usageCount: 0,
      usageDate: new Date().toISOString().slice(0, 10),
      usageTokens: 0,
    })
    userUpdate.mockResolvedValue({ id: userId })
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-probe')
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubGlobal('fetch', async () => sseResponse())
    try {
      // Warm every lazy dynamic import with one sequential request first.
      const warm = await chatPost(chatRequest([{ role: 'user', content: 'hi' }]))
      console.error('PROBE warm status:', warm.status)
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => chatPost(chatRequest([{ role: 'user', content: 'hi' }]))),
      )
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('PROBE rejection stack:\n', (r.reason as Error).stack)
        } else {
          console.error('PROBE status:', r.value.status)
        }
      }
      console.error('PROBE authMocked:', authIsMocked)
      console.error('PROBE authMock call count:', authMock.mock.calls.length)
    } catch (error) {
      console.error('PROBE full stack:\n', (error as Error).stack)
      throw error
    }
    vi.unstubAllGlobals()
  })

  beforeAll(async () => {
    if (!smokeEnabled) return
    const { getRedisClient } = await import('../lib/redis')
    const client = getRedisClient()
    if (!client) throw new Error('REDIS_URL is set but getRedisClient() returned null')
    // The shared client is lazyConnect with offline queue disabled, so
    // commands issued before the connect handshake resolves would throw
    // instead of queueing. Await the ready state, then ping.
    if (client.status !== 'ready') {
      await new Promise<void>((resolve, reject) => {
        const onReady = () => {
          client.removeListener('error', onError)
          resolve()
        }
        const onError = (error: Error) => {
          client.removeListener('ready', onReady)
          reject(error)
        }
        client.once('ready', onReady)
        client.once('error', onError)
        if (client.status === 'ready') onReady()
      })
    }
    // Fail loudly when Redis is unreachable — never silently test the memory
    // fallback that the catch blocks in the limiter would otherwise use.
    await client.ping()
  })

  afterAll(async () => {
    if (!smokeEnabled) return
    const { getRedisClient, disconnectRedis } = await import('../lib/redis')
    const client = getRedisClient()
    if (client) {
      // This suite owns its Redis (or is pointed at a disposable instance);
      // drop every key the smoke wrote so reruns start clean.
      await client.flushdb().catch(() => {})
    }
    await disconnectRedis()
  })

  it.skipIf(!smokeEnabled)(
    'caps the free-tier burst window at exactly the limit under 3x concurrency',
    async () => {
      const limit = TIER_CONFIGS.free!.requestsPerMinute
      const userId = `smoke-burst-${Date.now()}`
      const wave = async (n: number) =>
        Promise.all(Array.from({ length: n }, () => checkTierBurstLimit(userId, 'free')))

      const first = await wave(limit * 3)
      const allowed1 = first.filter((r) => r.allowed).length
      expect(allowed1, 'allowed in first concurrent wave').toBe(limit)
      for (const denial of first.filter(
        (r): r is Extract<typeof r, { allowed: false }> => !r.allowed,
      )) {
        expect(denial.limit).toBe(limit)
        expect(denial.retryAfterMs).toBeGreaterThan(0)
      }

      // A second wave while the window is still full must not overshoot: the
      // total allowed stays pinned at the cap (the sliding window is atomic).
      const second = await wave(limit * 2)
      const allowed2 =
        first.filter((r) => r.allowed).length + second.filter((r) => r.allowed).length
      expect(allowed2, 'allowed across two concurrent waves').toBe(limit)

      // A fresh user gets a fresh bucket — the cap is per user, not global.
      const other = await wave(1)
      expect(other[0]!.allowed).toBe(true)
    },
  )

  it.skipIf(!smokeEnabled)(
    'holds the free burst cap through the real /api/chat hot path under concurrency',
    async () => {
      const limit = TIER_CONFIGS.free!.requestsPerMinute
      const userId = `smoke-route-${Date.now()}`
      const today = new Date().toISOString().slice(0, 10)
      authMock.mockResolvedValue({ user: { id: userId } })
      getCurrentUserId.mockResolvedValue(userId)
      userFindUnique.mockResolvedValue({
        plan: 'free',
        usageCount: 0,
        usageDate: today,
        usageTokens: 0,
      })
      userUpdate.mockResolvedValue({ id: userId })
      const fetchMock = vi.fn(async () => sseResponse())
      vi.stubGlobal('fetch', fetchMock)

      const total = limit * 4 // e.g. 80 requests against a 20/min burst cap
      const responses = await Promise.all(
        Array.from({ length: total }, () =>
          chatPost(chatRequest([{ role: 'user', content: 'hi' }])),
        ),
      )
      const statusCounts = responses.reduce<Record<number, number>>((acc, res) => {
        acc[res.status] = (acc[res.status] ?? 0) + 1
        return acc
      }, {})
      // Exactly `limit` requests pass the burst pre-check and stream; the rest
      // get the guard-shaped 429 before any LLM call.
      expect(statusCounts[200], `200s out of ${total}`).toBe(limit)
      expect(statusCounts[429]).toBe(total - limit)
      expect(fetchMock).toHaveBeenCalledTimes(limit)
      vi.unstubAllGlobals()
    },
  )
})
