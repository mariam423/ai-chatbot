/**
 * Shared rate-limit store used by the API route guardrails.
 *
 * The limiter is a fixed window that slides forward on expiry — identical
 * semantics whether the counter lives in memory or in Redis. When
 * `REDIS_URL` is configured the buckets are shared across processes and
 * survive restarts (multi-instance deploys); when it is unset the store
 * degrades to an in-memory Map so local dev and tests need no Redis.
 *
 * The Redis path uses a single atomic Lua script (INCR + PEXPIRE) so the
 * count, window, and reset-time reads are race-free — exactly what two
 * instances racing on the same bucket would otherwise get wrong.
 */

import Redis from 'ioredis'
import { NextResponse } from 'next/server'

export interface RateWindow {
  count: number
  resetAt: number
}

/** The counter backend. Kept narrow so tests can inject a fake. */
export interface RateLimitStore {
  /**
   * Increment the counter for `key` within a `windowMs` window and return the
   * new count plus the milliseconds until the window resets.
   */
  increment(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>
  /** Release any resources (e.g. the Redis connection). No-op for memory. */
  disconnect(): Promise<void>
}

/* ------------------------------------------------------------------ */
/* Memory store (default; used when REDIS_URL is unset)                */
/* ------------------------------------------------------------------ */

/**
 * The original per-process limiter. `rateLimit` semantics are preserved
 * exactly (fixed window, opportunistic sweep) so behavior is identical in
 * local dev / tests and in Redis-backed deploys.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, RateWindow>()
  private lastSweep = 0

  async increment(key: string, windowMs: number): Promise<{ count: number; resetMs: number }> {
    const now = Date.now()

    // Opportunistic cleanup so long-running processes don't leak memory.
    if (now - this.lastSweep > 60_000) {
      this.lastSweep = now
      for (const [bucketKey, window] of this.buckets) {
        if (window.resetAt <= now) this.buckets.delete(bucketKey)
      }
    }

    const existing = this.buckets.get(key)
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs })
      return { count: 1, resetMs: windowMs }
    }
    existing.count += 1
    return { count: existing.count, resetMs: existing.resetAt - now }
  }

  async disconnect(): Promise<void> {
    // Nothing to release.
  }
}

/* ------------------------------------------------------------------ */
/* Redis store (shared across processes / instances)                   */
/* ------------------------------------------------------------------ */

/**
 * Atomic fixed-window counter. INCR creates the key at 1; the first
 * increment arms the TTL so expired windows start fresh (matching the
 * memory store's "slides forward on expiry"). PTTL doubles as the
 * reset-time read for the Retry-After header.
 */
const REDIS_INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('PTTL', KEYS[1]) }
`

/** Narrow surface ioredis exposes that the store needs — easy to fake in tests. */
export interface RedisLikeClient {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>
  quit?(): Promise<unknown>
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RedisLikeClient) {}

  async increment(key: string, windowMs: number): Promise<{ count: number; resetMs: number }> {
    const result = (await this.client.eval(REDIS_INCREMENT_SCRIPT, 1, key, String(windowMs))) as [
      number,
      number,
    ]
    return { count: Number(result[0]), resetMs: Number(result[1]) }
  }

  async disconnect(): Promise<void> {
    await this.client.quit?.()
  }
}

/**
 * Build the Redis client from `REDIS_URL` (ioredis accepts `redis://`,
 * `rediss://` TLS, and Unix-socket forms). The options are tuned to fail
 * fast instead of queueing forever: `lazyConnect` avoids touching the
 * network until the first bucket check, and no reconnect strategy + a small
 * per-command retry budget means an outage surfaces immediately so
 * `rateLimit` can degrade to the in-memory store.
 */
export function createRateLimitClient(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 5_000,
    retryStrategy: () => null,
  })
  // ioredis emits `error` for connection failures; without a listener they
  // become unhandled events. Failures here are expected (rateLimit degrades
  // to memory), so log and move on.
  client.on('error', (error) => {
    console.warn('[rate-limit] Redis connection error:', error.message)
  })
  return client
}

/* ------------------------------------------------------------------ */
/* Store selection (env-gated singleton)                               */
/* ------------------------------------------------------------------ */

let store: RateLimitStore | null = null
let storeKind: 'memory' | 'redis' = 'memory'

/**
 * Resolve the shared store once per process: Redis when `REDIS_URL` is set,
 * otherwise the in-memory fallback. A failed client (bad URL) also falls
 * back to memory so a misconfigured deploy keeps working — the rate limiter
 * degrades instead of 500ing.
 */
export function getRateLimitStore(): { store: RateLimitStore; kind: 'memory' | 'redis' } {
  if (store) return { store, kind: storeKind }

  const url = process.env.REDIS_URL
  if (url) {
    try {
      store = new RedisRateLimitStore(createRateLimitClient(url))
      storeKind = 'redis'
    } catch (error) {
      console.warn('[rate-limit] Redis client failed to start, using in-memory store:', error)
      store = new MemoryRateLimitStore()
      storeKind = 'memory'
    }
  } else {
    store = new MemoryRateLimitStore()
  }
  return { store, kind: storeKind }
}

/* ------------------------------------------------------------------ */
/* Public API (same contract as the original limiter, now async)       */
/* ------------------------------------------------------------------ */

/** Shared fallback bucket used while Redis is unavailable (kept warm so
 * counts still accumulate during an outage). */
let fallbackStore: MemoryRateLimitStore | null = null

/**
 * Check a rate-limit bucket for `key`. On success increments the count and
 * returns `{ ok: true }`; on failure returns the seconds until reset so the
 * caller can set a Retry-After header. Fixed window, shared across instances
 * when Redis is configured.
 */
export async function rateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const { store: activeStore } = getRateLimitStore()
  let count: number
  let resetMs: number
  try {
    ;({ count, resetMs } = await activeStore.increment(key, options.windowMs))
  } catch (error) {
    // Redis unavailable (connection refused, timeout, …): degrade to the
    // per-process counter rather than failing the request. The request is
    // never blocked by infrastructure the limiter depends on.
    console.warn('[rate-limit] store unavailable, falling back to in-memory:', error)
    fallbackStore ??= new MemoryRateLimitStore()
    ;({ count, resetMs } = await fallbackStore.increment(key, options.windowMs))
  }

  if (count > options.limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)) }
  }
  return { ok: true }
}

/** Convenience: a `{ ok: false }` result already shaped as a 429 response. */
export function rateLimitResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please slow down and try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  )
}
