import { isValidElement, type ReactNode } from 'react'

/**
 * Recover the raw source text from a react-markdown `code` element's children.
 *
 * This matters because `rehype-highlight` rewrites the children of a fenced
 * code block from a single text node into an array of syntax-highlighting
 * `<span class="hljs-*">` elements interleaved with plain text strings. A
 * naive `String(children)` then renders `[object Object]` for every span —
 * the bug this helper exists to prevent. It walks the node tree, concatenating
 * every text fragment (descending into element props), so the exact original
 * source survives for display, copy-to-clipboard, and any highlighter that
 * runs afterwards.
 *
 * A single trailing newline is stripped: fenced blocks carry one after the
 * closing line, and keeping it would add an empty last line to rendered code.
 */
export function extractCodeText(children: ReactNode): string {
  return collectText(children).replace(/\n$/, '')
}

/** Concatenate every text fragment in the node tree (strings + element props). */
function collectText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map((child) => collectText(child)).join('')
  if (isValidElement(children)) {
    // React 19 types ReactElement props as unknown; we only need the children.
    const props = children.props as { children?: ReactNode }
    return collectText(props.children)
  }
  return ''
}
