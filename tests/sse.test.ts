import { describe, it, expect } from 'vitest'
import { extractSSEEvents, deltaText, readSSEStream, SSE_DONE } from '../lib/sse'

describe('extractSSEEvents', () => {
  it('extracts complete events and leaves the rest as remaining', () => {
    const { events, remaining } = extractSSEEvents(
      'data: {"a":1}\n\ndata: {"b":2}\n\ndata: partial',
    )
    expect(events).toEqual(['{"a":1}', '{"b":2}'])
    expect(remaining).toBe('data: partial')
  })

  it('handles CRLF line endings', () => {
    const { events, remaining } = extractSSEEvents('data: one\r\ndata: two\r\n\r\n')
    expect(events).toEqual(['one\ntwo'])
    expect(remaining).toBe('')
  })

  it('ignores events without data lines', () => {
    const { events, remaining } = extractSSEEvents(': keep-alive\n\n')
    expect(events).toEqual([])
    expect(remaining).toBe('')
  })

  it('keeps an unterminated event in remaining', () => {
    const { events, remaining } = extractSSEEvents('data: {')
    expect(events).toEqual([])
    expect(remaining).toBe('data: {')
  })
})

describe('deltaText', () => {
  it('returns empty for the [DONE] marker', () => {
    expect(deltaText(SSE_DONE)).toBe('')
  })

  it('extracts content from a chat completion delta', () => {
    const data = JSON.stringify({
      choices: [{ delta: { content: 'Hello' } }],
    })
    expect(deltaText(data)).toBe('Hello')
  })

  it('returns empty for malformed payloads', () => {
    expect(deltaText('not json')).toBe('')
  })
})

describe('readSSEStream', () => {
  it('yields deltas in order and resolves true on [DONE]', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`,
          ),
        )
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}\n\n` +
              `data: ${SSE_DONE}\n\n`,
          ),
        )
        controller.close()
      },
    })

    const deltas: string[] = []
    const completed = await readSSEStream(stream, { onDelta: (t) => deltas.push(t) })
    expect(deltas).toEqual(['Hel', 'lo'])
    expect(completed).toBe(true)
  })

  it('resolves false when aborted mid-stream', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: {\n\n`))
        controller.enqueue(encoder.encode('data: never finishes'))
      },
    })

    const controller = new AbortController()
    controller.abort()

    const deltas: string[] = []
    const completed = await readSSEStream(stream, {
      signal: controller.signal,
      onDelta: (t) => deltas.push(t),
    })
    expect(completed).toBe(false)
  })
})
