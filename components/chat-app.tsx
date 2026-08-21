'use client'

import Image from 'next/image'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  MenuIcon,
  MoonIcon,
  PlusIcon,
  Sun01Icon,
  Logout01Icon,
  UserIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useSession, signOut } from 'next-auth/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clearChatSession, listChatSessions, renameChatSession, togglePinSession, toggleArchiveSession } from '@/app/actions'
import { withThemeTransition } from '@/lib/theme-transition'
import { clearSessionId, clearThread, getSessionId, setSessionId } from '@/lib/storage'
import type { ChatSessionSummary } from '@/lib/types'
import Chat from './chat'
import Sidebar from './sidebar'
import CommandPalette from './command-palette'

export default function ChatApp() {
  const { data: session } = useSession()
  const [sessionId, setSessionIdState] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const reducedMotion = useReducedMotion()
  const loadingMoreRef = useRef(false)

  const loadSessions = useCallback(
    async (opts: { search?: string; skip?: number; archived?: boolean } = {}) => {
      const term = opts.search ?? search
      const offset = opts.skip ?? 0
      const isArchived = opts.archived ?? showArchived
      const result = await listChatSessions({ search: term, skip: offset, archived: isArchived })
      if (!result.ok) return
      setSessions((prev) => (offset === 0 ? result.sessions : [...prev, ...result.sessions]))
      setHasMore(result.hasMore)
    },
    [search, showArchived],
  )

  const refreshSessions = useCallback(() => void loadSessions(), [loadSessions])

  async function loadMore() {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    try {
      await loadSessions({ search, skip: sessions.length })
    } finally {
      loadingMoreRef.current = false
    }
  }

  const isFirstSearchRenderRef = useRef(true)
  useEffect(() => {
    if (isFirstSearchRenderRef.current) {
      isFirstSearchRenderRef.current = false
      return
    }
    const timer = setTimeout(() => void loadSessions({ search, skip: 0 }), 250)
    return () => clearTimeout(timer)
  }, [search, showArchived, loadSessions])

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    setSessionIdState(getSessionId())
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    void refreshSessions()
    setReady(true)
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  function handleSessionChange(id: string | null) {
    setSessionIdState(id)
    if (id) {
      setSessionId(id)
    } else {
      clearSessionId()
      clearThread()
    }
  }

  async function renameSession(id: string, title: string) {
    await renameChatSession({ sessionId: id, title })
    await refreshSessions()
  }

  async function deleteSession(id: string) {
    await clearChatSession(id)
    if (id === sessionId) handleSessionChange(null)
    await refreshSessions()
  }

  async function handleTogglePin(id: string) {
    await togglePinSession(id)
    await refreshSessions()
  }

  async function handleToggleArchive(id: string) {
    await toggleArchiveSession(id)
    if (id === sessionId) handleSessionChange(null)
    await refreshSessions()
  }

  function toggleTheme() {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
    withThemeTransition(() => {
      document.documentElement.classList.toggle('dark', next === 'dark')
    })
    try {
      localStorage.setItem('chat.theme', next)
    } catch {
      // Best-effort.
    }
    setTheme(next)
  }

  /** signOut with View Transition — captures the chat shell snapshot before redirect. */
  function handleSignOut() {
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      document.startViewTransition(() => {
        signOut({ callbackUrl: '/login' })
      })
    } else {
      signOut({ callbackUrl: '/login' })
    }
  }

  // Global keyboard shortcut: Ctrl+K / Cmd+K opens the command palette.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setCommandPaletteOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: 'var(--bg-deep)' }}>
      <Sidebar
        sessions={sessions}
        activeSessionId={sessionId}
        theme={theme}
        search={search}
        hasMore={hasMore}
        showArchived={showArchived}
        onSearchChange={setSearch}
        onLoadMore={() => void loadMore()}
        open={menuOpen}
        onNewChat={() => {
          handleSessionChange(null)
          setMenuOpen(false)
        }}
        onSelectSession={(id) => {
          handleSessionChange(id)
          setMenuOpen(false)
        }}
        onToggleTheme={toggleTheme}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleToggleArchive}
        onToggleArchivedView={() => setShowArchived((prev) => !prev)}
        onOpenSettings={() => window.location.href = '/settings'}
        onClose={() => setMenuOpen(false)}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        sessions={sessions}
        activeSessionId={sessionId}
        theme={theme}
        onSelectSession={(id) => { handleSessionChange(id); setCommandPaletteOpen(false) }}
        onNewChat={() => { handleSessionChange(null); setCommandPaletteOpen(false) }}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => { window.location.href = '/settings'; setCommandPaletteOpen(false) }}
      />

      <main id="main" className="flex min-w-0 flex-1 flex-col vt-chat-shell">
        <header
          className="flex items-center justify-between px-4 py-3"
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div className="flex items-center gap-2">
            <motion.button
              type="button"
              onClick={() => setMenuOpen(true)}
              whileHover={reducedMotion ? undefined : { scale: 1.05 }}
              whileTap={reducedMotion ? undefined : { scale: 0.95 }}
              aria-label="Open conversation list"
              aria-expanded={menuOpen}
              aria-controls="conversations-drawer"
              className="flex size-9 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] md:hidden"
            >
              <HugeiconsIcon icon={MenuIcon} size={20} strokeWidth={1.5} />
            </motion.button>
            <div className="flex items-center gap-2">
              <div
                className="flex size-7 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/20 vt-brand-icon"
              >
                <HugeiconsIcon icon={MenuIcon} size={13} strokeWidth={2} className="text-cyan-400" />
              </div>
              <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
                Chatbot
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* Command palette trigger */}
            <motion.button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              whileHover={reducedMotion ? undefined : { scale: 1.05 }}
              whileTap={reducedMotion ? undefined : { scale: 0.95 }}
              aria-label="Open command palette"
              className="hidden items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] md:flex"
              style={{ border: '1px solid var(--border-subtle)' }}
            >
              <HugeiconsIcon icon={Search01Icon} size={13} strokeWidth={1.5} />
              <span>Search...</span>
              <kbd className="rounded px-1 py-0.5 text-[10px]" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                ⌘K
              </kbd>
            </motion.button>
            {/* User avatar (desktop) */}
            {session?.user && (
              <div className="hidden items-center gap-2 md:flex">
                <div
                  className="flex items-center gap-2 rounded-xl px-2 py-1"
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {session.user.image ? (
                    <Image
                      src={session.user.image}
                      alt=""
                      width={24}
                      height={24}
                      className="size-6 rounded-full"
                    />
                  ) : (
                    <div className="flex size-6 items-center justify-center rounded-full bg-cyan-500/10 border border-cyan-500/20">
                      <HugeiconsIcon
                        icon={UserIcon}
                        size={12}
                        strokeWidth={1.5}
                        className="text-cyan-400"
                      />
                    </div>
                  )}
                  <span className="max-w-[120px] truncate text-xs font-medium text-[var(--text-secondary)]">
                    {session.user.name ?? session.user.email}
                  </span>
                </div>
                <motion.button
                  type="button"
                  onClick={handleSignOut}
                  whileHover={reducedMotion ? undefined : { scale: 1.05 }}
                  whileTap={reducedMotion ? undefined : { scale: 0.95 }}
                  aria-label="Sign out"
                  className="flex size-8 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                >
                  <HugeiconsIcon icon={Logout01Icon} size={16} strokeWidth={1.5} />
                </motion.button>
              </div>
            )}
            {/* Mobile actions */}
            <div className="flex items-center gap-1 md:hidden">
              <motion.button
                type="button"
                onClick={() => handleSessionChange(null)}
                whileHover={reducedMotion ? undefined : { scale: 1.05 }}
                whileTap={reducedMotion ? undefined : { scale: 0.95 }}
                aria-label="Start a new chat"
                className="flex size-9 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
              >
                <HugeiconsIcon icon={PlusIcon} size={20} strokeWidth={1.5} />
              </motion.button>
              <motion.button
                type="button"
                onClick={toggleTheme}
                whileHover={reducedMotion ? undefined : { scale: 1.05 }}
                whileTap={reducedMotion ? undefined : { scale: 0.95 }}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="flex size-9 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
              >
                <HugeiconsIcon
                  icon={theme === 'dark' ? Sun01Icon : MoonIcon}
                  size={18}
                  strokeWidth={1.5}
                />
              </motion.button>
              {/* Mobile user menu */}
              {session?.user && (
                <motion.button
                  type="button"
                  onClick={handleSignOut}
                  whileHover={reducedMotion ? undefined : { scale: 1.05 }}
                  whileTap={reducedMotion ? undefined : { scale: 0.95 }}
                  aria-label="Sign out"
                  className="flex size-9 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                >
                  <HugeiconsIcon icon={Logout01Icon} size={18} strokeWidth={1.5} />
                </motion.button>
              )}
            </div>
          </div>
        </header>

        {ready && (
          <Chat
            sessionId={sessionId}
            onSessionChange={handleSessionChange}
            onConversationChanged={refreshSessions}
          />
        )}
      </main>
    </div>
  )
}
