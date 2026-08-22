import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODEL_KEY, resolveModel } from '../lib/models'
import { detectStructuredOutputKind, renderStructuredResponse } from '../lib/structured-output'

describe('model registry', () => {
  it('resolves the provider default without a client-side provider id', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    expect(resolveModel()).toBe('stealth/ox-alpha')
    expect(DEFAULT_MODEL_KEY).toBe('provider-default')
    vi.unstubAllEnvs()
  })

  it('resolves a selected model key and permits server-side overrides', () => {
    vi.stubEnv('MODEL_DEEPSEEK_V4_FLASH', 'custom/deepseek')
    expect(resolveModel('deepseek-v4-flash')).toBe('custom/deepseek')
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
