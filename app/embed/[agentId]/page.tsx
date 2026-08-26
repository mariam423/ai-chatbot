import { headers } from 'next/headers'
import { prisma } from '@/lib/db'
import { verifyEmbedToken } from '@/lib/embed'
import EmbedChat from '@/components/embed-chat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { agentId } = await params
  const query = await searchParams
  const token = Array.isArray(query.token) ? query.token[0] : query.token
  const requestOrigin = (await headers()).get('origin')
  const payload = verifyEmbedToken(token, agentId, requestOrigin)

  if (!payload) {
    return (
      <main className="flex h-dvh items-center justify-center bg-[#0a0f0d] p-6 text-center text-white">
        <p className="text-sm text-white/70">This assistant embed link is invalid or expired.</p>
      </main>
    )
  }

  const agent = await prisma.customAgent.findFirst({
    where: { id: payload.agentId, userId: payload.userId },
    select: { name: true },
  })
  if (!agent) {
    return (
      <main className="flex h-dvh items-center justify-center bg-[#0a0f0d] p-6 text-center text-white">
        <p className="text-sm text-white/70">Assistant not found.</p>
      </main>
    )
  }

  return <EmbedChat agentId={agentId} token={token!} assistantName={agent.name} />
}
