'use server'

import { z } from 'zod'
import { Prisma } from '../generated/client'
import { prisma } from '@/lib/db'
import { ChatMessageSchema, type ChatMessage, type ChatSessionSummary } from '@/lib/types'

/**
 * Server Actions for per-session conversation persistence (FR-11).
 *
 * A session is an anonymous conversation thread identified by a client-held
 * session id (stored in localStorage). All functions return a discriminated
 * `{ ok }` result — never throw to the client.
 */

const SessionIdSchema = z.string().min(1).max(100)

const SaveMessagesInputSchema = z.object({
  sessionId: z.string().min(1).max(100),
  messages: z.array(ChatMessageSchema).min(1),
})

const RenameSessionInputSchema = z.object({
  sessionId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(48),
})

/** Create a new empty session. */
export async function createChatSession(): Promise<
  { ok: true; sessionId: string } | { ok: false; error: string }
> {
  try {
    const session = await prisma.chatSession.create({ data: {} })
    return { ok: true, sessionId: session.id }
  } catch {
    return { ok: false, error: 'Could not create session.' }
  }
}

/** Load a session's messages in chronological order (empty when unknown). */
export async function getChatSession(
  sessionId: string,
): Promise<{ ok: true; messages: ChatMessage[] } | { ok: false; error: string }> {
  if (!SessionIdSchema.safeParse(sessionId).success) {
    return { ok: false, error: 'Invalid session id.' }
  }
  try {
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      // position preserves the client's thread order (createdAt can tie
      // within one save transaction).
      include: { messages: { orderBy: { position: 'asc' } } },
    })
    // Return the clean ChatMessage shape, not raw rows (role is validated on
    // write, so the narrowing cast is safe).
    const messages: ChatMessage[] = (session?.messages ?? []).map(({ id, role, content }) => ({
      id,
      role,
      content,
    })) as ChatMessage[]
    return { ok: true, messages }
  } catch {
    return { ok: false, error: 'Could not load session.' }
  }
}

/**
 * Persist a full thread for a session (replace semantics via per-message
 * upsert on client-generated ids — re-saving the same thread is idempotent,
 * and the session is created on first save if it does not exist).
 */
export async function saveChatMessages(input: {
  sessionId: string
  messages: ChatMessage[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = SaveMessagesInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid session id or messages payload.' }
  }
  const { sessionId, messages } = parsed.data
  try {
    await prisma.chatSession.upsert({
      where: { id: sessionId },
      create: { id: sessionId },
      update: {},
    })
    await prisma.$transaction(
      messages.map((message, position) =>
        prisma.chatMessage.upsert({
          where: { id: message.id },
          create: {
            id: message.id,
            sessionId,
            role: message.role,
            content: message.content,
            position,
          },
          update: { role: message.role, content: message.content, position },
        }),
      ),
    )
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
})

/**
 * List sessions (newest first) for the sidebar, one page at a time.
 *
 * `search` filters by custom title OR message content (case-insensitive);
 * `skip`/`take` paginate. Returns `hasMore` so the client can offer a
 * "Show more" action. Empty sessions (created but never used) are excluded
 * in the query itself so offset pagination stays correct.
 */
export async function listChatSessions(input?: {
  search?: string
  skip?: number
  take?: number
}): Promise<
  { ok: true; sessions: ChatSessionSummary[]; hasMore: boolean } | { ok: false; error: string }
> {
  const parsed = ListSessionsInputSchema.safeParse(input ?? {})
  if (!parsed.success) {
    return { ok: false, error: 'Invalid list options.' }
  }
  const { search, skip, take } = parsed.data
  try {
    // Raw SQL: Prisma's `mode: 'insensitive'` filter is not available for
    // SQLite with the LibSQL adapter ("Unknown argument `mode`"), and LIKE is
    // case-insensitive for ASCII by default — COLLATE NOCASE makes it explicit.
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
      }>
    >`
      SELECT cs.id, cs.title,
        (SELECT m2.content FROM chat_messages m2 WHERE m2.sessionId = cs.id
           ORDER BY m2.position ASC LIMIT 1) AS first_content,
        (SELECT COUNT(*) FROM chat_messages m3 WHERE m3.sessionId = cs.id) AS message_count,
        cs.updatedAt AS updated_at
      FROM chat_sessions cs
      WHERE EXISTS (SELECT 1 FROM chat_messages m WHERE m.sessionId = cs.id)
        ${searchFilter}
      ORDER BY cs.updatedAt DESC
      LIMIT ${take + 1} OFFSET ${skip}
    `
    const hasMore = rows.length > take
    const page = hasMore ? rows.slice(0, take) : rows
    return {
      ok: true,
      hasMore,
      sessions: page.map((row) => ({
        id: row.id,
        // A user-renamed title wins; otherwise derive from the first message.
        title: row.title ?? sessionTitle(row.first_content ?? undefined),
        updatedAt: new Date(row.updated_at).toISOString(),
        messageCount: Number(row.message_count),
      })),
    }
  } catch {
    return { ok: false, error: 'Could not list sessions.' }
  }
}

/** Rename a session (sidebar label). No-op success for unknown sessions. */
export async function renameChatSession(input: {
  sessionId: string
  title: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = RenameSessionInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid session id or title.' }
  }
  const { sessionId, title } = parsed.data
  try {
    await prisma.chatSession.updateMany({ where: { id: sessionId }, data: { title } })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not rename session.' }
  }
}

/** Delete a session and its messages (cascade). */
export async function clearChatSession(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!SessionIdSchema.safeParse(sessionId).success) {
    return { ok: false, error: 'Invalid session id.' }
  }
  try {
    await prisma.chatSession.deleteMany({ where: { id: sessionId } })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not clear session.' }
  }
}
