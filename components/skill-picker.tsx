'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { RefreshIcon, Settings02Icon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SKILLS } from '@/lib/skills/registry'

interface SkillPickerProps {
  /** Explicit active list; null means "use defaults" (all skills). */
  enabledSkills: string[] | null
  onChange: (next: string[] | null) => void
}

const ALL_SKILL_IDS = SKILLS.map((skill) => skill.id)

// Approximate height of the menu — used to decide whether to flip
// upward. Slightly larger than the visible max-h (320px) to cover
// header + description + paddings.
const MENU_APPROX_HEIGHT = 400

export default function SkillPicker({ enabledSkills, onChange }: SkillPickerProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; placement: 'down' | 'up' }>(
    {
      top: 0,
      left: 0,
      placement: 'down',
    },
  )
  const buttonRef = useRef<HTMLButtonElement>(null)
  const reducedMotion = useReducedMotion()

  // Recompute the menu's viewport coordinates whenever it opens, when
  // the window resizes, or when the trigger moves (covers both the
  // initial open and subsequent window/scroll changes). useLayoutEffect
  // avoids a one-frame flash at the old position.
  const computePosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuWidth = 288 // w-72 = 18rem = 288px
    const margin = 8
    // Right-align the menu to the trigger (same as `right-0` in the
    // previous absolute layout).
    let left = rect.right - menuWidth
    if (left < margin) left = margin
    const spaceBelow = window.innerHeight - rect.bottom - margin
    if (spaceBelow >= MENU_APPROX_HEIGHT) {
      setPosition({ top: rect.bottom + margin, left, placement: 'down' })
    } else {
      // Flip upward: anchor the menu's bottom edge to just above the
      // trigger. `bottom` is computed from the viewport's top so the
      // fixed menu lands in the right spot.
      setPosition({ top: rect.top - margin, left, placement: 'up' })
    }
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    computePosition()
    const onResize = () => computePosition()
    const onScroll = () => computePosition()
    window.addEventListener('resize', onResize)
    // capture:true so the menu follows scrolling on any ancestor
    // (the chat messages container scrolls without bubbling to window).
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, computePosition])

  // Close on outside click or Escape while open. The handlers are
  // document-scoped, so they keep working even after the menu is
  // portalled out of its original DOM subtree.
  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      const target = event.target as Node
      // The trigger button lives in the original tree, the menu
      // lives in <body> via portal — accept clicks on either.
      if (buttonRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-skill-picker-menu]')) return
      setOpen(false)
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const customized = enabledSkills !== null
  const activeCount = customized ? enabledSkills!.length : SKILLS.length
  const isActive = (id: string) => enabledSkills === null || enabledSkills.includes(id)

  function toggleSkill(id: string) {
    if (enabledSkills === null) {
      // First customization starts from the default full catalog.
      onChange(ALL_SKILL_IDS.filter((skillId) => skillId !== id))
      return
    }
    onChange(
      enabledSkills.includes(id)
        ? enabledSkills.filter((skillId) => skillId !== id)
        : [...enabledSkills, id],
    )
  }

  const menu = open ? (
    <AnimatePresence>
      <motion.div
        key="skill-picker-menu"
        initial={{ opacity: 0, y: position.placement === 'up' ? 4 : -4, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: position.placement === 'up' ? 4 : -4, scale: 0.97 }}
        transition={{ duration: 0.12 }}
        role="menu"
        aria-label="Active skills"
        data-skill-picker-menu
        data-placement={position.placement}
        // position:fixed escapes the chat scroll container so the menu
        // never gets clipped by .overflow-y-auto ancestors. Right edge
        // aligns with the trigger (left is the right-aligned coord
        // computed above); top is set from the trigger rect.
        className="fixed z-50 w-72 overflow-hidden rounded-xl py-1"
        style={
          position.placement === 'down'
            ? { top: position.top, left: position.left }
            : // Flip: anchor the menu's bottom to the trigger's top.
              { bottom: window.innerHeight - position.top, left: position.left }
        }
        // Prevent the portal'd menu from causing layout shifts in the
        // original tree while the exit animation plays.
        ref={(node) => {
          if (node)
            node.style.transformOrigin = position.placement === 'up' ? 'bottom right' : 'top right'
        }}
        onAnimationStart={() => {
          /* keep framer happy */
        }}
      >
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <p className="text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase">
            Active skills
          </p>
          {customized && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
            >
              <HugeiconsIcon icon={RefreshIcon} size={11} strokeWidth={1.5} />
              Use all
            </button>
          )}
        </div>
        <p className="px-3 pt-2 pb-1 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
          Skills add domain guidance and tools to this conversation.
        </p>
        <div className="max-h-80 overflow-y-auto py-1">
          {SKILLS.map((skill) => {
            const active = isActive(skill.id)
            return (
              <button
                key={skill.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={active}
                onClick={() => toggleSkill(skill.id)}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-input)]"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors"
                  style={{
                    background: active
                      ? 'linear-gradient(135deg, #10b981, #0d9488)'
                      : 'var(--bg-input)',
                    border: '1px solid var(--border-medium)',
                  }}
                >
                  <span
                    className="size-2.5 rounded-full bg-white shadow-sm transition-transform"
                    style={{ transform: active ? 'translateX(12px)' : 'translateX(0)' }}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-[var(--text-primary)]">
                    {skill.name}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                    {skill.description}
                  </span>
                  {skill.toolNames.length > 0 && (
                    <span className="mt-0.5 block text-[10px] font-medium text-emerald-500/90">
                      {skill.toolNames.map((name) => `\`${name}\``).join(' · ')}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  ) : null

  return (
    <div className="relative">
      <motion.button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        whileHover={reducedMotion ? undefined : { scale: 1.05 }}
        whileTap={reducedMotion ? undefined : { scale: 0.95 }}
        aria-label="Toggle active skills"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors"
        style={{
          color: customized ? 'var(--text-secondary)' : 'var(--text-muted)',
          background: open ? 'var(--bg-input)' : 'transparent',
          border: open ? '1px solid var(--border-subtle)' : '1px solid transparent',
        }}
      >
        <HugeiconsIcon
          icon={Settings02Icon}
          size={15}
          strokeWidth={1.5}
          className={customized ? 'text-emerald-500' : ''}
        />
        <span className="hidden sm:inline">Skills</span>
        {customized && (
          <span
            className="rounded px-1 py-0.5 text-[10px] font-semibold text-emerald-500"
            style={{ background: 'var(--accent-soft)' }}
          >
            {activeCount}/{SKILLS.length}
          </span>
        )}
      </motion.button>

      {/* Portal the menu to <body> so it escapes any ancestor with
          overflow:auto/hidden/scroll (the chat's messages container
          has overflow-y-auto and was clipping the previous absolute
          menu). SSR-safe — portal only on the client. */}
      {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}
    </div>
  )
}
