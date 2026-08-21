'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckIcon,
  ChatIcon,
  MoonIcon,
  MoreIcon,
  PencilIcon,
  PlusIcon,
  Sun01Icon,
  TrashIcon,
  CircleXIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatSessionSummary } from '@/lib/types'

interface SidebarProps {
  sessions: ChatSessionSummary[]
  activeSessionId: string | null
  theme: 'light' | 'dark'
  search: string
  hasMore: boolean
  open: boolean
  onSearchChange: (term: string) => void
  onLoadMore: () => void
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onToggleTheme: () => void
  onRenameSession: (id: string, title: string) => void
  onDeleteSession: (id: string) => void
  onClose: () => void
}

interface SidebarContentProps {
  sessions: ChatSessionSummary[]
  activeSessionId: string | null
  theme: 'light' | 'dark'
  search: string
  hasMore: boolean
  onSearchChange: (term: string) => void
  onLoadMore: () => void
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onToggleTheme: () => void
  onRenameSession: (id: string, title: string) => void
  onDeleteSession: (id: string) => void
}

function SidebarContent({
  sessions,
  activeSessionId,
  theme,
  search,
  hasMore,
  onSearchChange,
  onLoadMore,
  onNewChat,
  onSelectSession,
  onToggleTheme,
  onRenameSession,
  onDeleteSession,
}: SidebarContentProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function closeRowActions() {
    setMenuOpenId(null)
    setRenamingId(null)
    setConfirmingId(null)
  }

  function openMenu(id: string) {
    setMenuOpenId(menuOpenId === id ? null : id)
    setRenamingId(null)
    setConfirmingId(null)
  }

  function startRename(id: string, title: string) {
    setDraft(title)
    setRenamingId(id)
    setMenuOpenId(null)
    setConfirmingId(null)
  }

  function startDelete(id: string) {
    setConfirmingId(id)
    setMenuOpenId(null)
    setRenamingId(null)
  }

  function submitRename(event: FormEvent, id: string) {
    event.preventDefault()
    const title = draft.trim()
    if (title === '') return
    onRenameSession(id, title)
    closeRowActions()
  }

  return (
    <>
      {/* New Chat button */}
      <div className="p-3">
        <motion.button
          type="button"
          onClick={onNewChat}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.97 }}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-white transition-all"
          style={{
            background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
            boxShadow: '0 2px 12px rgba(124,58,237,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          <HugeiconsIcon icon={PlusIcon} size={16} strokeWidth={2} />
          New Chat
        </motion.button>
      </div>

      {/* Search */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="relative pb-2">
          <label htmlFor="session-search" className="sr-only">
            Search conversations
          </label>
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
          />
          <input
            id="session-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search..."
            className="focus-glow w-full rounded-lg py-1.5 pl-8 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
            }}
          />
        </div>

        <h2 className="px-1 pb-2 text-[10px] font-semibold tracking-widest text-[var(--text-tertiary)] uppercase">
          Conversations
        </h2>

        {sessions.length === 0 ? (
          <p className="px-1 py-2 text-sm text-[var(--text-tertiary)]">
            {search ? 'No conversations found.' : 'No conversations yet.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((session) => {
              const active = session.id === activeSessionId
              return (
                <li key={session.id}>
                  <div
                    className="group rounded-xl"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') closeRowActions()
                    }}
                  >
                    <div className="flex items-center gap-0.5">
                      <motion.button
                        type="button"
                        onClick={() => onSelectSession(session.id)}
                        aria-current={active ? 'page' : undefined}
                        whileHover={{ scale: 1.005 }}
                        whileTap={{ scale: 0.995 }}
                        className="relative flex min-w-0 flex-1 items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-all duration-150"
                        style={{
                          background: active ? 'var(--accent-soft)' : 'transparent',
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                          boxShadow: active
                            ? 'inset 0 0 0 1px var(--accent-medium), 0 0 16px var(--accent-glow)'
                            : 'none',
                          border: active
                            ? '1px solid var(--accent-medium)'
                            : '1px solid transparent',
                        }}
                      >
                        {active && (
                          <div
                            className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-violet-500"
                            style={{ boxShadow: '0 0 8px var(--accent-glow)' }}
                          />
                        )}
                        <HugeiconsIcon
                          icon={ChatIcon}
                          size={13}
                          strokeWidth={1.5}
                          className={`mt-0.5 shrink-0 ${active ? 'text-violet-500' : 'text-[var(--text-muted)]'}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate">{session.title}</span>
                          <span className="block text-[10px] text-[var(--text-tertiary)]">
                            {session.messageCount} msg{session.messageCount === 1 ? '' : 's'}
                          </span>
                        </span>
                      </motion.button>
                      <button
                        type="button"
                        onClick={() => openMenu(session.id)}
                        aria-label={`More actions for ${session.title}`}
                        aria-expanded={menuOpenId === session.id}
                        className="flex size-6 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-all duration-150 hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0"
                      >
                        <HugeiconsIcon icon={MoreIcon} size={12} strokeWidth={1.5} />
                      </button>
                    </div>

                    <AnimatePresence>
                      {menuOpenId === session.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="flex items-center gap-1 px-2.5 pb-1.5">
                            <button
                              type="button"
                              onClick={() => startRename(session.id, session.title)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                            >
                              <HugeiconsIcon icon={PencilIcon} size={11} strokeWidth={1.5} />
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => startDelete(session.id)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-500/10"
                            >
                              <HugeiconsIcon icon={TrashIcon} size={11} strokeWidth={1.5} />
                              Delete
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <AnimatePresence>
                      {renamingId === session.id && (
                        <motion.form
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                          onSubmit={(event) => submitRename(event, session.id)}
                        >
                          <div className="flex items-center gap-1 px-2.5 pb-1.5">
                            <label htmlFor={`rename-${session.id}`} className="sr-only">
                              Session title
                            </label>
                            <input
                              id={`rename-${session.id}`}
                              value={draft}
                              onChange={(event) => setDraft(event.target.value)}
                              maxLength={48}
                              autoFocus
                              className="focus-glow min-w-0 flex-1 rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none"
                              style={{
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-medium)',
                              }}
                            />
                            <button
                              type="submit"
                              aria-label="Save session title"
                              className="flex size-6 shrink-0 items-center justify-center rounded-lg text-emerald-500 transition-colors hover:bg-emerald-500/10"
                            >
                              <HugeiconsIcon icon={CheckIcon} size={13} strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              onClick={closeRowActions}
                              aria-label="Cancel rename"
                              className="flex size-6 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
                            >
                              <HugeiconsIcon icon={CircleXIcon} size={13} strokeWidth={1.5} />
                            </button>
                          </div>
                        </motion.form>
                      )}
                    </AnimatePresence>

                    <AnimatePresence>
                      {confirmingId === session.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="flex items-center gap-1 px-2.5 pb-1.5 text-sm">
                            <span className="text-[var(--text-tertiary)]">Delete?</span>
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteSession(session.id)
                                closeRowActions()
                              }}
                              aria-label="Confirm delete"
                              className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-500"
                            >
                              <HugeiconsIcon icon={TrashIcon} size={11} strokeWidth={1.5} />
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={closeRowActions}
                              aria-label="Cancel delete"
                              className="rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)]"
                            >
                              No
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </li>
              )
            })}
            {hasMore && (
              <li>
                <button
                  type="button"
                  onClick={onLoadMore}
                  className="w-full rounded-lg px-2 py-1.5 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
                >
                  Show more
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Theme toggle */}
      <div className="p-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <motion.button
          type="button"
          onClick={onToggleTheme}
          whileHover={{ scale: 1.005 }}
          whileTap={{ scale: 0.995 }}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-[var(--text-secondary)] transition-all duration-150 hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
        >
          <HugeiconsIcon
            icon={theme === 'dark' ? Sun01Icon : MoonIcon}
            size={14}
            strokeWidth={1.5}
          />
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </motion.button>
      </div>
    </>
  )
}

export default function Sidebar({
  sessions,
  activeSessionId,
  theme,
  search,
  hasMore,
  open,
  onSearchChange,
  onLoadMore,
  onNewChat,
  onSelectSession,
  onToggleTheme,
  onRenameSession,
  onDeleteSession,
  onClose,
}: SidebarProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [open])

  const contentProps = {
    sessions,
    activeSessionId,
    theme,
    search,
    hasMore,
    onSearchChange,
    onLoadMore,
    onNewChat,
    onSelectSession,
    onToggleTheme,
    onRenameSession,
    onDeleteSession,
  }

  const sidebarTransition = reducedMotion
    ? ({ duration: 0 } as const)
    : { type: 'spring' as const, stiffness: 400, damping: 30, mass: 0.8 }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        aria-label="Conversations"
        className="hidden w-64 shrink-0 flex-col md:flex"
        style={{
          background: 'var(--sidebar-bg)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRight: '1px solid var(--sidebar-border)',
        }}
      >
        <SidebarContent {...contentProps} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            id="conversations-drawer"
            className="fixed inset-0 z-50 md:hidden"
            initial={false}
            aria-hidden={!open}
          >
            <motion.button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={onClose}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 backdrop-blur-sm"
              style={{ background: 'var(--overlay)' }}
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Conversations"
              tabIndex={-1}
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={sidebarTransition}
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col outline-none"
              style={{
                background: 'var(--sidebar-bg)',
                backdropFilter: 'blur(32px)',
                WebkitBackdropFilter: 'blur(32px)',
                borderRight: '1px solid var(--sidebar-border)',
                boxShadow: '8px 0 40px rgba(0,0,0,0.2)',
              }}
            >
              <div
                className="flex items-center justify-between px-3 py-3"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Conversations</h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close conversation list"
                  className="flex size-7 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                >
                  <HugeiconsIcon icon={CircleXIcon} size={15} strokeWidth={1.5} />
                </button>
              </div>
              <SidebarContent {...contentProps} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
