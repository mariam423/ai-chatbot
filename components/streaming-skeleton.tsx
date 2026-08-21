'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { BotMessageSquareIcon } from '@hugeicons/core-free-icons'
import { motion, useReducedMotion } from 'framer-motion'

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
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-indigo-600"
        style={{ boxShadow: '0 2px 10px rgba(6,182,212),0.3)' }}
      >
        <HugeiconsIcon
          icon={BotMessageSquareIcon}
          size={13}
          strokeWidth={1.5}
          className="text-white"
        />
      </div>
      <div
        className="w-2/3 min-w-40 rounded-2xl rounded-bl-md p-4"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}
      >
        <div className="space-y-2.5">
          <div className="skeleton-bar h-3 w-4/5" />
          <div className="skeleton-bar h-3 w-3/5" />
          <div className="skeleton-bar h-3 w-full" />
          <div className="skeleton-bar h-3 w-2/5" />
        </div>
        {/* Streaming pulse bar */}
        <div className="mt-3 flex items-center gap-2">
          <div className="streaming-pulse-bar flex-1" />
        </div>
      </div>
      <span className="sr-only">Assistant is typing</span>
    </motion.div>
  )
}
