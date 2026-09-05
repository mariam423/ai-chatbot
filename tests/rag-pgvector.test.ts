// Unit tests for the CONDITIONAL pgvector retrieval path (Pipeline 5).
//
// The default RAG backend is the zero-dependency hash search. When
// RAG_VECTOR_MODE=pgvector and the optional `embedding_vector` column exists,
// retrieval switches to a database-side `<=>` cosine query with a real
// similarity threshold — and degrades back to hash search when the column is
// missing or a raw query throws.
//
// These tests mock prisma's raw methods ($queryRaw/$executeRaw) directly so no
// database or pgvector extension is required.
import { afterEach, describe, expect, it, vi } from 'vitest'

const queryRawMock = vi.fn()
const executeRawMock = vi.fn()
const findOwnedSessionMock = vi.fn()
const createManyMock = vi.fn().mockResolvedValue({ count: 1 })
const findManyMock = vi.fn().mockResolvedValue([])

vi.mock('@/lib/session-access', () => ({ findOwnedSession: findOwnedSessionMock }))
vi.mock('@/lib/db', () => ({
  prisma: {
    documentChunk: { createMany: createManyMock, findMany: findManyMock },
    $queryRaw: queryRawMock,
    $executeRaw: executeRawMock,
  },
}))

/**
 * Load lib/rag with a specific RAG_VECTOR_MODE. Env must be set before the
 * module is imported (the mode is read at module scope), so we reset modules
 * and re-import dynamically each time.
 */
async function loadRag(mode: 'hash' | 'pgvector', columnProbe: unknown = []) {
  vi.stubEnv('RAG_VECTOR_MODE', mode)
  vi.resetModules()
  const rag = await import('@/lib/rag')
  queryRawMock.mockReset()
  executeRawMock.mockReset()
  findOwnedSessionMock.mockReset()
  // The capability probe is the first $queryRaw call: column present →
  // [{ present: 1 }]; missing → [].
  queryRawMock.mockResolvedValue(columnProbe)
  return rag
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('RAG pgvector conditional path', () => {
  it('uses hash search by default when RAG_VECTOR_MODE is unset', async () => {
    const rag = await loadRag('hash', [])
    expect(rag.RAG_VECTOR_MODE).toBe('hash')
    expect(rag.RAG_VECTOR_MIN_SIMILARITY).toBeGreaterThan(0)
  })

  it('mirrors hash embeddings into the vector column when pgvector is ready', async () => {
    const rag = await loadRag('pgvector', [{ present: 1 }])
    executeRawMock.mockResolvedValue(1)
    await rag.storeDocumentChunks('doc-1', [{ chunkIndex: 0, content: 'vector search rocks' }])
    // createMany stores the TEXT hash column; the probe + a per-chunk UPDATE
    // mirror the identical 128-dim vector into embedding_vector.
    expect(createManyMock).toHaveBeenCalledTimes(1)
    expect(queryRawMock).toHaveBeenCalledTimes(1)
    expect(executeRawMock).toHaveBeenCalledTimes(1)
  })

  it('retrieves via $queryRaw cosine distance with the similarity threshold when the column exists', async () => {
    const rag = await loadRag('pgvector', [{ present: 1 }])
    findOwnedSessionMock.mockResolvedValue({ id: 'session-1' })
    // The mock plays the database: the real query enforces the threshold
    // (<= distance) at the SQL layer, so only an in-threshold row returns.
    queryRawMock
      .mockResolvedValueOnce([{ present: 1 }])
      .mockResolvedValueOnce([
        { chunkIndex: 0, content: 'vector search rocks', documentName: 'docs.txt', distance: 0.08 },
      ])
    const results = await rag.retrieveDocumentChunks('session-1', 'vector search', 'user-1')
    // Only the row within the similarity threshold surfaced → score = 1 − distance.
    expect(results).toEqual([
      { documentName: 'docs.txt', chunkIndex: 0, content: 'vector search rocks', score: 0.92 },
    ])
    expect(queryRawMock).toHaveBeenCalledTimes(2)
    // Assert the emitted SQL actually encodes the cosine search contract:
    // distance operator, similarity threshold, null exclusion, ordering, cap.
    const call = queryRawMock.mock.calls[1]!
    const strings = call[0] as string[]
    const values = call.slice(1)
    const sql = strings.reduce(
      (acc, fragment, i) => acc + fragment + (values[i] !== undefined ? String(values[i]) : ''),
      '',
    )
    expect(sql).toContain('<=>')
    expect(sql).toContain('<= 0.25')
    expect(sql).toContain('embedding_vector IS NOT NULL')
    expect(sql).toContain('ORDER BY')
    expect(sql).toContain('LIMIT 6')
    expect(sql).toContain('d.session_id =')
  })

  it('falls back to hash search when the embedding_vector column does not exist', async () => {
    const rag = await loadRag('pgvector', [])
    findOwnedSessionMock.mockResolvedValue({ id: 'session-1' })
    findManyMock.mockResolvedValue([])
    const results = await rag.retrieveDocumentChunks('session-1', 'anything', 'user-1')
    expect(results).toEqual([])
    // One probe only — the missing column short-circuits before any search.
    expect(queryRawMock).toHaveBeenCalledTimes(1)
    expect(findManyMock).toHaveBeenCalledTimes(1)
  })

  it('degrades to hash search when the pgvector query itself throws', async () => {
    const rag = await loadRag('pgvector', [{ present: 1 }])
    findOwnedSessionMock.mockResolvedValue({ id: 'session-1' })
    const error = new Error('relation "document_chunks" does not exist')
    // Probe succeeds (column exists) but the actual cosine query throws →
    // retrieveDocumentChunks catches and uses findMany instead.
    queryRawMock.mockResolvedValueOnce([{ present: 1 }]).mockRejectedValueOnce(error)
    findManyMock.mockResolvedValue([])
    const results = await rag.retrieveDocumentChunks('session-1', 'anything', 'user-1')
    expect(results).toEqual([])
    expect(queryRawMock).toHaveBeenCalledTimes(2)
  })
})
