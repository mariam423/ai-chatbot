/**
 * Shared LLM provider configuration.
 *
 * Both the streaming chat route and the server-side transcription route need
 * the same facts about the configured provider: which key to use, which base
 * URL to call, and which provider is in play (OpenRouter's URL differs from
 * plain OpenAI's, and Gemini's OpenAI-compatible endpoint differs from both —
 * and expects plain model names). Centralizing them keeps the fallback chain
 * in one place instead of drifting across routes.
 */

export type LlmProvider = 'openrouter' | 'gemini' | 'openai'

export interface LlmConfig {
  /** Preferred API key, or null when no provider key is configured. */
  apiKey: string | null
  /** Provider base URL with trailing slashes stripped. */
  baseUrl: string
  /** Which provider the resolved key belongs to (drives model ids + URL). */
  provider: LlmProvider
  /** True when the resolved provider is OpenRouter. */
  usesOpenRouter: boolean
}

/**
 * Google Gemini's OpenAI-compatible endpoint (docs:
 * https://ai.google.dev/gemini-api/docs/openai). Serves `/chat/completions`
 * with `Authorization: Bearer <GEMINI_API_KEY>`, so the shared route code
 * works unchanged — free-tier models like `gemini-2.5-flash-lite` are
 * reachable with a free AI Studio key.
 */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

/**
 * Infer which provider a key belongs to from its well-known prefix, so a
 * per-user key pasted in Settings routes to the right endpoint:
 * - OpenRouter keys start with `sk-or-`
 * - Gemini API keys start with `AIza`
 * - everything else is treated as an OpenAI-style key (`sk-…`)
 */
export function detectProviderFromKey(key: string): LlmProvider {
  if (key.startsWith('sk-or-')) return 'openrouter'
  if (key.startsWith('AIza')) return 'gemini'
  return 'openai'
}

/**
 * Resolve the effective LLM provider configuration.
 *
 * A per-user key from Settings (UserPreference.apiKey, decrypted) wins over
 * the server env entirely — that is the "use your personal quota" contract.
 * Otherwise the env chain is OPENROUTER_API_KEY → GEMINI_API_KEY →
 * OPENAI_API_KEY. Base URL honors the provider's explicit override before
 * falling back to its default; OPENAI_BASE_URL remains the escape hatch for
 * any OpenAI-compatible endpoint, even when an OpenRouter key is in play.
 */
export function getLlmConfig(userApiKey?: string | null): LlmConfig {
  const resolvedUserKey = userApiKey?.trim() || null
  // `||` (not `??`) is deliberate: an empty-string env var means "unset", so
  // clearing OPENROUTER_API_KEY must let GEMINI/OPENAI keys win.
  const apiKey =
    resolvedUserKey ??
    (process.env.OPENROUTER_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      null)

  const provider: LlmProvider = resolvedUserKey
    ? detectProviderFromKey(resolvedUserKey)
    : process.env.OPENROUTER_API_KEY
      ? 'openrouter'
      : process.env.GEMINI_API_KEY
        ? 'gemini'
        : 'openai'

  const providerBaseUrl =
    provider === 'openrouter'
      ? process.env.OPENROUTER_BASE_URL
      : provider === 'gemini'
        ? process.env.GEMINI_BASE_URL
        : process.env.OPENAI_BASE_URL
  const defaultBaseUrl =
    provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : provider === 'gemini'
        ? GEMINI_BASE_URL
        : 'https://api.openai.com/v1'
  const baseUrl = (
    providerBaseUrl ??
    (provider === 'openrouter' ? process.env.OPENAI_BASE_URL : undefined) ??
    defaultBaseUrl
  ).replace(/\/+$/, '')

  return { apiKey, baseUrl, provider, usesOpenRouter: provider === 'openrouter' }
}

/**
 * Resolve the `max_tokens` value to put on a completion request.
 *
 * A per-user value (Settings → Max Completion Tokens, sent by the client as
 * `maxTokens`) always wins. Otherwise every provider gets the conservative
 * cap from `getMaxOutputTokens()` (MAX_OUTPUT_TOKENS env or the 200 default).
 *
 * The cap is what makes low-credit keys work: OpenRouter pre-authorizes the
 * request against `max_tokens` and rejects the key with 402 Insufficient
 * Balance when the pre-auth exceeds the remaining balance (verified live:
 * omitting the field made OpenRouter pre-authorize ~16,000 tokens and 402 a
 * key that can only afford ~2,500; an explicit tiny cap pre-authorizes cents
 * and streams). So the field is always sent — never omitted.
 */
export function resolveMaxTokens(userMaxTokens?: number): number {
  if (userMaxTokens !== undefined) return userMaxTokens
  return getMaxOutputTokens()
}

/**
 * Conservative default for the completion-length cap (`max_tokens`) sent to
 * providers when the caller doesn't specify one.
 *
 * Sending an explicit value matters for cost control and 402 avoidance: when
 * `max_tokens` is omitted, providers fall back to the model's own maximum
 * (OpenRouter's is often 16,000–65,536) and pre-authorize the request against
 * that full estimated cost, which rejects a low-credit key with 402
 * Insufficient Balance before a single token streams (verified live). The cap
 * is deliberately tiny (200) and is per-request; the per-user settings slider
 * raises it per chat when a longer answer is wanted.
 *
 * Override with MAX_OUTPUT_TOKENS (e.g. 8192 for a chatty model).
 *
 * Scope: applied at every token-billed call site — the streaming chat route
 * (app/api/chat) and the agent tool-planning calls (lib/agent) for all
 * providers. It is deliberately NOT sent to /audio/transcriptions: the
 * OpenAI-compatible STT API has no max_tokens parameter (whisper is billed by
 * audio duration, and strict providers reject unknown fields with a 400).
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 200

/** Resolve the effective completion cap: MAX_OUTPUT_TOKENS env or the default. */
export function getMaxOutputTokens(): number {
  const raw = Number(process.env.MAX_OUTPUT_TOKENS)
  if (Number.isInteger(raw) && raw >= 1) return raw
  return DEFAULT_MAX_OUTPUT_TOKENS
}
