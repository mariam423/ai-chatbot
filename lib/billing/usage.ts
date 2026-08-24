import { prisma } from '@/lib/db'
import { getPlan, isOverDailyLimit } from './plans'

/**
 * Check-and-record one chat request against the user's plan usage cap.
 *
 * Returns `{ ok: true }` when the request is allowed (and the daily counter
 * is incremented) or `{ ok: false, error }` when the user has hit their
 * plan's daily limit — the caller surfaces this as a 429.
 *
 * The read-then-write is intentionally non-transactional: the tiny race
 * window only risks an occasional request slipping past the cap, which is an
 * acceptable trade for keeping the hot path free of a write lock, and the
 * counter is a cost guard, not a billing metering system.
 */
export async function checkAndRecordUsage(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, usageCount: true, usageDate: true },
  })
  if (!user) return { ok: true }

  const today = new Date().toISOString().slice(0, 10)
  const usedToday = user.usageDate === today ? user.usageCount : 0
  if (isOverDailyLimit(user.plan, usedToday)) {
    const limit = getPlan(user.plan).dailyChatRequests
    return {
      ok: false,
      error: `You've reached the Free plan's daily limit of ${limit} chat requests. Upgrade to Pro for unlimited requests.`,
    }
  }

  const isNewDay = user.usageDate !== today
  await prisma.user.update({
    where: { id: userId },
    data: {
      usageCount: isNewDay ? 1 : user.usageCount + 1,
      usageDate: today,
    },
  })
  return { ok: true }
}
