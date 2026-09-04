import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import {
  extractDocumentText,
  chunkDocumentText,
  getDocumentExtension,
  MAX_DOCUMENT_BYTES,
  ASYNC_PROCESSING_MIN_CHUNKS,
} from '@/lib/documents'
import { createEmbedding, storeDocumentChunks } from '@/lib/rag'
import { errorResponse } from '@/lib/http'
import { findOwnedSession } from '@/lib/session-access'
import { guardRoute, ROUTE_GUARDS } from '@/lib/security'
import { addTask } from '@/lib/queues/task-queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SessionIdSchema = z.string().trim().min(1).max(100)

const UploadMetadataSchema = z.object({
  sessionId: SessionIdSchema,
})

const DeleteSchema = z.object({
  sessionId: SessionIdSchema,
  documentId: z.string().trim().min(1).max(100),
})

function isAllowedMime(
  extension: NonNullable<ReturnType<typeof getDocumentExtension>>,
  mime: string,
) {
  if (extension === 'pdf') return mime === '' || mime === 'application/pdf'
  if (extension === 'txt') return mime === '' || mime === 'text/plain'
  if (extension === 'md') return mime === '' || mime === 'text/markdown' || mime === 'text/plain'
  if (extension === 'xlsx') {
    return (
      mime === '' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  }
  if (extension === 'docx') {
    return (
      mime === '' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  }
  return (
    mime === '' ||
    mime === 'text/csv' ||
    mime === 'text/plain' ||
    mime === 'application/vnd.ms-excel'
  )
}

export async function POST(request: Request) {
  const guard = await guardRoute(request, ROUTE_GUARDS.upload)
  if (!guard.ok) return guard.response

  // Reject oversized multipart bodies before formData() buffers them (the
  // 20 MB file cap is enforced after parsing; this is the fast pre-check).
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > 25 * 1024 * 1024) {
    return errorResponse('Upload too large.', 413)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return errorResponse('Upload must be sent as multipart form data.')
  }

  const metadata = UploadMetadataSchema.safeParse({ sessionId: formData.get('sessionId') })
  if (!metadata.success) return errorResponse('A valid chat session is required.')

  const file = formData.get('file')
  if (!(file instanceof File)) return errorResponse('A document file is required.')
  if (file.size === 0) return errorResponse('The document is empty.')
  if (file.size > MAX_DOCUMENT_BYTES)
    return errorResponse('The document exceeds the 20 MB limit.', 413)

  const extension = getDocumentExtension(file.name)
  if (!extension)
    return errorResponse('Only PDF, TXT, MD, CSV, XLSX, and DOCX files are supported.')
  if (!isAllowedMime(extension, file.type)) {
    return errorResponse('The file type does not match its extension.')
  }

  try {
    const session = await findOwnedSession(metadata.data.sessionId)
    if (!session) return errorResponse('Chat session not found.', 404)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const text = extractDocumentText(file.name, file.type, bytes)
    const chunks = chunkDocumentText(text)
    if (chunks.length === 0) return errorResponse('The document does not contain usable text.')

    // Large documents offload chunking + embedding + the bulk chunk insert
    // to the BullMQ worker so the request returns fast; small documents stay
    // fully synchronous so retrieval is immediately ready. When Redis is
    // down the offload path falls back to synchronous ingestion inline.
    const offload = chunks.length > ASYNC_PROCESSING_MIN_CHUNKS

    const document = await prisma.document.create({
      data: {
        sessionId: session.id,
        name: file.name.slice(0, 255),
        mimeType:
          file.type ||
          (extension === 'pdf'
            ? 'application/pdf'
            : extension === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : extension === 'docx'
                ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                : 'text/plain'),
        size: file.size,
        textLength: text.length,
        // Offloaded documents get their chunk rows from the worker;
        // synchronous ones embed inline so retrieval is immediately ready.
        ...(offload
          ? {}
          : {
              chunks: {
                create: chunks.map((content, chunkIndex) => ({
                  chunkIndex,
                  content,
                  embedding: JSON.stringify(createEmbedding(content)),
                })),
              },
            }),
      },
      select: { id: true, name: true, mimeType: true, size: true, textLength: true },
    })

    if (offload) {
      // Full-ingestion offload: the worker chunks, embeds, and persists the
      // chunk rows, then invalidates the session/user caches.
      const jobId = await addTask('document:process', {
        sessionId: session.id,
        documentId: document.id,
        userId: guard.userId,
        fileName: file.name,
        text,
      })
      if (!jobId) {
        // Redis unavailable — ingest synchronously so the document is usable.
        await storeDocumentChunks(
          document.id,
          chunks.map((content, chunkIndex) => ({ chunkIndex, content })),
        )
      }
    } else {
      // Small doc: work is already done inline; queue only cache
      // invalidation (best-effort — the short cache TTL bounds staleness).
      void addTask('document:process', {
        sessionId: session.id,
        documentId: document.id,
        userId: guard.userId,
        fileName: file.name,
      })
    }

    return NextResponse.json({ document })
  } catch (error) {
    // Log the full error server-side for diagnosis; surface a generic
    // message to the client. Prisma's exception messages routinely include
    // partial method calls (e.g. "Invalid `prisma.document.create(`") whose
    // formatting breaks in the UI and can leak schema names, so we never
    // forward the raw `error.message` to the client. The 422 distinguishes
    // "I understood the request but it couldn't be processed" from 413
    // (oversized) and 500 (infrastructure).
    console.error('[api/upload] document create failed:', error)
    return errorResponse('Could not process the document. Please try again.', 422)
  }
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId')
  const parsed = SessionIdSchema.safeParse(sessionId)
  if (!parsed.success) return errorResponse('A valid chat session is required.')

  try {
    const session = await findOwnedSession(parsed.data)
    if (!session) return errorResponse('Chat session not found.', 404)
    const documents = await prisma.document.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, mimeType: true, size: true, textLength: true },
    })
    return NextResponse.json({ documents })
  } catch {
    return errorResponse('Could not load documents.', 500)
  }
}

export async function DELETE(request: Request) {
  // State-changing endpoint: same CSRF + rate-limit guard as POST (cross-
  // origin browser DELETEs are already blocked by the absent CORS headers;
  // this is the defense-in-depth + shared-bucket consistency layer).
  const guard = await guardRoute(request, ROUTE_GUARDS.upload)
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body.')
  }
  const parsed = DeleteSchema.safeParse(body)
  if (!parsed.success) return errorResponse('A valid session and document are required.')

  try {
    const session = await findOwnedSession(parsed.data.sessionId)
    if (!session) return errorResponse('Chat session not found.', 404)
    await prisma.document.deleteMany({
      where: { id: parsed.data.documentId, sessionId: session.id },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return errorResponse('Could not remove the document.', 500)
  }
}
