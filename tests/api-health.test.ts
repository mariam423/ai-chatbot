import { afterEach, describe, expect, it, vi } from 'vitest'

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }))

vi.mock('../lib/db', () => ({
  prisma: { $queryRaw: queryRaw },
}))

import { GET } from '../app/api/health/route'

afterEach(() => {
  queryRaw.mockReset()
  vi.unstubAllEnvs()
})

function request(token?: string): Request {
  return new Request('http://localhost/api/health', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

describe('GET /api/health', () => {
  it('answers anonymous liveness without touching the database', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'monitor-secret')
    queryRaw.mockRejectedValue(new Error('database unavailable'))

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('ignores a wrong token and still answers liveness only', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'monitor-secret')

    const response = await GET(request('wrong-token'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('runs the detailed readiness check only for the Bearer secret', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'monitor-secret')
    queryRaw.mockResolvedValue([{ 1: 1 }])

    const response = await GET(request('monitor-secret'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } })
    expect(queryRaw).toHaveBeenCalledOnce()
  })

  it('reports 503 degraded for the authorized monitor when the DB check fails', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'monitor-secret')
    queryRaw.mockRejectedValue(new Error('database unavailable'))

    const response = await GET(request('monitor-secret'))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      status: 'degraded',
      checks: { database: 'error' },
    })
  })

  it('never exposes detail when no health token is configured', async () => {
    vi.unstubAllEnvs()
    queryRaw.mockRejectedValue(new Error('database unavailable'))

    const response = await GET(request('anything'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(queryRaw).not.toHaveBeenCalled()
  })
})
