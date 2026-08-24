import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { headers } from 'next/headers'
import bcrypt from 'bcryptjs'

// next/headers can't run outside a request scope — mock it so the auth server
// actions can derive the client IP for their rate-limit buckets, and the test
// can swap IPs to prove the buckets are per-IP.
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

// lib/db.ts reads DATABASE_URL at import time, so the temp DB must exist and
// the env var be set BEFORE the actions module is (dynamically) imported.
const dir = mkdtempSync(join(tmpdir(), 'chat-auth-'))
const dbPath = join(dir, 'test.db')

let auth: typeof import('../app/actions/auth')
const headersMock = vi.mocked(headers)

beforeAll(() => {
  process.env.DATABASE_URL = `file:${dbPath}`
  execSync('npx prisma db push --accept-data-loss', {
    stdio: 'pipe',
    env: process.env,
  })
})

beforeEach(async () => {
  auth = await import('../app/actions/auth')
  headersMock.mockReset()
  headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.55' }))
})

afterAll(() => {
  delete process.env.DATABASE_URL
  rmSync(dir, { recursive: true, force: true })
})

describe('auth server-action rate limits (per-IP)', () => {
  it('registerUser allows 5 per IP then returns the throttle error before bcrypt', async () => {
    // bcrypt cost-12 hashing is the expensive step — spy so the test is fast,
    // then assert the throttle fires BEFORE any hashing happens.
    const hashSpy = vi.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never)
    try {
      for (let i = 0; i < 5; i += 1) {
        const result = await auth.registerUser({
          name: `User ${i}`,
          email: `reg-${i}@test.dev`,
          password: 'password-123',
        })
        expect(result).toEqual({ ok: true })
      }
      expect(hashSpy).toHaveBeenCalledTimes(5)

      const blocked = await auth.registerUser({
        name: 'Blocked',
        email: 'blocked@test.dev',
        password: 'password-123',
      })
      expect(blocked.ok).toBe(false)
      if (!blocked.ok) expect(blocked.error).toContain('Too many attempts')
      // No expensive work ran for the throttled attempt.
      expect(hashSpy).toHaveBeenCalledTimes(5)
    } finally {
      hashSpy.mockRestore()
    }
  })

  it('a different IP has its own registration budget', async () => {
    const hashSpy = vi.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never)
    try {
      for (let i = 0; i < 5; i += 1) {
        await auth.registerUser({
          name: 'Burner',
          email: `burn-${i}@test.dev`,
          password: 'password-123',
        })
      }
      expect(
        (await auth.registerUser({ name: 'X', email: 'x@test.dev', password: 'password-123' })).ok,
      ).toBe(false)

      // Rotate the IP (as a NAT'd client would) — fresh bucket.
      headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '198.51.100.23' }))
      const result = await auth.registerUser({
        name: 'Rotated',
        email: 'rotated@test.dev',
        password: 'password-123',
      })
      expect(result).toEqual({ ok: true })
    } finally {
      hashSpy.mockRestore()
    }
  })

  it('requestPasswordReset allows 5 per IP then throttles (without writing tokens)', async () => {
    for (let i = 0; i < 5; i += 1) {
      // Unknown email: anti-enumeration path returns the same neutral success.
      expect(await auth.requestPasswordReset({ email: `nobody-${i}@test.dev` })).toEqual({
        ok: true,
      })
    }
    const blocked = await auth.requestPasswordReset({ email: 'nobody-6@test.dev' })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error).toContain('Too many attempts')
  })

  it('resetPassword allows 10 per IP then throttles (token still unguessable)', async () => {
    for (let i = 0; i < 10; i += 1) {
      const result = await auth.resetPassword({ token: `garbage-${i}`, password: 'password-123' })
      expect(result.ok).toBe(false) // invalid-token path, not the throttle
      if (!result.ok) expect(result.error).toContain('invalid or has expired')
    }
    const blocked = await auth.resetPassword({ token: 'garbage-10', password: 'password-123' })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error).toContain('Too many attempts')
  })
})
