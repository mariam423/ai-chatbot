'use client'

import { useState } from 'react'
import { createCustomAgentEmbedToken } from '@/app/actions'

interface EmbedGeneratorProps {
  agentId: string
  assistantName: string
}

function appOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

/** Generate copyable iframe and script snippets without exposing provider credentials. */
export default function EmbedGenerator({ agentId, assistantName }: EmbedGeneratorProps) {
  const [origin, setOrigin] = useState('')
  const [snippet, setSnippet] = useState<{ iframe: string; script: string } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function generate() {
    if (loading) return
    setLoading(true)
    setStatus(null)
    const result = await createCustomAgentEmbedToken({ agentId, origin: origin || undefined })
    setLoading(false)
    if (!result.ok) {
      setStatus(result.error)
      return
    }
    const base = appOrigin()
    const url = `${base}/embed/${encodeURIComponent(agentId)}?token=${encodeURIComponent(result.token)}`
    const iframe = `<iframe src="${url}" title="${assistantName.replace(/"/g, '&quot;')}" width="100%" height="600" loading="lazy" style="border:0;border-radius:16px;overflow:hidden" allow="microphone"></iframe>`
    const script = `<script async src="${base}/embed-widget.js" data-agent-id="${agentId}" data-token="${result.token}" data-origin="${origin || '*'}"></script>`
    setSnippet({ iframe, script })
    setStatus(
      'Snippet generated. Keep it private: the signed token grants access to this assistant.',
    )
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('Copied to clipboard.')
    } catch {
      setStatus('Copy failed. Select the snippet and copy it manually.')
    }
  }

  return (
    <div className="space-y-3 rounded-xl p-3" style={{ background: 'var(--bg-input)' }}>
      <div>
        <p className="text-xs font-semibold text-[var(--text-secondary)]">Embed assistant</p>
        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
          Generate a signed, expiring widget link for an external site. Optionally restrict requests
          to one site origin.
        </p>
      </div>
      <div className="flex gap-2">
        <input
          aria-label={`Embed origin for ${assistantName}`}
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          placeholder="https://your-site.example (optional)"
          className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-medium)' }}
        />
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          className="shrink-0 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>
      {status && <p className="text-[11px] text-[var(--text-tertiary)]">{status}</p>}
      {snippet && (
        <div className="space-y-3">
          {(
            [
              ['iframe', snippet.iframe],
              ['script', snippet.script],
            ] as const
          ).map(([kind, value]) => (
            <div key={kind}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {kind} snippet
                </span>
                <button
                  type="button"
                  onClick={() => void copy(value)}
                  className="text-[11px] font-medium text-emerald-500"
                >
                  Copy
                </button>
              </div>
              <pre
                className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg p-2 text-[10px] text-[var(--text-secondary)]"
                style={{ background: 'var(--bg-card)' }}
              >
                {value}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
