import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

describe('lib/redis.ts', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.REDIS_URL
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns null when REDIS_URL is not set', async () => {
    delete process.env.REDIS_URL
    const { getRedisClient } = await import('../lib/redis')
    expect(getRedisClient()).toBeNull()
  })

  it('returns a Redis client when REDIS_URL is set', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const { getRedisClient } = await import('../lib/redis')
    const client = getRedisClient()
    expect(client).not.toBeNull()
    expect(['wait', 'connecting', 'reconnecting']).toContain(client!.status)
  })

  it('returns the same client instance on repeated calls (singleton)', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const { getRedisClient } = await import('../lib/redis')
    const first = getRedisClient()
    const second = getRedisClient()
    expect(first).toBe(second)
  })

  it('requireRedis throws when REDIS_URL is not set', async () => {
    delete process.env.REDIS_URL
    const { requireRedis } = await import('../lib/redis')
    expect(() => requireRedis()).toThrow(/REDIS_URL/)
  })

  it('requireRedis error message includes helpful guidance', async () => {
    delete process.env.REDIS_URL
    const { requireRedis } = await import('../lib/redis')
    expect(() => requireRedis()).toThrow(/task queue and distributed cache/)
  })

  it('requireRedis returns a client when REDIS_URL is set', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const { requireRedis } = await import('../lib/redis')
    const client = requireRedis()
    expect(client).not.toBeNull()
  })

  it('disconnectRedis cleans up the singleton', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const { getRedisClient, disconnectRedis } = await import('../lib/redis')
    const client = getRedisClient()
    expect(client).not.toBeNull()
    await disconnectRedis()
    const fresh = getRedisClient()
    expect(fresh).not.toBe(client)
  })

  it('disconnectRedis is a no-op when no client was created', async () => {
    delete process.env.REDIS_URL
    const { disconnectRedis } = await import('../lib/redis')
    // Should not throw.
    await disconnectRedis()
  })

  it('logs a warning on connection error', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getRedisClient } = await import('../lib/redis')
    const client = getRedisClient()
    expect(client).not.toBeNull()
    client!.emit('error', new Error('connection refused'))
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[redis] connection error:'),
      expect.stringContaining('connection refused'),
    )
    warn.mockRestore()
  })

  it('logs a warning when initial connection fails', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getRedisClient } = await import('../lib/redis')
    const client = getRedisClient()
    expect(client).not.toBeNull()
    // Simulate the connect promise rejecting.
    client!.emit('error', new Error('ECONNREFUSED'))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not create a second client when connecting', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const { getRedisClient } = await import('../lib/redis')
    const first = getRedisClient()
    // Second call while still connecting returns the same instance.
    const second = getRedisClient()
    expect(first).toBe(second)
  })
})
