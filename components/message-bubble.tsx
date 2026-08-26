'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  UserIcon,
  BotMessageSquareIcon,
  Edit01Icon,
  CheckIcon,
  CircleXIcon,
} from '@hugeicons/core-free-icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useState, type FormEvent } from 'react'
import type { ChatMessage } from '@/lib/types'
import Markdown from './markdown'
import StructuredResponse from './structured-response'
import SpeechButton from './speech-button'
import { parseStructuredResponse } from '@/lib/structured-output'

export default function MessageBubble({
  message,
  sessionId = null,
  editable = false,
  onEditSave,
}: {
  message: ChatMessage
  sessionId?: string | null
  /** Show an inline edit action for user messages (drives fork/branch UI). */
  editable?: boolean
  /** Called with the edited text when the user saves an edit. */
  onEditSave?: (next: string) => void
}) {
  const isUser = message.role === 'user'
  const reducedMotion = useReducedMotion()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(message.content)
    setEditing(true)
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault()
    const next = draft.trim()
    if (next === '') return
    onEditSave?.(next)
    setEditing(false)
  }

  if (isUser) {
    return (
      <motion.div
        className="group/user flex justify-end gap-2.5"
        initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="max-w-[80%]">
          <div
            className="flex items-center gap-1 rounded-2xl rounded-br-md px-4 py-2.5 text-[13.5px] leading-relaxed text-[var(--text-primary)]"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
            }}
          >
            <span className="whitespace-pre-wrap">{message.content}</span>
            {editable && !editing && (
              <button
                type="button"
                onClick={startEdit}
                aria-label="Edit prompt"
                className="shrink-0 rounded-md p-1 text-[var(--text-muted)] opacity-0 transition-all hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover/user:opacity-100"
              >
                <HugeiconsIcon icon={Edit01Icon} size={13} strokeWidth={1.5} />
              </button>
            )}
          </div>
          {editing && (
            <form
              onSubmit={submitEdit}
              className="mt-1.5 flex items-center gap-1.5 rounded-xl px-3 py-2"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
            >
              <textarea
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={Math.min(6, Math.max(2, draft.split('\n').length))}
                maxLength={4000}
                aria-label="Edit prompt text"
                className="flex-1 resize-none bg-transparent text-sm text-[var(--text-primary)] outline-none"
              />
              <button
                type="submit"
                aria-label="Save edit"
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-emerald-500 transition-colors hover:bg-emerald-500/10"
              >
                <HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                aria-label="Cancel edit"
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
              >
                <HugeiconsIcon icon={CircleXIcon} size={14} strokeWidth={1.5} />
              </button>
            </form>
          )}
        </div>
        <div
          className="flex size-7 shrink-0 items-center justify-center rounded-full"
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <HugeiconsIcon
            icon={UserIcon}
            size={13}
            strokeWidth={1.5}
            className="text-[var(--text-secondary)]"
          />
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      className="flex justify-start gap-2.5"
      initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20"
        style={{ boxShadow: '0 2px 10px rgba(16,185,129,0.3)' }}
      >
        <HugeiconsIcon
          icon={BotMessageSquareIcon}
          size={13}
          strokeWidth={1.5}
          className="text-emerald-400"
        />
      </div>
      <div className="group flex max-w-[80%] items-end gap-1">
        <div
          aria-live="polite"
          className="min-w-0 break-words rounded-2xl rounded-bl-md px-4 py-2.5 text-[13.5px] leading-relaxed text-[var(--text-primary)]"
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          {message.content === '' ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
              <span
                className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400"
                style={{ animationDelay: '0.15s' }}
              />
              <span
                className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400"
                style={{ animationDelay: '0.3s' }}
              />
            </span>
          ) : parseStructuredResponse(message.content) ? (
            <StructuredResponse content={message.content} sessionId={sessionId} />
          ) : (
            <Markdown content={message.content} sessionId={sessionId} />
          )}
        </div>
        {message.content !== '' && <SpeechButton text={message.content} />}
      </div>
    </motion.div>
  )
}
