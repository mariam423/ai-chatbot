import { describe, expect, it } from 'vitest'
import {
  EXPORT_DEFAULT_TITLE,
  chatToJson,
  chatToMarkdown,
  exportFileName,
} from '../lib/export-chat'
import type { ChatMessage } from '../lib/types'

const thread: ChatMessage[] = [
  { id: '1', role: 'user', content: 'Hello there' },
  { id: '2', role: 'assistant', content: 'Hi! How can I help?' },
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
      { role: 'assistant', content: 'Hi! How can I help?' },
      { role: 'user', content: 'Explain state in React' },
    ])
    expect(parsed.messages.every((m) => m.id === undefined)).toBe(true)
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
