import { afterEach, describe, expect, it, vi } from 'vitest'

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }))

vi.mock('../lib/db', () => ({
  prisma: { $queryRaw: queryRaw },
}))

import { GET } from '../app/api/health/route'

afterEach(() => {
  queryRaw.mockReset()
})

describe('GET /api/health', () => {
  it('returns a non-sensitive healthy status when the database responds', async () => {
    queryRaw.mockResolvedValue([{ 1: 1 }])

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } })
    expect(queryRaw).toHaveBeenCalledOnce()
  })

  it('returns 503 when the database readiness check fails', async () => {
    queryRaw.mockRejectedValue(new Error('database unavailable'))

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      status: 'degraded',
      checks: { database: 'error' },
    })
  })
})
