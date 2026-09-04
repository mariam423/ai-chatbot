import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../app/api/upload/route'

// Route-level fault-injection tests for the document upload path (Phase 6):
// when the BullMQ offload is unavailable (Redis down, `addTask` → null) the
// route must ingest the document synchronously so retrieval stays usable.
//
// The prisma client is mocked in-memory; the real text pipeline
// (extract → chunk) and the real `storeDocumentChunks` fallback run against
// it, so the assertions prove chunk rows actually land via the fallback.

const { addTaskMock, createDocument, createDocumentChunks, findChatSession } = vi.hoisted(() => ({
  // Promise<unknown> so mockImplementation/mockResolvedValue accept any stub.
  addTaskMock: vi.fn(async (..._args: unknown[]) => null as unknown),
  createDocument: vi.fn(async (..._args: unknown[]) => null as unknown),
  createDocumentChunks: vi.fn(async (..._args: unknown[]) => null as unknown),
  findChatSession: vi.fn(async (..._args: unknown[]) => null as unknown),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    document: {
      create: (...args: unknown[]) => createDocument(...args),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    chatSession: {
      findFirst: (...args: unknown[]) => findChatSession(...args),
    },
    documentChunk: {
      createMany: (...args: unknown[]) => createDocumentChunks(...args),
    },
  },
}))

// findOwnedSession (real) resolves the caller via auth-context — mock it to a
// signed-in user so the ownership query runs against the mocked prisma.
vi.mock('@/lib/auth-context', () => ({
  getCurrentUserId: vi.fn().mockResolvedValue('user-1'),
}))

vi.mock('@/lib/queues/task-queue', () => ({ addTask: addTaskMock }))

// Paragraph-length text so every chunk is ~CHUNK_SIZE and the count is
// deterministic (no newline/sentence boundary snapping at paragraph edges).
const SENTENCE = 'The quick brown fox jumps over the lazy dog. '

function uploadRequest(content: string, filename = 'notes.txt'): Request {
  const form = new FormData()
  form.set('sessionId', 'session-1')
  form.set('file', new File([content], filename, { type: 'text/plain' }))
  // No Origin header — the CSRF guard treats header-less requests as
  // non-browser traffic (curl/server/tests), same as the other route suites.
  return new Request('http://localhost/api/upload', {
    method: 'POST',
    body: form,
  })
}

beforeEach(() => {
  createDocument.mockReset()
  createDocumentChunks.mockReset()
  findChatSession.mockReset()
  addTaskMock.mockReset()
  addTaskMock.mockResolvedValue('job-1')
  findChatSession.mockImplementation(async (args: unknown) => {
    const where = (args as { where: { id: string } }).where
    if (where.id !== 'session-1') return null
    return { id: 'session-1' }
  })
  createDocument.mockImplementation(async (args: unknown) => {
    const { name, size, textLength, mimeType } = (args as { data: Record<string, unknown> })
      .data as {
      name: string
      size: number
      textLength: number
      mimeType: string
    }
    return { id: 'doc-1', name, mimeType, size, textLength }
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/upload — async offload + synchronous fallback (Phase 6)', () => {
  it('offloads a large document to the worker and stores no chunks inline when Redis is up', async () => {
    // ~180 KB → well over the 50-chunk offload threshold.
    const big = SENTENCE.repeat(4000)
    const res = await POST(uploadRequest(big))
    expect(res.status).toBe(200)

    // The document row is created WITHOUT chunk rows (the worker fills them).
    const createArgs = createDocument.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(createArgs.data).not.toHaveProperty('chunks')
    // The full-ingestion job carries the extracted text so the worker can
    // chunk + embed without re-reading the file.
    expect(addTaskMock).toHaveBeenCalledWith(
      'document:process',
      expect.objectContaining({
        sessionId: 'session-1',
        documentId: 'doc-1',
        userId: '',
        fileName: 'notes.txt',
        text: expect.stringContaining('lazy dog'),
      }),
    )
    expect(createDocumentChunks).not.toHaveBeenCalled()
  })

  it('falls back to synchronous chunk storage when Redis is down (addTask → null)', async () => {
    const big = SENTENCE.repeat(4000)
    addTaskMock.mockResolvedValue(null)

    const res = await POST(uploadRequest(big))
    // The upload contract never regresses: the client still gets a usable doc.
    expect(res.status).toBe(200)

    expect(addTaskMock).toHaveBeenCalledWith(
      'document:process',
      expect.objectContaining({ documentId: 'doc-1', text: expect.any(String) }),
    )
    // The inline fallback stored every chunk row with a deterministic
    // embedding (real storeDocumentChunks against the mocked prisma).
    const chunks = createDocumentChunks.mock.calls[0]![0] as { data: unknown[] }
    expect(chunks.data.length).toBeGreaterThan(50)
    expect(chunks.data[0]).toMatchObject({
      documentId: 'doc-1',
      chunkIndex: 0,
      content: expect.any(String),
      embedding: expect.stringContaining('['),
    })
    const indexes = chunks.data.map((chunk) => (chunk as { chunkIndex: number }).chunkIndex)
    expect(indexes).toEqual([...indexes.keys()])
    // Chunk content stays within the pipeline's CHUNK_SIZE bound.
    const maxContent = Math.max(
      ...chunks.data.map((c) => (c as { content: string }).content.length),
    )
    expect(maxContent).toBeLessThanOrEqual(1602)
  })

  it('stores a small document fully inline regardless of Redis availability', async () => {
    const small = SENTENCE.repeat(40)
    // Even with Redis down the small-doc path stores chunk rows at creation
    // time (they ride in the nested document.create), so nothing to fall back.
    addTaskMock.mockResolvedValue(null)

    const res = await POST(uploadRequest(small))
    expect(res.status).toBe(200)

    const createArgs = createDocument.mock.calls[0]![0] as {
      data: { chunks: { create: unknown[] } }
    }
    const inlineChunks = createArgs.data.chunks.create
    expect(inlineChunks.length).toBeGreaterThan(0)
    expect(inlineChunks.length).toBeLessThanOrEqual(50)
    // The cache-invalidation job is still dispatched (best-effort) but carries
    // no text — the work is already done.
    expect(addTaskMock).toHaveBeenCalledWith(
      'document:process',
      expect.objectContaining({
        documentId: 'doc-1',
        fileName: 'notes.txt',
      }),
    )
    expect(addTaskMock.mock.calls[0]![1]).not.toHaveProperty('text')
    expect(createDocumentChunks).not.toHaveBeenCalled()
  })
})
