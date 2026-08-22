'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { UserIcon, BotMessageSquareIcon } from '@hugeicons/core-free-icons'
import { motion, useReducedMotion } from 'framer-motion'
import type { ChatMessage } from '@/lib/types'
import Markdown from './markdown'
import StructuredResponse from './structured-response'
import { parseStructuredResponse } from '@/lib/structured-output'

export default function MessageBubble({
  message,
  sessionId = null,
}: {
  message: ChatMessage
  sessionId?: string | null
}) {
  const isUser = message.role === 'user'
  const reducedMotion = useReducedMotion()

  if (isUser) {
    return (
      <motion.div
        className="flex justify-end gap-2.5"
        initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          className="max-w-[80%] break-words rounded-2xl rounded-br-md px-4 py-2.5 text-[13.5px] leading-relaxed text-[var(--text-primary)]"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          <span className="whitespace-pre-wrap">{message.content}</span>
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
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cyan-500/10 border border-cyan-500/20"
        style={{ boxShadow: '0 2px 10px rgba(6,182,212,0.3)' }}
      >
        <HugeiconsIcon
          icon={BotMessageSquareIcon}
          size={13}
          strokeWidth={1.5}
          className="text-cyan-400"
        />
      </div>
      <div
        aria-live="polite"
        className="max-w-[80%] break-words rounded-2xl rounded-bl-md px-4 py-2.5 text-[13.5px] leading-relaxed text-[var(--text-primary)]"
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
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-cyan-400" />
            <span
              className="inline-block size-1.5 animate-pulse rounded-full bg-cyan-400"
              style={{ animationDelay: '0.15s' }}
            />
            <span
              className="inline-block size-1.5 animate-pulse rounded-full bg-cyan-400"
              style={{ animationDelay: '0.3s' }}
            />
          </span>
        ) : parseStructuredResponse(message.content) ? (
          <StructuredResponse content={message.content} sessionId={sessionId} />
        ) : (
          <Markdown content={message.content} sessionId={sessionId} />
        )}
      </div>
    </motion.div>
  )
}
