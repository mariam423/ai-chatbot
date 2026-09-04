/**
 * Redis-backed tier-aware rate limiter for Stripe subscription enforcement.
 *
 * Provides two layers of rate limiting for the LLM chat endpoint:
 *
 * 1. **Per-minute burst limit** — a sliding-window counter in Redis that
 *    caps the raw request rate per user. Prevents abuse even on Pro plans.
 *    Uses a Redis sorted set (ZSET) for an accurate sliding window rather
 *    than the fixed-window approach in lib/rate-limit.ts.
 *
 * 2. **Per-day plan cap** — the existing `checkAndRecordUsage` in
 *    lib/billing/usage.ts already enforces daily limits via the DB. This
 *    module wraps it with a Redis-cached fast path so the DB is only hit
 *    once per minute per user for the daily counter.
 *
 * When Redis is unavailable, both layers fall through to the in-memory
 * fallback (per-process counters) so the app never 500s due to infra.
 *
 * Key prefix: `pulse:ratelimit:` (distinct from `pulse:cache:` and
 * BullMQ's `bull:` namespace).
 */

import { getRedisClient } from '@/lib/redis'

const PREFIX = 'pulse:ratelimit:'

/* ------------------------------------------------------------------ */
/* Tier definitions                                                    */
/* ------------------------------------------------------------------ */

export interface TierConfig {
  /** Maximum requests per minute (burst cap). */
  requestsPerMinute: number
  /** Maximum requests per day. `null` = unlimited. */
  requestsPerDay: number | null
  /** Maximum tokens per day (estimated). `null` = unlimited. */
  tokensPerDay: number | null
}

export const TIER_CONFIGS: Record<string, TierConfig> = {
  free: {
    // Env-tunable, mirroring FREE_PLAN_DAILY_LIMIT below (default 20/min).
    requestsPerMinute: Number(process.env.FREE_PLAN_BURST_PER_MINUTE) || 20,
    requestsPerDay: Number(process.env.FREE_PLAN_DAILY_LIMIT) || 20,
    tokensPerDay: null,
  },
  pro: {
    requestsPerMinute: 120,
    requestsPerDay: null,
    tokensPerDay: null,
  },
}

function getTierConfig(plan: string): TierConfig {
  return TIER_CONFIGS[plan] ?? TIER_CONFIGS.free!
}

/* ------------------------------------------------------------------ */
/* Sliding window (Redis sorted set)                                   */
/* ------------------------------------------------------------------ */

/**
 * Sliding-window rate limiter using Redis sorted sets.
 *
 * Each request is scored by its timestamp. Expired entries are pruned
 * on every check, and the remaining count determines whether the
 * request is allowed. This avoids the fixed-window boundary problem
 * where a burst at the end of one window + the start of the next
 * doubles the effective rate.
 *
 * Falls back to an in-memory Map when Redis is unavailable.
 */
const inMemoryWindows = new Map<string, number[]>()

export async function checkTierBurstLimit(
  userId: string,
  plan: string,
): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number; limit: number }> {
  const config = getTierConfig(plan)
  const windowMs = 60_000 // 1 minute sliding window
  const key = `${PREFIX}burst:${userId}`
  const now = Date.now()
  const windowStart = now - windowMs

  const redis = getRedisClient()
  if (!redis) {
    // In-memory fallback (per-process).
    return checkInMemoryWindow(key, config.requestsPerMinute, windowMs, now)
  }

  try {
    // Atomic sliding window: remove expired entries, count remaining, add new entry.
    const result = (await redis.eval(
      `
      local key = KEYS[1]
      local window_start = tonumber(ARGV[1])
      local now = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local window_ms = tonumber(ARGV[4])

      -- Remove entries outside the window
      redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

      -- Count current entries
      local count = redis.call('ZCARD', key)

      if count < limit then
        -- Allow: add this request
        redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
        redis.call('PEXPIRE', key, window_ms)
        return {1, count + 1, 0}
      else
        -- Deny: find the oldest entry to calculate retry-after
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local retry_ms = 0
        if #oldest >= 2 then
          retry_ms = tonumber(oldest[2]) + window_ms - now
        end
        return {0, count, retry_ms}
      end
      `,
      1,
      key,
      String(windowStart),
      String(now),
      String(config.requestsPerMinute),
      String(windowMs),
    )) as [number, number, number]

    const allowed = result[0] === 1
    if (allowed) {
      return { allowed: true }
    }
    return {
      allowed: false,
      retryAfterMs: Math.max(1, result[2]),
      limit: config.requestsPerMinute,
    }
  } catch (error) {
    // Redis unavailable — degrade to in-memory.
    console.warn('[tier-rate-limit] Redis unavailable, falling back to memory:', error)
    return checkInMemoryWindow(key, config.requestsPerMinute, windowMs, now)
  }
}

function checkInMemoryWindow(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): { allowed: true } | { allowed: false; retryAfterMs: number; limit: number } {
  const entries = inMemoryWindows.get(key) ?? []
  const windowStart = now - windowMs

  // Prune expired entries.
  const active = entries.filter((ts) => ts > windowStart)

  if (active.length < limit) {
    active.push(now)
    inMemoryWindows.set(key, active)
    return { allowed: true }
  }

  const oldest = active[0]!
  const retryAfterMs = oldest + windowMs - now
  return {
    allowed: false,
    retryAfterMs: Math.max(1, retryAfterMs),
    limit,
  }
}

/* ------------------------------------------------------------------ */
/* Daily usage cache (fast path over DB)                               */
/* ------------------------------------------------------------------ */

/**
 * Cached daily usage counter. The DB (users.usageCount / users.usageDate)
 * remains the source of truth, but we cache the current day's count in
 * Redis so the chat hot path avoids a DB read on every request.
 *
 * The cache is invalidated by `recordUsage` and on plan changes via the
 * Stripe webhook.
 */

export interface CachedDailyUsage {
  count: number
  date: string // YYYY-MM-DD
}

const DAILY_USAGE_TTL = 120 // 2 minutes

export async function getCachedDailyUsage(userId: string): Promise<CachedDailyUsage | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const raw = await redis.get(`${PREFIX}daily:${userId}`)
    if (!raw) return null
    return JSON.parse(raw) as CachedDailyUsage
  } catch {
    return null
  }
}

export async function setCachedDailyUsage(userId: string, usage: CachedDailyUsage): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    await redis.set(`${PREFIX}daily:${userId}`, JSON.stringify(usage), 'EX', DAILY_USAGE_TTL)
  } catch {
    // Best-effort.
  }
}

export async function invalidateCachedDailyUsage(userId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    await redis.del(`${PREFIX}daily:${userId}`)
  } catch {
    // Best-effort.
  }
}

/* ------------------------------------------------------------------ */
/* Composite tier guard (burst + daily)                                */
/* ------------------------------------------------------------------ */

export type TierCheckResult =
  | { allowed: true }
  | { allowed: false; reason: 'burst' | 'daily'; retryAfterMs?: number; error: string }

/**
 * Check both the per-minute burst limit and the per-day plan cap.
 * Returns `{ allowed: true }` when both pass, or a structured denial.
 *
 * Call this BEFORE the existing `checkAndRecordUsage` — it's a fast
 * pre-check that avoids DB work when the user is clearly over limit.
 */
export async function checkTierLimits(
  userId: string,
  plan: string,
  todayCount: number,
): Promise<TierCheckResult> {
  // 1. Per-minute burst limit (Redis sliding window).
  const burst = await checkTierBurstLimit(userId, plan)
  if (!burst.allowed) {
    return {
      allowed: false,
      reason: 'burst',
      retryAfterMs: burst.retryAfterMs,
      error: `Rate limit exceeded. You can make ${burst.limit} requests per minute. Please wait ${Math.ceil((burst.retryAfterMs ?? 1000) / 1000)}s.`,
    }
  }

  // 2. Per-day plan cap (in-memory check against cached or passed count).
  const config = getTierConfig(plan)
  if (config.requestsPerDay !== null && todayCount >= config.requestsPerDay) {
    return {
      allowed: false,
      reason: 'daily',
      error:
        plan === 'free'
          ? `You've reached the Free plan's daily limit of ${config.requestsPerDay} requests. Upgrade to Pro for unlimited.`
          : `Daily limit of ${config.requestsPerDay} requests reached.`,
    }
  }

  return { allowed: true }
}
