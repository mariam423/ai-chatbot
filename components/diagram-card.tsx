'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckIcon,
  CopyIcon,
  Download01Icon,
  CodeIcon,
  Maximize01Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { decodeSvgDataUrl, svgFilename } from '@/lib/svg-data-url'
import DiagramViewer from './diagram-viewer'

interface DiagramCardProps {
  /** An SVG data URL (`data:image/svg+xml;base64,…`). */
  src: string
  alt?: string
}

/** Spring-powered shimmer: a gradient sweep on a recessive skeleton surface. */
function DiagramSkeleton({ reducedMotion }: { reducedMotion: boolean | null }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg"
      style={{
        height: 240,
        background: 'var(--skeleton-bg)',
      }}
      aria-hidden="true"
    >
      {!reducedMotion && (
        <motion.span
          className="absolute inset-y-0 w-1/2"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, var(--skeleton-shimmer) 50%, transparent 100%)',
          }}
          initial={{ x: '-150%' }}
          animate={{ x: '150%' }}
          transition={{ type: 'spring', stiffness: 40, damping: 18, repeat: Infinity }}
        />
      )}
    </div>
  )
}

/**
 * Renders a provider-rendered SVG diagram (e.g. from the `diagram_render`
 * skill tool, embedded as a Markdown image). Shows a spring-animated skeleton
 * while the SVG loads, fades the image in over it, and offers Copy-SVG,
 * Download, and a full-screen pan/zoom viewer. The SVG is displayed via an
 * `<img>` tag — data URLs loaded this way cannot execute scripts, so the card
 * never injects raw markup.
 */
export default function DiagramCard({ src, alt }: DiagramCardProps) {
  const reducedMotion = useReducedMotion()
  const svgMarkup = useMemo(() => decodeSvgDataUrl(src), [src])
  const [copied, setCopied] = useState(false)
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [viewerOpen, setViewerOpen] = useState(false)
  const viewButtonRef = useRef<HTMLButtonElement>(null)

  async function copy() {
    if (svgMarkup === null) return
    try {
      await navigator.clipboard.writeText(svgMarkup)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable
    }
  }

  function download() {
    if (svgMarkup === null) return
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = svgFilename(alt)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function closeViewer() {
    // Focus the trigger before AnimatePresence starts the exit animation so
    // Escape and backdrop closes have a deterministic focus target.
    viewButtonRef.current?.focus()
    setViewerOpen(false)
  }

  // Defensive: non-SVG or undecodable sources render as a plain image.
  if (svgMarkup === null) {
    return <img src={src} alt={alt ?? 'Diagram'} />
  }

  return (
    <figure
      data-testid="diagram-card"
      className="diagram-card my-3 overflow-hidden rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.1)]"
      style={{ border: '1px solid var(--border-subtle)' }}
    >
      <figcaption
        className="flex items-center justify-between px-3 py-2"
        style={{ background: 'var(--bg-card)' }}
      >
        <div className="flex items-center gap-1.5">
          <HugeiconsIcon
            icon={CodeIcon}
            size={12}
            strokeWidth={1.5}
            className="text-[var(--text-muted)]"
          />
          <span className="font-mono text-[11px] font-medium text-[var(--text-muted)]">SVG</span>
        </div>
        <div className="flex items-center gap-1">
          <motion.button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? 'SVG copied' : 'Copy SVG'}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.div
                  key="check"
                  initial={{ scale: 0, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                  className="flex items-center gap-1"
                >
                  <HugeiconsIcon
                    icon={CheckIcon}
                    size={12}
                    strokeWidth={2}
                    className="text-emerald-400"
                  />
                  <span className="text-emerald-400">Copied</span>
                </motion.div>
              ) : (
                <motion.div
                  key="copy"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                  className="flex items-center gap-1"
                >
                  <HugeiconsIcon icon={CopyIcon} size={12} strokeWidth={1.5} />
                  <span>Copy SVG</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
          <motion.button
            type="button"
            onClick={download}
            aria-label="Download SVG"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
          >
            <HugeiconsIcon icon={Download01Icon} size={12} strokeWidth={1.5} />
            <span>Download</span>
          </motion.button>
          <motion.button
            ref={viewButtonRef}
            type="button"
            onClick={() => setViewerOpen(true)}
            aria-label="View full screen"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
          >
            <HugeiconsIcon icon={Maximize01Icon} size={12} strokeWidth={1.5} />
            <span>View</span>
          </motion.button>
        </div>
      </figcaption>
      <div
        className="flex max-h-[480px] min-h-16 items-center justify-center overflow-auto bg-white p-3"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        {/* The skeleton holds the card's height while the SVG decodes/loads;
            the image fades in over it with a spring the moment it is ready. */}
        {imageState !== 'ready' && (
          <div className="w-full">
            <DiagramSkeleton reducedMotion={reducedMotion} />
            {imageState === 'error' && (
              <p className="mt-2 text-center text-xs text-[var(--text-muted)]">
                Diagram failed to render.
              </p>
            )}
          </div>
        )}
        <motion.img
          src={src}
          alt={alt ?? 'Rendered diagram'}
          className="h-auto max-w-full"
          initial={reducedMotion ? false : { opacity: 0, scale: 0.99 }}
          animate={{ opacity: imageState === 'ready' ? 1 : 0, scale: 1 }}
          transition={reducedMotion ? undefined : { type: 'spring', stiffness: 260, damping: 26 }}
          onLoad={() => setImageState('ready')}
          onError={() => setImageState('error')}
        />
      </div>

      {/* Rendered through a portal: .vt-chat-shell sets view-transition-name,
          which makes <main> a containing block for fixed descendants, so a
          plain fixed overlay would be trapped inside the chat area and never
          cover the sidebar. Portaling to <body> keeps the viewer truly
          full-screen; AnimatePresence stays mounted inside the portal so the
          exit animation still plays (React tree, not DOM, drives it). */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {viewerOpen && <DiagramViewer src={src} alt={alt} onClose={closeViewer} />}
          </AnimatePresence>,
          document.body,
        )}
    </figure>
  )
}
