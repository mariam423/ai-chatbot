'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { UserIcon, BotMessageSquareIcon } from '@hugeicons/core-free-icons'
import { motion, useReducedMotion } from 'framer-motion'
import type { ChatMessage } from '@/lib/types'
import Markdown from './markdown'

export default function MessageBubble({ message }: { message: ChatMessage }) {
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
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600"
        style={{ boxShadow: '0 2px 10px rgba(139,92,246,0.3)' }}
      >
        <HugeiconsIcon
          icon={BotMessageSquareIcon}
          size={13}
          strokeWidth={1.5}
          className="text-white"
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
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-violet-400" />
            <span
              className="inline-block size-1.5 animate-pulse rounded-full bg-violet-400"
              style={{ animationDelay: '0.15s' }}
            />
            <span
              className="inline-block size-1.5 animate-pulse rounded-full bg-violet-400"
              style={{ animationDelay: '0.3s' }}
            />
          </span>
        ) : (
          <Markdown content={message.content} />
        )}
      </div>
    </motion.div>
  )
}
