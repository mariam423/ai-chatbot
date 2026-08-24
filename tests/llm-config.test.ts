import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLlmConfig } from '../lib/llm-config'

// The shell/dev environment may export real provider values (OPENROUTER_*),
// so every test stubs the full env surface it cares about.
afterEach(() => {
  vi.unstubAllEnvs()
})

function clearProviderEnv(): void {
  vi.stubEnv('OPENROUTER_API_KEY', '')
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('OPENROUTER_BASE_URL', undefined)
  vi.stubEnv('OPENAI_BASE_URL', undefined)
}

describe('getLlmConfig', () => {
  it('returns a null apiKey when no provider key is configured', () => {
    clearProviderEnv()
    expect(getLlmConfig()).toMatchObject({ apiKey: null, usesOpenRouter: false })
  })

  it('prefers OPENROUTER_API_KEY and defaults to the OpenRouter base URL', () => {
    clearProviderEnv()
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    expect(getLlmConfig()).toEqual({
      apiKey: 'sk-or-v1-test',
      baseUrl: 'https://openrouter.ai/api/v1',
      usesOpenRouter: true,
    })
  })

  it('falls back to OPENAI_API_KEY and the OpenAI base URL', () => {
    clearProviderEnv()
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    expect(getLlmConfig()).toEqual({
      apiKey: 'sk-openai-test',
      baseUrl: 'https://api.openai.com/v1',
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
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    vi.stubEnv('OPENAI_BASE_URL', 'https://ollama.local/v1/')
    expect(getLlmConfig()).toMatchObject({
      apiKey: 'sk-openai-test',
      baseUrl: 'https://ollama.local/v1',
      usesOpenRouter: false,
    })
  })
})
