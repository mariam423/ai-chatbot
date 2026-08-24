/**
 * Server-only session ownership lookup.
 *
 * Every endpoint that reads or mutates a chat session must first prove the
 * requester owns it. When auth is active the lookup is scoped by the
 * authenticated user id; when AUTH_DISABLED (local dev / e2e) the scope is
 * dropped so anonymous access still works — matching lib/auth-context.
 */

import { prisma } from '@/lib/db'

/**
 * Find a chat session the current user may access, or null when it does not
 * exist (or belongs to someone else). Pass an explicit `userId` when the
 * caller already resolved it (avoids a second lazy auth import); otherwise
 * the current user id is looked up.
 */
export async function findOwnedSession(
  sessionId: string,
  userId?: string | null,
): Promise<{ id: string } | null> {
  const ownerId =
    userId === undefined
      ? await import('@/lib/auth-context').then((module) => module.getCurrentUserId())
      : userId
  if (process.env.AUTH_DISABLED !== 'true' && !ownerId) return null
  return prisma.chatSession.findFirst({
    where: { id: sessionId, ...(ownerId ? { userId: ownerId } : {}) },
    select: { id: true },
  })
}
