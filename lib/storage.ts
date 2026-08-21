import { z } from 'zod'
import { ChatMessageSchema, type ChatMessage } from './types'

/**
 * Chat thread persistence (PRD FR-9).
 *
 * Stored payload is versioned (`{ version: 1, messages }`) so future schema
 * changes can migrate old data instead of silently dropping it (see the
 * vercel-react-best-practices `client-localstorage-schema` rule). Reading is
 * validated with Zod at the storage boundary — corrupt or partial payloads
 * are treated as an empty thread, never trusted, while legacy formats are
 * migrated to the current version (see `normalizeThread`).
 */

export const THREAD_STORAGE_KEY = 'chat.messages'

/** localStorage key for the anonymous session id (FR-11 database persistence). */
export const SESSION_STORAGE_KEY = 'chat.sessionId'

/** Read the anonymous session id, or null when none has been created yet. */
export function getSessionId(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Store the anonymous session id (best-effort). */
export function setSessionId(id: string): void {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, id)
  } catch {
    // Storage unavailable — best-effort.
  }
}

/** Remove the stored session id (best-effort). */
export function clearSessionId(): void {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Storage unavailable — best-effort.
  }
}

/** Current persisted format version. Bump + add a migration when the shape changes. */
export const THREAD_STORAGE_VERSION = 1

const ThreadSchema = z.object({
  version: z.literal(THREAD_STORAGE_VERSION),
  messages: z.array(ChatMessageSchema),
})

export type StoredThread = z.infer<typeof ThreadSchema>

/** Legacy pre-versioning format: a bare array of messages (pre FR-9 hardening). */
const LegacyThreadSchema = z.array(ChatMessageSchema)

/**
 * Normalize a parsed storage payload to the current versioned shape,
 * migrating legacy formats.
 *
 * Returns `null` when the payload is not a valid thread (corrupt, partial,
 * or an unknown future version). `migrated` is true when the payload was a
 * legacy format and should be written back in the current shape.
 */
export function normalizeThread(
  payload: unknown,
): { thread: StoredThread; migrated: boolean } | null {
  const current = ThreadSchema.safeParse(payload)
  if (current.success) return { thread: current.data, migrated: false }

  const legacy = LegacyThreadSchema.safeParse(payload)
  if (legacy.success) {
    return { thread: { version: THREAD_STORAGE_VERSION, messages: legacy.data }, migrated: true }
  }

  return null
}

/** Load the persisted thread, or an empty one if absent, corrupt, or invalid. */
export function loadThread(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(THREAD_STORAGE_KEY)
    if (!raw) return []
    const result = normalizeThread(JSON.parse(raw))
    if (!result) return []
    // One-time migration: write legacy data back in the current format so the
    // next load skips the migration path. Best-effort like all writes.
    if (result.migrated) saveThread(result.thread.messages)
    return result.thread.messages
  } catch {
    return []
  }
}

/** Persist the thread. Best-effort: storage can be unavailable (private mode, quota). */
export function saveThread(messages: ChatMessage[]): void {
  try {
    const payload: StoredThread = { version: THREAD_STORAGE_VERSION, messages }
    window.localStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Storage unavailable — persistence is best-effort.
  }
}

/** Remove the persisted thread. */
export function clearThread(): void {
  try {
    window.localStorage.removeItem(THREAD_STORAGE_KEY)
  } catch {
    // Storage unavailable — best-effort.
  }
}
