import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MODEL_KEY,
  getOpenRouterFallbackModel,
  getProviderFallbackModel,
  resolveModel,
} from '../lib/models'
import { detectStructuredOutputKind, renderStructuredResponse } from '../lib/structured-output'

describe('model registry', () => {
  it('resolves the provider default to a stable primary model', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    // Free-first: the OpenRouter default is the genuinely free
    // `stealth/ox-alpha` (0-cost and vision-capable), which also streams on a
    // zero-credit key — verified live against OpenRouter.
    expect(resolveModel()).toBe('stealth/ox-alpha')
    expect(resolveModel(undefined, 'gemini')).toBe('gemini-2.5-flash-lite')
    expect(resolveModel(undefined, 'openai')).toBe('gpt-4o-mini')
    expect(DEFAULT_MODEL_KEY).toBe('provider-default')
    vi.unstubAllEnvs()
  })

  it('exposes the OpenRouter fallback model via the FALLBACK_MODEL env override', () => {
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    vi.stubEnv('FALLBACK_MODEL', undefined)
    // Default is the free vision-capable route; the provider default uses it.
    expect(getOpenRouterFallbackModel()).toBe('stealth/ox-alpha')
    expect(resolveModel()).toBe('stealth/ox-alpha')
    // FALLBACK_MODEL env override flows through to both callers.
    vi.stubEnv('FALLBACK_MODEL', 'custom/backup')
    expect(getOpenRouterFallbackModel()).toBe('custom/backup')
    expect(resolveModel()).toBe('custom/backup')
    // The vision fallback is independent — media on a text-only option still
    // routes to the vision-capable model, not the override.
    expect(resolveModel('deepseek-v4-flash', 'openrouter', { vision: true })).toBe(
      'stealth/ox-alpha',
    )
    vi.unstubAllEnvs()
  })

  it('resolves a per-provider error-fallback model with env overrides', () => {
    vi.stubEnv('FALLBACK_MODEL', undefined)
    vi.stubEnv('GEMINI_FALLBACK_MODEL', undefined)
    vi.stubEnv('OPENAI_FALLBACK_MODEL', undefined)
    // Every provider has a backup id valid on its own endpoint.
    expect(getProviderFallbackModel('openrouter')).toBe('stealth/ox-alpha')
    expect(getProviderFallbackModel('gemini')).toBe('gemini-2.5-flash-lite')
    expect(getProviderFallbackModel('openai')).toBe('gpt-4o-mini')
    // Per-provider env overrides flow through.
    vi.stubEnv('FALLBACK_MODEL', 'custom/or-backup')
    vi.stubEnv('GEMINI_FALLBACK_MODEL', 'custom/gemini-backup')
    vi.stubEnv('OPENAI_FALLBACK_MODEL', 'custom/openai-backup')
    expect(getProviderFallbackModel('openrouter')).toBe('custom/or-backup')
    expect(getProviderFallbackModel('gemini')).toBe('custom/gemini-backup')
    expect(getProviderFallbackModel('openai')).toBe('custom/openai-backup')
    vi.unstubAllEnvs()
  })

  it('auto-routes media requests to a stable vision-capable model', () => {
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    vi.stubEnv('MODEL_GEMINI_2_FLASH', '')
    // Text-only selection (DeepSeek) + vision → provider vision fallback.
    expect(resolveModel('deepseek-v4-flash', 'openrouter', { vision: true })).toBe(
      'stealth/ox-alpha',
    )
    // Provider default + vision → the free vision-capable default itself
    // (stealth/ox-alpha is vision-capable, so the default satisfies media).
    expect(resolveModel(undefined, 'openrouter', { vision: true })).toBe('stealth/ox-alpha')
    expect(resolveModel(undefined, 'gemini', { vision: true })).toBe('gemini-2.5-flash-lite')
    expect(resolveModel('deepseek-v4-flash', 'gemini', { vision: true })).toBe(
      'gemini-2.5-flash-lite',
    )
    // Vision-capable selections are kept, even with media present.
    expect(resolveModel('gpt-5-6', 'openrouter', { vision: true })).toBe('openai/gpt-5.6')
    expect(resolveModel('gemini-2-flash', 'openrouter', { vision: true })).toBe(
      'google/gemini-2.5-flash-lite',
    )
    // No media → the text-only selection stands.
    expect(resolveModel('deepseek-v4-flash', 'openrouter')).toBe('deepseek/deepseek-v4-flash')
    // The vision swap beats a MODEL_* env override on a text-only option.
    vi.stubEnv('MODEL_DEEPSEEK_V4_FLASH', 'custom/deepseek')
    expect(resolveModel('deepseek-v4-flash', 'openrouter', { vision: true })).toBe(
      'stealth/ox-alpha',
    )
    vi.unstubAllEnvs()
  })

  it('resolves a selected model key and permits server-side overrides', () => {
    vi.stubEnv('MODEL_DEEPSEEK_V4_FLASH', 'custom/deepseek')
    expect(resolveModel('deepseek-v4-flash')).toBe('custom/deepseek')
    vi.unstubAllEnvs()
  })

  it('resolves provider-appropriate ids for the Gemini option', () => {
    vi.stubEnv('MODEL_GEMINI_2_FLASH', '')
    vi.stubEnv('MODEL_NAME', undefined)
    vi.stubEnv('OPENAI_MODEL', undefined)
    // Via OpenRouter the live, cheapest Gemini slug is sent (Gemini 2.0 is
    // gone from the catalog — verified live).
    expect(resolveModel('gemini-2-flash', 'openrouter')).toBe('google/gemini-2.5-flash-lite')
    // Via the direct Google OpenAI-compatible endpoint the plain name is sent.
    expect(resolveModel('gemini-2-flash', 'gemini')).toBe('gemini-2.5-flash-lite')
    // The provider default falls back to a Gemini model on the direct endpoint.
    expect(resolveModel(undefined, 'gemini')).toBe('gemini-2.5-flash-lite')
    // envVar override still wins for the Gemini option.
    vi.stubEnv('MODEL_GEMINI_2_FLASH', 'custom/gemini')
    expect(resolveModel('gemini-2-flash', 'gemini')).toBe('custom/gemini')
    vi.unstubAllEnvs()
  })
})

describe('structured output', () => {
  it('detects table, code, and document citation intents', () => {
    expect(detectStructuredOutputKind('Show this as a table', false)).toBe('table')
    expect(detectStructuredOutputKind('Write a TypeScript function', false)).toBe('code')
    expect(detectStructuredOutputKind('What does the document say?', true)).toBe('citations')
    expect(detectStructuredOutputKind('Say hello', false)).toBeNull()
  })

  it('renders a validated table envelope as Markdown', () => {
    const raw = JSON.stringify({
      kind: 'table',
      content: 'Comparison',
      code: '',
      language: '',
      columns: ['Name', 'Value'],
      rows: [['A|B', '1']],
      citations: [],
    })
    expect(renderStructuredResponse(raw)).toContain('| A\\|B | 1 |')
  })

  it('renders a validated code envelope with a copyable fenced block', () => {
    const raw = JSON.stringify({
      kind: 'code',
      content: 'Example',
      code: 'const value = 1',
      language: 'typescript',
      columns: [],
      rows: [],
      citations: [],
    })
    expect(renderStructuredResponse(raw)).toContain('```typescript\nconst value = 1')
  })

  it('does not trust malformed structured output', () => {
    expect(renderStructuredResponse('{"kind":"code"}')).toBe('{"kind":"code"}')
  })
})
