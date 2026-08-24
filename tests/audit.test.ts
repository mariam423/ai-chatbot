import { afterEach, describe, expect, it, vi } from 'vitest'
import { logSecurityEvent } from '../lib/audit'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('logSecurityEvent (OWASP A09)', () => {
  it('is a no-op under NODE_ENV=test so unit suites stay quiet', () => {
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'test'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSecurityEvent('rate_limited', { route: 'chat' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('emits warn-level events as structured JSON in production', () => {
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSecurityEvent('ownership_violation', { sessionId: 'sess-1', userId: 'user-1' })

    expect(warn).toHaveBeenCalledTimes(1)
    const raw = String(warn.mock.calls[0]![0])
    expect(raw.startsWith('[security] ')).toBe(true)
    const parsed = JSON.parse(raw.slice('[security] '.length))
    expect(parsed).toMatchObject({
      event: 'ownership_violation',
      level: 'warn',
      sessionId: 'sess-1',
      userId: 'user-1',
    })
    expect(typeof parsed.ts).toBe('string')
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false)
  })

  it('gates info-level events behind SECURITY_AUDIT_LOG=true', () => {
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'
    delete process.env.SECURITY_AUDIT_LOG
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logSecurityEvent('auth_succeeded', { userId: 'user-1' }, 'info')
    expect(info).not.toHaveBeenCalled()

    process.env.SECURITY_AUDIT_LOG = 'true'
    logSecurityEvent('auth_succeeded', { userId: 'user-1' }, 'info')
    expect(info).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(String(info.mock.calls[0]![0]).slice('[security] '.length))
    expect(parsed).toMatchObject({ event: 'auth_succeeded', level: 'info', userId: 'user-1' })
  })

  it('does not log info events as warn', () => {
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'
    process.env.SECURITY_AUDIT_LOG = 'true'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    logSecurityEvent('auth_succeeded', { userId: 'user-1' }, 'info')
    expect(warn).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledTimes(1)
  })
})
