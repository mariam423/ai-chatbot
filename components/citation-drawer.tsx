'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface CitationDrawerProps {
  sessionId: string | null
  documentName: string
  section: string
}

interface CitationPayload {
  section: number
  content: string
  document: {
    id: string
    name: string
    mimeType: string
    size: number
    createdAt: string
  }
}

/** Citation badge plus a lightweight right-side source drawer. */
export default function CitationDrawer({ sessionId, documentName, section }: CitationDrawerProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [citation, setCitation] = useState<CitationPayload | null>(null)

  async function openCitation() {
    if (!sessionId) return
    setOpen(true)
    setError(null)
    if (citation) return
    setLoading(true)
    try {
      const query = new URLSearchParams({ sessionId, documentName, section })
      const response = await fetch(`/api/citation?${query.toString()}`)
      const payload: unknown = await response.json()
      if (!response.ok || typeof payload !== 'object' || payload === null) {
        throw new Error('Citation could not be loaded.')
      }
      setCitation(payload as CitationPayload)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Citation could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void openCitation()}
        disabled={!sessionId}
        className="rounded-md px-1 py-0.5 text-left font-medium text-emerald-500 underline decoration-emerald-500/40 underline-offset-2 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400 disabled:cursor-default disabled:no-underline"
        aria-label={`Open source ${documentName}, section ${section}`}
      >
        [Document: {documentName}, section {section}]
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              aria-label="Close citation drawer"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default bg-black/20 backdrop-blur-[1px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label={`Source ${documentName}, section ${section}`}
              className="fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-md flex-col border-l p-5 shadow-2xl"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold tracking-widest text-emerald-500 uppercase">
                    Source excerpt
                  </p>
                  <h2 className="mt-1 truncate text-base font-semibold text-[var(--text-primary)]">
                    {documentName}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">Section {section}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close citation drawer"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)]"
                >
                  ×
                </button>
              </div>

              <div
                className="mt-5 min-h-0 flex-1 overflow-y-auto rounded-xl p-4 text-sm leading-relaxed text-[var(--text-secondary)]"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
              >
                {loading && <p aria-live="polite">Loading source excerpt…</p>}
                {error && (
                  <p role="alert" className="text-[var(--error-text)]">
                    {error}
                  </p>
                )}
                {citation && <p className="whitespace-pre-wrap">{citation.content}</p>}
              </div>

              {citation && (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-[var(--text-tertiary)]">File type</dt>
                    <dd className="mt-1 text-[var(--text-secondary)]">
                      {citation.document.mimeType}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-tertiary)]">File size</dt>
                    <dd className="mt-1 text-[var(--text-secondary)]">
                      {Math.max(1, Math.round(citation.document.size / 1024))} KB
                    </dd>
                  </div>
                </dl>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
