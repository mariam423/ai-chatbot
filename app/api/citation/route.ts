import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { errorResponse } from '@/lib/http'
import { findOwnedSession } from '@/lib/session-access'
import { guardRoute, ROUTE_GUARDS } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CitationQuerySchema = z.object({
  sessionId: z.string().trim().min(1).max(100),
  documentName: z.string().trim().min(1).max(255),
  section: z.coerce.number().int().min(1).max(10_000),
})

export async function GET(request: Request) {
  const guard = await guardRoute(request, ROUTE_GUARDS.citation)
  if (!guard.ok) return guard.response

  const params = new URL(request.url).searchParams
  const parsed = CitationQuerySchema.safeParse({
    sessionId: params.get('sessionId'),
    documentName: params.get('documentName'),
    section: params.get('section'),
  })
  if (!parsed.success) return errorResponse('Invalid citation.')

  try {
    const session = await findOwnedSession(parsed.data.sessionId)
    if (!session) return errorResponse('Chat session not found.', 404)

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
    if (!chunk) return errorResponse('Citation not found.', 404)

    return NextResponse.json({
      section: chunk.chunkIndex + 1,
      content: chunk.content,
      document: {
        ...chunk.document,
        createdAt: chunk.document.createdAt.toISOString(),
      },
    })
  } catch {
    return errorResponse('Could not load citation.', 500)
  }
}
