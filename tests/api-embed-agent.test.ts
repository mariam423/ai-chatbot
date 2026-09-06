import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmbedToken } from '../lib/embed'

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }))
vi.mock('../lib/db', () => ({ prisma: { customAgent: { findFirst } } }))

import { GET } from '../app/api/embed/agent/route'

afterEach(() => {
  findFirst.mockReset()
  vi.unstubAllEnvs()
})

function request(
  agentId: string,
  token: string | null,
  origin = 'https://allowed.example',
  parentOrigin?: string,
): Request {
  return new Request(`http://localhost/api/embed/agent?agentId=${agentId}`, {
    method: 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Origin: origin,
      ...(parentOrigin ? { 'X-Embed-Parent-Origin': parentOrigin } : {}),
    },
  })
}

describe('GET /api/embed/agent', () => {
  it('rejects a missing token without touching the database', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const response = await GET(request('agent-1', null))
    expect(response.status).toBe(401)
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('rejects a token bound to a different origin', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const token = createEmbedToken({
      agentId: 'agent-1',
      userId: 'user-1',
      origin: 'https://other.example',
    })
    const response = await GET(request('agent-1', token))
    expect(response.status).toBe(401)
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('returns the assistant name for a valid token', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const token = createEmbedToken({
      agentId: 'agent-1',
      userId: 'user-1',
      origin: 'https://allowed.example',
    })
    findFirst.mockResolvedValue({ name: 'Support bot' })
    const requestValid = request('agent-1', token, 'https://allowed.example')
    const response = await GET(requestValid)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ name: 'Support bot' })
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'agent-1', userId: 'user-1' },
      select: { name: true },
    })
  })

  it('matches a bound origin via the X-Embed-Parent-Origin signal', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const token = createEmbedToken({
      agentId: 'agent-1',
      userId: 'user-1',
      origin: 'https://publisher.example',
    })
    findFirst.mockResolvedValue({ name: 'Support bot' })
    const requestViaParent = request(
      'agent-1',
      token,
      'https://app.example',
      'https://publisher.example',
    )
    const response = await GET(requestViaParent)
    expect(response.status).toBe(200)
  })

  it('returns 404 when the agent does not exist', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret')
    const token = createEmbedToken({
      agentId: 'agent-1',
      userId: 'user-1',
      origin: 'https://allowed.example',
    })
    findFirst.mockResolvedValue(null)
    const response = await GET(request('agent-1', token))
    expect(response.status).toBe(404)
  })
})
