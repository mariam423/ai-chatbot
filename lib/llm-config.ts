/**
 * Shared LLM provider configuration.
 *
 * Both the streaming chat route and the server-side transcription route need
 * the same three facts about the configured provider: which key to use, which
 * base URL to call, and whether OpenRouter is in play (its URL differs from
 * the plain OpenAI one). Centralizing them keeps the fallback chain in one
 * place instead of drifting across routes.
 */

export interface LlmConfig {
  /** Preferred API key, or null when no provider key is configured. */
  apiKey: string | null
  /** Provider base URL with trailing slashes stripped. */
  baseUrl: string
  /** True when OPENROUTER_API_KEY is set (drives URL + model defaults). */
  usesOpenRouter: boolean
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

/**
 * Resolve the effective LLM provider configuration from env vars.
 *
 * OPENROUTER_API_KEY is preferred; OPENAI_API_KEY remains supported for any
 * other OpenAI-compatible endpoint (Groq, Together, Ollama, …). Base URL
 * honors explicit overrides before falling back to the provider default.
 */
export function getLlmConfig(): LlmConfig {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY
  const usesOpenRouter = Boolean(process.env.OPENROUTER_API_KEY)
  const baseUrl = (
    process.env.OPENROUTER_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    (usesOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')
  ).replace(/\/+$/, '')
  return { apiKey: apiKey || null, baseUrl, usesOpenRouter }
}
