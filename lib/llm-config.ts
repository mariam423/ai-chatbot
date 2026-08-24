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
