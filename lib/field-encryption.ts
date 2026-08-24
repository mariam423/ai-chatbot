/**
 * Data-at-rest field encryption for sensitive preference fields (the user's
 * API key and Google service-account private key).
 *
 * Values are stored as a versioned envelope so the scheme can evolve:
 *
 *   v1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>
 *
 * - AES-256-GCM (authenticated): tampering or a wrong key fails the auth-tag
 *   check instead of producing garbage output.
 * - The key comes from `ENCRYPTION_KEY` (any string, sha256-hashed to 32
 *   bytes). Set it once in production — changing it makes previously written
 *   envelopes undecryptable (they degrade gracefully to '').
 * - No key configured (local dev / tests): writes store plaintext with a
 *   one-time warning, and reads pass legacy plaintext rows through — the
 *   "graceful fallback for unencrypted legacy rows" path.
 * - An encrypted row that can't be decrypted (key lost/rotated, tampered
 *   data) degrades to '' rather than surfacing ciphertext to the UI or into
 *   error messages, and emits a structured `decryption_failed` audit event.
 *
 * Server-only (imports node:crypto).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { logSecurityEvent } from './audit'

const VERSION = 'v1'
const SEPARATOR = ':'
const IV_LENGTH = 12 // 96 bits — the GCM recommendation

/** Derive the 32-byte AES-256 key from the env var (any-length input). */
function encryptionKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) return null
  return createHash('sha256').update(raw).digest()
}

let warnedMissingKey = false

/** True when an ENCRYPTION_KEY is configured, so callers can branch if needed. */
export function isFieldEncryptionEnabled(): boolean {
  return Boolean(process.env.ENCRYPTION_KEY)
}

/**
 * Encrypt a sensitive string. Without ENCRYPTION_KEY the input is returned
 * unchanged (with a one-time warning) so local dev keeps working — production
 * must set the key; see README.
 */
export function encryptField(plaintext: string): string {
  const key = encryptionKey()
  if (!key) {
    if (!warnedMissingKey && process.env.NODE_ENV !== 'test') {
      warnedMissingKey = true
      console.warn(
        '[field-encryption] ENCRYPTION_KEY is unset — sensitive preference fields will be stored in plaintext. Set it in production.',
      )
    }
    return plaintext
  }
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(SEPARATOR)
}

/**
 * Decrypt a field. Legacy plaintext rows (no `v1:` envelope) pass through
 * unchanged. Encrypted rows that can't be verified (missing key, rotated key,
 * tampered ciphertext) degrade to '' with a structured audit event — never
 * ciphertext, never a throw.
 */
export function decryptField(value: string): string {
  const parts = value.split(SEPARATOR)
  if (parts.length !== 4 || parts[0] !== VERSION) return value // legacy plaintext
  const key = encryptionKey()
  if (!key) {
    logSecurityEvent('decryption_failed', { reason: 'ENCRYPTION_KEY is not configured' })
    return ''
  }
  try {
    const iv = Buffer.from(parts[1]!, 'base64')
    const authTag = Buffer.from(parts[2]!, 'base64')
    const ciphertext = Buffer.from(parts[3]!, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    // GCM auth-tag mismatch: wrong key, truncated/corrupt data, or tampering.
    logSecurityEvent('decryption_failed', { reason: 'auth-tag verification failed' })
    return ''
  }
}
