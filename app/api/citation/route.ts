import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CitationQuerySchema = z.object({
  sessionId: z.string().trim().min(1).max(100),
  documentName: z.string().trim().min(1).max(255),
  section: z.coerce.number().int().min(1).max(10_000),
})

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const parsed = CitationQuerySchema.safeParse({
    sessionId: params.get('sessionId'),
    documentName: params.get('documentName'),
    section: params.get('section'),
  })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid citation.' }, { status: 400 })

  try {
    const { getCurrentUserId } = await import('@/lib/auth-context')
    const userId = await getCurrentUserId()
    if (process.env.AUTH_DISABLED !== 'true' && !userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
    }

    const session = await prisma.chatSession.findFirst({
      where: { id: parsed.data.sessionId, ...(userId ? { userId } : {}) },
      select: { id: true },
    })
    if (!session) return NextResponse.json({ error: 'Chat session not found.' }, { status: 404 })

    const chunk = await prisma.documentChunk.findFirst({
      where: {
        document: {
          sessionId: session.id,
          name: parsed.data.documentName,
        },
        chunkIndex: parsed.data.section - 1,
      },
      select: {
        content: true,
        chunkIndex: true,
        document: {
          select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
        },
      },
    })
    if (!chunk) return NextResponse.json({ error: 'Citation not found.' }, { status: 404 })

    return NextResponse.json({
      section: chunk.chunkIndex + 1,
      content: chunk.content,
      document: {
        ...chunk.document,
        createdAt: chunk.document.createdAt.toISOString(),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Could not load citation.' }, { status: 500 })
  }
}
