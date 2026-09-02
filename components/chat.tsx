'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  AiSparklesIcon,
  RefreshIcon,
  SendIcon,
  TrashIcon,
  GitBranchIcon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearChatSession,
  createChatSession,
  getChatSession,
  getUserPreferences,
  saveChatMessages,
  setActiveBranch,
  updateSessionSystemPrompt,
} from '@/app/actions'
import { readSSEStream } from '@/lib/sse'
import {
  clearThread,
  loadThreadState,
  saveThreadState,
  setSessionId,
  type ThreadState,
} from '@/lib/storage'
import { detectStructuredOutputKind, renderStructuredResponse } from '@/lib/structured-output'
import type { VideoFrame } from '@/lib/video'
import type { ModelKey } from '@/lib/models'
import { EVENTS, useAnalytics } from '@/lib/use-analytics'
import {
  BUILTIN_PRESETS,
  type ChatMessage,
  type ChatWireMessage,
  type SystemPromptPreset,
  UploadedDocumentSchema,
  type UploadedDocument,
  type WorkspaceTool,
} from '@/lib/types'

import { MAX_INPUT_LENGTH, isValidMessageInput } from '@/lib/validation'
import MessageBubble from './message-bubble'
import LoadingBadge from './loading-badge'
import StreamingSkeleton from './streaming-skeleton'
import FileUpload from './file-upload'
import MediaUpload from './media-upload'
// The mic's MediaRecorder/Web-Speech logic is heavy — lazy-load it so it
// ships as a separate chunk only loaded when the composer renders.
const AudioInput = dynamic(() => import('./audio-input'), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="flex size-9 items-center justify-center rounded-full text-[var(--text-tertiary)]"
    >
      <HugeiconsIcon icon={AiSparklesIcon} size={16} strokeWidth={1.5} />
    </div>
  ),
})
import ChatExport from './chat-export'
import WorkspacePanel from './workspace-panel'

interface ChatProps {
  sessionId: string | null
  /** Bumped by the shell on New Chat / delete-active while sessionId is null. */
  resetNonce?: number
  modelKey: ModelKey
  /** Optional user-owned assistant persona selected in the chat header. */
  customAgentId?: string | null
  /** Display name for transcript metadata and the active assistant theme. */
  assistantName?: string
  /** Per-session skill override; null = default catalog. */
  enabledSkills: string[] | null
  /** Generation tuning from user settings; null = provider defaults. */
  temperature?: number | null
  maxCompletionTokens?: number | null
  /** Show the per-message "via <model>" captions (user setting; default on). */
  showModelCaptions?: boolean
  activeWorkspaceTool?: WorkspaceTool | null
  onWorkspaceToolChange?: (tool: WorkspaceTool | null) => void
  onSessionChange: (id: string | null) => void
  onConversationChanged: () => void
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** The initial single-branch, empty thread state. */
const EMPTY_THREAD: ThreadState = { branches: [[]], active: 0 }

export default function Chat({
  sessionId,
  resetNonce = 0,
  modelKey,
  customAgentId = null,
  assistantName = 'Chatbot',
  enabledSkills,
  temperature = null,
  maxCompletionTokens = null,
  showModelCaptions = true,
  activeWorkspaceTool = null,
  onWorkspaceToolChange,
  onSessionChange,
  onConversationChanged,
}: ChatProps) {
  // Analytics events are fire-and-forget and never block the send path.
  const { track } = useAnalytics()
  const [thread, setThread] = useState<ThreadState>(EMPTY_THREAD)
  // Imperative mirror of `thread`, kept current so async persistence and the
  // fork-on-edit flow read the latest state without stale render closures.
  const threadRef = useRef<ThreadState>(EMPTY_THREAD)
  const [restored, setRestored] = useState(false)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null)
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [videoFrames, setVideoFrames] = useState<VideoFrame[]>([])
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null)
  const [customPresets, setCustomPresets] = useState<SystemPromptPreset[]>([])
  const [presetMenuOpen, setPresetMenuOpen] = useState(false)
  const presetMenuRef = useRef<HTMLDivElement>(null)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const threadGenRef = useRef(0)
  const documentsRevisionRef = useRef(0)

  // The active branch is what the UI renders; other branches are preserved for
  // toggling when a past prompt has been edited (tree-branching / forks).
  const messages = useMemo(() => thread.branches[thread.active] ?? [], [thread])

  /** Set the thread state, keeping `threadRef` in sync imperatively. */
  const commitThread = useCallback((next: ThreadState) => {
    threadRef.current = next
    setThread(next)
  }, [])

  /** Update the currently active branch in place (streaming appends, etc.). */
  const updateActive = useCallback(
    (updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
      const prev = threadRef.current
      if (prev.active < 0 || prev.active >= prev.branches.length) return
      commitThread({
        ...prev,
        branches: prev.branches.map((branch, i) => (i === prev.active ? updater(branch) : branch)),
      })
    },
    [commitThread],
  )

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }

  useEffect(() => {
    let cancelled = false
    const gen = threadGenRef.current
    async function restore() {
      let initial = loadThreadState()
      if (sessionId) {
        const result = await getChatSession(sessionId)
        if (!cancelled && gen === threadGenRef.current && result.ok) {
          if (result.branches.length > 0 && result.branches.some((b) => b.length > 0)) {
            // Restore DB-persisted branches (survives session switches).
            initial = { branches: result.branches, active: result.active }
          }
          setSystemPrompt(result.systemPrompt ?? null)
        }
      }
      if (!cancelled && gen === threadGenRef.current) {
        commitThread(initial)
        setRestored(true)
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // External clear (sidebar New Chat / delete-active while sessionId is null):
  // the [sessionId] restore effect above only re-runs when the id CHANGES, so
  // clearing a still-unsigned first conversation would otherwise leave the old
  // thread on screen. Bump the generation too so any in-flight save/restore
  // from the previous conversation abandons its work instead of resurrecting
  // the cleared thread (slow saves resolving after a clear were the bug).
  const resetNonceRef = useRef(resetNonce)
  useEffect(() => {
    if (resetNonce === resetNonceRef.current) return
    resetNonceRef.current = resetNonce
    threadGenRef.current += 1
    abortRef.current?.abort()
    commitThread(EMPTY_THREAD)
    setError(null)
    setRetryMessage(null)
    setInput('')
    setSystemPrompt(null)
  }, [resetNonce, commitThread])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isStreaming])

  useEffect(() => {
    if (!sessionId) {
      documentsRevisionRef.current += 1
      return
    }
    let cancelled = false
    const revision = documentsRevisionRef.current
    void fetch(`/api/upload?sessionId=${encodeURIComponent(sessionId)}`)
      .then(async (response) => {
        if (!response.ok) return null
        const payload: unknown = await response.json()
        if (typeof payload !== 'object' || payload === null || !('documents' in payload))
          return null
        const documents = payload.documents
        if (!Array.isArray(documents)) return null
        return documents.flatMap((document) => {
          const parsed = UploadedDocumentSchema.safeParse(document)
          return parsed.success ? [parsed.data] : []
        })
      })
      .then((loaded) => {
        if (!cancelled && loaded && revision === documentsRevisionRef.current) setDocuments(loaded)
      })
      .catch(() => {
        /* The chat remains usable if document metadata cannot be loaded. */
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    if (!restored || isStreaming) return
    saveThreadState(thread)
  }, [thread, isStreaming, restored])

  // Load custom presets from user preferences on mount.
  useEffect(() => {
    let cancelled = false
    void getUserPreferences().then((result) => {
      if (cancelled || !result.ok) return
      try {
        setCustomPresets(JSON.parse(result.data.systemPromptPresets) as SystemPromptPreset[])
      } catch {
        /* ignore */
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Close preset menu on outside click or Esc. Without the Esc handler, the
  // dropdown stays open until you click somewhere else, which is jarring
  // — and Chrome's default Esc on the focused trigger button does an
  // implicit blur-then-restore that looks like the composer is "filling
  // itself in" with the draft text.
  useEffect(() => {
    if (!presetMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
        setPresetMenuOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setPresetMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [presetMenuOpen])

  const allPresets = [...BUILTIN_PRESETS, ...customPresets]

  const activePresetName = systemPrompt
    ? (allPresets.find((p) => p.prompt === systemPrompt)?.name ?? 'Custom')
    : 'Base assistant'

  const selectPreset = useCallback(
    async (preset: SystemPromptPreset | null) => {
      const newPrompt = preset?.prompt ?? null
      setSystemPrompt(newPrompt)
      setPresetMenuOpen(false)
      if (sessionId) {
        await updateSessionSystemPrompt({
          sessionId,
          systemPrompt: newPrompt ?? '',
        })
      }
    },
    [sessionId],
  )

  async function send(text: string, base?: ChatMessage[]) {
    const content = text.trim()
    if (content === '' || isStreaming) return
    threadGenRef.current += 1

    const userMessage: ChatMessage = { id: newId(), role: 'user', content }
    const history =
      base && base[base.length - 1]?.role === 'user' && base[base.length - 1]!.content === content
        ? base
        : [...(base ?? messages), userMessage]
    updateActive(() => history)
    setInput('')
    setError(null)
    setRetryMessage(content)
    setIsStreaming(true)
    track(EVENTS.messageSent, { model: modelKey, branch: String(thread.active) })

    const controller = new AbortController()
    abortRef.current = controller

    const assistantId = newId()
    let reply = ''
    let pendingReply = ''
    const structuredOutput = detectStructuredOutputKind(content, documents.length > 0)
    updateActive(() => [...history, { id: assistantId, role: 'assistant', content: '' }])

    const flushReply = () => {
      if (pendingReply === '') return
      const chunk = pendingReply
      pendingReply = ''
      updateActive((prev) => {
        const last = prev[prev.length - 1]
        if (!last || last.role !== 'assistant' || last.id !== assistantId) return prev
        return [...prev.slice(0, -1), { ...last, content: last.content + chunk }]
      })
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map<ChatWireMessage>(({ role, content: c }) => ({ role, content: c })),
          ...(systemPrompt ? { systemPrompt } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(customAgentId ? { customAgentId } : {}),
          ...(enabledSkills !== null ? { enabledSkills } : {}),
          model: modelKey,
          ...(temperature !== null ? { temperature } : {}),
          ...(maxCompletionTokens !== null ? { maxTokens: maxCompletionTokens } : {}),
          ...(structuredOutput ? { structuredOutput } : {}),
          ...(videoFrames.length > 0 ? { videoFrames } : {}),
          ...(imageDataUrl ? { imageDataUrl } : {}),
          ...(audioDataUrl ? { audioDataUrl } : {}),
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        let message = `Request failed (${response.status}).`
        try {
          const body = (await response.json()) as { error?: string; detail?: string }
          if (body.error) message = body.detail ? `${body.error} ${body.detail}` : body.error
        } catch {
          /* keep status-based message */
        }
        throw new Error(message)
      }

      // The route reports the model that actually served the reply (after any
      // error-fallback retry) — stamp it onto the assistant message so branch
      // history shows which model answered. The overridden flag (vision
      // auto-routing or a fallback retry) drives the amber warning caption.
      const served = response.headers.get('x-served-model')
      if (served) {
        const overridden = response.headers.get('x-served-model-overridden') === 'true'
        updateActive((prev) => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== 'assistant' || last.id !== assistantId) return prev
          return [...prev.slice(0, -1), { ...last, model: served, modelOverridden: overridden }]
        })
      }

      if (!response.body) throw new Error('The server returned an empty response.')

      const aborted = await readSSEStream(response.body, {
        signal: controller.signal,
        onDelta: (delta) => {
          reply += delta
          if (structuredOutput) return
          pendingReply += delta
          // Coalesce provider token deltas into word-sized updates while still
          // flushing long code/URL runs promptly.
          if (/\s/.test(delta) || pendingReply.length >= 48) flushReply()
        },
      })
      flushReply()
      if (structuredOutput && reply !== '') {
        const rendered = structuredOutput === 'chart' ? reply : renderStructuredResponse(reply)
        updateActive((prev) => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== 'assistant' || last.id !== assistantId) return prev
          return [...prev.slice(0, -1), { ...last, content: rendered }]
        })
      }
      if (!aborted) setError(null)
    } catch (err) {
      if (controller.signal.aborted) {
        /* Cancelled */
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
        updateActive((prev) =>
          prev[prev.length - 1]?.role === 'assistant' && prev[prev.length - 1]!.content === ''
            ? prev.slice(0, -1)
            : prev,
        )
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }

    void persistToDb()
  }

  /**
   * Inline-edit a past user message: fork a NEW branch from the shared context
   * prefix (dropping the old continuation) and regenerate from there. The old
   * branch is preserved so the user can toggle back without losing context.
   */
  async function editMessage(index: number, newText: string) {
    const content = newText.trim()
    if (content === '' || content === messages[index]?.content) return
    const prefix = messages.slice(0, index)
    // Activate a fresh fork from the shared prefix; send() appends the edited
    // prompt and streams the regenerated reply onto this new active branch.
    const prev = threadRef.current
    commitThread({ branches: [...prev.branches, prefix], active: prev.branches.length })
    void send(content, prefix)
  }

  async function persistToDb(): Promise<void> {
    // Persist the whole branched thread so forks survive a session switch. The
    // active branch + any skill override ride along (atomically on first save).
    const state = threadRef.current
    let sid = sessionId
    if (!sid) {
      sid = newId()
      track(EVENTS.sessionCreated)
      // Write the session id to localStorage synchronously so a fast reload
      // right after send still finds it (the DB save is async and may not have
      // landed by the time the user navigates away). BUT don't publish it to
      // React state yet — the [sessionId] restore effect would re-run against
      // the as-yet-unsaved session and clobber the live thread. Publish it via
      // onSessionChange only once the save commits.
      setSessionId(sid)
    }
    // Nothing to persist (e.g. the stream was aborted by a mid-flight New
    // Chat and the thread was reset) — don't create a junk empty session.
    if (state.branches.every((branch) => branch.length === 0)) return
    const genAtSave = threadGenRef.current
    const result = await saveChatMessages({
      sessionId: sid,
      branches: state.branches,
      active: state.active,
      ...(enabledSkills !== null ? { enabledSkills } : {}),
    })
    // Publish the new session id only if the conversation wasn't cleared or
    // replaced while the save was in flight — a slow save resolving after
    // New Chat would otherwise resurrect the just-cleared thread.
    if (result.ok && !sessionId && genAtSave === threadGenRef.current) onSessionChange(sid)
    if (result.ok) onConversationChanged()
  }

  function stop() {
    abortRef.current?.abort()
  }
  function retry() {
    if (retryMessage) void send(retryMessage)
  }
  function regenerate() {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || isStreaming) return
    const trimmed = messages.slice(0, -1)
    const userText = [...trimmed].reverse().find((m) => m.role === 'user')?.content
    if (!userText) return
    updateActive(() => trimmed)
    void send(userText, trimmed)
  }

  function clearConversation() {
    if (isStreaming) return
    threadGenRef.current += 1
    if (sessionId) void clearChatSession(sessionId)
    onSessionChange(null)
    clearThread()
    commitThread(EMPTY_THREAD)
    setError(null)
    setRetryMessage(null)
    setInput('')
    documentsRevisionRef.current += 1
    setDocuments([])
    setVideoFrames([])
    setImageDataUrl(null)
    setAudioDataUrl(null)
  }

  async function createSessionForDocument(): Promise<string | null> {
    const result = await createChatSession()
    if (!result.ok) return null
    onSessionChange(result.sessionId)
    return result.sessionId
  }

  function handleDocumentsChange(next: UploadedDocument[]) {
    documentsRevisionRef.current += 1
    setDocuments(next)
  }

  const canSend = !isStreaming && isValidMessageInput(input)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ─── Chat tools ─── */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-[11px] font-medium text-[var(--text-tertiary)]">{assistantName}</span>
        <ChatExport
          messages={messages}
          title={messages.find((m) => m.role === 'user')?.content}
          assistantName={assistantName}
          disabled={isStreaming}
        />
      </div>
      {activeWorkspaceTool && (
        <WorkspacePanel
          tool={activeWorkspaceTool}
          sessionId={sessionId}
          messages={messages}
          documents={documents}
          onDocumentsChange={handleDocumentsChange}
          onSessionRequired={createSessionForDocument}
          onNewChat={clearConversation}
          onClose={() => onWorkspaceToolChange?.(null)}
        />
      )}

      {/* ─── Branch switcher (visible only once a thread has forked) ─── */}
      {thread.branches.length > 1 && (
        <div
          className="flex items-center gap-2 overflow-x-auto px-4 py-2"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">
            <HugeiconsIcon icon={GitBranchIcon} size={13} strokeWidth={1.5} />
            Versions
          </span>
          <div className="flex items-center gap-1.5">
            {thread.branches.map((branch, i) => {
              const active = i === thread.active
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    commitThread({ ...threadRef.current, active: i })
                    // Persist the newly active branch for this session.
                    if (sessionId) void setActiveBranch({ sessionId, active: i })
                  }}
                  aria-pressed={active}
                  aria-label={`Show version ${i + 1}`}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    background: active ? 'var(--accent-soft)' : 'var(--bg-input)',
                    border: `1px solid ${active ? 'var(--accent-medium)' : 'var(--border-subtle)'}`,
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <HugeiconsIcon
                    icon={GitBranchIcon}
                    size={11}
                    strokeWidth={1.5}
                    className={active ? 'text-emerald-500' : 'text-[var(--text-muted)]'}
                  />
                  v{i + 1}
                  <span className="text-[10px] text-[var(--text-tertiary)]">
                    {branch.length} msgs
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        data-testid="message-list"
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-24">
            <div
              className="mb-4 flex size-12 items-center justify-center rounded-2xl"
              style={{
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-medium)',
              }}
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                size={20}
                strokeWidth={1.5}
                className="text-emerald-400"
              />
            </div>
            <p className="text-center text-sm font-medium text-[var(--text-secondary)]">
              Ask me anything
            </p>
            <p className="mt-1 text-center text-xs text-[var(--text-tertiary)]">
              I stream replies as they are generated
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((message, index) => (
              <motion.div
                key={message.id}
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <MessageBubble
                  message={message}
                  sessionId={sessionId}
                  editable={message.role === 'user' && !isStreaming}
                  onEditSave={(next) => void editMessage(index, next)}
                />
                {/* "via <model>" caption per assistant message — persisted on
                    the message (from the X-Served-Model header) so branch
                    history shows which model answered. Amber warning + a
                    "fallback" tag only when the error-fallback retry fired
                    (X-Served-Model-Overridden); vision auto-routing stays
                    neutral. Hidden entirely when the user disables captions
                    in settings. */}
                {showModelCaptions && message.role === 'assistant' && message.model && (
                  <p
                    className="mt-1 ml-10 text-[11px] text-[var(--text-muted)]"
                    data-testid="served-model"
                    data-overridden={message.modelOverridden || undefined}
                  >
                    via{' '}
                    <code
                      className={
                        message.modelOverridden
                          ? 'rounded border border-[var(--gold-border)] bg-[var(--gold-soft)] px-1 py-0.5 font-mono text-[10px] text-[var(--gold)]'
                          : 'rounded bg-[var(--bg-input)] px-1 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]'
                      }
                    >
                      {message.model}
                    </code>
                    {message.modelOverridden && (
                      <span className="ml-1.5 font-medium text-[var(--gold)]">fallback</span>
                    )}
                  </p>
                )}
                {message.role === 'assistant' &&
                  !isStreaming &&
                  message.content !== '' &&
                  index === messages.length - 1 && (
                    <motion.button
                      type="button"
                      onClick={regenerate}
                      aria-label="Regenerate response"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2 }}
                      whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                      whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                      className="mt-1 ml-10 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
                    >
                      <HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={1.5} />
                      Regenerate
                    </motion.button>
                  )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {isStreaming && messages.length > 0 && messages[messages.length - 1]!.content === '' && (
          <StreamingSkeleton />
        )}

        {/* Glowing loading badge — appears below the dynamic response block
            while the reply is pending/streaming and exits cleanly on
            completion or error (AnimatePresence plays the exit animation). */}
        <AnimatePresence>{isStreaming && messages.length > 0 && <LoadingBadge />}</AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div
              role="alert"
              data-testid="chat-error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="rounded-xl px-3 py-2.5 text-sm"
              style={{
                background: 'var(--error-bg)',
                border: '1px solid var(--error-border)',
                color: 'var(--error-text)',
              }}
            >
              <p>{error}</p>
              <button
                type="button"
                onClick={retry}
                className="mt-1 font-medium underline underline-offset-2 hover:opacity-80"
                style={{ color: 'var(--error-text)' }}
              >
                Retry
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Streaming status bar ─── */}
      <AnimatePresence>
        {isStreaming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden px-4 py-2"
            style={{
              background: 'var(--accent-soft)',
              borderTop: '1px solid var(--accent-medium)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span>Generating...</span>
              </div>
              <motion.button
                type="button"
                onClick={stop}
                whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)]"
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                Cancel
              </motion.button>
            </div>
            <div className="mt-1.5 streaming-pulse-bar" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Input form ─── */}
      <form
        className="flex items-end gap-2 px-4 py-3"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--border-subtle)',
        }}
        onSubmit={(event) => {
          event.preventDefault()
          void send(input)
        }}
      >
        <AudioInput
          disabled={isStreaming}
          onTranscript={(text) => setInput((prev) => `${prev}${text}`.trimStart())}
        />
        <MediaUpload
          frames={videoFrames}
          onFramesChange={setVideoFrames}
          imageDataUrl={imageDataUrl}
          onImageChange={setImageDataUrl}
          audioDataUrl={audioDataUrl}
          onAudioChange={setAudioDataUrl}
          disabled={isStreaming}
        />
        <FileUpload
          sessionId={sessionId}
          onSessionRequired={createSessionForDocument}
          documents={sessionId ? documents : []}
          onDocumentsChange={handleDocumentsChange}
          disabled={isStreaming}
        >
          {/* System prompt preset selector */}
          <div className="relative shrink-0" ref={presetMenuRef}>
            <motion.button
              type="button"
              onClick={() => setPresetMenuOpen((prev) => !prev)}
              aria-label="Select system prompt"
              aria-expanded={presetMenuOpen}
              aria-haspopup="listbox"
              whileHover={reducedMotion ? undefined : { scale: 1.05 }}
              whileTap={reducedMotion ? undefined : { scale: 0.95 }}
              className="flex items-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium transition-colors"
              style={{
                color: systemPrompt ? 'var(--text-secondary)' : 'var(--text-muted)',
                background: presetMenuOpen ? 'var(--bg-input)' : 'transparent',
                border: presetMenuOpen ? '1px solid var(--border-subtle)' : '1px solid transparent',
              }}
            >
              <HugeiconsIcon
                icon={AiSparklesIcon}
                size={16}
                strokeWidth={1.5}
                className={systemPrompt ? 'text-emerald-500' : ''}
              />
              <span className="hidden max-w-[100px] truncate sm:inline">{activePresetName}</span>
            </motion.button>

            <AnimatePresence>
              {presetMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  role="listbox"
                  aria-label="System prompt presets"
                  className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-xl py-1"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
                  }}
                >
                  <p className="px-3 py-1.5 text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase">
                    Presets
                  </p>
                  {/* Default option — labeled "Base assistant" so it reads as
                      the absence of a system-prompt override, not a
                      separate agent. */}
                  <button
                    type="button"
                    role="option"
                    aria-selected={!systemPrompt}
                    onClick={() => void selectPreset(null)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
                    style={{
                      background: !systemPrompt ? 'var(--accent-soft)' : 'transparent',
                      color: !systemPrompt ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" />
                    <span className="truncate font-medium">Base assistant</span>
                    {!systemPrompt && (
                      <span className="ml-auto text-[10px] text-emerald-500">Active</span>
                    )}
                  </button>
                  {/* Built-in presets */}
                  {BUILTIN_PRESETS.filter((p) => p.id !== 'default').map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      role="option"
                      aria-selected={systemPrompt === preset.prompt}
                      onClick={() => void selectPreset(preset)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
                      style={{
                        background:
                          systemPrompt === preset.prompt ? 'var(--accent-soft)' : 'transparent',
                        color:
                          systemPrompt === preset.prompt
                            ? 'var(--text-primary)'
                            : 'var(--text-secondary)',
                      }}
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span className="truncate font-medium">{preset.name}</span>
                      {systemPrompt === preset.prompt && (
                        <span className="ml-auto text-[10px] text-emerald-500">Active</span>
                      )}
                    </button>
                  ))}
                  {/* Custom presets */}
                  {customPresets.length > 0 && (
                    <>
                      <div
                        className="mx-3 my-1 border-t"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      />
                      <p className="px-3 py-1.5 text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase">
                        Custom
                      </p>
                      {customPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          role="option"
                          aria-selected={systemPrompt === preset.prompt}
                          onClick={() => void selectPreset(preset)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
                          style={{
                            background:
                              systemPrompt === preset.prompt ? 'var(--accent-soft)' : 'transparent',
                            color:
                              systemPrompt === preset.prompt
                                ? 'var(--text-primary)'
                                : 'var(--text-secondary)',
                          }}
                        >
                          <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />
                          <span className="truncate font-medium">{preset.name}</span>
                          {systemPrompt === preset.prompt && (
                            <span className="ml-auto text-[10px] text-emerald-500">Active</span>
                          )}
                        </button>
                      ))}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <motion.button
            type="button"
            onClick={clearConversation}
            disabled={isStreaming || messages.length === 0}
            aria-label="Clear"
            whileHover={reducedMotion ? undefined : { scale: 1.05 }}
            whileTap={reducedMotion ? undefined : { scale: 0.95 }}
            className="shrink-0 rounded-xl p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <HugeiconsIcon icon={TrashIcon} size={18} strokeWidth={1.5} />
          </motion.button>
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send(input)
                return
              }
              if (event.key === 'Escape') {
                // Chrome's default Esc behavior on a focused textarea is to
                // blur it and surface the draft text to the page (it
                // re-injects any IME composition). Users hit Esc expecting
                // "cancel", and instead the textarea re-renders the draft
                // visibly. Two jobs here:
                //   1. If a reply is streaming, Esc stops it.
                //   2. Otherwise, swallow the event so the browser doesn't
                //      blur / re-inject — and let Enter handle send.
                if (isStreaming) {
                  event.preventDefault()
                  stop()
                  return
                }
                event.preventDefault()
              }
            }}
            rows={1}
            maxLength={MAX_INPUT_LENGTH}
            placeholder="Type a message..."
            className="focus-glow max-h-40 min-h-10 flex-1 resize-none rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-medium)',
            }}
          />
          {isStreaming ? (
            <motion.button
              type="button"
              onClick={stop}
              whileHover={reducedMotion ? undefined : { scale: 1.02 }}
              whileTap={reducedMotion ? undefined : { scale: 0.98 }}
              className="rounded-xl px-3.5 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)]"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-medium)',
              }}
            >
              Stop
            </motion.button>
          ) : (
            <motion.button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              whileHover={
                reducedMotion
                  ? undefined
                  : { scale: 1.02, boxShadow: '0 0 20px rgba(16,185,129,0.35)' }
              }
              whileTap={reducedMotion ? undefined : { scale: 0.98 }}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-950 transition-all disabled:cursor-not-allowed disabled:opacity-30"
              style={{
                background: 'linear-gradient(to right, #10b981, #0d9488)',
                boxShadow:
                  '0 4px 14px 0 rgba(16,185,129,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
              }}
            >
              <HugeiconsIcon icon={SendIcon} size={16} strokeWidth={1.5} />
            </motion.button>
          )}
        </FileUpload>
      </form>
    </div>
  )
}
