'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { BotMessageSquareIcon } from '@hugeicons/core-free-icons'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * Pre-first-token loading state while the AI reply streams (per the
 * loading-states-and-perceived-performance skill: a skeleton that matches the
 * shape of the incoming content, subtle shimmer, aria-live announcement).
 */
export default function StreamingSkeleton() {
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      className="flex justify-start gap-2.5"
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      role="status"
      aria-label="Assistant is typing"
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_2px_8px_rgba(124,58,237,0.25)]">
        <HugeiconsIcon
          icon={BotMessageSquareIcon}
          size={14}
          strokeWidth={1.5}
          className="text-white"
        />
      </div>
      <div className="w-2/3 min-w-40 rounded-2xl rounded-bl-md border border-zinc-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:border-zinc-800/80 dark:bg-zinc-900/80 dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
        <div className="space-y-2.5">
          <div className="skeleton-bar h-3 w-4/5" />
          <div className="skeleton-bar h-3 w-3/5" />
          <div className="skeleton-bar h-3 w-full" />
          <div className="skeleton-bar h-3 w-2/5" />
        </div>
      </div>
      <span className="sr-only">Assistant is typing</span>
    </motion.div>
  )
}
