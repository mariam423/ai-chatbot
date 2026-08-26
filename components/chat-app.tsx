'use client'

import Image from 'next/image'
import { Files, MonitorPlay, Rocket, Terminal } from 'lucide-react'
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
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  clearChatSession,
  createWorkspaceTask,
  getBillingStatus,
  getSessionSkills,
  getWorkspaceTasks,
  getUserPreferences,
  listChatSessions,
  listCustomAgents,
  renameChatSession,
  setActiveWorkspaceTask,
  togglePinSession,
  toggleArchiveSession,
  updateSessionSkills,
} from '@/app/actions'
import { withThemeTransition } from '@/lib/theme-transition'
import { clearSessionId, clearThread, getSessionId, setSessionId } from '@/lib/storage'
import { DEFAULT_MODEL_KEY, MODEL_OPTIONS, ModelKeySchema, type ModelKey } from '@/lib/models'
import type {
  ChatSessionSummary,
  CustomAgentSummary,
  CustomAgentTheme,
  WorkspaceTask,
  WorkspaceTool,
} from '@/lib/types'
import Chat from './chat'
import Sidebar from './sidebar'
import CommandPalette from './command-palette'
import SkillPicker from './skill-picker'

const WORKSPACE_TOOLS: Array<{
  id: WorkspaceTool
  label: string
  Icon: typeof Terminal
}> = [
  { id: 'terminal', label: 'Terminal', Icon: Terminal },
  { id: 'files', label: 'Files', Icon: Files },
  { id: 'preview', label: 'Preview', Icon: MonitorPlay },
  { id: 'publish', label: 'Publish', Icon: Rocket },
]

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export default function ChatApp() {
  const { data: session } = useSession()
  const [sessionId, setSessionIdState] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [tasks, setTasks] = useState<WorkspaceTask[]>([
    { id: 'inbox', name: 'Inbox' },
    { id: 'build', name: 'Build workspace' },
    { id: 'launch', name: 'Launch checklist' },
  ])
  const [activeTaskId, setActiveTaskId] = useState('inbox')
  // Bumped whenever the user starts a new chat (or deletes the active session)
  // while `sessionId` is already null — Chat's [sessionId] restore effect won't
  // re-run in that case, so the reset signal tells it to clear the thread
  // explicitly and invalidate any in-flight persist/restore work.
  const [resetNonce, setResetNonce] = useState(0)
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ModelKey>(DEFAULT_MODEL_KEY)
  const modelSelectionTouchedRef = useRef(false)
  const [customAgents, setCustomAgents] = useState<CustomAgentSummary[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [activeWorkspaceTool, setActiveWorkspaceTool] = useState<WorkspaceTool | null>(null)
  const [quota, setQuota] = useState<{
    usedToday: number
    dailyLimit: number | null
    estimatedTokensToday: number
  } | null>(null)
  // Per-user generation tuning from Settings (Model & Generation). Applied to
  // every chat request; null = provider defaults.
  const [temperature, setTemperature] = useState<number | null>(null)
  const [maxCompletionTokens, setMaxCompletionTokens] = useState<number | null>(null)
  // Per-message "via <model>" captions (Settings → Model & Generation).
  const [showModelCaptions, setShowModelCaptions] = useState(true)
  // Per-session skill override. null = use the full catalog (defaults).
  const [enabledSkills, setEnabledSkills] = useState<string[] | null>(null)
  // Override chosen before a session existed; applied + persisted the moment a
  // session id arrives (see the skill-load effect below).
  const pendingSkillsRef = useRef<string[] | null>(null)
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
    // Clear the previous page while the debounced server search is pending;
    // otherwise stale rows remain interactive and can make a new query appear
    // not to have filtered yet.
    setSessions([])
    setHasMore(false)
    const timer = setTimeout(() => void loadSessions({ search, skip: 0 }), 250)
    return () => clearTimeout(timer)
  }, [search, showArchived, loadSessions])

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    setSessionIdState(getSessionId())
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    let storedModelKey: ModelKey | null = null
    try {
      const storedModel = ModelKeySchema.safeParse(localStorage.getItem('chat.model'))
      if (storedModel.success) storedModelKey = storedModel.data
    } catch {
      // Best-effort.
    }
    // Load preferences: a locally stored model choice wins; otherwise the
    // user's preferred default model applies. Generation tuning always rides
    // along.
    void getUserPreferences().then((result) => {
      if (!result.ok) return
      const preferred = result.data.preferredModel
      const preferredKey = ModelKeySchema.safeParse(preferred)
      if (storedModelKey !== null) {
        setSelectedModel(storedModelKey)
      } else if (preferredKey.success && !modelSelectionTouchedRef.current) {
        setSelectedModel(preferredKey.data)
      }
      setTemperature(result.data.temperature)
      setMaxCompletionTokens(result.data.maxCompletionTokens)
      setShowModelCaptions(result.data.showModelCaptions)
    })
    void getWorkspaceTasks().then((result) => {
      if (result.ok) {
        setTasks(result.tasks)
        if (result.activeTaskId) setActiveTaskId(result.activeTaskId)
      }
    })
    void getBillingStatus().then((result) => {
      if (result.ok) {
        setQuota({
          usedToday: result.data.usedToday,
          dailyLimit: result.data.dailyLimit,
          estimatedTokensToday: result.data.estimatedTokensToday,
        })
      }
    })
    void refreshSessions()
    void listCustomAgents().then((result) => {
      if (result.ok) setCustomAgents(result.agents)
    })
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
      pendingSkillsRef.current = null
      // New chat while no session is active: Chat's [sessionId] restore effect
      // won't re-run (the id didn't change), so signal it to reset the thread.
      setResetNonce((nonce) => nonce + 1)
    }
    // Start blank; the skill-load effect below fetches the real override.
    setEnabledSkills(null)
  }

  /**
   * Load a session's skill override. When a session was just created while the
   * user had customized skills (pending override), persist it to the session
   * and use it instead of the (likely empty) fetched value.
   */
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void getSessionSkills(sessionId).then((result) => {
      if (cancelled || !result.ok) return
      const pending = pendingSkillsRef.current
      if (pending !== null) {
        pendingSkillsRef.current = null
        setEnabledSkills(pending)
        void updateSessionSkills({ sessionId, enabledSkills: pending })
        return
      }
      setEnabledSkills(result.enabledSkills)
    })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  function handleEnabledSkillsChange(next: string[] | null) {
    setEnabledSkills(next)
    if (sessionId) {
      void updateSessionSkills({ sessionId, enabledSkills: next })
    } else {
      pendingSkillsRef.current = next
    }
  }

  async function createTask() {
    const nextNumber = tasks.length + 1
    const result = await createWorkspaceTask({ name: `New task ${nextNumber}` })
    if (!result.ok) return
    setTasks((current) => [...current, result.task])
    setActiveTaskId(result.activeTaskId)
  }

  function selectTask(id: string) {
    setActiveTaskId(id)
    // The action verifies authentication and ownership. Calling it directly
    // also covers the short window while NextAuth is still hydrating the
    // client session after the persisted task list has loaded.
    void setActiveWorkspaceTask(id)
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

  // Active conversation metadata for the header: the session's title and the
  // model that served its last assistant reply (from the sidebar summary's
  // lastModel). Null when no session is active (e.g. a fresh new chat).
  const activeSession = sessionId ? (sessions.find((s) => s.id === sessionId) ?? null) : null
  const activeAgent = selectedAgentId
    ? (customAgents.find((agent) => agent.id === selectedAgentId) ?? null)
    : null

  const assistantThemeStyles: Record<CustomAgentTheme, Record<string, string>> = {
    emerald: {
      '--accent': '#34d399',
      '--accent-soft': 'rgba(52, 211, 153, 0.08)',
      '--accent-medium': 'rgba(52, 211, 153, 0.16)',
      '--accent-glow': 'rgba(52, 211, 153, 0.22)',
    },
    sapphire: {
      '--accent': '#60a5fa',
      '--accent-soft': 'rgba(96, 165, 250, 0.1)',
      '--accent-medium': 'rgba(96, 165, 250, 0.2)',
      '--accent-glow': 'rgba(96, 165, 250, 0.24)',
    },
    violet: {
      '--accent': '#a78bfa',
      '--accent-soft': 'rgba(167, 139, 250, 0.1)',
      '--accent-medium': 'rgba(167, 139, 250, 0.2)',
      '--accent-glow': 'rgba(167, 139, 250, 0.24)',
    },
    obsidian: {
      '--accent': '#94a3b8',
      '--accent-soft': 'rgba(148, 163, 184, 0.1)',
      '--accent-medium': 'rgba(148, 163, 184, 0.2)',
      '--accent-glow': 'rgba(148, 163, 184, 0.2)',
    },
    amber: {
      '--accent': '#fbbf24',
      '--accent-soft': 'rgba(251, 191, 36, 0.1)',
      '--accent-medium': 'rgba(251, 191, 36, 0.2)',
      '--accent-glow': 'rgba(251, 191, 36, 0.24)',
    },
  }
  const activeAssistantTheme = activeAgent?.theme ?? 'emerald'

  function selectModel(value: string) {
    const parsed = ModelKeySchema.safeParse(value)
    if (!parsed.success) return
    modelSelectionTouchedRef.current = true
    setSelectedModel(parsed.data)
    try {
      localStorage.setItem('chat.model', parsed.data)
    } catch {
      // Best-effort.
    }
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
        tasks={tasks}
        activeTaskId={activeTaskId}
        onSelectTask={selectTask}
        onCreateTask={createTask}
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
        onOpenSettings={() => (window.location.href = '/settings')}
        onClose={() => setMenuOpen(false)}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        sessions={sessions}
        activeSessionId={sessionId}
        theme={theme}
        onSelectSession={(id) => {
          handleSessionChange(id)
          setCommandPaletteOpen(false)
        }}
        onNewChat={() => {
          handleSessionChange(null)
          setCommandPaletteOpen(false)
        }}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => {
          window.location.href = '/settings'
          setCommandPaletteOpen(false)
        }}
      />

      <main
        id="main"
        className="flex min-w-0 flex-1 flex-col vt-chat-shell"
        style={assistantThemeStyles[activeAssistantTheme] as CSSProperties}
        data-assistant-theme={activeAssistantTheme}
      >
        <header
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
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
                className="vt-brand-icon flex size-7 items-center justify-center rounded-lg border"
                style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold-border)' }}
              >
                <HugeiconsIcon
                  icon={MenuIcon}
                  size={13}
                  strokeWidth={2}
                  className="text-[var(--gold)]"
                />
              </div>
              <div className="min-w-0">
                <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
                  Chatbot
                </h1>
                {/* Active conversation metadata — the session title and the
                    model that served its last reply, so which model answered
                    is visible without opening the sidebar. Always rendered
                    (invisible when no session) so the header height is stable
                    and visual snapshots can mask the slot deterministically. */}
                <p
                  className={`max-w-40 truncate text-[10px] text-[var(--text-tertiary)] sm:max-w-64 ${
                    activeSession ? '' : 'invisible'
                  }`}
                  data-testid="conversation-meta"
                >
                  {activeSession?.title ?? ''}
                  {activeSession?.lastModel ? (
                    <>
                      {' '}
                      ·{' '}
                      <span className="font-mono" data-testid="conversation-model">
                        via {activeSession.lastModel}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
            </div>
          </div>
          <div className="flex min-w-0 max-w-full flex-1 flex-wrap items-center justify-end gap-1">
            <nav
              aria-label="Workspace tools"
              className="flex items-center gap-0.5 rounded-xl p-0.5"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
            >
              {WORKSPACE_TOOLS.map(({ id, label, Icon }) => {
                const active = activeWorkspaceTool === id
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    aria-label={label}
                    title={label}
                    data-testid={`workspace-${id}`}
                    onClick={() => setActiveWorkspaceTool(active ? null : id)}
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors sm:px-2.5 ${
                      active
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                )
              })}
            </nav>
            <SkillPicker enabledSkills={enabledSkills} onChange={handleEnabledSkillsChange} />
            <label
              className="flex items-center rounded-xl px-2.5 py-1.5 text-xs text-[var(--text-secondary)]"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
            >
              <span className="sr-only">Select assistant</span>
              <select
                value={selectedAgentId ?? ''}
                onChange={(event) => setSelectedAgentId(event.target.value || null)}
                aria-label="Select custom assistant"
                className="max-w-28 cursor-pointer truncate bg-transparent outline-none sm:max-w-40"
              >
                <option value="">Default assistant</option>
                {customAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="flex items-center rounded-xl px-2.5 py-1.5 text-xs text-[var(--text-secondary)]"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
            >
              <span className="sr-only">AI model</span>
              <select
                value={selectedModel}
                onChange={(event) => selectModel(event.target.value)}
                aria-label="Select AI model"
                className="max-w-36 cursor-pointer truncate bg-transparent outline-none sm:max-w-48"
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <span
              data-testid="quota-badge"
              title={
                quota
                  ? `${formatCompactNumber(quota.estimatedTokensToday)} estimated tokens used today`
                  : 'Daily quota usage'
              }
              className="flex h-8 items-center gap-1.5 rounded-xl px-2 text-[11px] font-medium text-emerald-400 sm:px-2.5"
              style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-medium)' }}
            >
              <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              <span className="sm:hidden">Quota </span>
              <span className="hidden sm:inline">Daily quota </span>
              <span>
                {quota
                  ? quota.dailyLimit === null
                    ? `${formatCompactNumber(quota.estimatedTokensToday)} tokens`
                    : `${quota.usedToday}/${quota.dailyLimit}`
                  : '...'}
              </span>
            </span>
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
              <kbd
                className="rounded px-1 py-0.5 text-[10px]"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
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
                    <div className="flex size-6 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20">
                      <HugeiconsIcon
                        icon={UserIcon}
                        size={12}
                        strokeWidth={1.5}
                        className="text-emerald-400"
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
            resetNonce={resetNonce}
            modelKey={selectedModel}
            customAgentId={selectedAgentId}
            assistantName={activeAgent?.name ?? 'Chatbot'}
            enabledSkills={enabledSkills}
            temperature={temperature}
            maxCompletionTokens={maxCompletionTokens}
            showModelCaptions={showModelCaptions}
            activeWorkspaceTool={activeWorkspaceTool}
            onWorkspaceToolChange={setActiveWorkspaceTool}
            onSessionChange={handleSessionChange}
            onConversationChanged={refreshSessions}
          />
        )}
      </main>
    </div>
  )
}
