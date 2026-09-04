'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon, ChatIcon, PinIcon, Archive01Icon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatSessionSummary } from '@/lib/types'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  sessions: ChatSessionSummary[]
  activeSessionId: string | null
  theme: 'light' | 'dark'
  onSelectSession: (id: string) => void
  onNewChat: () => void
  onToggleTheme: () => void
  onOpenSettings: () => void
}

interface PaletteAction {
  id: string
  label: string
  description?: string
  section: string
  shortcut?: string
  perform: () => void
}

export default function CommandPalette({
  open,
  onClose,
  sessions,
  activeSessionId,
  theme,
  onSelectSession,
  onNewChat,
  onToggleTheme,
  onOpenSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

  // Build action list
  const actions: PaletteAction[] = [
    {
      id: 'new-chat',
      label: 'New Chat',
      description: 'Start a fresh conversation',
      section: 'Actions',
      shortcut: '⌘N',
      perform: () => {
        onNewChat()
        onClose()
      },
    },
    {
      id: 'toggle-theme',
      label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
      description: 'Toggle the app theme',
      section: 'Actions',
      shortcut: '⌘.',
      perform: () => {
        onToggleTheme()
        onClose()
      },
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      description: 'Manage your profile, API key, and presets',
      section: 'Actions',
      shortcut: '⌘,',
      perform: () => {
        onOpenSettings()
        onClose()
      },
    },
  ]

  // Search sessions
  const queryLower = query.toLowerCase()
  const matchingSessions = queryLower
    ? sessions.filter(
        (s) =>
          s.title.toLowerCase().includes(queryLower) || s.id.toLowerCase().includes(queryLower),
      )
    : sessions

  // Combined items: actions matching query + sessions
  const matchingActions = queryLower
    ? actions.filter(
        (a) =>
          a.label.toLowerCase().includes(queryLower) ||
          a.description?.toLowerCase().includes(queryLower),
      )
    : []

  const allItems: Array<
    { type: 'action'; action: PaletteAction } | { type: 'session'; session: ChatSessionSummary }
  > = [
    ...matchingActions.map((action) => ({ type: 'action' as const, action })),
    ...matchingSessions.map((session) => ({ type: 'session' as const, session })),
  ]

  // Reset on open. The synchronous resets are intentional (fresh query each
  // time the palette opens); the focus is deferred so it isn't synchronous.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Keep selected index in bounds when the result list shrinks.
  useEffect(() => {
    if (selectedIndex >= allItems.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedIndex(Math.max(0, allItems.length - 1))
    }
  }, [allItems.length, selectedIndex])

  // Scroll selected into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`)
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (allItems[selectedIndex]) {
            const item = allItems[selectedIndex]
            if (item.type === 'action') {
              item.action.perform()
            } else {
              onSelectSession(item.session.id)
              onClose()
            }
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [allItems, selectedIndex, onSelectSession, onClose],
  )

  // Global keyboard listener: Esc closes from anywhere, Cmd/Ctrl+K toggles.
  // Without the document-level Esc, the only way to close was to focus
  // the search input and press Esc there — clicking outside the input
  // (e.g. on a result row) would leave the user with no way out.
  useEffect(() => {
    if (!open) return
    function handleGlobalKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleGlobalKey)
    return () => document.removeEventListener('keydown', handleGlobalKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0"
            style={{ background: 'var(--overlay)', backdropFilter: 'blur(4px)' }}
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15 }}
            className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.03)',
            }}
          >
            {/* Search input */}
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <HugeiconsIcon
                icon={Search01Icon}
                size={16}
                strokeWidth={1.5}
                className="shrink-0 text-[var(--text-muted)]"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedIndex(0)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search chats, actions..."
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <kbd
                className="hidden rounded-lg px-1.5 py-0.5 text-[10px] font-medium sm:inline-block"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-tertiary)',
                }}
              >
                esc
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
              {allItems.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">
                  No results found.
                </p>
              )}

              {/* Actions section */}
              {matchingActions.length > 0 && !queryLower && (
                <div className="mb-1">
                  <p className="px-3 py-1.5 text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase">
                    Actions
                  </p>
                  {matchingActions.map((action, i) => {
                    const globalIndex = i
                    return (
                      <button
                        key={action.id}
                        type="button"
                        data-index={globalIndex}
                        onClick={() => action.perform()}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors"
                        style={{
                          background:
                            selectedIndex === globalIndex ? 'var(--accent-soft)' : 'transparent',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <span className="flex-1">
                          <span className="font-medium">{action.label}</span>
                          {action.description && (
                            <span className="ml-2 text-xs text-[var(--text-tertiary)]">
                              {action.description}
                            </span>
                          )}
                        </span>
                        {action.shortcut && (
                          <kbd
                            className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {action.shortcut}
                          </kbd>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Actions in search mode */}
              {matchingActions.length > 0 && queryLower && (
                <div className="mb-1">
                  <p className="px-3 py-1.5 text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase">
                    Actions
                  </p>
                  {matchingActions.map((action, i) => {
                    const globalIndex = i
                    return (
                      <button
                        key={action.id}
                        type="button"
                        data-index={globalIndex}
                        onClick={() => action.perform()}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors"
                        style={{
                          background:
                            selectedIndex === globalIndex ? 'var(--accent-soft)' : 'transparent',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <span className="flex-1">
                          <span className="font-medium">{action.label}</span>
                          {action.description && (
                            <span className="ml-2 text-xs text-[var(--text-tertiary)]">
                              {action.description}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Sessions section */}
              {matchingSessions.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase">
                    {queryLower ? 'Conversations' : 'Recent Conversations'}
                  </p>
                  {matchingSessions.slice(0, 20).map((session, i) => {
                    const globalIndex = (queryLower ? 0 : matchingActions.length) + i
                    return (
                      <button
                        key={session.id}
                        type="button"
                        data-index={globalIndex}
                        onClick={() => {
                          onSelectSession(session.id)
                          onClose()
                        }}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors"
                        style={{
                          background:
                            selectedIndex === globalIndex ? 'var(--accent-soft)' : 'transparent',
                          color:
                            session.id === activeSessionId
                              ? 'var(--text-primary)'
                              : 'var(--text-secondary)',
                        }}
                      >
                        <HugeiconsIcon
                          icon={ChatIcon}
                          size={14}
                          strokeWidth={1.5}
                          className={
                            session.id === activeSessionId
                              ? 'text-emerald-500'
                              : 'text-[var(--text-muted)]'
                          }
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {session.title}
                        </span>
                        {session.pinned && (
                          <HugeiconsIcon
                            icon={PinIcon}
                            size={10}
                            strokeWidth={1.5}
                            className="shrink-0 text-emerald-500"
                          />
                        )}
                        {session.archived && (
                          <HugeiconsIcon
                            icon={Archive01Icon}
                            size={10}
                            strokeWidth={1.5}
                            className="shrink-0 text-[var(--text-muted)]"
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer hints */}
            <div
              className="flex items-center gap-4 px-4 py-2"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <kbd
                  className="rounded px-1 py-0.5"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  ↑↓
                </kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <kbd
                  className="rounded px-1 py-0.5"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  ↵
                </kbd>
                Select
              </span>
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <kbd
                  className="rounded px-1 py-0.5"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  esc
                </kbd>
                Close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
