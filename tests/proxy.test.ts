import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { proxy } from '../proxy'

afterEach(() => vi.unstubAllEnvs())

function request(pathname: string, cookies: Record<string, string> = {}): NextRequest {
  return {
    nextUrl: new URL(`http://localhost${pathname}`),
    cookies: {
      get: (name: string) =>
        cookies[name] !== undefined ? { name, value: cookies[name] } : undefined,
    },
  } as unknown as NextRequest
}

describe('proxy route gating', () => {
  it('lets the Stripe webhook through without a session cookie (signature is the auth)', () => {
    const response = proxy(request('/api/webhooks/stripe'))
    expect(response.headers.get('location')).toBeNull()
  })

  it('still lets NextAuth, embed, and health routes through', () => {
    for (const path of ['/api/auth/session', '/api/embed/chat', '/embed/agent-1', '/api/health']) {
      expect(proxy(request(path)).headers.get('location')).toBeNull()
    }
  })

  it('redirects a session-gated API route to /login without a session cookie', () => {
    const response = proxy(request('/api/skills'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
    expect(decodeURIComponent(response.headers.get('location') ?? '')).toContain('/api/skills')
  })

  it('allows a session-gated route when a valid session cookie is present', () => {
    const response = proxy(request('/api/chat', { '__Secure-authjs.session-token': 'tok' }))
    expect(response.headers.get('location')).toBeNull()
  })
})
