'use server'

import { z } from 'zod'
import { Prisma } from '../generated/client'
import { prisma } from '@/lib/db'
import { getCurrentUserId } from '@/lib/auth-context'
import { isValidSkillId } from '@/lib/skills/registry'
import { exchangeGoogleAccessToken, parseGoogleServiceAccountKey } from '@/lib/skills/tools'
import { ChatMessageSchema, type ChatMessage, type ChatSessionSummary } from '@/lib/types'

/**
 * Server Actions for per-session conversation persistence (FR-11).
 *
 * Every action scopes queries by the authenticated user's id, ensuring
 * isolated DB access per user session. When AUTH_DISABLED=true (e2e tests),
 * the userId filter is skipped so anonymous access still works.
 */

const SessionIdSchema = z.string().min(1).max(100)

const SaveMessagesInputSchema = z
  .object({
    sessionId: z.string().min(1).max(100),
    // Every branch of the conversation, so forked threads persist. A branch may
    // be empty (a fork created before any message is sent on it), but at least
    // one non-empty branch must exist.
    branches: z.array(z.array(ChatMessageSchema)).min(1),
    // Index of the currently active branch (defaults to 0).
    active: z.number().int().min(0).max(64).optional(),
    // Optional per-session skill override, applied when the session is created.
    enabledSkills: z.array(z.string().trim().min(1).max(64)).max(8).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.branches.some((branch) => branch.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one branch must be non-empty.',
      })
    }
  })

const RenameSessionInputSchema = z.object({
  sessionId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(48),
})

/** Create a new empty session owned by the current user. */
export async function createChatSession(): Promise<
  { ok: true; sessionId: string } | { ok: false; error: string }
> {
  const userId = await getCurrentUserId()
  try {
    const session = await prisma.chatSession.create({
      data: { userId: userId ?? undefined },
    })
    return { ok: true, sessionId: session.id }
  } catch {
    return { ok: false, error: 'Could not create session.' }
  }
}

/** Load a session's branches and the active branch index (empty when unknown). */
export async function getChatSession(sessionId: string): Promise<
  | {
      ok: true
      branches: ChatMessage[][]
      active: number
      systemPrompt: string | null
    }
  | { ok: false; error: string }
> {
  if (!SessionIdSchema.safeParse(sessionId).success) {
    return { ok: false, error: 'Invalid session id.' }
  }
  const userId = await getCurrentUserId()
  try {
    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        // When auth is active, only return sessions owned by the current user.
        ...(userId ? { userId } : {}),
      },
      include: { messages: { orderBy: { position: 'asc' } } },
    })
    const rows = session?.messages ?? []
    const active = session?.activeBranch ?? 0
    // A session with no messages (unknown or cleared) has no branches at all.
    if (rows.length === 0) {
      return {
        ok: true,
        branches: [],
        active: 0,
        systemPrompt: session?.systemPrompt ?? null,
      }
    }
    // Group messages by their branch index; `position` orders within a branch.
    const byBranch = new Map<number, ChatMessage[]>()
    let maxBranch = active
    for (const message of rows) {
      const parsed = Number.parseInt(message.branchId ?? '0', 10)
      const branchIndex = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed
      if (branchIndex > maxBranch) maxBranch = branchIndex
      if (!byBranch.has(branchIndex)) byBranch.set(branchIndex, [])
      byBranch.get(branchIndex)!.push({
        id: message.id,
        role: message.role as ChatMessage['role'],
        content: message.content,
      })
    }
    // Rebuild the full array (including empty branches) so the active index
    // stays valid; a branch with no messages yet is restored as empty.
    const branches: ChatMessage[][] = Array.from({ length: maxBranch + 1 }, () => [])
    for (const [index, messages] of byBranch) branches[index] = messages
    return { ok: true, branches, active, systemPrompt: session?.systemPrompt ?? null }
  } catch {
    return { ok: false, error: 'Could not load session.' }
  }
}

/**
 * Persist an entire branched thread for a session (replace semantics via
 * per-message upsert on client-generated ids — re-saving is idempotent, and
 * the session is created on first save if it does not exist). Every branch is
 * stored so forked conversations survive a session switch; `active` records
 * which branch was last shown.
 */
export async function saveChatMessages(input: {
  sessionId: string
  branches: ChatMessage[][]
  /** Index of the active branch (defaults to 0). */
  active?: number
  /** Per-session skill override, applied when the session is created. */
  enabledSkills?: string[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = SaveMessagesInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid session id, branches, or messages payload.' }
  }
  const { sessionId, branches, active, enabledSkills } = parsed.data
  if (enabledSkills !== undefined && enabledSkills.some((id) => !isValidSkillId(id))) {
    return { ok: false, error: 'Invalid skill ids.' }
  }
  const userId = await getCurrentUserId()
  try {
    // Upsert with ownership: create attaches userId, update records the active
    // branch (when provided) without clobbering other session metadata.
    await prisma.chatSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        userId: userId ?? undefined,
        activeBranch: active ?? 0,
        ...(enabledSkills !== undefined ? { enabledSkills: enabledSkills.join(',') } : {}),
      },
      update: {
        ...(active !== undefined ? { activeBranch: active } : {}),
      },
    })
    const rows = branches.flatMap((branch, branchIndex) =>
      branch.map((message, position) =>
        prisma.chatMessage.upsert({
          // Identity is (sessionId, branchId, id) so a shared-prefix message
          // gets its own row per branch instead of clobbering the previous one.
          where: {
            sessionId_branchId_id: {
              sessionId,
              branchId: String(branchIndex),
              id: message.id,
            },
          },
          create: {
            sessionId,
            role: message.role,
            content: message.content,
            position,
            branchId: String(branchIndex),
            id: message.id,
          },
          update: {
            role: message.role,
            content: message.content,
            position,
          },
        }),
      ),
    )
    await prisma.$transaction(rows)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not save messages.' }
  }
}

/** Derive a sidebar title from a session's first message. */
function sessionTitle(content: string | undefined): string {
  const text = (content ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return 'New chat'
  return text.length > 48 ? `${text.slice(0, 48)}…` : text
}

const SESSION_PAGE_SIZE = 20

const ListSessionsInputSchema = z.object({
  search: z.string().trim().max(100).optional(),
  skip: z.number().int().min(0).default(0),
  take: z.number().int().min(1).max(50).default(SESSION_PAGE_SIZE),
  archived: z.boolean().default(false),
})

/**
 * List sessions (newest first) for the sidebar, one page at a time.
 * Scoped to the current user's sessions.
 */
export async function listChatSessions(input?: {
  search?: string
  skip?: number
  take?: number
  archived?: boolean
}): Promise<
  { ok: true; sessions: ChatSessionSummary[]; hasMore: boolean } | { ok: false; error: string }
> {
  const parsed = ListSessionsInputSchema.safeParse(input ?? {})
  if (!parsed.success) {
    return { ok: false, error: 'Invalid list options.' }
  }
  const { search, skip, take, archived } = parsed.data
  const userId = await getCurrentUserId()
  try {
    const userFilter = userId ? Prisma.sql`AND cs.userId = ${userId}` : Prisma.empty
    const searchFilter = search
      ? Prisma.sql`AND (cs.title LIKE ${`%${search}%`} COLLATE NOCASE
             OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.sessionId = cs.id
                        AND m.content LIKE ${`%${search}%`} COLLATE NOCASE))`
      : Prisma.empty
    const rows = await prisma.$queryRaw<
      Array<{
        id: string
        title: string | null
        first_content: string | null
        message_count: bigint | number
        updated_at: Date | string
        pinned: number | boolean
        archived: number | boolean
      }>
    >`
      SELECT cs.id, cs.title, cs.pinned, cs.archived,
        (SELECT m2.content FROM chat_messages m2 WHERE m2.sessionId = cs.id
           ORDER BY m2.position ASC LIMIT 1) AS first_content,
        (SELECT COUNT(*) FROM chat_messages m3 WHERE m3.sessionId = cs.id) AS message_count,
        cs.updatedAt AS updated_at
      FROM chat_sessions cs
      WHERE cs.archived = ${archived ? 1 : 0}
        AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.sessionId = cs.id)
        ${userFilter}
        ${searchFilter}
      ORDER BY cs.pinned DESC, cs.updatedAt DESC
      LIMIT ${take + 1} OFFSET ${skip}
    `
    const hasMore = rows.length > take
    const page = hasMore ? rows.slice(0, take) : rows
    return {
      ok: true,
      hasMore,
      sessions: page.map((row) => ({
        id: row.id,
        title: row.title ?? sessionTitle(row.first_content ?? undefined),
        updatedAt: new Date(row.updated_at).toISOString(),
        messageCount: Number(row.message_count),
        pinned: Boolean(row.pinned),
        archived: Boolean(row.archived),
      })),
    }
  } catch {
    return { ok: false, error: 'Could not list sessions.' }
  }
}

/** Rename a session (sidebar label). Scoped to the current user. */
export async function renameChatSession(input: {
  sessionId: string
  title: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = RenameSessionInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid session id or title.' }
  }
  const { sessionId, title } = parsed.data
  const userId = await getCurrentUserId()
  try {
    await prisma.chatSession.updateMany({
      where: {
        id: sessionId,
        ...(userId ? { userId } : {}),
      },
      data: { title },
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not rename session.' }
  }
}

/** Delete a session and its messages (cascade). Scoped to the current user. */
export async function clearChatSession(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!SessionIdSchema.safeParse(sessionId).success) {
    return { ok: false, error: 'Invalid session id.' }
  }
  const userId = await getCurrentUserId()
  try {
    await prisma.chatSession.deleteMany({
      where: {
        id: sessionId,
        ...(userId ? { userId } : {}),
      },
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not clear session.' }
  }
}

// ─── Pin / Archive ───

/** Toggle the pinned state of a session. Scoped to the current user. */
export async function togglePinSession(
  sessionId: string,
): Promise<{ ok: true; pinned: boolean } | { ok: false; error: string }> {
  if (!SessionIdSchema.safeParse(sessionId).success) {
    return { ok: false, error: 'Invalid session id.' }
  }
  const userId = await getCurrentUserId()
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, ...(userId ? { userId } : {}) },
    })
    if (!session) return { ok: false, error: 'Session not found.' }
    const pinned = !session.pinned
    await prisma.chatSession.update({ where: { id: sessionId }, data: { pinned } })
    return { ok: true, pinned }
  } catch {
    return { ok: false, error: 'Could not toggle pin.' }
  }
}

/** Toggle the archived state of a session. Scoped to the current user. */
export async function toggleArchiveSession(
  sessionId: string,
): Promise<{ ok: true; archived: boolean } | { ok: false; error: string }> {
  if (!SessionIdSchema.safeParse(sessionId).success) {
    return { ok: false, error: 'Invalid session id.' }
  }
  const userId = await getCurrentUserId()
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, ...(userId ? { userId } : {}) },
    })
    if (!session) return { ok: false, error: 'Session not found.' }
    const archived = !session.archived
    await prisma.chatSession.update({ where: { id: sessionId }, data: { archived } })
    return { ok: true, archived }
  } catch {
    return { ok: false, error: 'Could not toggle archive.' }
  }
}

// ─── Session Skills ───

function parseEnabledSkills(raw: string | null): string[] | null {
  if (raw === null) return null
  if (raw === '') return []
  return raw.split(',').filter(Boolean)
}

/** Load a session's skill override (null = defaults). Scoped to the current user. */
export async function getSessionSkills(
  sessionId: string,
): Promise<{ ok: true; enabledSkills: string[] | null } | { ok: false; error: string }> {
  if (!SessionIdSchema.safeParse(sessionId).success) {
    return { ok: false, error: 'Invalid session id.' }
  }
  const userId = await getCurrentUserId()
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, ...(userId ? { userId } : {}) },
    })
    return { ok: true, enabledSkills: parseEnabledSkills(session?.enabledSkills ?? null) }
  } catch {
    return { ok: false, error: 'Could not load session skills.' }
  }
}

/**
 * Update which skills are active for a session. Pass null to clear the
 * override and fall back to defaults. Scoped to the current user.
 */
export async function updateSessionSkills(input: {
  sessionId: string
  enabledSkills: string[] | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!SessionIdSchema.safeParse(input.sessionId).success) {
    return { ok: false, error: 'Invalid session id.' }
  }
  if (input.enabledSkills !== null && input.enabledSkills.some((id) => !isValidSkillId(id))) {
    return { ok: false, error: 'Invalid skill ids.' }
  }
  const userId = await getCurrentUserId()
  try {
    await prisma.chatSession.updateMany({
      where: { id: input.sessionId, ...(userId ? { userId } : {}) },
      data: {
        enabledSkills: input.enabledSkills === null ? null : input.enabledSkills.join(','),
      },
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not update skills.' }
  }
}

// ─── Conversation branches ───

const SetActiveBranchSchema = z.object({
  sessionId: z.string().min(1).max(100),
  active: z.number().int().min(0).max(64),
})

/** Persist which branch is currently active (restored on session reload). */
export async function setActiveBranch(input: {
  sessionId: string
  active: number
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = SetActiveBranchSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid session id or branch index.' }
  }
  const { sessionId, active } = parsed.data
  const userId = await getCurrentUserId()
  try {
    await prisma.chatSession.updateMany({
      where: {
        id: sessionId,
        ...(userId ? { userId } : {}),
      },
      data: { activeBranch: active },
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not update active branch.' }
  }
}

// ─── System Prompt ───

/** Update the system prompt for a session. Scoped to the current user. */
export async function updateSessionSystemPrompt(input: {
  sessionId: string
  systemPrompt: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!SessionIdSchema.safeParse(input.sessionId).success) {
    return { ok: false, error: 'Invalid session id.' }
  }
  const userId = await getCurrentUserId()
  try {
    await prisma.chatSession.updateMany({
      where: { id: input.sessionId, ...(userId ? { userId } : {}) },
      data: { systemPrompt: input.systemPrompt || null },
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not update system prompt.' }
  }
}

// ─── User Preferences ───

const UserPreferencesSchema = z.object({
  displayName: z.string().trim().max(50).optional(),
  avatarUrl: z.string().max(500).optional().or(z.literal('')),
  apiKey: z.string().max(200).optional().or(z.literal('')),
  systemPromptPresets: z.string().max(10000).optional(),
  // Google Calendar service-account integration (schedule_block). The key is a
  // pasted service-account JSON; empty string clears it.
  googleCalendarId: z.string().trim().max(200).optional().or(z.literal('')),
  googleServiceAccountKey: z.string().max(8000).optional().or(z.literal('')),
})

const CALENDAR_LOOKUP_URL = 'https://www.googleapis.com/calendar/v3/calendars'

/** Load user preferences (or defaults when none exist). */
export async function getUserPreferences(): Promise<
  | {
      ok: true
      data: {
        displayName: string
        avatarUrl: string
        apiKey: string
        systemPromptPresets: string
        googleCalendarId: string
        googleServiceAccountKey: string
      }
    }
  | { ok: false; error: string }
> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      ok: true,
      data: {
        displayName: '',
        avatarUrl: '',
        apiKey: '',
        systemPromptPresets: '[]',
        googleCalendarId: '',
        googleServiceAccountKey: '',
      },
    }
  }
  try {
    const pref = await prisma.userPreference.findUnique({ where: { userId } })
    return {
      ok: true,
      data: {
        displayName: pref?.displayName ?? '',
        avatarUrl: pref?.avatarUrl ?? '',
        apiKey: pref?.apiKey ?? '',
        systemPromptPresets: pref?.systemPromptPresets ?? '[]',
        googleCalendarId: pref?.googleCalendarId ?? '',
        googleServiceAccountKey: pref?.googleServiceAccountKey ?? '',
      },
    }
  } catch {
    return { ok: false, error: 'Could not load preferences.' }
  }
}

/** Upsert user preferences. Scoped to the current user. */
export async function updateUserPreferences(input: {
  displayName?: string
  avatarUrl?: string
  apiKey?: string
  systemPromptPresets?: string
  googleCalendarId?: string
  googleServiceAccountKey?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = UserPreferencesSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid preferences.' }
  }
  const data = parsed.data
  // Validate the pasted service-account JSON before persisting anything.
  if (data.googleServiceAccountKey) {
    if (!parseGoogleServiceAccountKey(data.googleServiceAccountKey)) {
      return { ok: false, error: 'Invalid Google service-account key JSON.' }
    }
  }
  const userId = await getCurrentUserId()
  if (!userId) return { ok: false, error: 'Not authenticated.' }
  try {
    await prisma.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        displayName: data.displayName ?? undefined,
        avatarUrl: data.avatarUrl ?? undefined,
        apiKey: data.apiKey ?? undefined,
        systemPromptPresets: data.systemPromptPresets ?? '[]',
        googleCalendarId: data.googleCalendarId ?? undefined,
        googleServiceAccountKey: data.googleServiceAccountKey ?? undefined,
      },
      update: {
        ...(data.displayName !== undefined && { displayName: data.displayName || null }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl || null }),
        ...(data.apiKey !== undefined && { apiKey: data.apiKey || null }),
        ...(data.systemPromptPresets !== undefined && {
          systemPromptPresets: data.systemPromptPresets,
        }),
        ...(data.googleCalendarId !== undefined && {
          googleCalendarId: data.googleCalendarId || null,
        }),
        ...(data.googleServiceAccountKey !== undefined && {
          googleServiceAccountKey: data.googleServiceAccountKey || null,
        }),
      },
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not save preferences.' }
  }
}

/**
 * Verify the current user's stored Google Calendar credentials by exchanging
 * the service-account JWT for an access token and fetching the calendar.
 * Returns the connected calendar id + service account email on success.
 */
export async function testGoogleCalendarConnection(): Promise<
  { ok: true; calendarId: string; email: string; message: string } | { ok: false; error: string }
> {
  const userId = await getCurrentUserId()
  if (!userId) return { ok: false, error: 'Not authenticated.' }
  let pref
  try {
    pref = await prisma.userPreference.findUnique({ where: { userId } })
  } catch {
    return { ok: false, error: 'Could not load preferences.' }
  }
  const key = pref?.googleServiceAccountKey
  const calendarId = pref?.googleCalendarId
  if (!key || !calendarId) {
    return { ok: false, error: 'No Google Calendar credentials saved yet.' }
  }
  const parsed = parseGoogleServiceAccountKey(key)
  if (!parsed) {
    return { ok: false, error: 'Stored Google service-account key is invalid.' }
  }
  try {
    const accessToken = await exchangeGoogleAccessToken(parsed.email, parsed.privateKey)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await fetch(`${CALENDAR_LOOKUP_URL}/${encodeURIComponent(calendarId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      })
      if (!response.ok) {
        return {
          ok: false,
          error: `Calendar access check failed (${response.status}). Make sure the service account is shared with the calendar (edit → Share with specific people).`,
        }
      }
    } finally {
      clearTimeout(timeout)
    }
    return {
      ok: true,
      calendarId,
      email: parsed.email,
      message: `Connected to calendar ${calendarId} as ${parsed.email}.`,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach Google Calendar.',
    }
  }
}
