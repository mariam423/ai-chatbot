/**
 * Security & guardrails shared by the API routes:
 *
 *  - `rateLimit`      — shared fixed-window limiter (per IP and per user),
 *                       in-memory locally, Redis-backed when `REDIS_URL` is
 *                       set (see lib/rate-limit.ts).
 *  - `checkCsrf`      — Origin/Referer guard for state-changing requests.
 *  - `sanitizeInput`  — strip control chars / trim for user-supplied strings.
 *  - `requireSession` — ensure a request carries a valid session (NextAuth).
 *  - `guardRoute`     — one-call composition of the above for API routes.
 *
 * API routes should use `guardRoute` (CSRF → optional session → rate limit)
 * rather than calling the primitives directly.
 */

import { NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse, type RateLimitStore } from './rate-limit'
import { logSecurityEvent } from './audit'

// Re-exported so existing `@/lib/security` imports keep working.
export { rateLimit, rateLimitResponse, type RateLimitStore }

/**
 * Client IP from raw headers (honoring X-Forwarded-For set by proxies).
 * Shared by the API routes (which have a `Request`) and the server actions
 * (which only have `next/headers`), so both throttle on the same value.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip') ?? 'unknown'
}

/** Client IP from a `Request` — convenience for the API routes. */
export function clientIp(request: Request): string {
  return clientIpFromHeaders(request.headers)
}

/* ------------------------------------------------------------------ */
/* CSRF / origin guard                                                 */
/* ------------------------------------------------------------------ */

/**
 * Reject cross-site requests to state-changing endpoints. The app is a
 * cookie-authenticated SPA, so any mutation must come from the same origin.
 * Accepts either an explicit Origin header (browsers always send one on
 * cross-origin + same-origin POSTs) or a Referer fallback. Same-origin is
 * judged against the configured public URL (defaults to localhost:3000).
 * Returns null when the request is safe, or a 403 response to return.
 */
export function checkCsrf(request: Request): NextResponse | null {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  const candidate = origin ?? (referer ? new URL(referer).origin : null)
  if (!candidate) {
    // No Origin/Referer: a same-origin fetch from a modern browser always
    // sends Origin for POST; its absence is treated as non-browser traffic
    // (curl, servers, tests) and allowed through for API compatibility.
    return null
  }
  const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const allowed = new URL(allowedOrigin).origin
  if (candidate === allowed) return null
  return NextResponse.json({ error: 'Cross-site request blocked.' }, { status: 403 })
}

/* ------------------------------------------------------------------ */
/* Auth guardrails (server actions + the credentials provider)         */
/* ------------------------------------------------------------------ */

/** Keys of the throttled auth surfaces — the lookup handles for `AUTH_GUARDS`. */
export type AuthGuardKey = 'register' | 'login' | 'reset-request' | 'reset-complete'

/**
 * Per-window abuse limits for the auth entry points, mirroring the
 * `ROUTE_GUARDS` philosophy: every auth surface's cap is defined and
 * reviewable here instead of inline at each call site. The API routes are
 * guarded via `guardRoute`; these four are server actions / the NextAuth
 * credentials provider, which have no `Request`-level guard, so they use
 * `checkAuthRateLimit` / `checkLoginRateLimit` instead.
 *
 * - `register` — bcrypt cost-12 hashing + DB row creation, unauthenticated
 * - `login` — brute-force surface; `emailLimit` caps attempts per account
 *   (both are enforced in the credentials `authorize`)
 * - `reset-request` — writes a token row per call (+ future email sends)
 * - `reset-complete` — token-consumption surface
 *
 * Buckets are keyed by client IP (plus the account email for login) and go
 * through the shared Redis-capable store, so limits survive restarts and
 * hold across instances. Tests/security.test.ts pins this map so the caps
 * can't drift from the docs.
 */
export const AUTH_GUARDS: Record<
  AuthGuardKey,
  { name: string; limit: number; windowMs: number; emailLimit?: number }
> = {
  register: { name: 'auth:register', limit: 5, windowMs: 60_000 },
  login: { name: 'auth:login', limit: 20, windowMs: 60_000, emailLimit: 10 },
  'reset-request': { name: 'auth:reset-request', limit: 5, windowMs: 60_000 },
  'reset-complete': { name: 'auth:reset-complete', limit: 10, windowMs: 60_000 },
}

/** The throttled error shared by all auth server actions. */
export const AUTH_RATE_LIMIT_ERROR = 'Too many attempts. Please wait a minute and try again.'
export const BILLING_RATE_LIMIT_ERROR =
  'Too many billing requests. Please wait a minute and try again.'

/** Rate limits for authenticated Stripe mutations exposed as server actions. */
export type BillingGuardKey = 'status' | 'checkout' | 'portal'

export const BILLING_GUARDS: Record<
  BillingGuardKey,
  { name: string; limit: number; windowMs: number }
> = {
  status: { name: 'billing:status', limit: 60, windowMs: 60_000 },
  checkout: { name: 'billing:checkout', limit: 10, windowMs: 60_000 },
  portal: { name: 'billing:portal', limit: 20, windowMs: 60_000 },
}

/**
 * Throttle billing redirects by IP after the caller has been authenticated.
 * Billing actions are server actions rather than Request-backed routes, so
 * they use the same shared store through `clientIpFromHeaders`.
 */
export async function checkBillingRateLimit(
  guard: BillingGuardKey,
  ip: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = BILLING_GUARDS[guard]
  const result = await rateLimit(`${config.name}:ip:${ip}`, {
    limit: config.limit,
    windowMs: config.windowMs,
  })
  if (!result.ok) {
    logSecurityEvent('billing_throttled', {
      guard,
      ip,
      retryAfterSeconds: result.retryAfterSeconds,
    })
    return { ok: false, error: BILLING_RATE_LIMIT_ERROR }
  }
  return { ok: true }
}

/**
 * Throttle an auth server action by client IP (register, password reset).
 * Returns the standard `{ ok: false; error }` shape the actions already use,
 * so callers short-circuit before any DB or bcrypt work.
 */
export async function checkAuthRateLimit(
  guard: AuthGuardKey,
  ip: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { name, limit, windowMs } = AUTH_GUARDS[guard]
  const result = await rateLimit(`${name}:ip:${ip}`, { limit, windowMs })
  if (!result.ok) {
    logSecurityEvent('auth_throttled', { guard, ip, retryAfterSeconds: result.retryAfterSeconds })
  }
  return result.ok ? { ok: true } : { ok: false, error: AUTH_RATE_LIMIT_ERROR }
}

/**
 * Throttle a login attempt: per-IP cap (broad flooding) and a tighter
 * per-account cap (targeted password guessing). Runs before bcrypt so a
 * flood can't burn CPU. Returns false when either cap is exceeded — the
 * credentials provider turns that into a generic auth failure (no leak of
 * which limit tripped).
 */
export async function checkLoginRateLimit(ip: string, email: string): Promise<boolean> {
  const { name, limit, windowMs, emailLimit = 10 } = AUTH_GUARDS.login
  const byIp = await rateLimit(`${name}:ip:${ip}`, { limit, windowMs })
  if (!byIp.ok) {
    logSecurityEvent('auth_throttled', {
      guard: 'login',
      scope: 'ip',
      ip,
      retryAfterSeconds: byIp.retryAfterSeconds,
    })
    return false
  }
  const byEmail = await rateLimit(`${name}:email:${email}`, { limit: emailLimit, windowMs })
  if (!byEmail.ok) {
    logSecurityEvent('auth_throttled', {
      guard: 'login',
      scope: 'email',
      email,
      retryAfterSeconds: byEmail.retryAfterSeconds,
    })
    return false
  }
  return true
}

/* ------------------------------------------------------------------ */
/* Input sanitization                                                  */
/* ------------------------------------------------------------------ */

/**
 * Trim and strip control characters (including \u0000 which can truncate
 * SQLite/Postgres text comparisons) from user-supplied strings. Never used
 * as a substitute for schema validation — it just normalizes the surface.
 */ export function sanitizeInput(value: string, maxLength = 2_000): string {
  // Strip control chars EXCEPT whitespace (\t \n \r): newlines are legitimate
  // markdown content (fenced code blocks, lists) and must survive persistence.
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength)
}

/* ------------------------------------------------------------------ */
/* Route guard (composition helper)                                    */
/* ------------------------------------------------------------------ */

export interface RouteGuardOptions {
  /** Namespace for the rate-limit bucket, e.g. "chat" → `chat:user:<id>` / `chat:ip:<ip>`. */
  name: string
  /**
   * Rate-limit window and per-window cap. `limit` may be a literal number or
   * an env var name; when the env var is unset, `defaultLimit` applies (so
   * an unset var never silently disables the cap). Omit the whole option to
   * skip rate limiting.
   */
  rateLimit?: { limit: number | string; windowMs?: number; defaultLimit?: number }
  /** Key rate-limit buckets by the signed-in user (falling back to IP). Default: IP only. */
  scope?: 'user' | 'ip'
  /** Require a valid NextAuth session (bypassed when AUTH_DISABLED=true). */
  session?: boolean
  /** Skip the Origin/Referer CSRF guard (GET endpoints may disable it). */
  csrf?: boolean
}

/** Keys of the guarded API routes — the lookup handles for `ROUTE_GUARDS`. */
export type RouteGuardKey =
  'chat' | 'transcribe' | 'upload' | 'citation' | 'analytics' | 'skills' | 'stripe-webhook'

/**
 * Single source of truth for every API route's guard configuration: the
 * rate-limit bucket namespace, scope, session requirement, and CSRF policy
 * are defined here instead of inline at each call site, so the whole guard
 * surface is reviewable in one place. Routes apply it with
 * `guardRoute(request, ROUTE_GUARDS.<route>)`.
 *
 * `name` is the bucket namespace (e.g. `chat:user:<id>`) and must match the
 * map key — tests/security.test.ts enforces that. The values mirror the
 * README's deployment runbook table; tests pin them so the docs can't drift
 * from the code.
 */
export const ROUTE_GUARDS: Record<RouteGuardKey, RouteGuardOptions> = {
  chat: {
    name: 'chat',
    scope: 'user',
    session: true,
    rateLimit: { limit: 'CHAT_RATE_LIMIT', defaultLimit: 120, windowMs: 60_000 },
  },
  transcribe: {
    name: 'transcribe',
    rateLimit: { limit: 'TRANSCRIBE_RATE_LIMIT', defaultLimit: 60, windowMs: 60_000 },
  },
  upload: {
    name: 'upload',
    rateLimit: { limit: 'UPLOAD_RATE_LIMIT', defaultLimit: 60, windowMs: 60_000 },
  },
  citation: {
    name: 'citation',
    csrf: false,
    rateLimit: { limit: 120, windowMs: 60_000 },
  },
  analytics: {
    name: 'analytics',
  },
  skills: {
    name: 'skills',
    csrf: false,
    rateLimit: { limit: 600, windowMs: 60_000 },
  },
  'stripe-webhook': {
    name: 'stripe-webhook',
    rateLimit: { limit: 600, windowMs: 60_000 },
  },
}

/**
 * One-call guardrail for the API routes: CSRF (unless disabled), optional
 * session check, then a rate limit whose bucket is keyed by the signed-in
 * user (when `scope: 'user'`) or the client IP. Pass the route's config from
 * `ROUTE_GUARDS`.
 *
 * Returns a discriminated union:
 *  - `{ ok: true; userId: string }` — request passed; `userId` is the
 *    signed-in user id ('' when AUTH_DISABLED and no session was required)
 *  - `{ ok: false; response: NextResponse }` — short-circuit with the 401/403/429
 *
 * ```ts
 * const guard = await guardRoute(request, ROUTE_GUARDS.chat)
 * if (!guard.ok) return guard.response
 * ```
 */
export async function guardRoute(
  request: Request,
  options: RouteGuardOptions,
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const { name, rateLimit: rateLimitOptions, scope = 'ip', session = false, csrf = true } = options

  if (csrf) {
    const csrfResponse = checkCsrf(request)
    if (csrfResponse) {
      logSecurityEvent('csrf_blocked', {
        route: name,
        ip: clientIp(request),
        origin: request.headers.get('origin') ?? request.headers.get('referer') ?? null,
      })
      return { ok: false, response: csrfResponse }
    }
  }

  let userId = ''
  if (session) {
    const sessionResult = await requireSession()
    if (sessionResult.response) {
      logSecurityEvent('unauthorized', { route: name, ip: clientIp(request) })
      return { ok: false, response: sessionResult.response }
    }
    userId = sessionResult.userId
  }

  const rawLimit = rateLimitOptions
    ? typeof rateLimitOptions.limit === 'number'
      ? rateLimitOptions.limit
      : Number(process.env[rateLimitOptions.limit]) || rateLimitOptions.defaultLimit || 0
    : 0
  if (rateLimitOptions && rawLimit > 0) {
    const rateKey =
      scope === 'user' && userId ? `${name}:user:${userId}` : `${name}:ip:${clientIp(request)}`
    const limited = await rateLimit(rateKey, {
      limit: rawLimit,
      windowMs: rateLimitOptions.windowMs ?? 60_000,
    })
    if (!limited.ok) {
      logSecurityEvent('rate_limited', {
        route: name,
        key: rateKey,
        retryAfterSeconds: limited.retryAfterSeconds,
      })
      return { ok: false, response: rateLimitResponse(limited.retryAfterSeconds) }
    }
  }

  return { ok: true, userId }
}

/* ------------------------------------------------------------------ */
/* Session guard                                                       */
/* ------------------------------------------------------------------ */

/**
 * Ensure the request carries a valid NextAuth session. Returns the user id
 * when signed in, or a 401 response to return. Note the app supports
 * AUTH_DISABLED (local dev / e2e) — when that env is set the guard is
 * bypassed so the API keeps working without credentials.
 */
export async function requireSession(): Promise<
  { userId: string; response: null } | { userId: null; response: NextResponse }
> {
  if (process.env.AUTH_DISABLED === 'true') {
    // No session enforcement in local dev/e2e mode (matches lib/auth-context).
    return { userId: '', response: null }
  }
  // Lazy import so importing this module never pulls next-auth (vitest-safe).
  const { auth } = await import('@/lib/auth')
  const session = await auth()
  const userId = (session?.user as { id?: string })?.id
  if (!userId) {
    return {
      userId: null,
      response: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }),
    }
  }
  return { userId, response: null }
}
