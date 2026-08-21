import type { ChatWireMessage } from './types'

/**
 * History truncation + token-budget compression for LLM requests.
 *
 * Per the session-compression skill, this is the token-budget FIFO pattern
 * (ConversationTokenBufferMemory): keep the most recent messages verbatim and
 * drop the oldest when limits are exceeded. It is deterministic, costs no
 * extra LLM calls, and is appropriate for real-time chat — abstractive
 * summarization (a second LLM call per request) is deliberately not used.
 */

/** Default: how many of the most recent messages to keep. */
export const DEFAULT_MAX_HISTORY_MESSAGES = 20

/** Default: estimated token budget for history (system prompt is separate). */
export const DEFAULT_MAX_CONTEXT_TOKENS = 8000

/** Rough token estimate (~4 chars per token, per the session-compression skill). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Compress a conversation for an LLM request:
 *  1. Truncate to the last `maxMessages` messages.
 *  2. Drop the oldest messages until the estimated token count of what remains
 *     fits `maxTokens`.
 *
 * The newest message (the current user question) is always kept, even if it
 * alone exceeds the budget — a request must never arrive with zero history.
 */
export function truncateHistory(
  messages: ChatWireMessage[],
  options: { maxMessages?: number; maxTokens?: number } = {},
): ChatWireMessage[] {
  if (messages.length === 0) return []

  const maxMessages = options.maxMessages ?? DEFAULT_MAX_HISTORY_MESSAGES
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_CONTEXT_TOKENS
  const recent = messages.slice(-maxMessages)

  const kept: ChatWireMessage[] = []
  let total = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    const message = recent[i]!
    const cost = estimateTokens(message.content)
    // `kept.length > 0` guarantees the newest message is always included.
    if (kept.length > 0 && total + cost > maxTokens) break
    kept.unshift(message)
    total += cost
  }
  return kept
}
