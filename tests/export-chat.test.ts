import { describe, expect, it } from 'vitest'
import {
  EXPORT_DEFAULT_TITLE,
  chatToJson,
  chatToMarkdown,
  chatToText,
  exportFileName,
} from '../lib/export-chat'
import type { ChatMessage } from '../lib/types'

const thread: ChatMessage[] = [
  { id: '1', role: 'user', content: 'Hello there' },
  {
    id: '2',
    role: 'assistant',
    content: 'Hi! How can I help?',
    model: 'stealth/ox-alpha',
    modelOverridden: true,
  },
  { id: '3', role: 'user', content: 'Explain state in React' },
]

describe('chatToMarkdown', () => {
  it('emits a title as an H1 and role-labelled sections in order', () => {
    const md = chatToMarkdown(thread, 'My chat')
    expect(md.startsWith('# My chat')).toBe(true)
    expect(md.indexOf('## You')).toBeGreaterThan(0)
    // Sections appear in message order.
    expect(md.indexOf('Hello there')).toBeLessThan(md.indexOf('Hi! How can I help?'))
    expect(md.indexOf('Hi! How can I help?')).toBeLessThan(md.indexOf('Explain state in React'))
    const headings = md.match(/^## (You|Assistant)$/gm)
    expect(headings).toEqual(['## You', '## Assistant', '## You'])
  })

  it('defaults the title when none is given', () => {
    expect(chatToMarkdown([])).toContain(`# ${EXPORT_DEFAULT_TITLE}`)
  })

  it('escapes markdown-flavoured line starts so content is not re-parsed', () => {
    const md = chatToMarkdown([{ id: 'x', role: 'user', content: '# heading\n- item' }])
    expect(md).toContain('\\# heading')
    expect(md).toContain('\\- item')
  })

  it('adds a *via <model>* line under assistant headings when the model is stamped', () => {
    const md = chatToMarkdown(thread)
    // The assistant reply carries a model — rendered right under its heading,
    // before the content, with the (fallback) tag for an overridden model.
    const assistantAt = md.indexOf('## Assistant')
    const section = md.slice(assistantAt, md.indexOf('## You', assistantAt))
    expect(section).toContain('*via stealth/ox-alpha (fallback)*')
    expect(section.indexOf('*via')).toBeLessThan(section.indexOf('Hi! How can I help?'))
  })

  it('omits the model line when the message has no model stamp', () => {
    const md = chatToMarkdown([{ id: 'x', role: 'assistant', content: 'plain reply' }])
    expect(md).not.toContain('*via')
    expect(md).toContain('plain reply')
  })
})

describe('chat export metadata', () => {
  it('adds assistant identity and ordered timestamps to Markdown/text/JSON exports', () => {
    const options = {
      assistantName: 'Researcher',
      includeTimestamps: true,
      exportedAt: '2026-08-29T12:00:00.000Z',
    }
    const markdown = chatToMarkdown(thread, 'Shared chat', options)
    expect(markdown).toContain('Assistant: Researcher')
    expect(markdown).toContain('_2026-08-29T11:59:59.000Z_')
    expect(markdown).toContain('_2026-08-29T11:59:57.000Z_')

    const text = chatToText(thread, 'Shared chat', options)
    expect(text).toContain('Assistant: Researcher')
    expect(text).toContain('via stealth/ox-alpha (fallback)')
    expect(text.indexOf('2026-08-29T11:59:59.000Z')).toBeLessThan(text.indexOf('Hello there'))

    const json = JSON.parse(chatToJson(thread, 'Shared chat', options)) as {
      assistantName: string
      exportedAt: string
      messages: Array<{ timestamp: string }>
    }
    expect(json).toMatchObject({
      assistantName: 'Researcher',
      exportedAt: '2026-08-29T12:00:00.000Z',
    })
    expect(json.messages.map((message) => message.timestamp)).toEqual([
      '2026-08-29T11:59:59.000Z',
      '2026-08-29T11:59:58.000Z',
      '2026-08-29T11:59:57.000Z',
    ])
  })
})

describe('chatToJson', () => {
  it('serializes title, metadata, and role/content messages (no client ids)', () => {
    const parsed = JSON.parse(chatToJson(thread, 'Export me')) as {
      title: string
      exportedAt: string
      messages: Array<{ role: string; content: string; id?: string }>
    }
    expect(parsed.title).toBe('Export me')
    expect(parsed.exportedAt).toBeTruthy()
    expect(parsed.messages).toEqual([
      { role: 'user', content: 'Hello there' },
      {
        role: 'assistant',
        content: 'Hi! How can I help?',
        model: 'stealth/ox-alpha',
        modelOverridden: true,
      },
      { role: 'user', content: 'Explain state in React' },
    ])
    expect(parsed.messages.every((m) => m.id === undefined)).toBe(true)
  })

  it('keeps model fields out of messages that have no model stamp', () => {
    const parsed = JSON.parse(chatToJson([{ id: 'x', role: 'assistant', content: 'plain' }])) as {
      messages: Array<{ model?: string; modelOverridden?: boolean }>
    }
    expect(parsed.messages[0]).toEqual({ role: 'assistant', content: 'plain' })
    expect(parsed.messages[0]!.model).toBeUndefined()
    expect(parsed.messages[0]!.modelOverridden).toBeUndefined()
  })
})

describe('exportFileName', () => {
  it('appends the extension and sanitizes unsafe characters', () => {
    expect(exportFileName('My Chat / Session!', 'md')).toBe('My Chat Session.md')
  })

  it('uses the default title when none is given and "chat" when it strips away', () => {
    expect(exportFileName(undefined, 'md')).toBe(`${EXPORT_DEFAULT_TITLE}.md`)
    expect(exportFileName('!!!', 'json')).toBe('chat.json')
  })

  it('truncates very long titles', () => {
    const name = exportFileName('a'.repeat(200), 'md')
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name.endsWith('.md')).toBe(true)
  })
})
