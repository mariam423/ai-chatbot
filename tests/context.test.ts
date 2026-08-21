import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_MAX_HISTORY_MESSAGES,
  estimateTokens,
  truncateHistory,
} from '../lib/context'
import type { ChatWireMessage } from '../lib/types'

function msg(content: string, role: ChatWireMessage['role'] = 'user'): ChatWireMessage {
  return { role, content }
}

describe('estimateTokens', () => {
  it('estimates ~4 characters per token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('a'.repeat(8))).toBe(2)
  })
})

describe('truncateHistory', () => {
  it('returns an empty array for no messages', () => {
    expect(truncateHistory([])).toEqual([])
  })

  it('keeps messages unchanged when within limits', () => {
    const messages = [msg('a'), msg('b'), msg('c')]
    expect(truncateHistory(messages)).toEqual(messages)
  })

  it('keeps exactly maxMessages when at the boundary', () => {
    const messages = Array.from({ length: DEFAULT_MAX_HISTORY_MESSAGES }, (_, i) => msg(`m${i}`))
    expect(truncateHistory(messages)).toEqual(messages)
  })

  it('drops the oldest messages beyond maxMessages, preserving order', () => {
    const messages = Array.from({ length: DEFAULT_MAX_HISTORY_MESSAGES + 5 }, (_, i) =>
      msg(`m${i}`),
    )
    const result = truncateHistory(messages)
    expect(result).toHaveLength(DEFAULT_MAX_HISTORY_MESSAGES)
    expect(result[0]!.content).toBe('m5')
    expect(result[result.length - 1]!.content).toBe(`m${DEFAULT_MAX_HISTORY_MESSAGES + 4}`)
  })

  it('respects a custom maxMessages option', () => {
    const messages = [msg('a'), msg('b'), msg('c'), msg('d')]
    expect(truncateHistory(messages, { maxMessages: 2 })).toEqual([msg('c'), msg('d')])
  })

  it('drops oldest messages until within the token budget', () => {
    // 3 long messages (~1,000 tokens each) + 2 short ones; budget fits only
    // the short recent pair.
    const messages = [
      msg('x'.repeat(4000)),
      msg('y'.repeat(4000)),
      msg('z'.repeat(4000)),
      msg('recent-1'),
      msg('recent-2'),
    ]
    const result = truncateHistory(messages, { maxTokens: 100 })
    expect(result).toEqual([msg('recent-1'), msg('recent-2')])
  })

  it('always keeps the newest message even when it alone exceeds the budget', () => {
    const messages = [msg('old'), msg('huge'.repeat(10_000))]
    const result = truncateHistory(messages, { maxTokens: 100 })
    expect(result).toEqual([msg('huge'.repeat(10_000))])
  })

  it('defaults to the documented token budget', () => {
    expect(DEFAULT_MAX_CONTEXT_TOKENS).toBeGreaterThan(0)
    expect(DEFAULT_MAX_HISTORY_MESSAGES).toBeGreaterThan(0)
  })
})
