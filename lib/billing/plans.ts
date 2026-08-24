/**
 * SaaS plan tiers and per-plan usage limits.
 *
 * Tiers are addressed by a stable key persisted on `users.plan`:
 *  - "free": default for every new user; capped at `dailyChatRequests` LLM
 *    calls per day (cost control — see the /api/chat route).
 *  - "pro": unlimited daily requests, unlocked via a Stripe subscription
 *    (checkout/portal actions in app/actions.ts).
 *
 * The limits are pure data so the webhook, the route guard, and the UI all
 * read from the same source of truth.
 */

export type PlanKey = 'free' | 'pro'

export interface PlanTier {
  key: PlanKey
  label: string
  /** Max chat requests per day; null = unlimited. */
  dailyChatRequests: number | null
  /** Stripe Price id used for checkout. Configured via env STRIPE_PRICE_PRO. */
  stripePriceId: string | null
}

export const PLANS: Record<PlanKey, PlanTier> = {
  free: {
    key: 'free',
    label: 'Free',
    dailyChatRequests: Number(process.env.FREE_PLAN_DAILY_LIMIT) || 20,
    stripePriceId: null,
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    dailyChatRequests: null,
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
  },
}

/** Normalize an arbitrary stored value into a valid plan key ("free" fallback). */
export function parsePlanKey(value: string | null | undefined): PlanKey {
  return value === 'pro' ? 'pro' : 'free'
}

/** The tier for a stored plan value. */
export function getPlan(value: string | null | undefined): PlanTier {
  return PLANS[parsePlanKey(value)]
}

/**
 * Whether a user at `plan` may make another chat request today.
 * `todayCount` is the number already made today (from the user's usage
 * counter, keyed by date). A null limit means unlimited.
 */
export function isOverDailyLimit(plan: string | null | undefined, todayCount: number): boolean {
  const limit = getPlan(plan).dailyChatRequests
  return limit !== null && todayCount >= limit
}
