/**
 * Pool tuning for the Prisma pg driver adapter (consumed by lib/db.ts).
 *
 * Kept as a pure module (no prisma / adapter imports) so the env → pool
 * mapping is unit-testable without opening a database connection.
 *
 * Design rules:
 *  - With no env overrides on a long-lived process (EC2/PM2/`next start`),
 *    the resolved values are exactly node-postgres's defaults — zero
 *    behavior change from passing only a connection string.
 *  - On a serverless runtime (Vercel) the pool max defaults to 1: each
 *    function instance is short-lived and Neon's pooler (the pooled
 *    `DATABASE_URL`) is what actually bounds connection counts — a fat
 *    per-instance pool multiplies connections across concurrent instances.
 *  - On a serverless runtime the connection timeout defaults to 5s instead
 *    of node-postgres's "wait forever" (0). A stuck database — Neon
 *    autosuspend waking, a direct-URL connection-limit queue, a rotated
 *    password — must fail fast so the request surfaces a proper error
 *    instead of holding the serverless function open until the platform
 *    kills it (which looks like an endless spinner on login). Long-lived
 *    processes keep the node-postgres default (0 = wait forever).
 *  - All envs are optional; invalid values (non-numeric, negative, zero
 *    where nonsensical) fall back to the default instead of throwing, so a
 *    typo in an env file can never take the app down.
 */

export interface PoolTuning {
  /** Max simultaneous connections this process opens. */
  max: number
  /** Min connections kept warm. */
  min: number
  /** Idle connection lifetime before the pool closes it (ms). */
  idleTimeoutMillis: number
  /** Max time to wait for a new connection before failing (ms). 0 = wait forever (pg default). */
  connectionTimeoutMillis: number
}

/** Matches node-postgres's own defaults, so unset envs change nothing. */
const PG_DEFAULT_MAX = 10
const PG_DEFAULT_MIN = 0
const PG_DEFAULT_IDLE_TIMEOUT_MS = 10_000
const PG_DEFAULT_CONNECTION_TIMEOUT_MS = 0

/**
 * Vercel function instances are short-lived and many run concurrently —
 * one connection per instance (the Neon pooler absorbs the rest) is the
 * standard serverless shape.
 */
const SERVERLESS_POOL_MAX = 1

/**
 * Max seconds to wait for a new Postgres connection on a serverless
 * runtime. node-postgres's own default is 0 = wait forever, which is correct
 * for long-lived processes but pathological in serverless: a database that
 * is temporarily unreachable (Neon autosuspend cold start, connection-
 * limit queue on a direct URL, a speed-of-light misconfiguration) would
 * pin the function until the platform timeout instead of failing cleanly.
 */
const SERVERLESS_CONNECTION_TIMEOUT_MS = 5_000

/**
 * Env-shaped input: `Record` (not `NodeJS.ProcessEnv`) so callers can pass
 * partial/plain objects in tests — Next's type augmentation makes NODE_ENV
 * required on ProcessEnv, which is noise here.
 */
export type DbEnv = Record<string, string | undefined>

/** True when the process runs on a short-lived serverless function host. */
export function isServerlessRuntime(env: DbEnv = process.env): boolean {
  return (
    env.VERCEL === '1' ||
    env.VERCEL_ENV !== undefined ||
    env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
    env.FUNCTION_TARGET !== undefined
  )
}

/** Parse a positive-int env; garbage or missing values fall back. */
function positiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

/**
 * Resolve pool tuning from the environment. Explicit env overrides always
 * win; otherwise the runtime-aware defaults apply (see module docstring).
 */
export function parsePoolTuning(env: DbEnv = process.env): PoolTuning {
  const max = positiveIntEnv(
    env.DATABASE_POOL_MAX,
    isServerlessRuntime(env) ? SERVERLESS_POOL_MAX : PG_DEFAULT_MAX,
  )
  // min is clamped to [0, max] so a misconfigured pair can never ask the
  // pool to keep more connections warm than it is allowed to open.
  const min = Math.min(Math.max(positiveIntEnv(env.DATABASE_POOL_MIN, PG_DEFAULT_MIN), 0), max)
  return {
    max,
    min,
    idleTimeoutMillis: positiveIntEnv(
      env.DATABASE_POOL_IDLE_TIMEOUT_MS,
      PG_DEFAULT_IDLE_TIMEOUT_MS,
    ),
    connectionTimeoutMillis: positiveIntEnv(
      env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
      isServerlessRuntime(env)
        ? SERVERLESS_CONNECTION_TIMEOUT_MS
        : PG_DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
  }
}

/** The adapter options object handed to `new PrismaPg(...)`. */
export interface PrismaPgConfig {
  connectionString: string
  max: number
  min: number
  idleTimeoutMillis: number
  connectionTimeoutMillis: number
}

export function buildPrismaPgConfig(
  connectionString: string,
  env: DbEnv = process.env,
): PrismaPgConfig {
  const { max, min, idleTimeoutMillis, connectionTimeoutMillis } = parsePoolTuning(env)
  return { connectionString, max, min, idleTimeoutMillis, connectionTimeoutMillis }
}

/**
 * Warn when a serverless deployment points at a Neon *direct* URL instead
 * of the pooled one. Neon allows ~10k concurrent connections on its proxy
 * but far fewer direct connections to the compute — a pooler (the
 * `?pgbouncer=true` URL) is what keeps serverless function bursts under the
 * direct-connection limit. Returns a message or `null`; callers emit it
 * once at startup (never on a hot path).
 */
export function pooledUrlWarning(
  databaseUrl: string | undefined,
  env: DbEnv = process.env,
): string | null {
  if (!databaseUrl) return null
  // Only meaningful for Neon-hosted URLs.
  if (!/neon\.tech/i.test(databaseUrl)) return null
  if (!isServerlessRuntime(env)) return null
  if (/pgbouncer=true/i.test(databaseUrl)) return null
  return (
    'DATABASE_URL points at a Neon direct connection while running on a serverless ' +
    'runtime. Use the pooled connection string (Connection Details → Pooled, has ' +
    '?pgbouncer=true) so concurrent function instances stay under the direct ' +
    'connection limit.'
  )
}
