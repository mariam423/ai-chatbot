import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmbedToken, normalizeEmbedOrigin, verifyEmbedToken } from '../lib/embed'

afterEach(() => vi.unstubAllEnvs())

describe('embed tokens', () => {
  it('round-trips an owned assistant token and enforces its origin', () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const token = createEmbedToken({
      agentId: 'agent-1',
      userId: 'user-1',
      origin: 'https://example.com',
      now: 1_000_000,
    })
    expect(verifyEmbedToken(token, 'agent-1', 'https://example.com', 1_000_001)).toMatchObject({
      agentId: 'agent-1',
      userId: 'user-1',
      origin: 'https://example.com',
    })
    expect(verifyEmbedToken(token, 'agent-1', 'https://other.example', 1_000_001)).toBeNull()
    expect(verifyEmbedToken(token, 'other-agent', 'https://example.com/path', 1_000_001)).toBeNull()
  })

  it('rejects tampered and expired tokens', () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const token = createEmbedToken({ agentId: 'agent-1', userId: 'user-1', now: 1_000_000 })
    expect(verifyEmbedToken(`${token}x`, 'agent-1', null, 1_000_001)).toBeNull()
    expect(
      verifyEmbedToken(token, 'agent-1', null, 1_000_000 + 30 * 24 * 60 * 60 * 1000),
    ).toBeNull()
  })

  it('normalizes an allowed origin to its origin component', () => {
    expect(normalizeEmbedOrigin('https://example.com/path?x=1')).toBe('https://example.com')
    expect(normalizeEmbedOrigin(undefined)).toBe('*')
  })
})
