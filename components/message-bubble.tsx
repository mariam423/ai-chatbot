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
        <div className="max-w-[80%] break-words rounded-2xl rounded-br-md bg-gradient-to-br from-zinc-800 to-zinc-900 px-4 py-2.5 text-[13.5px] leading-relaxed text-zinc-100 shadow-[0_2px_8px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.06)] dark:from-zinc-800 dark:to-zinc-900 dark:text-zinc-100 dark:shadow-[0_2px_12px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <span className="whitespace-pre-wrap">{message.content}</span>
        </div>
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700">
          <HugeiconsIcon
            icon={UserIcon}
            size={14}
            strokeWidth={1.5}
            className="text-zinc-600 dark:text-zinc-300"
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
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_2px_8px_rgba(124,58,237,0.25)]">
        <HugeiconsIcon
          icon={BotMessageSquareIcon}
          size={14}
          strokeWidth={1.5}
          className="text-white"
        />
      </div>
      <div
        aria-live="polite"
        className="max-w-[80%] break-words rounded-2xl rounded-bl-md border border-zinc-200/80 bg-white px-4 py-2.5 text-[13.5px] leading-relaxed text-zinc-900 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-zinc-800/80 dark:bg-zinc-900/80 dark:text-zinc-100 dark:shadow-[0_1px_3px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.03)]"
      >
        {message.content === '' ? (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-zinc-400 dark:bg-zinc-500" />
            <span
              className="inline-block size-1.5 animate-pulse rounded-full bg-zinc-400 dark:bg-zinc-500"
              style={{ animationDelay: '0.15s' }}
            />
            <span
              className="inline-block size-1.5 animate-pulse rounded-full bg-zinc-400 dark:bg-zinc-500"
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
