/**
 * Resilient multi-provider LLM gateway (Phase 4).
 *
 * Two pieces:
 *
 *  1. `listGatewayCandidates` — the ordered list of usable providers for one
 *     chat request. A per-user key from Settings (detected by prefix) is
 *     always tried first (the "use your personal quota" contract); the server
 *     env keys then follow in canonical rank: OpenRouter → Gemini → OpenAI.
 *     Each entry carries the key + base URL for its own endpoint, so failover
 *     between providers swaps key/base URL/model id cleanly.
 *
 *  2. The per-provider circuit breaker — when a provider fails repeatedly
 *     (failover statuses or pre-stream connect/head timeouts), it opens for a
 *     cooldown and requests skip it entirely, going straight to the next
 *     ranked provider. State lives in Redis (`pulse:gateway:*`) so all
 *     instances share one picture of a sick provider; when Redis is down the
 *     breaker degrades to per-process in-memory state (same contract as the
 *     cache and rate limiter — an infra outage never widens an LLM outage).
 *
 * Failures are recorded per *request attempt*, not per streamed chunk:
 * once a stream has started, mid-stream errors surface to the client as
 * partial content (the app's streaming contract) and never trip the breaker.
 *
 * Key prefix: `pulse:gateway:` (distinct from `pulse:cache:`,
 * `pulse:ratelimit:`, and BullMQ's `bull:` namespace).
 */

import { getRedisClient } from '@/lib/redis'
import { detectProviderFromKey, GEMINI_BASE_URL, type LlmProvider } from '@/lib/llm-config'

/** One usable provider for a request: key + endpoint + which provider it is. */
export interface GatewayCandidate {
  provider: LlmProvider
  apiKey: string
  baseUrl: string
}

/** Failover rank for the server env keys (user keys go first, then this). */
export const GATEWAY_PROVIDER_ORDER: LlmProvider[] = ['openrouter', 'gemini', 'openai']

function envKeyFor(provider: LlmProvider): string | undefined {
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY
  if (provider === 'gemini') return process.env.GEMINI_API_KEY
  return process.env.OPENAI_API_KEY
}

/**
 * Base URL for a provider, honoring its env override (empty string = unset,
 * so `||` not `??`). The OpenRouter entry also honors OPENAI_BASE_URL as an
 * escape hatch for self-hosted OpenAI-compatible endpoints — the same
 * resolution getLlmConfig uses, so a single-provider deploy behaves exactly
 * as before.
 */
function baseUrlFor(provider: LlmProvider): string {
  const explicit =
    provider === 'openrouter'
      ? process.env.OPENROUTER_BASE_URL
      : provider === 'gemini'
        ? process.env.GEMINI_BASE_URL
        : process.env.OPENAI_BASE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  if (provider === 'openrouter' && process.env.OPENAI_BASE_URL) {
    return process.env.OPENAI_BASE_URL.replace(/\/+$/, '')
  }
  return (
    provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : provider === 'gemini'
        ? GEMINI_BASE_URL
        : 'https://api.openai.com/v1'
  ).replace(/\/+$/, '')
}

/**
 * Ordered candidate providers for a chat request: the per-user key (when
 * present) first, then every server env key in canonical rank. Duplicate
 * providers are dropped (a user OpenRouter key replaces the server's).
 * Returns an empty array when no key at all is configured — the caller
 * surfaces the "not configured" error.
 */
export function listGatewayCandidates(userApiKey?: string | null): GatewayCandidate[] {
  const userKey = userApiKey?.trim() || null
  const out: GatewayCandidate[] = []
  const seen = new Set<LlmProvider>()

  const push = (provider: LlmProvider, apiKey: string): void => {
    if (seen.has(provider)) return
    seen.add(provider)
    out.push({ provider, apiKey, baseUrl: baseUrlFor(provider) })
  }

  if (userKey) push(detectProviderFromKey(userKey), userKey)
  for (const provider of GATEWAY_PROVIDER_ORDER) {
    const key = envKeyFor(provider)
    if (key) push(provider, key)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Per-provider circuit breaker                                        */
/* ------------------------------------------------------------------ */

const PREFIX = 'pulse:gateway:breaker:'

/** Failures within the window that open the breaker. */
export const GATEWAY_FAILURE_THRESHOLD = 3
/** Sliding window over which failures are counted. */
export const GATEWAY_WINDOW_MS = 60_000
/** How long an open breaker stays open before a half-open probe is allowed. */
export const GATEWAY_COOLDOWN_MS = 30_000

interface BreakerState {
  /** Failure timestamps (epoch ms) inside the current window. */
  failures: number[]
  /** Epoch ms until which the breaker stays open; 0 = closed. */
  openUntil: number
}

function closedState(): BreakerState {
  return { failures: [], openUntil: 0 }
}

// Per-process fallback when Redis is unavailable (or a command fails).
const memoryBreakers = new Map<LlmProvider, BreakerState>()

async function readBreaker(provider: LlmProvider): Promise<BreakerState> {
  const redis = getRedisClient()
  if (!redis) return memoryBreakers.get(provider) ?? closedState()
  try {
    const raw = await redis.get(`${PREFIX}${provider}`)
    if (!raw) return closedState()
    const parsed = JSON.parse(raw) as BreakerState
    return {
      failures: Array.isArray(parsed.failures) ? parsed.failures : [],
      openUntil: Number(parsed.openUntil) || 0,
    }
  } catch {
    // Redis hiccup — fall back to the per-process state for this decision.
    return memoryBreakers.get(provider) ?? closedState()
  }
}

async function writeBreaker(provider: LlmProvider, state: BreakerState): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    memoryBreakers.set(provider, state)
    return
  }
  try {
    // TTL = window + cooldown so stale state expires on its own.
    await redis.set(
      `${PREFIX}${provider}`,
      JSON.stringify(state),
      'EX',
      Math.ceil((GATEWAY_WINDOW_MS + GATEWAY_COOLDOWN_MS) / 1000),
    )
  } catch {
    // Best-effort — the in-memory copy still protects this process.
    memoryBreakers.set(provider, state)
  }
}

/**
 * True when the provider is inside its open cooldown — the caller should skip
 * it and go straight to the next ranked provider. Once the cooldown elapses
 * the breaker is implicitly half-open: the next request probes the provider,
 * and its outcome (recordSuccess/recordFailure) decides closure.
 */
export async function isGatewayProviderOpen(provider: LlmProvider): Promise<boolean> {
  const state = await readBreaker(provider)
  return state.openUntil > Date.now()
}

/**
 * Record a failed request attempt for a provider (a failover status or a
 * pre-stream connect/head timeout — never a mid-stream error). After
 * GATEWAY_FAILURE_THRESHOLD failures inside the window the breaker opens for
 * GATEWAY_COOLDOWN_MS; a failure on a half-open probe (cooldown elapsed)
 * reopens it immediately so one bad probe can't take the provider down again.
 */
export async function recordGatewayProviderFailure(provider: LlmProvider): Promise<void> {
  const now = Date.now()
  const state = await readBreaker(provider)
  if (state.openUntil > now) return // already open — requests are being skipped

  if (state.openUntil > 0) {
    // Cooldown elapsed: this was a half-open probe and it failed — reopen.
    await writeBreaker(provider, { failures: [], openUntil: now + GATEWAY_COOLDOWN_MS })
    return
  }

  const active = [...state.failures, now].filter((ts) => ts > now - GATEWAY_WINDOW_MS)
  if (active.length >= GATEWAY_FAILURE_THRESHOLD) {
    // Open. Failures reset so a later success closes cleanly and a half-open
    // probe failure reopens via the branch above.
    await writeBreaker(provider, { failures: [], openUntil: now + GATEWAY_COOLDOWN_MS })
    return
  }
  await writeBreaker(provider, { failures: active, openUntil: 0 })
}

/** Record a successful request head — closes the breaker and clears failures. */
export async function recordGatewayProviderSuccess(provider: LlmProvider): Promise<void> {
  await writeBreaker(provider, closedState())
}

/**
 * Clear all breaker state. Test helper (per-process memory state persists
 * across requests in a suite) and an ops escape hatch for a stuck breaker.
 * Also clears the Redis-backed state when Redis is configured.
 */
export async function resetGatewayBreakers(): Promise<void> {
  memoryBreakers.clear()
  const redis = getRedisClient()
  if (!redis) return
  try {
    const keys = await redis.keys(`${PREFIX}*`)
    if (keys.length > 0) await redis.del(...keys)
  } catch {
    // Best-effort — the in-memory state is already cleared.
  }
}
