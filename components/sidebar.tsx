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
  /** Current search term (server-side filtering). */
  search: string
  /** Whether another page of sessions is available ("Show more"). */
  hasMore: boolean
  /** Mobile drawer open state (the desktop aside ignores it). */
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

/** The session list + New Chat + theme toggle, shared by desktop and drawer. */
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
      <div className="p-3">
        <motion.button
          type="button"
          onClick={onNewChat}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-zinc-800 to-zinc-900 px-3 py-2.5 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)] transition-all hover:from-zinc-700 hover:to-zinc-800 dark:from-zinc-700 dark:to-zinc-800 dark:shadow-[0_1px_2px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:from-zinc-600 dark:hover:to-zinc-700"
        >
          <HugeiconsIcon icon={PlusIcon} size={16} strokeWidth={2} />
          New Chat
        </motion.button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="relative pb-2">
          <HugeiconsIcon
            icon={Search01Icon}
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500"
          />
          <input
            id="session-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search conversations..."
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:ring-zinc-700"
          />
        </div>
        <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
          Conversations
        </h2>
        {sessions.length === 0 ? (
          <p className="px-1 py-2 text-sm text-zinc-400 dark:text-zinc-500">
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
                        className={`flex min-w-0 flex-1 items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-all duration-150 ${
                          active
                            ? 'bg-zinc-800/80 font-medium text-zinc-100 shadow-[0_1px_3px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.04)] dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-[0_1px_3px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]'
                            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
                        }`}
                      >
                        <HugeiconsIcon
                          icon={ChatIcon}
                          size={14}
                          strokeWidth={1.5}
                          className={`mt-0.5 shrink-0 ${active ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-400 dark:text-zinc-600'}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate">{session.title}</span>
                          <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">
                            {session.messageCount} message{session.messageCount === 1 ? '' : 's'}
                          </span>
                        </span>
                      </motion.button>
                      <button
                        type="button"
                        onClick={() => openMenu(session.id)}
                        aria-label={`More actions for ${session.title}`}
                        aria-expanded={menuOpenId === session.id}
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-all duration-150 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                      >
                        <HugeiconsIcon icon={MoreIcon} size={14} strokeWidth={1.5} />
                      </button>
                    </div>

                    <AnimatePresence>
                      {menuOpenId === session.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15, ease: 'easeOut' }}
                          className="overflow-hidden"
                        >
                          <div className="flex items-center gap-1 px-2.5 pb-1.5">
                            <button
                              type="button"
                              onClick={() => startRename(session.id, session.title)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            >
                              <HugeiconsIcon icon={PencilIcon} size={12} strokeWidth={1.5} />
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => startDelete(session.id)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                            >
                              <HugeiconsIcon icon={TrashIcon} size={12} strokeWidth={1.5} />
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
                          transition={{ duration: 0.15, ease: 'easeOut' }}
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
                              className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-600 dark:focus:ring-zinc-700"
                            />
                            <button
                              type="submit"
                              aria-label="Save session title"
                              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-emerald-500 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                            >
                              <HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              onClick={closeRowActions}
                              aria-label="Cancel rename"
                              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            >
                              <HugeiconsIcon icon={CircleXIcon} size={14} strokeWidth={1.5} />
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
                          transition={{ duration: 0.15, ease: 'easeOut' }}
                          className="overflow-hidden"
                        >
                          <div className="flex items-center gap-1 px-2.5 pb-1.5 text-sm">
                            <span className="text-zinc-400 dark:text-zinc-500">Delete?</span>
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteSession(session.id)
                                closeRowActions()
                              }}
                              aria-label="Confirm delete"
                              className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500"
                            >
                              <HugeiconsIcon icon={TrashIcon} size={12} strokeWidth={1.5} />
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={closeRowActions}
                              aria-label="Cancel delete"
                              className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            >
                              Cancel
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
                  className="w-full rounded-lg px-2 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
                >
                  Show more
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="border-t border-zinc-100 p-3 dark:border-zinc-800/80">
        <motion.button
          type="button"
          onClick={onToggleTheme}
          whileHover={{ scale: 1.005 }}
          whileTap={{ scale: 0.995 }}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-zinc-500 transition-all duration-150 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
        >
          <HugeiconsIcon
            icon={theme === 'dark' ? Sun01Icon : MoonIcon}
            size={15}
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

  // While the drawer is open: move focus into it, trap Tab inside, close on
  // Escape, and restore focus to the trigger on close.
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
      {/* Desktop sidebar — always visible at md and up. */}
      <aside
        aria-label="Conversations"
        className="hidden w-64 shrink-0 flex-col border-r border-zinc-100 bg-zinc-50/80 backdrop-blur-sm md:flex dark:border-zinc-800/60 dark:bg-zinc-900/60"
      >
        <SidebarContent {...contentProps} />
      </aside>

      {/* Mobile drawer — overlay + sliding panel, hidden at md and up. */}
      <AnimatePresence>
        {open && (
          <motion.div
            id="conversations-drawer"
            className="fixed inset-0 z-50 md:hidden"
            initial={false}
            aria-hidden={!open}
          >
            {/* Backdrop */}
            <motion.button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={onClose}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            {/* Panel */}
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
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-zinc-200 bg-white/95 shadow-2xl outline-none backdrop-blur-xl dark:border-zinc-800/60 dark:bg-zinc-900/95 dark:shadow-[0_0_40px_rgba(0,0,0,0.5)]"
            >
              <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3 dark:border-zinc-800/60">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Conversations
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close conversation list"
                  className="flex size-8 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                >
                  <HugeiconsIcon icon={CircleXIcon} size={16} strokeWidth={1.5} />
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
