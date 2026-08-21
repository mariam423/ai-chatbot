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
} from '@hugeicons/core-free-icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useSession, signOut } from 'next-auth/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clearChatSession, listChatSessions, renameChatSession } from '@/app/actions'
import { withThemeTransition } from '@/lib/theme-transition'
import { clearSessionId, clearThread, getSessionId, setSessionId } from '@/lib/storage'
import type { ChatSessionSummary } from '@/lib/types'
import Chat from './chat'
import Sidebar from './sidebar'

export default function ChatApp() {
  const { data: session } = useSession()
  const [sessionId, setSessionIdState] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const reducedMotion = useReducedMotion()
  const loadingMoreRef = useRef(false)

  const loadSessions = useCallback(
    async (opts: { search?: string; skip?: number } = {}) => {
      const term = opts.search ?? search
      const offset = opts.skip ?? 0
      const result = await listChatSessions({ search: term, skip: offset })
      if (!result.ok) return
      setSessions((prev) => (offset === 0 ? result.sessions : [...prev, ...result.sessions]))
      setHasMore(result.hasMore)
    },
    [search],
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
  }, [search, loadSessions])

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

  return (
    <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: 'var(--bg-deep)' }}>
      <Sidebar
        sessions={sessions}
        activeSessionId={sessionId}
        theme={theme}
        search={search}
        hasMore={hasMore}
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
        onClose={() => setMenuOpen(false)}
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
                className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 vt-brand-icon"
                style={{ boxShadow: '0 2px 10px rgba(16,185,129,0.3)' }}
              >
                <HugeiconsIcon icon={MenuIcon} size={13} strokeWidth={2} className="text-white" />
              </div>
              <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
                Chatbot
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-1">
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
                    <div className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600">
                      <HugeiconsIcon
                        icon={UserIcon}
                        size={12}
                        strokeWidth={1.5}
                        className="text-white"
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
