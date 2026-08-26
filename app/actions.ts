'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { Prisma } from '../generated/client'
import { prisma } from '@/lib/db'
import { getCurrentUserId } from '@/lib/auth-context'
import { isValidSkillId } from '@/lib/skills/registry'
import { exchangeGoogleAccessToken, parseGoogleServiceAccountKey } from '@/lib/skills/tools'
import { ModelKeySchema } from '@/lib/models'
import { getMaxOutputTokens } from '@/lib/llm-config'
import { checkBillingRateLimit, clientIpFromHeaders, sanitizeInput } from '@/lib/security'
import { logSecurityEvent } from '@/lib/audit'
import { decryptField, encryptField } from '@/lib/field-encryption'
import { getPlan, isOverDailyLimit, PLANS } from '@/lib/billing/plans'
import {
  createBillingPortalSession as createStripePortalSession,
  createCheckoutSession as createStripeCheckoutSession,
} from '@/lib/billing/stripe'
import { ChatMessageSchema, type ChatMessage, type ChatSessionSummary } from '@/lib/types'

/**
 * Server Actions for per-session conversation persistence (FR-11).
 *
 * Every action scopes queries by the authenticated user's id, ensuring
 * isolated DB access per user session. When AUTH_DISABLED=true (e2e tests),
 * the userId filter is skipped so anonymous access still works.
 */

const SessionIdSchema = z.string().min(1).max(100)

// Bounded variant of ChatMessageSchema for the persistence boundary: ids and
// content are capped so a client cannot push an unbounded payload into the DB
// (the shared ChatMessageSchema stays uncapped for localStorage compat).
const PersistedChatMessageSchema = ChatMessageSchema.extend({
  id: z.string().min(1).max(200),
  content: z.string().max(50_000),
})

const SaveMessagesInputSchema = z
  .object({
    sessionId: z.string().min(1).max(100),
    // Every branch of the conversation, so forked threads persist. A branch may
    // be empty (a fork created before any message is sent on it), but at least
    // one non-empty branch must exist. Caps keep the payload bounded.
    branches: z.array(z.array(PersistedChatMessageSchema).max(1000)).min(1).max(64),
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
        ...(message.model ? { model: message.model } : {}),
        ...(message.modelOverridden !== null ? { modelOverridden: message.modelOverridden } : {}),
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
    // Ownership: an existing session must belong to the caller (mirrors
    // findOwnedSession used by the API routes). The upsert's create path
    // handles brand-new sessions, so only pre-existing rows need the check;
    // AUTH_DISABLED (e2e/local) deliberately skips it. Ownership is a direct
    // equality — including the anonymous case (null === null): an
    // anonymous-created session stays writable by anonymous callers, while a
    // signed-in user can never write into another user's session. Without
    // this, any signed-in user could inject messages into a session id they
    // do not own.
    const existing = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    })
    const ownsSession = process.env.AUTH_DISABLED === 'true' || existing?.userId === userId
    if (existing && !ownsSession) {
      // A01: attempted cross-user write — log it (only ids, never content).
      logSecurityEvent('ownership_violation', { sessionId, userId })
      return { ok: false, error: 'Chat session not found.' }
    }
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
            content: sanitizeInput(message.content, 50_000),
            position,
            branchId: String(branchIndex),
            id: message.id,
            model: message.model ?? null,
            modelOverridden: message.modelOverridden ?? null,
          },
          update: {
            role: message.role,
            content: sanitizeInput(message.content, 50_000),
            position,
            model: message.model ?? null,
            modelOverridden: message.modelOverridden ?? null,
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
        last_model: string | null
      }>
    >`
      SELECT cs.id, cs.title, cs.pinned, cs.archived,
        (SELECT m2.content FROM chat_messages m2 WHERE m2.sessionId = cs.id
           ORDER BY m2.position ASC LIMIT 1) AS first_content,
        (SELECT COUNT(*) FROM chat_messages m3 WHERE m3.sessionId = cs.id) AS message_count,
        (SELECT m4.model FROM chat_messages m4 WHERE m4.sessionId = cs.id
           AND m4.role = 'assistant' AND m4.model IS NOT NULL
           ORDER BY m4.position DESC LIMIT 1) AS last_model,
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
        lastModel: row.last_model ?? null,
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
  // Preferred default model (a lib/models.ts UI key; '' = provider default).
  preferredModel: ModelKeySchema.optional().or(z.literal('')),
  // Generation tuning applied to chat requests. Temperature is 0.0–1.0;
  // maxCompletionTokens caps the model's completion length.
  temperature: z.number().min(0).max(1).optional(),
  maxCompletionTokens: z.number().int().min(1).max(32768).optional(),
  // Per-message "via <model>" captions in the thread (default: shown).
  showModelCaptions: z.boolean().optional(),
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
        preferredModel: string
        temperature: number | null
        maxCompletionTokens: number | null
        // Per-message "via <model>" captions in the thread.
        showModelCaptions: boolean
        // Effective server-side completion cap when the user hasn't set a
        // custom one — MAX_OUTPUT_TOKENS env or the 200 default (see
        // lib/llm-config.ts). Surfaced on the settings page so users see what
        // the "default" max_tokens actually is.
        defaultMaxCompletionTokens: number
      }
    }
  | { ok: false; error: string }
> {
  const userId = await getCurrentUserId()
  const defaults = {
    displayName: '',
    avatarUrl: '',
    apiKey: '',
    systemPromptPresets: '[]',
    googleCalendarId: '',
    googleServiceAccountKey: '',
    preferredModel: '',
    temperature: null,
    maxCompletionTokens: null,
    showModelCaptions: true,
    defaultMaxCompletionTokens: getMaxOutputTokens(),
  }
  if (!userId) {
    return { ok: true, data: defaults }
  }
  try {
    const pref = await prisma.userPreference.findUnique({ where: { userId } })
    return {
      ok: true,
      data: {
        displayName: pref?.displayName ?? '',
        avatarUrl: pref?.avatarUrl ?? '',
        apiKey: decryptField(pref?.apiKey ?? ''),
        systemPromptPresets: pref?.systemPromptPresets ?? '[]',
        googleCalendarId: pref?.googleCalendarId ?? '',
        googleServiceAccountKey: decryptField(pref?.googleServiceAccountKey ?? ''),
        preferredModel: pref?.preferredModel ?? '',
        temperature: pref?.temperature ?? null,
        maxCompletionTokens: pref?.maxCompletionTokens ?? null,
        // Null (legacy rows / not set) means "shown" — matches the column default.
        showModelCaptions: pref?.showModelCaptions ?? true,
        defaultMaxCompletionTokens: getMaxOutputTokens(),
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
  preferredModel?: string
  temperature?: number
  maxCompletionTokens?: number
  showModelCaptions?: boolean
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
  // Data-at-rest encryption: apiKey and the service-account private key are
  // secrets — store them as AES-256-GCM envelopes (see lib/field-encryption.ts).
  // Empty strings still clear the field; the zod caps above bound the input.
  const encryptedApiKey = data.apiKey ? encryptField(data.apiKey) : undefined
  const encryptedServiceKey = data.googleServiceAccountKey
    ? encryptField(data.googleServiceAccountKey)
    : undefined
  const userId = await getCurrentUserId()
  if (!userId) return { ok: false, error: 'Not authenticated.' }
  try {
    await prisma.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        displayName: data.displayName ?? undefined,
        avatarUrl: data.avatarUrl ?? undefined,
        apiKey: encryptedApiKey,
        systemPromptPresets: data.systemPromptPresets ?? '[]',
        googleCalendarId: data.googleCalendarId ?? undefined,
        googleServiceAccountKey: encryptedServiceKey,
        preferredModel: data.preferredModel ?? undefined,
        temperature: data.temperature ?? undefined,
        maxCompletionTokens: data.maxCompletionTokens ?? undefined,
        showModelCaptions: data.showModelCaptions ?? true,
      },
      update: {
        ...(data.displayName !== undefined && { displayName: data.displayName || null }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl || null }),
        ...(data.apiKey !== undefined && { apiKey: encryptedApiKey ?? null }),
        ...(data.systemPromptPresets !== undefined && {
          systemPromptPresets: data.systemPromptPresets,
        }),
        ...(data.googleCalendarId !== undefined && {
          googleCalendarId: data.googleCalendarId || null,
        }),
        ...(data.googleServiceAccountKey !== undefined && {
          googleServiceAccountKey: encryptedServiceKey ?? null,
        }),
        ...(data.preferredModel !== undefined && {
          preferredModel: data.preferredModel || null,
        }),
        ...(data.temperature !== undefined && { temperature: data.temperature }),
        ...(data.maxCompletionTokens !== undefined && {
          maxCompletionTokens: data.maxCompletionTokens,
        }),
        ...(data.showModelCaptions !== undefined && {
          showModelCaptions: data.showModelCaptions,
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
  const key = decryptField(pref?.googleServiceAccountKey ?? '')
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

/**
 * Current billing status for the signed-in user: their plan, the plan's
 * daily request limit, how many requests they've used today, and whether
 * Stripe is configured (so the UI can hide billing when it isn't).
 */
export async function getBillingStatus(): Promise<
  | {
      ok: true
      data: {
        plan: string
        planLabel: string
        dailyLimit: number | null
        usedToday: number
        overLimit: boolean
        stripeConfigured: boolean
      }
    }
  | { ok: false; error: string }
> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      ok: true,
      data: {
        plan: 'free',
        planLabel: PLANS.free.label,
        dailyLimit: PLANS.free.dailyChatRequests,
        usedToday: 0,
        overLimit: false,
        stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO),
      },
    }
  }
  const throttled = await checkBillingRateLimit('status', clientIpFromHeaders(await headers()))
  if (!throttled.ok) return throttled
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    const today = new Date().toISOString().slice(0, 10)
    const usedToday = user?.usageDate === today ? user.usageCount : 0
    const plan = getPlan(user?.plan)
    return {
      ok: true,
      data: {
        plan: plan.key,
        planLabel: plan.label,
        dailyLimit: plan.dailyChatRequests,
        usedToday,
        overLimit: isOverDailyLimit(user?.plan, usedToday),
        stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO),
      },
    }
  } catch {
    return { ok: false, error: 'Could not load billing status.' }
  }
}

/** Start Stripe checkout for the Pro plan. Redirect the client to `data.url`. */
export async function upgradeToPro(): Promise<
  | { ok: true; url: string; notConfigured?: boolean }
  | { ok: false; error: string; notConfigured?: boolean }
> {
  const userId = await getCurrentUserId()
  if (!userId) return { ok: false, error: 'You must be signed in to upgrade.' }
  const throttled = await checkBillingRateLimit('checkout', clientIpFromHeaders(await headers()))
  if (!throttled.ok) return throttled

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return { ok: false, error: 'Could not load your billing account.' }
    const result = await createStripeCheckoutSession({
      customerId: user.stripeCustomerId ?? null,
      userId,
      email: user.email,
    })
    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? 'Could not start checkout.',
        notConfigured: result.notConfigured,
      }
    }
    return { ok: true, url: result.data!.url, notConfigured: result.notConfigured }
  } catch {
    return { ok: false, error: 'Could not start checkout.' }
  }
}

/** Open the Stripe billing portal so the user can manage/cancel their plan. */
export async function openBillingPortal(): Promise<
  | { ok: true; url: string; notConfigured?: boolean }
  | { ok: false; error: string; notConfigured?: boolean }
> {
  const userId = await getCurrentUserId()
  if (!userId) return { ok: false, error: 'You must be signed in to manage billing.' }
  const throttled = await checkBillingRateLimit('portal', clientIpFromHeaders(await headers()))
  if (!throttled.ok) return throttled
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    const customerId = user?.stripeCustomerId
    if (!customerId) {
      return { ok: false, error: 'No Stripe customer on file. Upgrade to Pro first.' }
    }
    const result = await createStripePortalSession({ customerId })
    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? 'Could not open billing portal.',
        notConfigured: result.notConfigured,
      }
    }
    return { ok: true, url: result.data!.url, notConfigured: result.notConfigured }
  } catch {
    return { ok: false, error: 'Could not load billing details.' }
  }
}
