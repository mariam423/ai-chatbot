import { createElement as h } from 'react'
import { describe, expect, it } from 'vitest'
import { extractCodeText } from '../lib/markdown-code'

/**
 * The regression this suite pins: with rehype-highlight, a fenced code block's
 * children arrive as an array of hljs <span> elements interleaved with text
 * strings. `String(children)` stringifies every span as "[object Object]".
 * extractCodeText must recover the exact raw source.
 */
describe('extractCodeText', () => {
  it('passes plain string children through unchanged', () => {
    expect(extractCodeText('const x = 1')).toBe('const x = 1')
  })

  it('joins an array of text fragments without separators', () => {
    expect(extractCodeText(['a', 'b', 'c'])).toBe('abc')
    expect(extractCodeText(['let ', 'y', ' = ', '2'])).toBe('let y = 2')
  })

  it('recovers raw code from an hljs span tree (the [object Object] regression)', () => {
    // The exact shape rehype-highlight produces for ```js const x = 1.
    const children = [
      h('span', { className: 'hljs-keyword' }, 'const'),
      ' ',
      h('span', { className: 'hljs-title' }, 'x'),
      ' ',
      h('span', { className: 'hljs-operator' }, '='),
      ' ',
      h('span', { className: 'hljs-number' }, '1'),
    ]
    expect(extractCodeText(children)).toBe('const x = 1')
  })

  it('descends through nested elements', () => {
    const children = [
      h('span', { className: 'hljs-keyword' }, h('span', null, 'if')),
      ' ',
      h('span', { className: 'hljs-literal' }, h('em', null, 'true')),
    ]
    expect(extractCodeText(children)).toBe('if true')
  })

  it('strips a single trailing newline from fenced blocks', () => {
    expect(extractCodeText('const x = 1\n')).toBe('const x = 1')
    // Only one — content with intentional trailing blank lines survives.
    expect(extractCodeText('a\n\n')).toBe('a\n')
    expect(extractCodeText(['const', ' = ', '1', '\n'])).toBe('const = 1')
  })

  it('coerces numbers and ignores non-text nodes', () => {
    expect(extractCodeText(42)).toBe('42')
    expect(extractCodeText([null, undefined, false, 'x', true])).toBe('x')
    expect(extractCodeText(null)).toBe('')
    expect(extractCodeText(undefined)).toBe('')
  })
})
