/**
 * Structured security audit logging (OWASP A09).
 *
 * Security-relevant events — auth failures, rate-limit trips, CSRF blocks,
 * unauthorized access, ownership violations, webhook signature failures —
 * are emitted as single-line JSON so a log collector can index them without
 * custom parsing:
 *
 *   [security] {"ts":"2026-08-24T…","event":"rate_limited","level":"warn","route":"chat",…}
 *
 * Rules:
 *  - `warn` events (denials) log always in non-test environments.
 *  - `info` events (allowed/auth-success) are opt-in via SECURITY_AUDIT_LOG=true
 *    so a busy app doesn't drown its own logs by default.
 *  - Nothing sensitive is ever logged: callers pass only ids, IPs, and status
 *    codes — never bodies, headers, tokens, or full request data. Emails are
 *    logged only for auth failures (the account under attack).
 *  - Vitest sets NODE_ENV=test, so unit/integration suites stay quiet.
 */

export type SecurityEventKind =
  | 'csrf_blocked'
  | 'unauthorized'
  | 'rate_limited'
  | 'ownership_violation'
  | 'auth_throttled'
  | 'auth_failed'
  | 'auth_succeeded'
  | 'billing_throttled'
  | 'webhook_invalid_signature'
  | 'webhook_invalid_payload'
  | 'webhook_unresolved_user'
  | 'decryption_failed'
  | 'worker_job_failed'
  // LLM gateway telemetry (Phase 4): emitted at info level, so both are
  // gated behind SECURITY_AUDIT_LOG like other info events.
  | 'gateway_failover'
  | 'gateway_exhausted'

/**
 * Emit one structured security event. `details` must contain only small,
 * non-sensitive identifiers (ids, ips, statuses, routes) — never bodies,
 * headers, or secrets.
 */
export function logSecurityEvent(
  kind: SecurityEventKind,
  details: Record<string, unknown>,
  level: 'warn' | 'info' = 'warn',
): void {
  if (process.env.NODE_ENV === 'test') return
  if (level === 'info' && process.env.SECURITY_AUDIT_LOG !== 'true') return
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event: kind,
    level,
    ...details,
  })
  if (level === 'warn') console.warn(`[security] ${line}`)
  else console.info(`[security] ${line}`)
}
