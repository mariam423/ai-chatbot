'use client'

import { useState } from 'react'
import { readSSEStream } from '@/lib/sse'
import SpeechButton from './speech-button'
import AudioInput from './audio-input'

interface EmbedChatProps {
  agentId: string
  token: string
  assistantName: string
}

interface EmbedMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Minimal iframe-friendly chat surface; provider credentials never reach it. */
export default function EmbedChat({ agentId, token, assistantName }: EmbedChatProps) {
  const [messages, setMessages] = useState<EmbedMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    const nextMessages = [...messages, { role: 'user' as const, content: text }]
    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setInput('')
    setError(null)
    setLoading(true)
    try {
      const response = await fetch(`/api/embed/chat?agentId=${encodeURIComponent(agentId)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(typeof document !== 'undefined' && document.referrer
            ? {
                'X-Embed-Parent-Origin': new URL(document.referrer).origin,
              }
            : {}),
        },
        body: JSON.stringify({ messages: nextMessages }),
      })
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `Request failed (${response.status}).`)
      }
      let reply = ''
      await readSSEStream(response.body, {
        onDelta: (delta) => {
          reply += delta
          setMessages((current) => [...current.slice(0, -1), { role: 'assistant', content: reply }])
        },
      })
    } catch (cause) {
      setMessages((current) => (current.at(-1)?.content ? current : current.slice(0, -1)))
      setError(cause instanceof Error ? cause.message : 'Could not send message.')
    } finally {
      setLoading(false)
    }
  }

  function appendTranscript(transcript: string) {
    setInput((current) => `${current}${transcript}`.trimStart())
  }

  return (
    <main className="flex h-dvh flex-col bg-[var(--embed-bg,#0a0f0d)] text-[var(--embed-text,#e9efeb)]">
      <header className="flex items-center gap-2 border-b border-emerald-400/15 px-4 py-3">
        <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.7)]" />
        <h1 className="min-w-0 truncate text-sm font-semibold">{assistantName}</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-xs text-emerald-100/70">
            Ask {assistantName} anything.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={message.role === 'user' ? 'text-right' : ''}
          >
            <div
              className={`inline-block max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                message.role === 'user'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'border border-white/10 bg-white/5 text-white/90'
              }`}
            >
              {message.content || (loading && index === messages.length - 1 ? '…' : '')}
            </div>
            {message.role === 'assistant' && message.content && (
              <div className="mt-1 flex justify-start">
                <SpeechButton text={message.content} />
              </div>
            )}
          </div>
        ))}
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>
      <form
        className="flex gap-2 border-t border-emerald-400/15 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <label htmlFor="embed-message" className="sr-only">
          Message
        </label>
        <AudioInput disabled={loading} onTranscript={appendTranscript} />
        <textarea
          id="embed-message"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          rows={1}
          maxLength={4_000}
          placeholder="Type a message…"
          className="min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-emerald-400/60"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="rounded-xl bg-emerald-400 px-3 text-sm font-semibold text-slate-950 disabled:opacity-40"
        >
          {loading ? '…' : 'Send'}
        </button>
      </form>
    </main>
  )
}
