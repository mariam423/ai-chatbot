'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { CopyIcon, CheckIcon, CodeIcon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useRef, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import type { Element } from 'hast'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { isSvgDataUrl } from '@/lib/svg-data-url'
import { extractCodeText } from '@/lib/markdown-code'
import CitationDrawer from './citation-drawer'
import DiagramCard from './diagram-card'

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable
    }
  }

  return (
    <div className="code-block my-3 overflow-hidden rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.1)]">
      <div className="code-block-header flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5">
          <HugeiconsIcon
            icon={CodeIcon}
            size={12}
            strokeWidth={1.5}
            className="text-[var(--text-muted)]"
          />
          <span className="font-mono text-[11px] font-medium text-[var(--text-muted)]">
            {language}
          </span>
        </div>
        <motion.button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Code copied' : 'Copy code'}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--text-primary)]"
        >
          <AnimatePresence mode="wait">
            {copied ? (
              <motion.div
                key="check"
                initial={{ scale: 0, rotate: -45 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                className="flex items-center gap-1"
              >
                <HugeiconsIcon
                  icon={CheckIcon}
                  size={12}
                  strokeWidth={2}
                  className="text-emerald-400"
                />
                <span className="text-emerald-400">Copied</span>
              </motion.div>
            ) : (
              <motion.div
                key="copy"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                className="flex items-center gap-1"
              >
                <HugeiconsIcon icon={CopyIcon} size={12} strokeWidth={1.5} />
                <span>Copy</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
      <pre className="code-block overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className="hljs">{code}</code>
      </pre>
    </div>
  )
}

interface MarkdownProps {
  content: string
  sessionId?: string | null
}

function linkifyCitations(content: string): string {
  return content.replace(
    /\[Document:\s*([^,\]]+),\s*section\s*(\d+)\]/g,
    (_match, documentName: string, section: string) =>
      `[Document: ${documentName}, section ${section}](citation:${encodeURIComponent(documentName.trim())}:${section})`,
  )
}

/**
 * react-markdown's default URL transform strips `data:` URLs (not in its safe
 * protocol list), which would drop the SVG data URLs the `diagram_render`
 * tool returns. Permit them for image sources only — markdown never produces
 * other `src` elements, `<img>` data URLs cannot execute scripts, and links
 * keep the default sanitization.
 */
function markdownUrlTransform(url: string, key: string, node: Element): string {
  if (key === 'src' && node.tagName === 'img' && isSvgDataUrl(url)) {
    return url
  }
  return defaultUrlTransform(url)
}

/**
 * Renders assistant markdown. No `rehype-raw`, so raw HTML in the LLM reply
 * is escaped and displayed literally - the NFR-3 security property holds.
 */
export default function Markdown({ content, sessionId = null }: MarkdownProps) {
  // Keep the renderer map stable even when the first session is created after
  // the reply starts. Recreating it remounts DiagramCard and destroys an open
  // portal viewer; the ref keeps citation actions on the current session.
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const components = useMemo(
    () => ({
      pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
      a({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) {
        if (href?.startsWith('citation:')) {
          const separator = href.lastIndexOf(':')
          const encodedName = href.slice('citation:'.length, separator)
          const section = href.slice(separator + 1)
          try {
            return (
              <CitationDrawer
                sessionId={sessionIdRef.current}
                documentName={decodeURIComponent(encodedName)}
                section={section}
              />
            )
          } catch {
            return <span>{children}</span>
          }
        }
        return (
          <a href={href} {...props}>
            {children}
          </a>
        )
      },
      code({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'>) {
        const match = /language-(\w+)/.exec(className ?? '')
        // rehype-highlight turns fenced-code children into hljs <span> trees,
        // so String(children) would render "[object Object]". extractCodeText
        // walks the tree and returns the raw source (trailing newline
        // stripped) for both display and the copy button.
        const text = extractCodeText(children)
        if (!match) {
          return (
            <code className={className} {...props}>
              {text}
            </code>
          )
        }
        return <CodeBlock language={match[1]!} code={text} />
      },
      img({ src, alt, ...props }: React.ComponentPropsWithoutRef<'img'>) {
        // Provider-rendered diagrams (SVG data URLs from diagram_render)
        // render in a card with copy/export controls; other images stay plain.
        if (typeof src === 'string' && isSvgDataUrl(src)) {
          return <DiagramCard src={src} alt={alt} />
        }
        return <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} {...props} />
      },
    }),
    [],
  )

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {linkifyCitations(content)}
      </ReactMarkdown>
    </div>
  )
}
