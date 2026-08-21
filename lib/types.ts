import { z } from 'zod'

/**
 * A message in the chat thread (client state). The Zod schema is the single
 * source of truth: it validates the shape at the localStorage boundary (see
 * lib/storage.ts) and `ChatMessage` is inferred from it.
 */
export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})

export type ChatMessage = z.infer<typeof ChatMessageSchema>

/**
 * Wire format sent to /api/chat and forwarded to the LLM API. Zod schema is
 * the source of truth — the route validates request bodies against it.
 */
export const ChatWireMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
})

export type ChatWireMessage = z.infer<typeof ChatWireMessageSchema>

/** A session listed in the sidebar (title derived from its first message). */
export interface ChatSessionSummary {
  id: string
  title: string
  updatedAt: string
  messageCount: number
}

/**
 * One SSE event from an OpenAI-compatible chat completions stream: a JSON
 * chunk whose `choices[0].delta` may carry the next token of text.
 */
export interface ChatCompletionChunk {
  choices?: Array<{ delta?: { content?: string } }>
}

/** Result of splitting complete SSE events out of a buffer. */
export interface SSEExtract {
  /** Complete `data:` payloads found in the buffer (JSON strings, or `[DONE]`). */
  events: string[]
  /** Unconsumed tail of the buffer, waiting for the next event boundary. */
  remaining: string
}

/** Callbacks and options for consuming an SSE stream. */
export interface StreamCallbacks {
  onDelta: (text: string) => void
  signal?: AbortSignal
}
