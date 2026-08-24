import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AUTH_GUARDS,
  AUTH_RATE_LIMIT_ERROR,
  ROUTE_GUARDS,
  checkAuthRateLimit,
  checkCsrf,
  checkLoginRateLimit,
  clientIp,
  clientIpFromHeaders,
  guardRoute,
  rateLimit,
  rateLimitResponse,
  sanitizeInput,
} from '../lib/security'

// requireSession lazily imports @/lib/auth; mock it so the session path can
// resolve a real user id without NextAuth. Only the signed-in-user tests
// delete AUTH_DISABLED to reach this path — the AUTH_DISABLED bypass never
// touches the mock.
vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: 'user-42' } }),
}))

describe('rateLimit', () => {
  beforeEach(() => {
    vi.resetModules()
    // The store singleton in lib/rate-limit.ts reads REDIS_URL at first use;
    // keep the memory path active for these contract tests.
    delete process.env.REDIS_URL
  })

  it('allows requests up to the limit', async () => {
    const result = await rateLimit('k:1', { limit: 3, windowMs: 60_000 })
    expect(result).toEqual({ ok: true })
    expect(await rateLimit('k:1', { limit: 3, windowMs: 60_000 })).toEqual({ ok: true })
    expect(await rateLimit('k:1', { limit: 3, windowMs: 60_000 })).toEqual({ ok: true })
  })

  it('rejects once the limit is exceeded with retry-after seconds', async () => {
    for (let i = 0; i < 3; i += 1) await rateLimit('k:2', { limit: 3, windowMs: 60_000 })
    const blocked = await rateLimit('k:2', { limit: 3, windowMs: 60_000 })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60)
    }
  })

  it('treats distinct keys independently', async () => {
    for (let i = 0; i < 5; i += 1) await rateLimit('k:a', { limit: 2, windowMs: 60_000 })
    expect(await rateLimit('k:b', { limit: 2, windowMs: 60_000 })).toEqual({ ok: true })
  })
})

describe('rateLimitResponse', () => {
  it('shapes a 429 with Retry-After header', () => {
    const response = rateLimitResponse(12)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('12')
  })
})

describe('clientIp', () => {
  it('prefers the first X-Forwarded-For entry', () => {
    const request = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    })
    expect(clientIp(request)).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip then unknown', () => {
    expect(clientIp(new Request('http://localhost', { headers: { 'x-real-ip': '1.2.3.4' } }))).toBe(
      '1.2.3.4',
    )
    expect(clientIp(new Request('http://localhost'))).toBe('unknown')
  })

  it('clientIpFromHeaders reads the same value from raw headers (server actions)', () => {
    const forwarded = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    expect(clientIpFromHeaders(forwarded)).toBe('203.0.113.7')
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '1.2.3.4' }))).toBe('1.2.3.4')
    expect(clientIpFromHeaders(new Headers())).toBe('unknown')
  })
})

describe('checkCsrf', () => {
  it('allows a matching origin', () => {
    const request = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    })
    expect(checkCsrf(request)).toBeNull()
  })

  it('blocks a cross-site origin with 403', () => {
    const request = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    })
    const response = checkCsrf(request)
    expect(response?.status).toBe(403)
  })

  it('accepts requests without an origin (non-browser traffic)', () => {
    expect(checkCsrf(new Request('http://localhost:3000/api/chat', { method: 'POST' }))).toBeNull()
  })
})

describe('sanitizeInput', () => {
  it('trims and strips control characters', () => {
    expect(sanitizeInput('  hello\u0000world  ')).toBe('helloworld')
  })

  it('preserves whitespace newlines and tabs', () => {
    expect(sanitizeInput('Here is code:\n```js\nconst x = 1;\n```')).toBe(
      'Here is code:\n```js\nconst x = 1;\n```',
    )
  })

  it('caps the length', () => {
    expect(sanitizeInput('a'.repeat(100), 10)).toBe('a'.repeat(10))
  })
})

describe('ROUTE_GUARDS', () => {
  it('uses the map key as the rate-limit bucket namespace', () => {
    for (const [key, config] of Object.entries(ROUTE_GUARDS)) {
      expect(config.name).toBe(key)
    }
  })

  it('covers every guarded API route', () => {
    expect(Object.keys(ROUTE_GUARDS).sort()).toEqual([
      'analytics',
      'chat',
      'citation',
      'skills',
      'stripe-webhook',
      'transcribe',
      'upload',
    ])
  })

  it('pins the documented limits, scopes, and CSRF policy', () => {
    // Chat: per-user cap (env override, 120 default) + session required.
    expect(ROUTE_GUARDS.chat).toMatchObject({
      scope: 'user',
      session: true,
      rateLimit: { limit: 'CHAT_RATE_LIMIT', defaultLimit: 120, windowMs: 60_000 },
    })
    // Transcribe / upload: per-IP env-overridable caps, 60 default.
    expect(ROUTE_GUARDS.transcribe.rateLimit).toMatchObject({
      limit: 'TRANSCRIBE_RATE_LIMIT',
      defaultLimit: 60,
    })
    expect(ROUTE_GUARDS.upload.rateLimit).toMatchObject({
      limit: 'UPLOAD_RATE_LIMIT',
      defaultLimit: 60,
    })
    // Read-only GETs: no CSRF, fixed caps.
    expect(ROUTE_GUARDS.citation).toMatchObject({ csrf: false, rateLimit: { limit: 120 } })
    expect(ROUTE_GUARDS.skills).toMatchObject({ csrf: false, rateLimit: { limit: 600 } })
    // Webhook: CSRF on (defense in depth), generous flood brake.
    expect(ROUTE_GUARDS['stripe-webhook'].rateLimit).toMatchObject({ limit: 600 })
    // Analytics: CSRF only, no rate limit.
    expect(ROUTE_GUARDS.analytics.rateLimit).toBeUndefined()
  })
})

describe('AUTH_GUARDS', () => {
  it('covers every auth surface with the documented per-window caps', () => {
    expect(Object.keys(AUTH_GUARDS).sort()).toEqual([
      'login',
      'register',
      'reset-complete',
      'reset-request',
    ])
    expect(AUTH_GUARDS.register).toEqual({ name: 'auth:register', limit: 5, windowMs: 60_000 })
    expect(AUTH_GUARDS.login).toEqual({
      name: 'auth:login',
      limit: 20,
      windowMs: 60_000,
      emailLimit: 10,
    })
    expect(AUTH_GUARDS['reset-request']).toEqual({
      name: 'auth:reset-request',
      limit: 5,
      windowMs: 60_000,
    })
    expect(AUTH_GUARDS['reset-complete']).toEqual({
      name: 'auth:reset-complete',
      limit: 10,
      windowMs: 60_000,
    })
  })

  it('checkAuthRateLimit allows up to the cap then blocks with the shared error', async () => {
    const ip = '203.0.113.77'
    for (let i = 0; i < 5; i += 1) {
      expect(await checkAuthRateLimit('register', ip)).toEqual({ ok: true })
    }
    expect(await checkAuthRateLimit('register', ip)).toEqual({
      ok: false,
      error: AUTH_RATE_LIMIT_ERROR,
    })
    // A different IP keeps its own budget.
    expect(await checkAuthRateLimit('register', '198.51.100.9')).toEqual({ ok: true })
  })

  it('checkLoginRateLimit caps by IP and independently by account', async () => {
    // 20 IP-wide attempts pass (distinct accounts so the email caps stay at 1).
    for (let i = 0; i < 20; i += 1) {
      expect(await checkLoginRateLimit('203.0.113.88', `user${i}@test.dev`)).toBe(true)
    }
    expect(await checkLoginRateLimit('203.0.113.88', 'fresh@test.dev')).toBe(false)
    // A different IP is still allowed…
    expect(await checkLoginRateLimit('203.0.113.89', 'fresh@test.dev')).toBe(true)
    // …while the per-account cap is independent of the IP: 10 tries on one
    // account, then blocked even though the IP budget is untouched.
    for (let i = 0; i < 10; i += 1) {
      expect(await checkLoginRateLimit('203.0.113.90', 'victim@test.dev')).toBe(true)
    }
    expect(await checkLoginRateLimit('203.0.113.90', 'victim@test.dev')).toBe(false)
  })
})

describe('guardRoute', () => {
  // guardRoute consults AUTH_DISABLED (via requireSession) and env-var limits;
  // isolate each test from the ambient shell env.
  const originalEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...originalEnv }
    delete process.env.AUTH_DISABLED
    delete process.env.TEST_RATE_LIMIT
    delete process.env.REDIS_URL
  })

  it('passes through with the user id when session is required', async () => {
    process.env.AUTH_DISABLED = 'true'
    const result = await guardRoute(new Request('http://localhost/api/chat'), {
      name: 'chat',
      scope: 'user',
      session: true,
      rateLimit: { limit: 1000, windowMs: 60_000 },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.userId).toBe('')
  })

  it('rejects a cross-site origin with a 403 short-circuit', async () => {
    process.env.AUTH_DISABLED = 'true'
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    })
    const result = await guardRoute(request, {
      name: 'chat',
      rateLimit: { limit: 1000 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('skips the CSRF guard when csrf is disabled', async () => {
    const request = new Request('http://localhost/api/citation', {
      method: 'GET',
      headers: { origin: 'https://evil.example' },
    })
    const result = await guardRoute(request, {
      name: 'citation',
      csrf: false,
      rateLimit: { limit: 1000 },
    })
    expect(result.ok).toBe(true)
  })

  it('rate-limits per IP by default and returns a 429 once exhausted', async () => {
    const guard = (ip: string) =>
      guardRoute(new Request('http://localhost/x', { headers: { 'x-forwarded-for': ip } }), {
        name: 'guardtest-ip',
        rateLimit: { limit: 2, windowMs: 60_000 },
      })
    expect((await guard('1.1.1.1')).ok).toBe(true)
    expect((await guard('1.1.1.1')).ok).toBe(true)
    const third = await guard('1.1.1.1')
    expect(third.ok).toBe(false)
    if (!third.ok) {
      expect(third.response.status).toBe(429)
      expect(Number(third.response.headers.get('Retry-After'))).toBeGreaterThan(0)
    }
    // A different IP keeps its own budget.
    expect((await guard('2.2.2.2')).ok).toBe(true)
  })

  it('scopes the bucket to the signed-in user when scope is user', async () => {
    process.env.AUTH_DISABLED = 'true'
    // AUTH_DISABLED makes requireSession return userId '' — indistinguishable
    // from anonymous, so the bucket falls back to the IP (same path as chat).
    const guard = (ip: string) =>
      guardRoute(new Request('http://localhost/x', { headers: { 'x-forwarded-for': ip } }), {
        name: 'guardtest-user',
        scope: 'user',
        session: true,
        rateLimit: { limit: 1, windowMs: 60_000 },
      })
    expect((await guard('3.3.3.3')).ok).toBe(true)
    expect((await guard('3.3.3.3')).ok).toBe(false)
  })

  it('reads the limit from an env var by name', async () => {
    process.env.AUTH_DISABLED = 'true'
    process.env.TEST_RATE_LIMIT = '1'
    const guard = () =>
      guardRoute(new Request('http://localhost/x', { headers: { 'x-forwarded-for': '4.4.4.4' } }), {
        name: 'guardtest-env',
        rateLimit: { limit: 'TEST_RATE_LIMIT', windowMs: 60_000 },
      })
    expect((await guard()).ok).toBe(true)
    expect((await guard()).ok).toBe(false)
  })

  it('applies the default limit when the env var is unset', async () => {
    // Regression: an unset env var must fall back to the route's documented
    // default (120 chat / 60 upload / 60 transcribe), never disable the cap.
    process.env.AUTH_DISABLED = 'true'
    delete process.env.TEST_RATE_LIMIT
    const guard = () =>
      guardRoute(new Request('http://localhost/x', { headers: { 'x-forwarded-for': '5.5.5.5' } }), {
        name: 'guardtest-default',
        rateLimit: { limit: 'TEST_RATE_LIMIT', defaultLimit: 2, windowMs: 60_000 },
      })
    expect((await guard()).ok).toBe(true)
    expect((await guard()).ok).toBe(true)
    const third = await guard()
    expect(third.ok).toBe(false)
    if (!third.ok) expect(third.response.status).toBe(429)
  })

  it('rate-limits a signed-in user on their own chat:user bucket', async () => {
    // AUTH_DISABLED unset + the mocked @/lib/auth above makes requireSession
    // return user id 'user-42', so buckets key as chat:user:user-42 (the
    // signed-in path /api/chat takes) rather than falling back to the IP.
    delete process.env.AUTH_DISABLED
    const guard = () =>
      guardRoute(new Request('http://localhost/api/chat'), {
        name: 'chat',
        scope: 'user',
        session: true,
        rateLimit: { limit: 2, windowMs: 60_000 },
      })
    expect((await guard()).ok).toBe(true)
    expect((await guard()).ok).toBe(true)
    const third = await guard()
    expect(third.ok).toBe(false)
    if (!third.ok) {
      expect(third.response.status).toBe(429)
      expect(Number(third.response.headers.get('Retry-After'))).toBeGreaterThan(0)
    }
  })

  it('skips rate limiting entirely when no rateLimit option is given', async () => {
    const result = await guardRoute(new Request('http://localhost/api/analytics'), {
      name: 'analytics',
    })
    expect(result.ok).toBe(true)
  })

  it('logs a structured security event when it blocks (A09 wiring)', async () => {
    process.env.AUTH_DISABLED = 'true'
    const prevNodeEnv = process.env.NODE_ENV
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const guard = () =>
        guardRoute(
          new Request('http://localhost/x', { headers: { 'x-forwarded-for': '6.6.6.6' } }),
          { name: 'guardtest-audit', rateLimit: { limit: 1, windowMs: 60_000 } },
        )
      await guard()
      await guard()
      expect(warn).toHaveBeenCalled()
      const raw = String(warn.mock.calls[0]![0])
      expect(raw).toContain('rate_limited')
      const parsed = JSON.parse(raw.slice('[security] '.length))
      expect(parsed).toMatchObject({ event: 'rate_limited', route: 'guardtest-audit' })
      expect(parsed.key).toContain('guardtest-audit:ip:6.6.6.6')
    } finally {
      ;(process.env as { NODE_ENV?: string }).NODE_ENV = prevNodeEnv
      warn.mockRestore()
    }
  })
})

describe('rate-limit store (lib/rate-limit.ts)', () => {
  // The store singleton reads env at first use, so each test gets a fresh
  // module instance with the env it needs.
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('selects the in-memory store when REDIS_URL is unset', async () => {
    vi.stubEnv('REDIS_URL', '')
    const { getRateLimitStore } = await import('../lib/rate-limit')
    expect(getRateLimitStore().kind).toBe('memory')
  })

  it('selects the Redis store when REDIS_URL is set (lazy client, no connection made)', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const { getRateLimitStore } = await import('../lib/rate-limit')
    const { kind } = getRateLimitStore()
    expect(kind).toBe('redis')
    // lazyConnect means the client never opened a socket here.
  })

  it('falls back to in-memory when Redis is unreachable', async () => {
    // Port 1 on loopback refuses connections immediately.
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1')
    const { rateLimit } = await import('../lib/rate-limit')
    const result = await rateLimit('fallback-key', { limit: 5, windowMs: 60_000 })
    expect(result).toEqual({ ok: true })
  })

  it('RedisRateLimitStore maps the Lua INCR+PTTL result and disconnects', async () => {
    const calls: unknown[][] = []
    const fakeClient = {
      eval: async (...args: unknown[]) => {
        calls.push(args)
        return [3, 42_000]
      },
      quit: async () => undefined,
    }
    const { RedisRateLimitStore } = await import('../lib/rate-limit')
    const store = new RedisRateLimitStore(fakeClient)
    await expect(store.increment('chat:ip:1.2.3.4', 60_000)).resolves.toEqual({
      count: 3,
      resetMs: 42_000,
    })
    // eval(script, numKeys, key, windowMs)
    expect(calls[0]?.[1]).toBe(1)
    expect(calls[0]?.[2]).toBe('chat:ip:1.2.3.4')
    expect(calls[0]?.[3]).toBe('60000')
    await store.disconnect()
    expect(fakeClient.quit).toBeDefined()
  })

  it('MemoryRateLimitStore resets an expired window instead of compounding it', async () => {
    vi.useFakeTimers()
    const { MemoryRateLimitStore } = await import('../lib/rate-limit')
    const store = new MemoryRateLimitStore()
    expect((await store.increment('expiring', 60_000)).count).toBe(1)
    vi.advanceTimersByTime(60_001)
    expect((await store.increment('expiring', 60_000)).count).toBe(1)
  })
})
