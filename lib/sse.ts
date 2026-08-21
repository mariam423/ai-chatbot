/**
 * Server-Sent Events parsing for OpenAI-compatible chat completion streams.
 * The client consumes the raw response body from app/api/chat and extracts
 * incremental text deltas from `data:` events.
 */

import type { ChatCompletionChunk, SSEExtract, StreamCallbacks } from './types'

/** Split complete SSE events (blank-line delimited) out of a buffer. */
export function extractSSEEvents(buffer: string): SSEExtract {
  const events: string[] = []
  let remaining = buffer

  while (true) {
    const boundary = remaining.search(/\r?\n\r?\n/)
    if (boundary === -1) break
    const rawEvent = remaining.slice(0, boundary)
    remaining = remaining.slice(boundary).replace(/^\r?\n\r?\n/, '')

    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n')
    if (data !== '') events.push(data)
  }

  return { events, remaining }
}

export const SSE_DONE = '[DONE]'

/** Extract the incremental text from one chat-completion SSE data payload. */
export function deltaText(data: string): string {
  if (data === SSE_DONE) return ''
  try {
    const parsed = JSON.parse(data) as ChatCompletionChunk
    return parsed.choices?.[0]?.delta?.content ?? ''
  } catch {
    return ''
  }
}

/**
 * Read an OpenAI-compatible SSE stream from a response body, invoking
 * onDelta for each chunk of text. Resolves true if the stream ended
 * normally, false if it was aborted.
 */
export async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  { onDelta, signal }: StreamCallbacks,
): Promise<boolean> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Cancelling the reader makes any pending or future read() reject with an
  // AbortError, so aborting the signal halts consumption even when the
  // underlying stream does not observe the signal itself.
  const onAbort = () => {
    void reader.cancel()
  }
  // Handle both a signal aborted before consumption starts and one aborted
  // mid-read.
  if (signal?.aborted) {
    void reader.cancel()
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const { events, remaining } = extractSSEEvents(buffer)
      buffer = remaining
      for (const event of events) {
        if (event === SSE_DONE) return true
        const text = deltaText(event)
        if (text !== '') onDelta(text)
      }
    }
    // A stream cancelled via the signal ends reads with done:true — report
    // it as aborted rather than completed.
    return !signal?.aborted
  } catch (error) {
    if (signal?.aborted) return false
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
