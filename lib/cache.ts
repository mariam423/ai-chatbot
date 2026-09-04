/**
 * Distributed caching layer backed by Redis.
 *
 * Caches frequently accessed, semi-volatile data (user session metadata,
 * plan tier, billing state, transient feature flags) to reduce direct hits
 * on Neon PostgreSQL. Every public function degrades silently to a no-op
 * when Redis is unavailable — the app stays correct, just slower.
 *
 * Key design choices:
 *  - All keys are prefixed with `pulse:cache:` to avoid collisions with
 *    BullMQ, rate-limit counters, and other Redis consumers.
 *  - TTLs are short (30–300 s) because the cached data is derived from
 *    the DB and can drift. The cache is a hot-path optimiser, not a
 *    source of truth.
 *  - Stale data is always safer than a 500 — on cache miss or Redis
 *    failure, callers fall through to the DB.
 */

import { getRedisClient } from './redis'

const PREFIX = 'pulse:cache:'

/* ------------------------------------------------------------------ */
/* Low-level helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Read a cached value by key. Returns `null` on miss, Redis failure,
 * or JSON parse error — callers should always have a DB fallback.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const raw = await redis.get(`${PREFIX}${key}`)
    if (raw === null) return null
    return JSON.parse(raw) as T
  } catch {
    // Redis down or corrupted value — treat as miss.
    return null
  }
}

/**
 * Write a value to the cache with a TTL in seconds.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    await redis.set(`${PREFIX}${key}`, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // Non-fatal — the DB remains the source of truth.
  }
}

/**
 * Delete a cached key (or pattern via pipeline).
 */
export async function cacheDel(key: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    await redis.del(`${PREFIX}${key}`)
  } catch {
    // Best-effort.
  }
}

/**
 * Delete all keys matching a prefix (for cache invalidation on writes).
 * Uses SCAN to avoid blocking Redis on large key sets.
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    let cursor = '0'
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${PREFIX}${pattern}`,
        'COUNT',
        100,
      )
      cursor = nextCursor
      if (keys.length > 0) {
        const pipeline = redis.pipeline()
        for (const key of keys) pipeline.del(key)
        await pipeline.exec()
      }
    } while (cursor !== '0')
  } catch {
    // Best-effort.
  }
}

/* ------------------------------------------------------------------ */
/* Domain-specific cache accessors                                     */
/* ------------------------------------------------------------------ */

/** Cached user metadata shape — the subset of User we cache. */
export interface CachedUserMeta {
  id: string
  plan: string
  role: string
  usageCount: number
  usageTokens: number
  usageDate: string
}

const USER_META_TTL = 60 // 1 minute — hot path, but fresh enough for plan changes

/**
 * Get cached user metadata, or `null` on miss.
 */
export async function getCachedUserMeta(userId: string): Promise<CachedUserMeta | null> {
  return cacheGet<CachedUserMeta>(`user:meta:${userId}`)
}

/**
 * Write user metadata to the cache.
 */
export async function setCachedUserMeta(userId: string, meta: CachedUserMeta): Promise<void> {
  await cacheSet(`user:meta:${userId}`, meta, USER_META_TTL)
}

/**
 * Invalidate cached user metadata (called on plan changes, profile updates).
 */
export async function invalidateCachedUserMeta(userId: string): Promise<void> {
  await cacheDel(`user:meta:${userId}`)
}

/** Cached billing status shape. */
export interface CachedBillingStatus {
  plan: string
  planLabel: string
  dailyLimit: number | null
  usedToday: number
  estimatedTokensToday: number
  overLimit: boolean
  stripeConfigured: boolean
}

const BILLING_TTL = 30 // 30 seconds — billing state changes on webhook

export async function getCachedBillingStatus(userId: string): Promise<CachedBillingStatus | null> {
  return cacheGet<CachedBillingStatus>(`billing:${userId}`)
}

export async function setCachedBillingStatus(
  userId: string,
  status: CachedBillingStatus,
): Promise<void> {
  await cacheSet(`billing:${userId}`, status, BILLING_TTL)
}

export async function invalidateCachedBillingStatus(userId: string): Promise<void> {
  await cacheDel(`billing:${userId}`)
}

/** Cached session metadata (title, message count, last model). */
export interface CachedSessionMeta {
  id: string
  title: string | null
  messageCount: number
  lastModel: string | null
}

const SESSION_META_TTL = 120 // 2 minutes — sessions change less frequently

export async function getCachedSessionMeta(sessionId: string): Promise<CachedSessionMeta | null> {
  return cacheGet<CachedSessionMeta>(`session:meta:${sessionId}`)
}

export async function setCachedSessionMeta(
  sessionId: string,
  meta: CachedSessionMeta,
): Promise<void> {
  await cacheSet(`session:meta:${sessionId}`, meta, SESSION_META_TTL)
}

export async function invalidateCachedSessionMeta(sessionId: string): Promise<void> {
  await cacheDel(`session:meta:${sessionId}`)
}

/* ------------------------------------------------------------------ */
/* Sidebar session-list pages                                          */
/* ------------------------------------------------------------------ */

/**
 * Cached sidebar list page — the search-less `listChatSessions` result for
 * one user/pagination slice. Pages are cached per user (not per session)
 * because the sidebar lists many sessions and the expensive part is the
 * per-session aggregate query over `chat_messages`; per-session keys could
 * not serve a paged, multi-row list anyway.
 *
 * Only the default (non-search) list is cached — search results are
 * ephemeral per keystroke and would explode the key space.
 */
export interface CachedSessionListItem {
  id: string
  title: string
  updatedAt: string
  messageCount: number
  pinned: boolean
  archived: boolean
  lastModel: string | null
}

export interface CachedSessionListPage {
  sessions: CachedSessionListItem[]
  hasMore: boolean
}

const SESSION_LIST_TTL = 30 // 30 seconds — every save reorders/updates the sidebar

function sessionListCacheKey(
  userId: string,
  opts: { archived: boolean; skip: number; take: number },
): string {
  return `sessions:list:${userId}:${opts.archived ? '1' : '0'}:${opts.skip}:${opts.take}`
}

/**
 * Read a cached sidebar page, or `null` on miss / Redis failure. The caller
 * falls through to the DB and repopulates.
 */
export async function getCachedSessionList(
  userId: string,
  opts: { archived: boolean; skip: number; take: number },
): Promise<CachedSessionListPage | null> {
  return cacheGet<CachedSessionListPage>(sessionListCacheKey(userId, opts))
}

/** Write a sidebar page to the cache (best-effort). */
export async function setCachedSessionList(
  userId: string,
  opts: { archived: boolean; skip: number; take: number },
  page: CachedSessionListPage,
): Promise<void> {
  await cacheSet(sessionListCacheKey(userId, opts), page, SESSION_LIST_TTL)
}

/**
 * Drop every cached sidebar page for a user (any archived flag / pagination
 * slice). Called after any session mutation that could reorder or change the
 * sidebar list: save, rename, delete, pin, archive, skill/branch updates.
 */
export async function invalidateCachedSessionList(userId: string): Promise<void> {
  await cacheDelPattern(`sessions:list:${userId}:*`)
}

/**
 * Invalidate all cached data for a user (on logout, account deletion, etc.).
 */
export async function invalidateAllUserCache(userId: string): Promise<void> {
  await Promise.all([
    invalidateCachedUserMeta(userId),
    invalidateCachedBillingStatus(userId),
    invalidateCachedSessionList(userId),
  ])
}
