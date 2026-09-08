import { z } from 'zod'
import type { LlmProvider } from '@/lib/llm-config'

/**
 * Curated model selector. `vision` records whether the model family accepts
 * image/video/audio content in a chat-completions request (used to auto-route
 * media payloads to a vision-capable model — see `resolveModel` and
 * `VISION_FALLBACK_MODELS`). Text-only options (and the provider default,
 * which resolves to the stable free OpenRouter text model) are NOT
 * vision-capable.
 *
 * Model slugs are pinned to the currently-live OpenRouter catalog (verified
 * 2026-08-31 against `/api/v1/models` with the project's OPENROUTER_API_KEY).
 * A model that 404s on this list will trigger the chat route's retry-with-
 * fallback path — keeping the slugs accurate here avoids that round-trip.
 */
export const MODEL_OPTIONS = [
  {
    key: 'provider-default',
    label: 'Provider default',
    model: null,
    envVar: null,
    vision: false,
  },
  {
    key: 'qwen-3-6',
    label: 'Qwen 3.8 Flash',
    // Verified live on OpenRouter (2026-08-31). Replaces the dead
    // `qwen/qwen3.5-397b-a17b` slug, which now 404s. Paid route — the
    // free-tier key 402s here, and the chat route's retry-with-fallback
    // path hands the request to the verified free pool head
    // (google/gemma-4-31b-it:free).
    model: 'qwen/qwen3.8-flash',
    envVar: 'MODEL_QWEN_3_6',
    vision: true,
  },
  {
    key: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    // Verified live on OpenRouter (2026-08-31). Replaces the dead
    // `deepseek/deepseek-v4-flash` slug, which now 404s. This is the
    // vision-capable revision of the same family. Paid route — same
    // fallback behavior as the others when the key has no credit.
    model: 'deepseek/deepseek-v4-flash-vision-exp',
    envVar: 'MODEL_DEEPSEEK_V4_FLASH',
    vision: true,
  },
  {
    key: 'kimi-k3',
    label: 'Kimi K3',
    // Verified live on OpenRouter (2026-08-31). This is a paid model,
    // not a `:free` route, so 402/429/404 responses intentionally use the
    // provider fallback sequence in /api/chat.
    model: 'moonshotai/kimi-k3',
    envVar: 'MODEL_KIMI_K3',
    vision: true,
  },
  {
    key: 'gpt-5-6',
    label: 'GPT-5.6',
    // Verified live on OpenRouter (2026-08-31). Replaces the dead
    // `openai/gpt-5.6` slug, which now 404s. `gpt-5.6-luna` is the
    // currently-routable OpenAI 5.6 family member.
    model: 'openai/gpt-5.6-luna',
    envVar: 'MODEL_GPT_5_6',
    vision: true,
  },
  {
    key: 'gemini-2-flash',
    label: 'Gemini 3.5 Flash Lite',
    // Verified live on OpenRouter (2026-08-31). Replaces the dead
    // `google/gemini-2.5-flash-lite` slug, which now 404s. The tiny
    // explicit max_tokens cap (see lib/llm-config.ts) keeps its
    // pre-authorization cost near zero, so it works even on low-credit keys.
    // When the request routes via Google's direct OpenAI-compatible endpoint
    // (`geminiModel` below, GEMINI_API_KEY), the plain model name is used.
    model: 'google/gemini-3.5-flash-lite',
    geminiModel: 'gemini-3.5-flash-lite',
    envVar: 'MODEL_GEMINI_2_FLASH',
    vision: true,
  },
] as const

export const DEFAULT_MODEL_KEY = MODEL_OPTIONS[0].key
export const MODEL_KEYS = MODEL_OPTIONS.map((option) => option.key) as [string, ...string[]]
export const ModelKeySchema = z.enum(MODEL_KEYS)
export type ModelKey = z.infer<typeof ModelKeySchema>

/**
 * OpenRouter free-tier pool, verified live against the catalog (2026-09-08).
 * Free routes on OpenRouter are per-model throttled shared pools — a request
 * can 404 (the model was retired from the free tier), 429 ("temporarily
 * rate-limited upstream ... shared pool"), or 400 (flaky free route). There
 * is no single reliable `:free` id; resilience comes from the POOL and the
 * chat route cascading across it (`openRouterFreeCascadeModels`) until one
 * streams. The ids here are the general-purpose (non-reasoning-only,
 * non-harness-gated) free models that stream `delta.content`:
 * - `google/gemma-4-31b-it:free` — dense 30.7B multimodal instruct (text +
 *   image) — primary default + vision fallback
 * - `google/gemma-4-26b-a4b-it:free` — 26B-A4B MoE multimodal instruct
 * - `dots-studio/dots-3-note-preview:free` — open MoE (16B active / 280B)
 *
 * Deliberately EXCLUDED from the pool:
 * - `thinkingmachines/inkling:free` — 403 gated to agentic harnesses
 * - `nvidia/nemotron-3-*-...:free` / `liquid/lfm-2.5-2.6b:free` — reasoning
 *   models that can stream into `delta.reasoning` (the content extractor
 *   never sees it — the `z-ai/glm-5.3-flash` failure mode)
 * - `inclusionai/ling-3.0-flash-*-sante|fin:free`, `cohere/north-mini-code:free`
 *   — domain specialists
 */
export const OPENROUTER_FREE_MODELS = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'dots-studio/dots-3-note-preview:free',
] as const

/**
 * Default OpenRouter fallback model, used when FALLBACK_MODEL is unset. It
 * serves two purposes:
 * - the "Provider default" resolution when no env override is set, and
 * - the chat route's error fallback: when the chosen model returns 404 (dead
 *   slug), 402 (low-credit pre-auth), or 429 (model-scoped rate limit), the
 *   route retries with this id instead of failing the chat — and then
 *   cascades across `OPENROUTER_FREE_MODELS` until one streams.
 *
 * The previous default `minimax/minimax-m3:free` now 404s on a free-tier key
 * ("This model is unavailable for free ... use minimax/minimax-m3 instead" —
 * verified live 2026-09-08), which is why every chat fell through to errors.
 * `google/gemma-4-31b-it:free` replaces it: verified live, general-purpose,
 * multimodal (so it doubles as the vision fallback), and streams
 * `delta.content`.
 */
export const DEFAULT_OPENROUTER_FALLBACK_MODEL = OPENROUTER_FREE_MODELS[0]

/**
 * Whether an OpenRouter model id rides the free-tier pool: it is one of the
 * verified live free models, or it is ANY `:free`-suffixed route (a custom
 * FALLBACK_MODEL into the free tier still inherits the pool's resilience).
 */
function isOpenRouterFreeModel(id: string): boolean {
  return id.endsWith(':free') || (OPENROUTER_FREE_MODELS as readonly string[]).includes(id)
}

/**
 * The verified free models to cascade to after the OpenRouter attempts for a
 * request. Returns [] when neither the resolved selected model nor its backup
 * is free-tier — a paid configuration (explicit FALLBACK_MODEL + paid
 * selection) never drags free models into the chain. Order follows the pool
 * so the primary default + backup are NOT repeated (the no-loop guard).
 *
 * Called by the chat route after building each provider's attempts: the
 * cascade is appended AFTER all providers' own attempts, so a failure still
 * hops cross-provider first (Gemini/OpenAI backups keep priority) and only
 * exhausts the free pool when nothing else remains.
 */
export function openRouterFreeCascadeModels(selected: string, backup: string): string[] {
  if (!isOpenRouterFreeModel(selected) && !isOpenRouterFreeModel(backup)) return []
  return OPENROUTER_FREE_MODELS.filter((id) => id !== selected && id !== backup)
}

/**
 * Resolve the OpenRouter fallback model (provider default + error retry):
 * the FALLBACK_MODEL env override when set, else the default above. Read
 * lazily (not at module load) so tests and env changes take effect at call
 * time — same pattern as getMaxOutputTokens in lib/llm-config.ts.
 */
export function getOpenRouterFallbackModel(): string {
  const configured = process.env.FALLBACK_MODEL?.trim()
  return configured || DEFAULT_OPENROUTER_FALLBACK_MODEL
}

/**
 * Stable error-fallback model per provider — what the chat route retries
 * with when the chosen model returns 404 (dead/deprecated slug), 402
 * (low-credit pre-auth), or 429 (model-scoped rate limit). Each id is valid
 * on its own provider's endpoint: the free OpenRouter `:free` route
 * (FALLBACK_MODEL override), the plain Gemini name on the direct endpoint
 * (`gemini-3.5-flash-lite` — verified live 2026-08-31), and a cheap OpenAI
 * model elsewhere.
 */
export const PROVIDER_FALLBACK_MODELS: Record<LlmProvider, string> = {
  openrouter: DEFAULT_OPENROUTER_FALLBACK_MODEL,
  gemini: 'gemini-3.5-flash-lite',
  openai: 'gpt-4o-mini',
}

/**
 * Resolve the provider's error-fallback model. OpenRouter honors the
 * FALLBACK_MODEL env override (see `getOpenRouterFallbackModel`); Gemini and
 * OpenAI accept GEMINI_FALLBACK_MODEL / OPENAI_FALLBACK_MODEL overrides so a
 * self-hosted OpenAI-compatible endpoint can pin its own backup. Read lazily
 * so tests and env changes take effect at call time.
 */
export function getProviderFallbackModel(provider: LlmProvider): string {
  if (provider === 'openrouter') return getOpenRouterFallbackModel()
  const override = process.env[`${provider.toUpperCase()}_FALLBACK_MODEL`]?.trim()
  return override || PROVIDER_FALLBACK_MODELS[provider]
}

/**
 * Stable vision-capable fallback model per provider, used when the request
 * carries image/video/audio media and the selected option is not flagged
 * vision-capable (text-only options and the provider default). These ids are
 * curated stable routes — the free OpenRouter `:free` route (also the
 * chat-route error fallback and the verified free pool head — the
 * `google/gemma-4-31b-it:free` route streams `delta.content`, is
 * vision-capable, and runs on the project's free-tier key), the plain
 * Gemini name on the direct endpoint (`gemini-3.5-flash-lite`, verified live
 * 2026-08-31 — the older `gemini-2.5-flash-lite` 404s), and a cheap OpenAI
 * model elsewhere.
 */
export const VISION_FALLBACK_MODELS: Record<LlmProvider, string> = {
  openrouter: DEFAULT_OPENROUTER_FALLBACK_MODEL,
  gemini: 'gemini-3.5-flash-lite',
  openai: 'gpt-4o-mini',
}

export function getModelOption(key: ModelKey) {
  return MODEL_OPTIONS.find((option) => option.key === key) ?? MODEL_OPTIONS[0]
}

/**
 * Resolve a user-facing key to a server-side provider model id.
 *
 * Model ids are provider-specific: OpenRouter (and most OpenAI-compatible
 * endpoints) use namespaced ids like `google/gemini-2.5-flash-lite`, while
 * Google's own OpenAI-compatible endpoint expects plain names like
 * `gemini-2.5-flash-lite`. The caller passes the provider in play (from
 * lib/llm-config.ts) so the right id is sent; it defaults to OpenRouter for
 * callers that predate provider awareness.
 *
 * When `opts.vision` is set (the request carries media), a non-vision-capable
 * selection — text-only options like DeepSeek, and the provider default — is
 * swapped for the provider's stable vision fallback (`VISION_FALLBACK_MODELS`),
 * so image/video/audio payloads always reach a model that accepts them.
 */
export function resolveModel(
  key?: ModelKey,
  provider: LlmProvider = 'openrouter',
  opts?: { vision?: boolean },
): string {
  const selected = key ? getModelOption(key) : MODEL_OPTIONS[0]
  // Vision capability is a property of the option, not of env overrides: a
  // media request never rides on a text-only id, even one set via MODEL_*.
  if (opts?.vision && selected.vision === false) {
    return VISION_FALLBACK_MODELS[provider]
  }
  if (selected.envVar) {
    const configured = process.env[selected.envVar]?.trim()
    if (configured) return configured
  }
  const providerModel =
    provider === 'gemini' && 'geminiModel' in selected ? selected.geminiModel : selected.model
  return (
    providerModel ??
    process.env.MODEL_NAME ??
    process.env.OPENAI_MODEL ??
    // Stable primary defaults — the OpenRouter default is the verified-live
    // free `:free` route `google/gemma-4-31b-it:free` (zero-cost,
    // vision-capable, and `delta.content` streams, so the provider default
    // also satisfies media requests; FALLBACK_MODEL overrides it). Media
    // requests on a text-only option auto-switch to the vision fallback above.
    (provider === 'gemini'
      ? 'gemini-3.5-flash-lite'
      : provider === 'openrouter'
        ? getOpenRouterFallbackModel()
        : 'gpt-4o-mini')
  )
}
