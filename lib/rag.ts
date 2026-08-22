import { z } from 'zod'
import { prisma } from '@/lib/db'

export const EMBEDDING_DIMENSION = 128
export const MAX_RAG_CHUNKS = 6
export const MAX_RAG_CONTEXT_LENGTH = 8_000

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
  if (process.env.AUTH_DISABLED !== 'true' && !userId) return []
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, ...(userId ? { userId } : {}) },
    select: { id: true },
  })
  if (!session) return []

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
