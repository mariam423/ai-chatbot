import EmbedShell from '@/components/embed-shell'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The embed token is delivered in the URL *fragment* (`#token=…`) by the
 * widget loader — fragments are never sent to the server, logged in access
 * logs, or included in Referer headers. Server-side verification therefore
 * can't happen here; the client shell reads the fragment, scrubs it from the
 * URL, and verifies the token against `/api/embed/agent` before mounting the
 * chat surface.
 */
export default async function EmbedPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  return <EmbedShell agentId={agentId} />
}
