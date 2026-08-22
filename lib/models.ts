import { z } from 'zod'

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
] as const

export const DEFAULT_MODEL_KEY = MODEL_OPTIONS[0].key
export const MODEL_KEYS = MODEL_OPTIONS.map((option) => option.key) as [string, ...string[]]
export const ModelKeySchema = z.enum(MODEL_KEYS)
export type ModelKey = z.infer<typeof ModelKeySchema>

export function getModelOption(key: ModelKey) {
  return MODEL_OPTIONS.find((option) => option.key === key) ?? MODEL_OPTIONS[0]
}

/** Resolve a user-facing key to a server-side provider model id. */
export function resolveModel(key?: ModelKey): string {
  const selected = key ? getModelOption(key) : MODEL_OPTIONS[0]
  if (selected.envVar) {
    const configured = process.env[selected.envVar]
    if (configured) return configured
  }
  return (
    selected.model ??
    process.env.MODEL_NAME ??
    process.env.OPENAI_MODEL ??
    (process.env.OPENROUTER_API_KEY ? 'stealth/ox-alpha' : 'gpt-4o-mini')
  )
}
