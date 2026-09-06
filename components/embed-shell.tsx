'use client'

import { useEffect, useState } from 'react'
import EmbedChat from './embed-chat'

interface EmbedShellProps {
  agentId: string
}

type EmbedState =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'not-found' }
  | { status: 'ready'; token: string; name: string }

function readHashParams(hash: string): { token: string; origin: string } {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return {
    token: params.get('token') || '',
    origin: params.get('origin') || '',
  }
}

/**
 * Client shell for the embed page. The signed token arrives in the URL
 * fragment (`#token=…&origin=…`), never in the query string — so it doesn't
 * reach server access logs or Referer headers. On mount the fragment is read,
 * immediately scrubbed from the address bar, and the token is verified against
 * `/api/embed/agent` before the real chat surface mounts. Provider credentials
 * never reach this code.
 */
export default function EmbedShell({ agentId }: EmbedShellProps) {
  const [state, setState] = useState<EmbedState>({ status: 'loading' })

  useEffect(() => {
    const { token } = readHashParams(window.location.hash)
    // Scrub the token from the visible URL so it doesn't linger in browser
    // history or the address bar beyond this instant.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    let cancelled = false
    if (!token) {
      // Defer so the update happens outside the synchronous effect body.
      queueMicrotask(() => {
        if (!cancelled) setState({ status: 'invalid' })
      })
      return () => {
        cancelled = true
      }
    }
    void (async () => {
      try {
        const parentOrigin = document.referrer ? new URL(document.referrer).origin : null
        const response = await fetch(`/api/embed/agent?agentId=${encodeURIComponent(agentId)}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(parentOrigin ? { 'X-Embed-Parent-Origin': parentOrigin } : {}),
          },
        })
        if (!response.ok) {
          setState(response.status === 404 ? { status: 'not-found' } : { status: 'invalid' })
          return
        }
        const body = (await response.json()) as { name?: string }
        if (!cancelled && body.name) setState({ status: 'ready', token, name: body.name })
        else if (!cancelled) setState({ status: 'invalid' })
      } catch {
        if (!cancelled) setState({ status: 'invalid' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [agentId])

  if (state.status === 'ready') {
    return <EmbedChat agentId={agentId} token={state.token} assistantName={state.name} />
  }
  if (state.status === 'loading') {
    return (
      <main className="flex h-dvh items-center justify-center bg-[#0a0f0d] p-6 text-center text-white">
        <p className="text-sm text-white/50">Loading…</p>
      </main>
    )
  }
  return (
    <main className="flex h-dvh items-center justify-center bg-[#0a0f0d] p-6 text-center text-white">
      <p className="text-sm text-white/70">
        {state.status === 'not-found'
          ? 'Assistant not found.'
          : 'This assistant embed link is invalid or expired.'}
      </p>
    </main>
  )
}
