import { z } from 'zod'
import { ChatMessageSchema, type ChatMessage } from './types'

/**
 * Chat thread persistence (PRD FR-9), extended for conversation branching.
 *
 * A thread is stored as a set of linear *branches* plus the index of the active
 * one. Each branch is a full linear sequence of messages; branching happens
 * when the user edits a past prompt, forking a new branch from a shared prefix
 * (see lib/storage.ts helpers and the message editing UI in components/chat.tsx).
 * The active branch is what the UI renders; switching branches re-renders the
 * stored conversation without losing any branch's context.
 *
 * Stored payload is versioned (`{ version: 3, branches, active }`) so future
 * schema changes can migrate old data instead of silently dropping it (see the
 * vercel-react-best-practices `client-localstorage-schema` rule). Reading is
 * validated with Zod at the storage boundary — corrupt or partial payloads are
 * treated as an empty thread, never trusted, while legacy formats are migrated
 * to the current version (see `normalizeThread`).
 *
 * v3 adds the optional per-message `model` / `modelOverridden` fields (which
 * model served an assistant reply, and whether it was swapped) so branch
 * history shows which model answered; v2 payloads migrate losslessly.
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
export const THREAD_STORAGE_VERSION = 3

const ThreadStateSchema = z.object({
  version: z.literal(THREAD_STORAGE_VERSION),
  branches: z.array(z.array(ChatMessageSchema)).min(1),
  active: z.number().int().min(0),
})

/** The persisted, versioned thread payload. */
export type StoredThread = z.infer<typeof ThreadStateSchema>

/** In-memory thread state: every branch plus the active branch index. */
export interface ThreadState {
  branches: ChatMessage[][]
  active: number
}

/** Version 2 format (branched, pre-model-field): migrated to v3 as-is. */
const Version2Schema = z.object({
  version: z.literal(2),
  branches: z.array(z.array(ChatMessageSchema)).min(1),
  active: z.number().int().min(0),
})

/** Version 1 format (pre-branching): a single linear thread. */
const Version1Schema = z.object({
  version: z.literal(1),
  messages: z.array(ChatMessageSchema),
})

/** Legacy pre-versioning format: a bare array of messages. */
const LegacyThreadSchema = z.array(ChatMessageSchema)

/**
 * Normalize a parsed storage payload to the current versioned shape,
 * migrating legacy formats (v1 and the pre-versioning bare array).
 *
 * Returns `null` when the payload is not a valid thread (corrupt, partial,
 * or an unknown future version). `migrated` is true when the payload was a
 * legacy format and should be written back in the current shape.
 */
export function normalizeThread(
  payload: unknown,
): { state: StoredThread; migrated: boolean } | null {
  const current = ThreadStateSchema.safeParse(payload)
  if (current.success) return { state: current.data, migrated: false }

  const v2 = Version2Schema.safeParse(payload)
  if (v2.success) {
    // v2 → v3 is an identity migration: the message shape gained optional
    // model fields, so every v2 payload is already valid v3 data.
    return {
      state: {
        version: THREAD_STORAGE_VERSION,
        branches: v2.data.branches,
        active: v2.data.active,
      },
      migrated: true,
    }
  }

  const v1 = Version1Schema.safeParse(payload)
  if (v1.success) {
    return {
      state: { version: THREAD_STORAGE_VERSION, branches: [v1.data.messages], active: 0 },
      migrated: true,
    }
  }

  const legacy = LegacyThreadSchema.safeParse(payload)
  if (legacy.success) {
    return {
      state: { version: THREAD_STORAGE_VERSION, branches: [legacy.data], active: 0 },
      migrated: true,
    }
  }

  return null
}

/** Load the persisted thread state, or the empty single-branch state. */
export function loadThreadState(): ThreadState {
  if (typeof window === 'undefined') return { branches: [[]], active: 0 }
  try {
    const raw = window.localStorage.getItem(THREAD_STORAGE_KEY)
    if (!raw) return { branches: [[]], active: 0 }
    const result = normalizeThread(JSON.parse(raw))
    if (!result) return { branches: [[]], active: 0 }
    // One-time migration: write legacy data back in the current format so the
    // next load skips the migration path. Best-effort like all writes.
    if (result.migrated) saveThreadState(result.state)
    return { branches: result.state.branches, active: result.state.active }
  } catch {
    return { branches: [[]], active: 0 }
  }
}

/** Persist the thread state. Best-effort: storage can be unavailable. */
export function saveThreadState(state: ThreadState): void {
  try {
    const payload: StoredThread = {
      version: THREAD_STORAGE_VERSION,
      branches: state.branches,
      active: state.active,
    }
    window.localStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Storage unavailable — persistence is best-effort.
  }
}

/** Load the active branch's messages, or an empty thread when none stored. */
export function loadThread(): ChatMessage[] {
  const state = loadThreadState()
  return state.branches[state.active] ?? []
}

/**
 * Persist a single-branch thread (convenience for the pre-branching call
 * sites). The stored state is always normalized to the versioned shape.
 */
export function saveThread(messages: ChatMessage[]): void {
  saveThreadState({ branches: [messages], active: 0 })
}

/** Remove the persisted thread. */
export function clearThread(): void {
  try {
    window.localStorage.removeItem(THREAD_STORAGE_KEY)
  } catch {
    // Storage unavailable — best-effort.
  }
}
