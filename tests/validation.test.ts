import { describe, expect, it } from 'vitest'
import { MAX_INPUT_LENGTH, isValidMessageInput } from '../lib/validation'

describe('isValidMessageInput (PRD edge case: max input length)', () => {
  it('rejects empty and whitespace-only input', () => {
    expect(isValidMessageInput('')).toBe(false)
    expect(isValidMessageInput('   ')).toBe(false)
    expect(isValidMessageInput('\n\t ')).toBe(false)
  })

  it('accepts normal messages', () => {
    expect(isValidMessageInput('Hello')).toBe(true)
    expect(isValidMessageInput('  Hello world  ')).toBe(true)
  })

  it('accepts input at exactly the max length', () => {
    expect(isValidMessageInput('a'.repeat(MAX_INPUT_LENGTH))).toBe(true)
  })

  it('rejects input beyond the max length', () => {
    expect(isValidMessageInput('a'.repeat(MAX_INPUT_LENGTH + 1))).toBe(false)
  })
})
