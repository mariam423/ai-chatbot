/**
 * Shared Redis connection singleton.
 *
 * Provides a single ioredis client reused across caching, rate limiting, and
 * the BullMQ task queue. The client connects lazily (only on first use) and
 * fails fast so downstream modules degrade gracefully instead of queuing
 * forever when Redis is unavailable.
 *
 * When `REDIS_URL` is unset the module exports `null` — every consumer
 * must handle this (memory fallback, no-op cache, etc.).
 */

import Redis from 'ioredis'

/** ioredis options tuned for serverless / Vercel-like environments:
 *  - lazyConnect: don't touch the network until the first command
 *  - no reconnect: outages surface immediately so callers degrade
 *  - small retry budget: bounded queuing per command
 *  - connectTimeout: fail fast on cold starts where Redis is unreachable */
const REDIS_OPTIONS = {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
  retryStrategy(times: number) {
    // No reconnect — degrade to memory / no-cache immediately.
    if (times > 1) return null
    return 200
  },
  // Keep the connection alive for warm invocations but drop idle connections
  // after 30 s so serverless functions don't hold idle sockets.
  keepAlive: 30_000,
}

let client: Redis | null = null
let connecting = false

/**
 * Return the shared Redis client, or `null` when `REDIS_URL` is not set.
 * The client is lazily connected on first use — import cost is zero.
 */
export function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL
  if (!url) return null

  if (client) return client

  if (!connecting) {
    connecting = true
    client = new Redis(url, REDIS_OPTIONS)

    client.on('error', (error) => {
      console.warn('[redis] connection error:', error.message)
    })

    client.connect().catch((error) => {
      console.warn('[redis] initial connection failed:', error.message)
      // The client is still usable — ioredis will retry per-command
      // up to maxRetriesPerRequest, then fail. Callers handle this.
    })
  }

  return client
}

/**
 * Convenience: get a client or throw with a clear message when Redis is
 * required (e.g. BullMQ mandates it).
 */
export function requireRedis(): Redis {
  const client = getRedisClient()
  if (!client) {
    throw new Error(
      'REDIS_URL is not set. The task queue and distributed cache require Redis. ' +
        'Set REDIS_URL in .env.local or your hosting provider environment.',
    )
  }
  return client
}

/**
 * Graceful shutdown — call on SIGTERM / process exit to drain connections.
 */
export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {})
    client = null
    connecting = false
  }
}
