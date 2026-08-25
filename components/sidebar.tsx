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
  ArrowRight01Icon,
  ArrowLeft01Icon,
  PinIcon,
  PinOffIcon,
  Archive01Icon,
  Settings02Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatSessionSummary } from '@/lib/types'

const SIDEBAR_WIDTH_EXPANDED = 256
const SIDEBAR_WIDTH_COLLAPSED = 64
const STORAGE_KEY = 'chat.sidebarCollapsed'

interface SidebarProps {
  sessions: ChatSessionSummary[]
  activeSessionId: string | null
  theme: 'light' | 'dark'
  search: string
  hasMore: boolean
  open: boolean
  showArchived: boolean
  onSearchChange: (term: string) => void
  onLoadMore: () => void
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onToggleTheme: () => void
  onRenameSession: (id: string, title: string) => void
  onDeleteSession: (id: string) => void
  onTogglePin: (id: string) => void
  onToggleArchive: (id: string) => void
  onToggleArchivedView: () => void
  onOpenSettings: () => void
  onClose: () => void
}

interface SidebarContentProps {
  sessions: ChatSessionSummary[]
  activeSessionId: string | null
  showArchived: boolean
  theme: 'light' | 'dark'
  search: string
  hasMore: boolean
  collapsed: boolean
  onSearchChange: (term: string) => void
  onLoadMore: () => void
  onNewChat: () => void
  onSelectSession: (id: string) => void
  onToggleTheme: () => void
  onRenameSession: (id: string, title: string) => void
  onDeleteSession: (id: string) => void
  onTogglePin: (id: string) => void
  onToggleArchive: (id: string) => void
  onToggleArchivedView: () => void
  onOpenSettings: () => void
}

interface SessionItemProps {
  session: ChatSessionSummary
  activeSessionId: string | null
  menuOpenId: string | null
  renamingId: string | null
  confirmingId: string | null
  draft: string
  collapsed: boolean
  onSelect: (id: string) => void
  onOpenMenu: (id: string) => void
  onStartRename: (id: string, title: string) => void
  onStartDelete: (id: string) => void
  onSubmitRename: (e: FormEvent, id: string) => void
  /** Keep the parent's rename draft in sync as the user types, so submitting
   *  sends the typed title (not the original one captured at startRename). */
  onDraftChange: (value: string) => void
  onDelete: (id: string) => void
  onCloseActions: () => void
  onTogglePin: (id: string) => void
  onToggleArchive: (id: string) => void
}

function SessionItem({
  session,
  activeSessionId,
  menuOpenId,
  renamingId,
  confirmingId,
  draft,
  onSelect,
  onOpenMenu,
  onStartRename,
  onStartDelete,
  onSubmitRename,
  onDraftChange,
  onDelete,
  onCloseActions,
  onTogglePin,
  onToggleArchive,
}: SessionItemProps) {
  const active = session.id === activeSessionId
  const reducedMotion = useReducedMotion()

  function submitRenameLocal(e: FormEvent) {
    onSubmitRename(e, session.id)
  }

  return (
    <li>
      <div
        className="group rounded-xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCloseActions()
        }}
      >
        <div className="flex items-center gap-0.5">
          <motion.button
            type="button"
            onClick={() => onSelect(session.id)}
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
              border: active ? '1px solid var(--accent-medium)' : '1px solid transparent',
            }}
          >
            {/* Active indicator — a shared layoutId slides the glowing bar
                between sessions as the active one changes (micro-interaction
                for the sidebar's active state). Reduced-motion collapses the
                spring to an instant swap. */}
            {active && (
              <motion.div
                layoutId="sidebar-active-indicator"
                transition={
                  reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38 }
                }
                className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-emerald-500"
                style={{ boxShadow: '0 0 8px var(--accent-glow)' }}
              />
            )}
            <HugeiconsIcon
              icon={ChatIcon}
              size={13}
              strokeWidth={1.5}
              className={`mt-0.5 shrink-0 ${active ? 'text-emerald-500' : 'text-[var(--text-muted)]'}`}
            />
            <span className="min-w-0">
              <span className="block truncate">{session.title}</span>
              <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
                {session.messageCount} msg{session.messageCount === 1 ? '' : 's'}
                {session.lastModel ? (
                  <>
                    {' '}
                    ·{' '}
                    <span className="font-mono" data-testid="session-model">
                      via {session.lastModel}
                    </span>
                  </>
                ) : null}
              </span>
            </span>
          </motion.button>
          <button
            type="button"
            onClick={() => onOpenMenu(session.id)}
            aria-label={`More actions for ${session.title}`}
            aria-expanded={menuOpenId === session.id}
            className="flex size-6 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-all duration-150 hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0"
          >
            <HugeiconsIcon icon={MoreIcon} size={12} strokeWidth={1.5} />
          </button>
        </div>

        {/* Menu */}
        <AnimatePresence>
          {menuOpenId === session.id && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-center gap-1 px-2.5 pb-1.5">
                <button
                  type="button"
                  onClick={() => onStartRename(session.id, session.title)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                >
                  <HugeiconsIcon icon={PencilIcon} size={11} strokeWidth={1.5} />
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => onTogglePin(session.id)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                >
                  <HugeiconsIcon
                    icon={session.pinned ? PinOffIcon : PinIcon}
                    size={11}
                    strokeWidth={1.5}
                  />
                  {session.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleArchive(session.id)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                >
                  <HugeiconsIcon icon={Archive01Icon} size={11} strokeWidth={1.5} />
                  {session.archived ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  type="button"
                  onClick={() => onStartDelete(session.id)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-500/10"
                >
                  <HugeiconsIcon icon={TrashIcon} size={11} strokeWidth={1.5} />
                  Delete
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rename form */}
        <AnimatePresence>
          {renamingId === session.id && (
            <motion.form
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
              onSubmit={submitRenameLocal}
            >
              <div className="flex items-center gap-1 px-2.5 pb-1.5">
                <label htmlFor={`rename-${session.id}`} className="sr-only">
                  Session title
                </label>
                <input
                  id={`rename-${session.id}`}
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
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
                  onClick={onCloseActions}
                  aria-label="Cancel rename"
                  className="flex size-6 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
                >
                  <HugeiconsIcon icon={CircleXIcon} size={13} strokeWidth={1.5} />
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Delete confirm */}
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
                    onDelete(session.id)
                    onCloseActions()
                  }}
                  aria-label="Confirm delete"
                  className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-500"
                >
                  <HugeiconsIcon icon={TrashIcon} size={11} strokeWidth={1.5} />
                  Yes
                </button>
                <button
                  type="button"
                  onClick={onCloseActions}
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
}

function SidebarContent({
  sessions,
  activeSessionId,
  showArchived,
  theme,
  search,
  hasMore,
  collapsed,
  onSearchChange,
  onLoadMore,
  onNewChat,
  onSelectSession,
  onToggleTheme,
  onRenameSession,
  onDeleteSession,
  onTogglePin,
  onToggleArchive,
  onToggleArchivedView,
  onOpenSettings,
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
          className={`flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-white transition-all ${
            collapsed ? 'px-0' : ''
          }`}
          style={{
            background: 'linear-gradient(to right, #10b981, #0d9488)',
            boxShadow: '0 4px 14px 0 rgba(16,185,129,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
          title={collapsed ? 'New Chat' : undefined}
        >
          <HugeiconsIcon icon={PlusIcon} size={16} strokeWidth={2} />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden whitespace-nowrap"
              >
                New Chat
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>

      {/* Search — hidden when collapsed */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
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

              {/* Archive toggle */}
              <div className="flex items-center justify-between px-1 pb-1">
                <h2 className="text-[10px] font-semibold tracking-widest text-[var(--text-tertiary)] uppercase">
                  {showArchived ? 'Archived' : 'Conversations'}
                </h2>
                <button
                  type="button"
                  onClick={onToggleArchivedView}
                  className="rounded-lg px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
                  title={showArchived ? 'Show active chats' : 'Show archived chats'}
                >
                  {showArchived ? 'Active' : 'Archive'}
                </button>
              </div>

              {(() => {
                const pinnedSessions = sessions.filter((s) => s.pinned)
                const regularSessions = sessions.filter((s) => !s.pinned)
                const hasPinned = pinnedSessions.length > 0 && !showArchived && !search

                if (sessions.length === 0) {
                  return (
                    <p className="px-1 py-2 text-sm text-[var(--text-tertiary)]">
                      {search
                        ? 'No conversations found.'
                        : showArchived
                          ? 'No archived chats.'
                          : 'No conversations yet.'}
                    </p>
                  )
                }

                return (
                  <ul className="space-y-0.5">
                    {/* Pinned section */}
                    {hasPinned && (
                      <>
                        <li className="px-1 pt-1 pb-0.5">
                          <span className="text-[10px] font-medium text-[var(--gold)] uppercase tracking-wider">
                            <HugeiconsIcon
                              icon={PinIcon}
                              size={9}
                              strokeWidth={2}
                              className="mr-1 inline-block"
                            />
                            Pinned
                          </span>
                        </li>
                        {pinnedSessions.map((session) => (
                          <SessionItem
                            key={session.id}
                            session={session}
                            activeSessionId={activeSessionId}
                            menuOpenId={menuOpenId}
                            renamingId={renamingId}
                            confirmingId={confirmingId}
                            draft={draft}
                            collapsed={collapsed}
                            onSelect={onSelectSession}
                            onOpenMenu={openMenu}
                            onStartRename={startRename}
                            onStartDelete={startDelete}
                            onSubmitRename={submitRename}
                            onDraftChange={setDraft}
                            onDelete={onDeleteSession}
                            onCloseActions={closeRowActions}
                            onTogglePin={onTogglePin}
                            onToggleArchive={onToggleArchive}
                          />
                        ))}
                        <li
                          className="my-1"
                          style={{ borderTop: '1px solid var(--border-subtle)' }}
                        />
                      </>
                    )}

                    {/* Regular section */}
                    {!showArchived && hasPinned && (
                      <li className="px-1 pb-0.5">
                        <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                          Recent
                        </span>
                      </li>
                    )}
                    {(showArchived ? sessions : regularSessions).map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        activeSessionId={activeSessionId}
                        menuOpenId={menuOpenId}
                        renamingId={renamingId}
                        confirmingId={confirmingId}
                        draft={draft}
                        collapsed={collapsed}
                        onSelect={onSelectSession}
                        onOpenMenu={openMenu}
                        onStartRename={startRename}
                        onStartDelete={startDelete}
                        onSubmitRename={submitRename}
                        onDraftChange={setDraft}
                        onDelete={onDeleteSession}
                        onCloseActions={closeRowActions}
                        onTogglePin={onTogglePin}
                        onToggleArchive={onToggleArchive}
                      />
                    ))}
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
                )
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed session list — icon-only */}
      {collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
          <h2 className="sr-only">Conversations</h2>
          <ul className="space-y-0.5">
            {sessions.map((session) => {
              const active = session.id === activeSessionId
              return (
                <li key={session.id}>
                  <motion.button
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    aria-current={active ? 'page' : undefined}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    title={session.title}
                    className="flex size-10 items-center justify-center rounded-xl transition-all duration-150"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      boxShadow: active
                        ? 'inset 0 0 0 1px var(--accent-medium), 0 0 16px var(--accent-glow)'
                        : 'none',
                      border: active ? '1px solid var(--accent-medium)' : '1px solid transparent',
                    }}
                  >
                    <HugeiconsIcon
                      icon={ChatIcon}
                      size={14}
                      strokeWidth={1.5}
                      className={active ? 'text-emerald-500' : 'text-[var(--text-muted)]'}
                    />
                  </motion.button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Bottom actions */}
      <div className="p-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <motion.button
          type="button"
          onClick={onOpenSettings}
          whileHover={{ scale: 1.005 }}
          whileTap={{ scale: 0.995 }}
          aria-label="Settings"
          className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-[var(--text-secondary)] transition-all duration-150 hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] ${
            collapsed ? 'justify-center px-0' : ''
          }`}
          title={collapsed ? 'Settings' : undefined}
        >
          <HugeiconsIcon icon={Settings02Icon} size={14} strokeWidth={1.5} />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden whitespace-nowrap"
              >
                Settings
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
        <motion.button
          type="button"
          onClick={onToggleTheme}
          whileHover={{ scale: 1.005 }}
          whileTap={{ scale: 0.995 }}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-[var(--text-secondary)] transition-all duration-150 hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] ${
            collapsed ? 'justify-center px-0' : ''
          }`}
          title={collapsed ? (theme === 'dark' ? 'Light mode' : 'Dark mode') : undefined}
        >
          <HugeiconsIcon
            icon={theme === 'dark' ? Sun01Icon : MoonIcon}
            size={14}
            strokeWidth={1.5}
          />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden whitespace-nowrap"
              >
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </motion.span>
            )}
          </AnimatePresence>
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
  showArchived,
  onSearchChange,
  onLoadMore,
  onNewChat,
  onSelectSession,
  onToggleTheme,
  onRenameSession,
  onDeleteSession,
  onTogglePin,
  onToggleArchive,
  onToggleArchivedView,
  onOpenSettings,
  onClose,
}: SidebarProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const reducedMotion = useReducedMotion()
  const [collapsed, setCollapsed] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Hydrate collapsed state from localStorage (client-only).
  /* eslint-disable react-hooks/set-state-in-effect -- Intentional: reading the
     persisted collapsed state into state after mount is the SSR-safe alternative
     to lazy initializers (no window access during render); `hydrated` gates the
     sidebar width animation on that restore completing. */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'true') setCollapsed(true)
    } catch {
      // Best-effort.
    }
    setHydrated(true)
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // Best-effort.
      }
      return next
    })
  }

  // Global keyboard shortcut: Ctrl+\ (or Cmd+\ on Mac) toggles collapse.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault()
        toggleCollapsed()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

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
    showArchived,
    theme,
    search,
    hasMore,
    collapsed,
    onSearchChange,
    onLoadMore,
    onNewChat,
    onSelectSession,
    onToggleTheme,
    onRenameSession,
    onDeleteSession,
    onTogglePin,
    onToggleArchive,
    onToggleArchivedView,
    onOpenSettings,
  }

  const sidebarTransition = reducedMotion
    ? ({ duration: 0 } as const)
    : { type: 'spring' as const, stiffness: 400, damping: 30, mass: 0.8 }

  const sidebarWidth = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED

  return (
    <>
      {/* Desktop sidebar */}
      <motion.aside
        aria-label="Conversations"
        className="hidden flex-col md:flex"
        initial={false}
        animate={{ width: hydrated ? sidebarWidth : SIDEBAR_WIDTH_EXPANDED }}
        transition={sidebarTransition}
        style={{
          background: 'var(--sidebar-bg)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRight: '1px solid var(--sidebar-border)',
        }}
      >
        {/* Collapse toggle */}
        <div className="flex items-center justify-end p-3 pb-0">
          <motion.button
            type="button"
            onClick={toggleCollapsed}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar (Ctrl+\)' : 'Collapse sidebar (Ctrl+\)'}
            className="flex size-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
          >
            <HugeiconsIcon
              icon={collapsed ? ArrowRight01Icon : ArrowLeft01Icon}
              size={14}
              strokeWidth={1.5}
            />
          </motion.button>
        </div>

        <SidebarContent {...contentProps} />
      </motion.aside>

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
              <SidebarContent {...contentProps} collapsed={false} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
