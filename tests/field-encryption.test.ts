import { afterEach, describe, expect, it } from 'vitest'
import { decryptField, encryptField, isFieldEncryptionEnabled } from '../lib/field-encryption'

afterEach(() => {
  delete process.env.ENCRYPTION_KEY
})

describe('field encryption (AES-256-GCM)', () => {
  it('round-trips a value with ENCRYPTION_KEY set, as a versioned envelope', () => {
    process.env.ENCRYPTION_KEY = 'unit-test-key'
    const encrypted = encryptField('sk-or-secret-123')
    expect(encrypted.startsWith('v1:')).toBe(true)
    expect(encrypted.split(':')).toHaveLength(4)
    expect(encrypted).not.toContain('sk-or-secret-123')
    expect(decryptField(encrypted)).toBe('sk-or-secret-123')
  })

  it('uses a fresh random IV so equal plaintexts produce different envelopes', () => {
    process.env.ENCRYPTION_KEY = 'unit-test-key'
    const a = encryptField('same-value')
    const b = encryptField('same-value')
    expect(a).not.toBe(b)
    expect(decryptField(a)).toBe('same-value')
    expect(decryptField(b)).toBe('same-value')
  })

  it('stores plaintext without a key (dev fallback) and passes it back', () => {
    expect(isFieldEncryptionEnabled()).toBe(false)
    expect(encryptField('sk-dev')).toBe('sk-dev')
    expect(decryptField('sk-dev')).toBe('sk-dev')
  })

  it('passes legacy plaintext rows through when a key is configured', () => {
    process.env.ENCRYPTION_KEY = 'unit-test-key'
    // Rows written before encryption existed have no `v1:` envelope.
    expect(decryptField('sk-legacy-456')).toBe('sk-legacy-456')
  })

  it('returns "" for an encrypted row when the key is not configured', () => {
    process.env.ENCRYPTION_KEY = 'unit-test-key'
    const encrypted = encryptField('secret')
    delete process.env.ENCRYPTION_KEY
    expect(decryptField(encrypted)).toBe('')
  })

  it('returns "" when the key changes (auth-tag mismatch)', () => {
    process.env.ENCRYPTION_KEY = 'first-key'
    const encrypted = encryptField('secret')
    process.env.ENCRYPTION_KEY = 'second-key'
    expect(decryptField(encrypted)).toBe('')
  })

  it('returns "" on tampered ciphertext instead of garbage', () => {
    process.env.ENCRYPTION_KEY = 'unit-test-key'
    const encrypted = encryptField('secret')
    const [version, iv, tag, ciphertext] = encrypted.split(':')
    const flipped = ciphertext!.endsWith('A')
      ? ciphertext!.slice(0, -1) + 'B'
      : ciphertext!.slice(0, -1) + 'A'
    const tampered = [version, iv, tag, flipped].join(':')
    expect(decryptField(tampered)).toBe('')
  })
})
