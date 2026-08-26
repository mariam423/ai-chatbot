'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, PaperclipIcon } from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { UploadedDocumentSchema, type UploadedDocument } from '@/lib/types'

interface FileUploadProps {
  sessionId: string | null
  onSessionRequired: () => Promise<string | null>
  documents: UploadedDocument[]
  onDocumentsChange: (documents: UploadedDocument[]) => void
  children: ReactNode
  disabled?: boolean
}

const ACCEPT = '.pdf,.txt,.md,.csv,.xlsx,.docx,application/pdf,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export default function FileUpload({
  sessionId,
  onSessionRequired,
  documents,
  onDocumentsChange,
  children,
  disabled = false,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setError(null)
    setBusy(true)
    try {
      const activeSessionId = sessionId ?? (await onSessionRequired())
      if (!activeSessionId) throw new Error('Could not create a chat session.')
      const body = new FormData()
      body.set('sessionId', activeSessionId)
      body.set('file', file)
      const response = await fetch('/api/upload', { method: 'POST', body })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? String(payload.error)
            : 'Could not upload the document.'
        throw new Error(message)
      }
      const parsed = UploadedDocumentSchema.safeParse(
        typeof payload === 'object' && payload !== null && 'document' in payload
          ? payload.document
          : null,
      )
      if (!parsed.success) throw new Error('The server returned invalid document metadata.')
      onDocumentsChange([...documents, parsed.data])
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : 'Could not upload the document.',
      )
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(document: UploadedDocument) {
    if (!sessionId || busy) return
    setError(null)
    setBusy(true)
    try {
      const response = await fetch('/api/upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, documentId: document.id }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? 'Could not remove the document.')
      }
      onDocumentsChange(documents.filter((item) => item.id !== document.id))
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : 'Could not remove the document.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-w-0 flex-1">
      {documents.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5" aria-label="Attached documents">
          {documents.map((document) => (
            <div
              key={document.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)]"
              style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-medium)' }}
            >
              <span className="max-w-44 truncate" title={document.name}>
                {document.name}
              </span>
              <button
                type="button"
                onClick={() => void remove(document)}
                disabled={disabled || busy}
                aria-label={`Remove ${document.name}`}
                className="flex size-4 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.5} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex min-w-0 items-end gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          aria-label="Attach document"
          title="Attach PDF, TXT, MD, CSV, XLSX, or DOCX"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <HugeiconsIcon icon={PaperclipIcon} size={18} strokeWidth={1.5} />
        </button>
        <div className="flex min-w-0 flex-1 items-end gap-2">{children}</div>
        {(busy || error) && (
          <p
            role={error ? 'alert' : undefined}
            className="max-w-40 truncate text-xs text-[var(--error-text)]"
          >
            {error ?? 'Processing...'}
          </p>
        )}
      </div>
    </div>
  )
}
