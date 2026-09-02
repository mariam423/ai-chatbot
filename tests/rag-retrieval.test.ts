// Verifies the RAG retrieval pipeline itself (not just the chat wiring):
//   1. Generate a unique token in a chunk of text.
//   2. Insert a DocumentChunk row into the in-memory Prisma mock.
//   3. Query for a paraphrased question.
//   4. Assert the retrieved top chunk contains the unique token.
// This catches regressions in the cosine-similarity / JSON.parse /
// sanitization paths without burning OpenRouter's free-tier quota.
//
// The in-memory Prisma mock (tests/_prisma-mock.ts) replaces the real
// client for lib/db, so no real database is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaFixture = (await import('./_prisma-mock')).makeInMemoryPrisma()
vi.mock('../lib/db', () => ({ prisma: prismaFixture.prisma }))

// Auth scoping: in the real app findOwnedSession requires either an
// authenticated user id or AUTH_DISABLED=true. The RAG tests pass a
// userId directly and skip the env-var path; setting AUTH_DISABLED here
// makes the ownership check accept that userId without an auth call.
vi.stubEnv('AUTH_DISABLED', 'true')

// `loadRag`/`loadDocuments` are dynamic imports so the vi.mock above is
// wired before module evaluation (and so the test reads the *current*
// in-memory store rather than a stale reference).
async function loadRag() {
  return await import('../lib/rag')
}
async function loadDocuments() {
  return await import('../lib/documents')
}

const UNIQUE_TOKEN = `MARMALADE${Math.random().toString(36).slice(2, 10).toUpperCase()}`
const SESSION_ID = `rag-test-${Date.now()}`
const USER_ID = `rag-test-user-${Date.now()}`

beforeEach(async () => {
  // Reset between tests so prior cases don't leak rows.
  await prismaFixture.prisma.documentChunk.deleteMany()
  await prismaFixture.prisma.document.deleteMany()
  await prismaFixture.prisma.chatSession.deleteMany()

  const { createEmbedding } = await loadRag()
  const { extractDocumentText, chunkDocumentText } = await loadDocuments()
  // Build a Document row + chunk that contains the unique token. We
  // hand-roll the embedding (same deterministic hash pipeline the
  // production upload route uses) so the chunk is directly retrievable.
  const session = await prismaFixture.prisma.chatSession.create({
    data: { id: SESSION_ID, userId: USER_ID, title: 'RAG retrieval test' },
  })
  const rawText = `The capital of Atlantis is Coralhaven. The secret passphrase is ${UNIQUE_TOKEN}.`
  // extractDocumentText already calls sanitizeForPostgres internally
  // (commit 323017d, to strip NUL bytes before Postgres INSERT), and
  // chunkDocumentText re-sanitizes as defense in depth.
  const cleanText = extractDocumentText('rag-test.txt', 'text/plain',
    new TextEncoder().encode(rawText))
  const chunks = chunkDocumentText(cleanText)
  expect(chunks.length).toBeGreaterThan(0)

  await prismaFixture.prisma.document.create({
    data: {
      sessionId: session.id,
      name: 'rag-test.txt',
      mimeType: 'text/plain',
      size: cleanText.length,
      textLength: cleanText.length,
      chunks: {
        create: chunks.map((content, chunkIndex) => ({
          chunkIndex,
          content,
          embedding: JSON.stringify(createEmbedding(content)),
        })),
      },
    },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RAG retrieval', () => {
  it('surfaces the relevant chunk for a paraphrased query', async () => {
    const { retrieveDocumentChunks } = await loadRag()
    const session = await prismaFixture.prisma.chatSession.findFirst({
      where: { id: SESSION_ID, userId: USER_ID },
      select: { id: true },
    })
    console.log('session findFirst:', session)
    const all = await prismaFixture.prisma.documentChunk.findMany()
    console.log('chunks in store:', all.length)
    const filtered = await prismaFixture.prisma.documentChunk.findMany({
      where: { document: { sessionId: SESSION_ID } },
    })
    console.log('filtered by doc.sessionId:', filtered.length)
    const results = await retrieveDocumentChunks(
      SESSION_ID,
      'What is the secret passphrase?',
      USER_ID,
    )
    expect(results.length).toBeGreaterThan(0)
    const top = results[0]!
    expect(top.content).toContain(UNIQUE_TOKEN)
    expect(top.score).toBeGreaterThan(0)
  })

  it('orders chunks by descending similarity', async () => {
    const { retrieveDocumentChunks } = await loadRag()
    const results = await retrieveDocumentChunks(
      SESSION_ID,
      'capital of Atlantis',
      USER_ID,
    )
    expect(results.length).toBeGreaterThan(0)
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score)
    }
  })

  it('returns a lower score for an unrelated query than for the on-topic query', async () => {
    const { retrieveDocumentChunks } = await loadRag()
    const onTopic = await retrieveDocumentChunks(
      SESSION_ID,
      'secret passphrase',
      USER_ID,
    )
    const offTopic = await retrieveDocumentChunks(
      SESSION_ID,
      'asdfgh qwerty zxcvbn mnbvcx lkjhgf poiuzt',
      USER_ID,
    )
    expect(onTopic.length).toBeGreaterThan(0)
    // Even if both queries return the same chunk set, the on-topic query
    // should score strictly higher — that proves the hash-based embedding
    // is actually distinguishing relevance.
    expect(onTopic[0]!.score).toBeGreaterThan(offTopic[0]?.score ?? -1)
  })
})
