'use client'

import { motion, useReducedMotion } from 'framer-motion'

/**
 * Slick glowing "Generating response…" badge shown while the assistant reply
 * is pending/streaming. Rendered inside the message stream below the dynamic
 * response block; it springs in when `isStreaming` flips true and fades/scales
 * out cleanly when the stream completes or errors (the parent wraps it in
 * AnimatePresence so the exit animation plays before unmount).
 *
 * Design system: Cyber Emerald glass pill — emerald ring spinner with a soft
 * glow, `--accent-*` tokens for the border/tint, reduced-motion aware.
 */
export default function LoadingBadge() {
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      role="status"
      initial={reducedMotion ? false : { opacity: 0, y: 6, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.95 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      // ml-10 aligns the badge with the assistant bubble column (avatar + gap).
      className="ml-10 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-[var(--text-secondary)]"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--accent-medium)',
        boxShadow:
          '0 0 20px rgba(16,185,129,0.22), 0 2px 10px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {/* Glowing emerald ring spinner */}
      <span
        aria-hidden
        className="size-3.5 animate-spin rounded-full border-2"
        style={{
          borderColor: 'var(--accent-medium)',
          borderTopColor: '#10b981',
          boxShadow: '0 0 8px rgba(16,185,129,0.6)',
        }}
      />
      <span>Generating response…</span>
    </motion.div>
  )
}
