import { z } from 'zod'
import type { LlmProvider } from '@/lib/llm-config'

export const MODEL_OPTIONS = [
  {
    key: 'provider-default',
    label: 'Provider default',
    model: null,
    envVar: null,
  },
  {
    key: 'qwen-3-6',
    label: 'Qwen 3.6',
    model: 'qwen/qwen3.5-397b-a17b',
    envVar: 'MODEL_QWEN_3_6',
  },
  {
    key: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    model: 'deepseek/deepseek-v4-flash',
    envVar: 'MODEL_DEEPSEEK_V4_FLASH',
  },
  {
    key: 'kimi-k3',
    label: 'Kimi K3',
    model: 'moonshotai/kimi-k3',
    envVar: 'MODEL_KIMI_K3',
  },
  {
    key: 'gpt-5-6',
    label: 'GPT-5.6',
    model: 'openai/gpt-5.6',
    envVar: 'MODEL_GPT_5_6',
  },
  {
    key: 'gemini-2-flash',
    label: 'Gemini 2.0 Flash',
    // OpenRouter id (free-tier variant). When the request routes via Google's
    // direct OpenAI-compatible endpoint (`geminiModel` below, GEMINI_API_KEY),
    // the plain model name is used instead.
    model: 'google/gemini-2.0-flash-exp:free',
    geminiModel: 'gemini-2.0-flash',
    envVar: 'MODEL_GEMINI_2_FLASH',
  },
] as const

export const DEFAULT_MODEL_KEY = MODEL_OPTIONS[0].key
export const MODEL_KEYS = MODEL_OPTIONS.map((option) => option.key) as [string, ...string[]]
export const ModelKeySchema = z.enum(MODEL_KEYS)
export type ModelKey = z.infer<typeof ModelKeySchema>

export function getModelOption(key: ModelKey) {
  return MODEL_OPTIONS.find((option) => option.key === key) ?? MODEL_OPTIONS[0]
}

/**
 * Resolve a user-facing key to a server-side provider model id.
 *
 * Model ids are provider-specific: OpenRouter (and most OpenAI-compatible
 * endpoints) use namespaced ids like `google/gemini-2.0-flash-exp:free`,
 * while Google's own OpenAI-compatible endpoint expects plain names like
 * `gemini-2.0-flash`. The caller passes the provider in play (from
 * lib/llm-config.ts) so the right id is sent; it defaults to OpenRouter for
 * callers that predate provider awareness.
 */
export function resolveModel(key?: ModelKey, provider: LlmProvider = 'openrouter'): string {
  const selected = key ? getModelOption(key) : MODEL_OPTIONS[0]
  if (selected.envVar) {
    const configured = process.env[selected.envVar]
    if (configured) return configured
  }
  const providerModel =
    provider === 'gemini' && 'geminiModel' in selected ? selected.geminiModel : selected.model
  return (
    providerModel ??
    process.env.MODEL_NAME ??
    process.env.OPENAI_MODEL ??
    (provider === 'gemini'
      ? 'gemini-2.0-flash'
      : provider === 'openrouter'
        ? 'stealth/ox-alpha'
        : 'gpt-4o-mini')
  )
}
