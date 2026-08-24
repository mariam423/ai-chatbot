'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { RefreshIcon, Settings02Icon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { SKILLS } from '@/lib/skills/registry'

interface SkillPickerProps {
  /** Explicit active list; null means "use defaults" (all skills). */
  enabledSkills: string[] | null
  onChange: (next: string[] | null) => void
}

const ALL_SKILL_IDS = SKILLS.map((skill) => skill.id)

export default function SkillPicker({ enabledSkills, onChange }: SkillPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
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

  return (
    <div className="relative" ref={ref}>
      <motion.button
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

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            role="menu"
            aria-label="Active skills"
            className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl py-1"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
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
        )}
      </AnimatePresence>
    </div>
  )
}
