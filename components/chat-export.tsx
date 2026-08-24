'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Download01Icon, FileExportIcon, Pdf01Icon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { chatToJson, chatToMarkdown, EXPORT_DEFAULT_TITLE, exportFileName } from '@/lib/export-chat'
import { EVENTS, useAnalytics } from '@/lib/use-analytics'
import type { ChatMessage } from '@/lib/types'

interface ChatExportProps {
  messages: ChatMessage[]
  title?: string
  disabled?: boolean
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const roleLabel: Record<ChatMessage['role'], string> = {
  user: 'You',
  assistant: 'Assistant',
}

/**
 * Render each message's content as pre-wrapped text inside role-titled blocks
 * so the print output is a clean, self-contained transcript. The LLM markdown
 * is shown as-is (plain), matching the conversational intent of a PDF dump.
 */
function buildPrintHtml(messages: ChatMessage[], title: string): string {
  const body = messages
    .map((message) => {
      const label = roleLabel[message.role] ?? message.role
      const side = message.role === 'user' ? 'right' : 'left'
      const roleColor = message.role === 'user' ? '#0e7490' : '#0b7285'
      return `
        <section class="turn ${side}">
          <div class="role" style="color:${roleColor}">${label}</div>
          <pre>${escapeHtml(message.content)}</pre>
        </section>`
    })
    .join('\n')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { margin: 2rem; }
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial,
          sans-serif;
        color: #1f2937;
        margin: 0;
        padding: 0;
      }
      header h1 { font-size: 1.5rem; margin: 0 0 0.25rem; color: #111827; }
      header .meta { font-size: 0.75rem; color: #6b7280; margin-bottom: 1.5rem; }
      .turn { margin-bottom: 1rem; }
      .turn.right { text-align: right; }
      .turn.right pre { margin-left: auto; background: #f3f4f6; }
      .turn .role { font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.05em; margin-bottom: 0.25rem; }
      .turn pre {
        display: inline-block; max-width: 85%; text-align: left; white-space: pre-wrap;
        word-break: break-word; background: #ffffff; border: 1px solid #e5e7eb;
        border-radius: 0.75rem; padding: 0.75rem 1rem; margin: 0;
        font-family: inherit; font-size: 0.875rem; line-height: 1.55;
      }
      .turn.left pre { background: #ecfeff; border-color: #cffafe; }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">Exported ${escapeHtml(new Date().toLocaleString())} · ${
        messages.length
      } messages</div>
    </header>
    ${body}
  </body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default function ChatExport({ messages, title, disabled = false }: ChatExportProps) {
  const { track } = useAnalytics()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const exportTitle = title?.trim() || EXPORT_DEFAULT_TITLE

  function handleMarkdown() {
    const blob = new Blob([chatToMarkdown(messages, exportTitle)], {
      type: 'text/markdown;charset=utf-8',
    })
    downloadBlob(blob, exportFileName(exportTitle, 'md'))
    track(EVENTS.exportChat, { format: 'markdown' })
  }

  function handleJson() {
    const blob = new Blob([chatToJson(messages, exportTitle)], {
      type: 'application/json;charset=utf-8',
    })
    downloadBlob(blob, exportFileName(exportTitle, 'json'))
    track(EVENTS.exportChat, { format: 'json' })
  }

  function handlePdf() {
    const frame = iframeRef.current
    if (!frame) return
    frame.srcdoc = buildPrintHtml(messages, exportTitle)
    // The print dialog drives the browser's native Save-as-PDF flow.
    requestAnimationFrame(() => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    })
    track(EVENTS.exportChat, { format: 'pdf' })
  }

  const hasMessages = messages.length > 0

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <motion.button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled || !hasMessages}
        aria-label="Export chat"
        aria-expanded={open}
        aria-haspopup="menu"
        whileHover={reducedMotion ? undefined : { scale: 1.05 }}
        whileTap={reducedMotion ? undefined : { scale: 0.95 }}
        className="shrink-0 rounded-xl p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        <HugeiconsIcon icon={Download01Icon} size={18} strokeWidth={1.5} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            role="menu"
            aria-label="Export chat"
            className="absolute bottom-full left-0 z-50 mb-2 w-52 overflow-hidden rounded-xl py-1"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
            }}
          >
            <p className="px-3 py-1.5 text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase">
              Export
            </p>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                handleMarkdown()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-input)]"
            >
              <HugeiconsIcon icon={FileExportIcon} size={15} strokeWidth={1.5} />
              <span>Markdown (.md)</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                handleJson()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-input)]"
            >
              <HugeiconsIcon icon={FileExportIcon} size={15} strokeWidth={1.5} />
              <span>JSON (.json)</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                handlePdf()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-input)]"
            >
              <HugeiconsIcon icon={Pdf01Icon} size={15} strokeWidth={1.5} />
              <span>PDF (print)</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden frame used only for the Print → Save-as-PDF flow. */}
      <iframe ref={iframeRef} title="Export preview" className="hidden" aria-hidden="true" />
    </div>
  )
}
