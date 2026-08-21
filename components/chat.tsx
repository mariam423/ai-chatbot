'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { RefreshIcon, SendIcon, TrashIcon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { clearChatSession, getChatSession, saveChatMessages } from '@/app/actions'
import { readSSEStream } from '@/lib/sse'
import { clearThread, loadThread, saveThread } from '@/lib/storage'
import type { ChatMessage, ChatWireMessage } from '@/lib/types'
import { MAX_INPUT_LENGTH, isValidMessageInput } from '@/lib/validation'
import MessageBubble from './message-bubble'
import StreamingSkeleton from './streaming-skeleton'

interface ChatProps {
  /** The active DB session, or null for a fresh chat. */
  sessionId: string | null
  /** Called when a session id is created or cleared. */
  onSessionChange: (id: string | null) => void
  /** Called after a DB write so the sidebar can refresh its session list. */
  onConversationChanged: () => void
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function Chat({ sessionId, onSessionChange, onConversationChanged }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [restored, setRestored] = useState(false)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  // Bumped on every local thread mutation (send/regenerate/clear) so a
  // stale async restore can detect it is out of date (see the restore effect).
  const threadGenRef = useRef(0)

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }

  // Restore the persisted thread after mount.
  useEffect(() => {
    let cancelled = false
    const gen = threadGenRef.current
    async function restore() {
      let initial = loadThread()
      if (sessionId) {
        const result = await getChatSession(sessionId)
        if (!cancelled && gen === threadGenRef.current && result.ok && result.messages.length > 0) {
          initial = result.messages
        }
      }
      if (!cancelled && gen === threadGenRef.current) {
        setMessages(initial)
        setRestored(true)
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isStreaming])

  // Persist stable conversation states (FR-9).
  useEffect(() => {
    if (!restored || isStreaming) return
    saveThread(messages)
  }, [messages, isStreaming, restored])

  async function send(text: string, base?: ChatMessage[]) {
    const content = text.trim()
    if (content === '' || isStreaming) return
    threadGenRef.current += 1

    const userMessage: ChatMessage = { id: newId(), role: 'user', content }
    const history =
      base && base[base.length - 1]?.role === 'user' && base[base.length - 1]!.content === content
        ? base
        : [...(base ?? messages), userMessage]
    setMessages(history)
    setInput('')
    setError(null)
    setRetryMessage(content)
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    const assistantId = newId()
    let reply = ''
    let settled = false
    setMessages([...history, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map<ChatWireMessage>(({ role, content: c }) => ({
            role,
            content: c,
          })),
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        let message = `Request failed (${response.status}).`
        try {
          const body = (await response.json()) as { error?: string; detail?: string }
          if (body.error) message = body.detail ? `${body.error} ${body.detail}` : body.error
        } catch {
          // keep the status-based message
        }
        throw new Error(message)
      }

      if (!response.body) {
        throw new Error('The server returned an empty response.')
      }

      const aborted = await readSSEStream(response.body, {
        signal: controller.signal,
        onDelta: (delta) => {
          reply += delta
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (!last || last.role !== 'assistant' || last.id !== assistantId) return prev
            return [...prev.slice(0, -1), { ...last, content: last.content + delta }]
          })
        },
      })
      settled = true

      if (!aborted) {
        setError(null)
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Cancelled
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
        setMessages((prev) =>
          prev[prev.length - 1]?.role === 'assistant' && prev[prev.length - 1]!.content === ''
            ? prev.slice(0, -1)
            : prev,
        )
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }

    const settledThread: ChatMessage[] =
      settled && reply !== ''
        ? [...history, { id: assistantId, role: 'assistant', content: reply }]
        : history
    saveThread(settledThread)
    void persistToDb(settledThread)
  }

  async function persistToDb(thread: ChatMessage[]): Promise<void> {
    let sid = sessionId
    if (!sid) {
      sid = newId()
      onSessionChange(sid)
    }
    const result = await saveChatMessages({ sessionId: sid, messages: thread })
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
    setMessages(trimmed)
    void send(userText, trimmed)
  }

  function clearConversation() {
    if (isStreaming) return
    threadGenRef.current += 1
    if (sessionId) void clearChatSession(sessionId)
    onSessionChange(null)
    clearThread()
    setMessages([])
    setError(null)
    setRetryMessage(null)
    setInput('')
  }

  const canSend = !isStreaming && isValidMessageInput(input)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-24">
            <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 dark:from-violet-500/20 dark:to-indigo-500/20">
              <HugeiconsIcon
                icon={RefreshIcon}
                size={20}
                strokeWidth={1.5}
                className="text-violet-500 dark:text-violet-400"
              />
            </div>
            <p className="text-center text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Ask me anything
            </p>
            <p className="mt-1 text-center text-xs text-zinc-400 dark:text-zinc-500">
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
                <MessageBubble message={message} />
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
                      className="mt-1 ml-10 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
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

        <AnimatePresence>
          {error && (
            <motion.div
              role="alert"
              data-testid="chat-error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="rounded-xl border border-red-200/80 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
            >
              <p>{error}</p>
              <button
                type="button"
                onClick={retry}
                className="mt-1 font-medium text-red-700 underline underline-offset-2 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200"
              >
                Retry
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <form
        className="flex items-end gap-2 border-t border-zinc-100 bg-white/80 px-4 py-3 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/80"
        onSubmit={(event) => {
          event.preventDefault()
          void send(input)
        }}
      >
        <motion.button
          type="button"
          onClick={clearConversation}
          disabled={isStreaming || messages.length === 0}
          aria-label="Clear"
          whileHover={reducedMotion ? undefined : { scale: 1.05 }}
          whileTap={reducedMotion ? undefined : { scale: 0.95 }}
          className="shrink-0 rounded-xl p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
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
            }
          }}
          rows={1}
          maxLength={MAX_INPUT_LENGTH}
          placeholder="Type a message..."
          className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:ring-zinc-700"
        />
        {isStreaming ? (
          <motion.button
            type="button"
            onClick={stop}
            whileHover={reducedMotion ? undefined : { scale: 1.02 }}
            whileTap={reducedMotion ? undefined : { scale: 0.98 }}
            className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] dark:hover:bg-zinc-750"
          >
            Stop
          </motion.button>
        ) : (
          <motion.button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            whileHover={reducedMotion ? undefined : { scale: 1.02 }}
            whileTap={reducedMotion ? undefined : { scale: 0.98 }}
            className="rounded-xl bg-gradient-to-b from-zinc-800 to-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[0_2px_8px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.06)] transition-all hover:from-zinc-700 hover:to-zinc-800 disabled:cursor-not-allowed disabled:opacity-30 dark:from-zinc-700 dark:to-zinc-800 dark:shadow-[0_2px_8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:from-zinc-600 dark:hover:to-zinc-700"
          >
            <HugeiconsIcon icon={SendIcon} size={16} strokeWidth={1.5} />
          </motion.button>
        )}
      </form>
    </div>
  )
}
