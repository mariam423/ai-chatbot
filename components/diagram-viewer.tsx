'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, MinusIcon, PlusIcon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

const MIN_SCALE = 1
const MAX_SCALE = 8
const ZOOM_STEP = 1.25

interface DiagramViewerProps {
  src: string
  alt?: string
  onClose: () => void
}

/**
 * Full-screen diagram viewer. Dark glassmorphic overlay, wheel/button/double
 * click zoom, drag-to-pan with clamping, Escape/backdrop/X to close, and focus
 * restore to the trigger. `prefers-reduced-motion` skips the entrance motion.
 */
export default function DiagramViewer({ src, alt, onClose }: DiagramViewerProps) {
  const reducedMotion = useReducedMotion()
  const stageRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dragOrigin = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)
  // Only closes on a backdrop press-and-release. The click that opens the
  // viewer can otherwise finish against the freshly mounted backdrop (its
  // trailing touch→mouse events land on the overlay) and immediately close it
  // — this is especially visible under touch emulation. Events inside the
  // mount window are ignored so the opening click can never close the viewer.
  const backdropPress = useRef(false)
  const ignoreBackdropUntil = useRef(0)

  // Raw motion values drive the transform; springs give the pan/zoom motion a
  // physical, settled feel. Reads for clamping use the raw values (no lag).
  const xRaw = useMotionValue(0)
  const yRaw = useMotionValue(0)
  const x = useSpring(xRaw, { stiffness: 420, damping: 34 })
  const y = useSpring(yRaw, { stiffness: 420, damping: 34 })
  const scale = useMotionValue(1)
  const [zoom, setZoom] = useState(1)

  // Lock body scroll while the viewer is open.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // Wheel zoom (non-passive so the page behind never scrolls) + Escape to close.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      applyZoom(scale.get() * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    closeButtonRef.current?.focus()
    // Ignore the opening click's trailing touch→mouse events on the backdrop.
    ignoreBackdropUntil.current = Date.now() + 350
    return () => {
      stage.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Clamp pan so the diagram edges can't leave the stage once zoomed. */
  function clampPan(currentScale: number) {
    const stage = stageRef.current
    if (!stage) return
    const maxX = Math.max(0, (stage.clientWidth * (currentScale - 1)) / 2)
    const maxY = Math.max(0, (stage.clientHeight * (currentScale - 1)) / 2)
    const nextX = Math.min(maxX, Math.max(-maxX, xRaw.get()))
    const nextY = Math.min(maxY, Math.max(-maxY, yRaw.get()))
    xRaw.set(nextX)
    yRaw.set(nextY)
  }

  function applyZoom(next: number) {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
    scale.set(clamped)
    setZoom(clamped)
    clampPan(clamped)
  }

  function reset() {
    xRaw.set(0)
    yRaw.set(0)
    scale.set(1)
    setZoom(1)
  }

  function handlePointerDown(event: React.PointerEvent) {
    dragOrigin.current = {
      startX: event.clientX,
      startY: event.clientY,
      x: xRaw.get(),
      y: yRaw.get(),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent) {
    const origin = dragOrigin.current
    if (!origin) return
    xRaw.set(origin.x + event.clientX - origin.startX)
    yRaw.set(origin.y + event.clientY - origin.startY)
    clampPan(scale.get())
  }

  function handlePointerUp() {
    dragOrigin.current = null
  }

  function handleDoubleClick() {
    applyZoom(zoom === 1 ? 2 : 1)
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Diagram viewer${alt ? ` — ${alt}` : ''}`}
      style={{
        background: 'rgba(7, 11, 18, 0.72)',
        backdropFilter: 'blur(28px) saturate(140%)',
        WebkitBackdropFilter: 'blur(28px) saturate(140%)',
      }}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reducedMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(event) => {
        backdropPress.current =
          event.target === event.currentTarget && Date.now() >= ignoreBackdropUntil.current
      }}
      onPointerUp={(event) => {
        const pressedOnBackdrop = backdropPress.current
        backdropPress.current = false
        if (pressedOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      {/* Use a short tween so controls become actionable immediately after
          the dialog appears; a long spring can look perpetually unstable to
          Chromium's actionability checks. */}
      <motion.div
        className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl"
        style={{
          background: 'rgba(15, 21, 30, 0.72)',
          backdropFilter: 'blur(32px) saturate(160%)',
          WebkitBackdropFilter: 'blur(32px) saturate(160%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow:
            '0 24px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.03) inset, 0 0 60px rgba(6, 182, 212, 0.08)',
        }}
        initial={reducedMotion ? false : { opacity: 0, scale: 0.98, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reducedMotion ? undefined : { opacity: 0, scale: 0.98, y: 8 }}
        transition={reducedMotion ? undefined : { duration: 0.18, ease: 'easeOut' }}
      >
        {/* Header: title + zoom controls */}
        <div
          className="flex items-center justify-between gap-3 px-3 py-2.5"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-[var(--text-secondary)]">
              {alt || 'Diagram'}
            </span>
            <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-tertiary)]">
              {Math.round(zoom * 100)}%
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => applyZoom(zoom / ZOOM_STEP)}
              aria-label="Zoom out"
              className="flex size-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
            >
              <HugeiconsIcon icon={MinusIcon} size={16} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => applyZoom(zoom * ZOOM_STEP)}
              aria-label="Zoom in"
              className="flex size-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
            >
              <HugeiconsIcon icon={PlusIcon} size={16} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={reset}
              aria-label="Reset zoom"
              className="flex size-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
            >
              <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.5} />
            </button>
            <div className="mx-1 h-4 w-px" style={{ background: 'rgba(255, 255, 255, 0.08)' }} />
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close diagram viewer"
              className="flex size-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-red-500/15 hover:text-red-400"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Stage: pan + zoom area */}
        <div
          ref={stageRef}
          className="relative flex flex-1 cursor-grab touch-none items-center justify-center overflow-hidden select-none active:cursor-grabbing"
          style={{ background: 'rgba(3, 6, 11, 0.5)' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          <motion.img
            src={src}
            alt={alt ?? 'Rendered diagram'}
            draggable={false}
            style={{ x, y, scale, maxWidth: '92%', maxHeight: '88%' }}
            className="h-auto w-auto rounded-md shadow-[0_12px_48px_rgba(0,0,0,0.45)]"
          />
          <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-medium text-white/60 backdrop-blur-sm">
            Scroll to zoom · drag to pan · double-click to fit
          </span>
        </div>
      </motion.div>
    </motion.div>
  )
}
