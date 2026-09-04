import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../app/api/health/queue/route'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getQueueMetrics } from '@/lib/queues/task-queue'

// The guard (ROUTE_GUARDS['health-queue']) requires a session, which lazily
// imports next-auth — mock it the same way tests/api-chat.test.ts does.
vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}))

// The ADMIN role check reads the user row.
vi.mock('@/lib/db', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}))

vi.mock('@/lib/queues/task-queue', () => ({
  getQueueMetrics: vi.fn(),
}))

// auth() is typed as NextMiddleware and prisma.user.findUnique against the
// full User row, but both are vi.fn() mocks at runtime — cast to the mock
// surface so per-test overrides don't fight the real types.
type MockFn = ReturnType<typeof vi.fn>
const authMock = auth as unknown as MockFn
const findUniqueMock = prisma.user.findUnique as unknown as MockFn
const metricsMock = getQueueMetrics as unknown as MockFn

const METRICS = { waiting: 2, active: 1, completed: 40, failed: 3, delayed: 0 }

function healthRequest(): Request {
  return new Request('http://localhost/api/health/queue', {
    headers: { 'x-forwarded-for': '203.0.113.5' },
  })
}

beforeEach(() => {
  authMock.mockResolvedValue({ user: { id: 'admin-1' } })
  findUniqueMock.mockResolvedValue({ role: 'ADMIN' })
  metricsMock.mockResolvedValue(METRICS)
})

afterEach(() => {
  vi.unstubAllEnvs()
  authMock.mockReset()
  findUniqueMock.mockReset()
  metricsMock.mockReset()
})

describe('GET /api/health/queue', () => {
  it('returns the queue depths for an ADMIN when Redis is configured', async () => {
    const res = await GET(healthRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; queue: typeof METRICS; timestamp: string }
    expect(body.status).toBe('ok')
    expect(body.queue).toEqual(METRICS)
    expect(typeof body.timestamp).toBe('string')
  })

  it('returns queue: null (clean 200) when Redis is not configured', async () => {
    metricsMock.mockResolvedValue(null)
    const res = await GET(healthRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { queue: unknown }
    expect(body.queue).toBeNull()
  })

  it('rejects a missing session with 401 before any role check', async () => {
    authMock.mockResolvedValue(null)
    const res = await GET(healthRequest())
    expect(res.status).toBe(401)
    expect(findUniqueMock).not.toHaveBeenCalled()
    expect(metricsMock).not.toHaveBeenCalled()
  })

  it('forbids a signed-in non-admin (FREE / PRO) with 403', async () => {
    authMock.mockResolvedValue({ user: { id: 'free-1' } })
    findUniqueMock.mockResolvedValue({ role: 'FREE' })
    const res = await GET(healthRequest())
    expect(res.status).toBe(403)
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 'free-1' },
      select: { role: true },
    })
    expect(metricsMock).not.toHaveBeenCalled()
  })

  it('forbids when the session user row cannot be found (no role escalation)', async () => {
    authMock.mockResolvedValue({ user: { id: 'ghost-1' } })
    findUniqueMock.mockResolvedValue(null)
    const res = await GET(healthRequest())
    expect(res.status).toBe(403)
  })

  it('bypasses the role check under AUTH_DISABLED (local dev / e2e)', async () => {
    vi.stubEnv('AUTH_DISABLED', 'true')
    metricsMock.mockResolvedValue(METRICS)
    const res = await GET(healthRequest())
    expect(res.status).toBe(200)
    expect(findUniqueMock).not.toHaveBeenCalled()
    const body = (await res.json()) as { queue: typeof METRICS }
    expect(body.queue).toEqual(METRICS)
  })
})
