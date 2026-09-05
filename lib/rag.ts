import { z } from 'zod'
import { prisma } from '@/lib/db'
import { findOwnedSession } from '@/lib/session-access'

// Keep the RAG boundary convenient for callers that own document ingestion:
// format-aware extraction/chunking lives in lib/documents.ts, while this
// module re-exports the public pipeline helpers alongside embeddings/retrieval.
export {
  chunkDocumentText,
  extractDocumentText,
  getDocumentExtension,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_CHUNKS,
  MAX_EXTRACTED_TEXT_LENGTH,
} from '@/lib/documents'

export const EMBEDDING_DIMENSION = 128
export const MAX_RAG_CHUNKS = 6
export const MAX_RAG_CONTEXT_LENGTH = 8_000

/**
 * RAG retrieval backend selection.
 *
 *  - `hash` (default): local deterministic embeddings stored in the TEXT
 *    `embedding` column with in-memory cosine scoring — zero dependencies,
 *    portable to any Postgres. This is the original implementation and
 *    remains fully supported.
 *  - `pgvector`: database-side cosine search over the optional `embedding_vector`
 *    vector(128) column (PgVector extension + HNSW index). Operator must apply
 *    `prisma/vector-column.sql` once; when the column or extension is missing the
 *    code transparently falls back to the hash path (same embeddings, same
 *    scores — both are L2-normalized so cosine equals the dot product).
 */
export const RAG_VECTOR_MODE: 'hash' | 'pgvector' =
  process.env.RAG_VECTOR_MODE === 'pgvector' ? 'pgvector' : 'hash'

/** Minimum cosine similarity for a chunk to be returned by the pgvector path. */
export const RAG_VECTOR_MIN_SIMILARITY = Math.min(
  1,
  Math.max(0, Number(process.env.RAG_VECTOR_MIN_SIMILARITY ?? 0.75)),
)
/** pgvector `<=>` is a cosine *distance* (1 − similarity). */
const RAG_VECTOR_MAX_DISTANCE = 1 - RAG_VECTOR_MIN_SIMILARITY

/** Lazy, once-per-process capability probe for the optional vector column. */
let vectorColumnAvailable: boolean | null = null

async function isPgvectorReady(): Promise<boolean> {
  if (RAG_VECTOR_MODE !== 'pgvector') return false
  if (vectorColumnAvailable !== null) return vectorColumnAvailable
  try {
    const rows = (await prisma.$queryRaw<
      Array<{ present: number }>
    >`SELECT 1 AS present FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'document_chunks' AND column_name = 'embedding_vector' LIMIT 1`) as Array<{
      present: number
    }>
    vectorColumnAvailable = Array.isArray(rows) && rows.length > 0
    if (!vectorColumnAvailable) {
      console.warn(
        '[rag] RAG_VECTOR_MODE=pgvector but document_chunks.embedding_vector is missing; falling back to hash search. Apply prisma/vector-column.sql to enable it.',
      )
    }
  } catch (error) {
    console.warn('[rag] pgvector capability check failed; using hash search:', error)
    vectorColumnAvailable = false
  }
  return vectorColumnAvailable
}

const EmbeddingSchema = z.array(z.number().finite()).length(EMBEDDING_DIMENSION)
const tokenPattern = /[\p{L}\p{N}]+/gu

/**
 * Generate a deterministic local vector from token hashes. This keeps RAG
 * private and works without an additional embedding API or exposed key.
 * Replacing this function with a hosted embedding model later does not change
 * the persisted document or retrieval contracts.
 */
export function createEmbedding(text: string): number[] {
  const vector = Array<number>(EMBEDDING_DIMENSION).fill(0)
  const tokens = text.toLocaleLowerCase().match(tokenPattern) ?? []
  for (const token of tokens) {
    let hash = 2_166_136_261
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index)
      hash = Math.imul(hash, 16_777_619)
    }
    const bucket = (hash >>> 0) % EMBEDDING_DIMENSION
    vector[bucket] = (vector[bucket] ?? 0) + 1
  }
  const magnitude = Math.hypot(...vector)
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude)
}

/**
 * Persist chunk rows with computed embeddings for a document whose metadata
 * row already exists (the worker's offloaded ingestion path). Embeddings are
 * deterministic local hashes, so recomputing them is idempotent and safe on
 * job retries. The upload route uses this as its synchronous fallback when
 * Redis is unavailable.
 */
export async function storeDocumentChunks(
  documentId: string,
  chunks: Array<{ chunkIndex: number; content: string }>,
): Promise<void> {
  if (chunks.length === 0) return
  await prisma.documentChunk.createMany({
    data: chunks.map(({ chunkIndex, content }) => ({
      documentId,
      chunkIndex,
      content,
      embedding: JSON.stringify(createEmbedding(content)),
    })),
  })
  // pgvector path: mirror the same 128-dim embedding into the optional vector
  // column so database-side cosine search can answer later retrievals. Failure
  // here is non-fatal — the hash column remains the source of truth for the
  // in-memory fallback (identical scores).
  if (await isPgvectorReady()) {
    try {
      for (const { chunkIndex, content } of chunks) {
        await prisma.$executeRaw`
          UPDATE document_chunks
          SET embedding_vector = ${JSON.stringify(createEmbedding(content))}::vector
          WHERE document_id = ${documentId} AND chunk_index = ${chunkIndex}
        `
      }
    } catch (error) {
      console.warn('[rag] pgvector mirror update failed; hash search remains active:', error)
    }
  }
}

/** Dot-product cosine for L2-normalized local vectors (identical in both modes). */
function cosineSimilarity(left: number[], right: number[]): number {
  let score = 0
  for (let index = 0; index < EMBEDDING_DIMENSION; index += 1) {
    score += (left[index] ?? 0) * (right[index] ?? 0)
  }
  return score
}

export interface RetrievedDocumentChunk {
  documentName: string
  chunkIndex: number
  content: string
  score: number
}

/** Retrieve the most relevant chunks from documents belonging to one session. */
export async function retrieveDocumentChunks(
  sessionId: string,
  query: string,
  userId: string | null = null,
): Promise<RetrievedDocumentChunk[]> {
  const session = await findOwnedSession(sessionId, userId)
  if (!session) return []
  if (await isPgvectorReady()) {
    try {
      return await retrieveDocumentChunksViaPgvector(sessionId, query)
    } catch (error) {
      // A malformed vector column, extension drop, or plan-level outage falls
      // back to the hash path rather than failing the chat.
      console.warn('[rag] pgvector search failed; falling back to hash search:', error)
    }
  }

  const rows = await prisma.documentChunk.findMany({
    where: { document: { sessionId } },
    select: {
      chunkIndex: true,
      content: true,
      embedding: true,
      document: { select: { name: true } },
    },
  })
  const queryEmbedding = createEmbedding(query)
  return rows
    .flatMap((row) => {
      let rawEmbedding: unknown
      try {
        rawEmbedding = JSON.parse(row.embedding)
      } catch {
        return []
      }
      const parsed = EmbeddingSchema.safeParse(rawEmbedding)
      if (!parsed.success) return []
      return [
        {
          documentName: row.document.name,
          chunkIndex: row.chunkIndex,
          content: row.content,
          score: cosineSimilarity(queryEmbedding, parsed.data),
        },
      ]
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RAG_CHUNKS)
}

/**
 * Database-side cosine search (pgvector `<=>` operator) over the optional
 * `embedding_vector` column. Returns the same shape as the hash path with a
 * real similarity threshold applied at the SQL layer.
 */
async function retrieveDocumentChunksViaPgvector(
  sessionId: string,
  query: string,
): Promise<RetrievedDocumentChunk[]> {
  const queryVector = JSON.stringify(createEmbedding(query))
  const rows = (await prisma.$queryRaw<
    Array<{ chunkIndex: number; content: string; documentName: string; distance: number }>
  >`
    SELECT dc.chunk_index AS "chunkIndex",
           dc.content,
           d.name AS "documentName",
           dc.embedding_vector <=> ${queryVector}::vector AS distance
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE d.session_id = ${sessionId}
      AND dc.embedding_vector IS NOT NULL
      AND dc.embedding_vector <=> ${queryVector}::vector <= ${RAG_VECTOR_MAX_DISTANCE}
    ORDER BY dc.embedding_vector <=> ${queryVector}::vector ASC
    LIMIT ${MAX_RAG_CHUNKS}
  `) as Array<{
    chunkIndex: number
    content: string
    documentName: string
    distance: number
  }>
  return rows.map((row) => ({
    documentName: row.documentName,
    chunkIndex: row.chunkIndex,
    content: row.content,
    score: 1 - row.distance,
  }))
}

/** Format retrieved excerpts as bounded, citation-friendly prompt context. */
export async function getSessionRagContext(
  sessionId: string,
  query: string,
  userId: string | null = null,
): Promise<string> {
  try {
    const chunks = await retrieveDocumentChunks(sessionId, query, userId)
    let length = 0
    const selected: string[] = []
    for (const chunk of chunks) {
      const excerpt = `[Document: ${chunk.documentName}, section ${chunk.chunkIndex + 1}]\n${chunk.content}`
      if (length + excerpt.length > MAX_RAG_CONTEXT_LENGTH) break
      selected.push(excerpt)
      length += excerpt.length
    }
    return selected.join('\n\n')
  } catch {
    // RAG should never take down a normal chat when a document row is corrupt
    // or the database is temporarily unavailable.
    return ''
  }
}
