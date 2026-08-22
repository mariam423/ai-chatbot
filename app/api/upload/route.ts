import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import {
  extractDocumentText,
  chunkDocumentText,
  getDocumentExtension,
  MAX_DOCUMENT_BYTES,
} from '@/lib/documents'
import { createEmbedding } from '@/lib/rag'

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

function errorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

function isAllowedMime(
  extension: NonNullable<ReturnType<typeof getDocumentExtension>>,
  mime: string,
) {
  if (extension === 'pdf') return mime === '' || mime === 'application/pdf'
  if (extension === 'txt') return mime === '' || mime === 'text/plain'
  if (extension === 'md') return mime === '' || mime === 'text/markdown' || mime === 'text/plain'
  return (
    mime === '' ||
    mime === 'text/csv' ||
    mime === 'text/plain' ||
    mime === 'application/vnd.ms-excel'
  )
}

async function ownedSession(sessionId: string) {
  const { getCurrentUserId } = await import('@/lib/auth-context')
  const userId = await getCurrentUserId()
  if (process.env.AUTH_DISABLED !== 'true' && !userId) return null
  return prisma.chatSession.findFirst({
    where: { id: sessionId, ...(userId ? { userId } : {}) },
    select: { id: true },
  })
}

export async function POST(request: Request) {
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
    return errorResponse('The document exceeds the 10 MB limit.', 413)

  const extension = getDocumentExtension(file.name)
  if (!extension) return errorResponse('Only PDF, TXT, MD, and CSV files are supported.')
  if (!isAllowedMime(extension, file.type)) {
    return errorResponse('The file type does not match its extension.')
  }

  try {
    const session = await ownedSession(metadata.data.sessionId)
    if (!session) return errorResponse('Chat session not found.', 404)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const text = extractDocumentText(file.name, file.type, bytes)
    const chunks = chunkDocumentText(text)
    if (chunks.length === 0) return errorResponse('The document does not contain usable text.')

    const document = await prisma.document.create({
      data: {
        sessionId: session.id,
        name: file.name.slice(0, 255),
        mimeType: file.type || (extension === 'pdf' ? 'application/pdf' : 'text/plain'),
        size: file.size,
        textLength: text.length,
        chunks: {
          create: chunks.map((content, chunkIndex) => ({
            chunkIndex,
            content,
            embedding: JSON.stringify(createEmbedding(content)),
          })),
        },
      },
      select: { id: true, name: true, mimeType: true, size: true, textLength: true },
    })

    return NextResponse.json({ document })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not process the document.'
    return errorResponse(message, message.includes('limit') ? 413 : 422)
  }
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId')
  const parsed = SessionIdSchema.safeParse(sessionId)
  if (!parsed.success) return errorResponse('A valid chat session is required.')

  try {
    const session = await ownedSession(parsed.data)
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
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body.')
  }
  const parsed = DeleteSchema.safeParse(body)
  if (!parsed.success) return errorResponse('A valid session and document are required.')

  try {
    const session = await ownedSession(parsed.data.sessionId)
    if (!session) return errorResponse('Chat session not found.', 404)
    await prisma.document.deleteMany({
      where: { id: parsed.data.documentId, sessionId: session.id },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return errorResponse('Could not remove the document.', 500)
  }
}
