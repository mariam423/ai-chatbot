import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectProviderFromKey,
  getLlmConfig,
  getMaxOutputTokens,
  resolveMaxTokens,
} from '../lib/llm-config'

// The shell/dev environment may export real provider values (OPENROUTER_*,
// GEMINI_API_KEY, …), so every test stubs the full env surface it cares about.
afterEach(() => {
  vi.unstubAllEnvs()
})

function clearProviderEnv(): void {
  vi.stubEnv('OPENROUTER_API_KEY', '')
  vi.stubEnv('GEMINI_API_KEY', '')
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('OPENROUTER_BASE_URL', undefined)
  vi.stubEnv('GEMINI_BASE_URL', undefined)
  vi.stubEnv('OPENAI_BASE_URL', undefined)
}

describe('getLlmConfig', () => {
  it('returns a null apiKey when no provider key is configured', () => {
    clearProviderEnv()
    expect(getLlmConfig()).toMatchObject({
      apiKey: null,
      provider: 'openai',
      usesOpenRouter: false,
    })
  })

  it('prefers OPENROUTER_API_KEY and defaults to the OpenRouter base URL', () => {
    clearProviderEnv()
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('GEMINI_API_KEY', 'AIza-test')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    expect(getLlmConfig()).toEqual({
      apiKey: 'sk-or-v1-test',
      baseUrl: 'https://openrouter.ai/api/v1',
      provider: 'openrouter',
      usesOpenRouter: true,
    })
  })

  it('falls back to GEMINI_API_KEY and the Gemini OpenAI-compatible base URL', () => {
    clearProviderEnv()
    vi.stubEnv('GEMINI_API_KEY', 'AIza-test')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    expect(getLlmConfig()).toEqual({
      apiKey: 'AIza-test',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      provider: 'gemini',
      usesOpenRouter: false,
    })
  })

  it('falls back to OPENAI_API_KEY and the OpenAI base URL', () => {
    clearProviderEnv()
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    expect(getLlmConfig()).toEqual({
      apiKey: 'sk-openai-test',
      baseUrl: 'https://api.openai.com/v1',
      provider: 'openai',
      usesOpenRouter: false,
    })
  })

  it('honors explicit base URL overrides and strips trailing slashes', () => {
    clearProviderEnv()
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('OPENROUTER_BASE_URL', 'https://custom-router.example.com/api/v1/')
    expect(getLlmConfig().baseUrl).toBe('https://custom-router.example.com/api/v1')

    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('OPENROUTER_BASE_URL', undefined)
    vi.stubEnv('GEMINI_API_KEY', 'AIza-test')
    vi.stubEnv('GEMINI_BASE_URL', 'https://gemini-proxy.example.com/v1beta/openai/')
    expect(getLlmConfig()).toMatchObject({
      apiKey: 'AIza-test',
      baseUrl: 'https://gemini-proxy.example.com/v1beta/openai',
      provider: 'gemini',
      usesOpenRouter: false,
    })

    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GEMINI_BASE_URL', undefined)
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    vi.stubEnv('OPENAI_BASE_URL', 'https://ollama.local/v1/')
    expect(getLlmConfig()).toMatchObject({
      apiKey: 'sk-openai-test',
      baseUrl: 'https://ollama.local/v1',
      provider: 'openai',
      usesOpenRouter: false,
    })
  })

  it('lets a per-user key from Settings override the server env entirely', () => {
    clearProviderEnv()
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-server')
    expect(getLlmConfig('AIzaSy-user-key')).toMatchObject({
      apiKey: 'AIzaSy-user-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      provider: 'gemini',
      usesOpenRouter: false,
    })
    // An empty / whitespace user key falls back to env (clearing the field).
    expect(getLlmConfig('   ')).toMatchObject({
      apiKey: 'sk-or-v1-server',
      provider: 'openrouter',
    })
  })
})

describe('detectProviderFromKey', () => {
  it('detects the provider from well-known key prefixes', () => {
    expect(detectProviderFromKey('sk-or-v1-abc')).toBe('openrouter')
    expect(detectProviderFromKey('AIzaSyABC123')).toBe('gemini')
    expect(detectProviderFromKey('sk-proj-abc')).toBe('openai')
    expect(detectProviderFromKey('anything-else')).toBe('openai')
  })
})

describe('resolveMaxTokens', () => {
  it('sends the conservative cap by default and honors per-user overrides', () => {
    vi.stubEnv('MAX_OUTPUT_TOKENS', undefined)
    // An explicit tiny cap keeps the pre-authorization cost near zero so
    // low-credit keys stream instead of 402ing (verified live: omitting the
    // field makes OpenRouter pre-authorize ~16k tokens and reject the key).
    expect(resolveMaxTokens()).toBe(200)
    expect(resolveMaxTokens(undefined)).toBe(200)
    // An explicit per-user value always wins.
    expect(resolveMaxTokens(4096)).toBe(4096)
    expect(resolveMaxTokens(512)).toBe(512)
    // MAX_OUTPUT_TOKENS env override flows through.
    vi.stubEnv('MAX_OUTPUT_TOKENS', '1024')
    expect(resolveMaxTokens()).toBe(1024)
    vi.unstubAllEnvs()
  })
})

describe('getMaxOutputTokens', () => {
  it('defaults to a conservative 200 when MAX_OUTPUT_TOKENS is unset', () => {
    vi.stubEnv('MAX_OUTPUT_TOKENS', undefined)
    expect(getMaxOutputTokens()).toBe(200)
  })

  it('honors a valid MAX_OUTPUT_TOKENS override', () => {
    vi.stubEnv('MAX_OUTPUT_TOKENS', '1024')
    expect(getMaxOutputTokens()).toBe(1024)
  })

  it('falls back to the default for an invalid MAX_OUTPUT_TOKENS', () => {
    for (const bad of ['0', '-5', 'abc', '4.5']) {
      vi.stubEnv('MAX_OUTPUT_TOKENS', bad)
      expect(getMaxOutputTokens(), bad).toBe(200)
    }
  })
})
