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
 * works unchanged — free-tier models like `gemini-2.0-flash` are reachable
 * with a free AI Studio key.
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
 * Conservative default for the completion-length cap (`max_tokens`) sent to
 * the provider when the caller doesn't specify one.
 *
 * Sending an explicit value matters for cost control: when `max_tokens` is
 * omitted, OpenRouter falls back to the model's own maximum (often 65536)
 * and pre-authorizes the request against that full estimated cost — a
 * low-credit key can be rejected with 402 Insufficient Balance even for a
 * short reply. A modest cap keeps the pre-auth tiny while still allowing
 * long answers. Override with MAX_OUTPUT_TOKENS (e.g. 8192 for a chatty
 * model); the per-user settings slider still wins when the client sends one.
 *
 * Scope: this cap is applied at every token-billed call site — the streaming
 * chat route (app/api/chat) and the agent tool-planning calls (lib/agent).
 * It is deliberately NOT sent to /audio/transcriptions: the OpenAI-compatible
 * STT API has no max_tokens parameter (whisper is billed by audio duration,
 * and strict providers reject unknown fields with a 400).
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/** Resolve the effective completion cap: MAX_OUTPUT_TOKENS env or the default. */
export function getMaxOutputTokens(): number {
  const raw = Number(process.env.MAX_OUTPUT_TOKENS)
  if (Number.isInteger(raw) && raw >= 1) return raw
  return DEFAULT_MAX_OUTPUT_TOKENS
}
