'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { CopyIcon, CheckIcon, CodeIcon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import CitationDrawer from './citation-drawer'

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
                  className="text-cyan-400"
                />
                <span className="text-cyan-400">Copied</span>
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
 * Renders assistant markdown. No `rehype-raw`, so raw HTML in the LLM reply
 * is escaped and displayed literally - the NFR-3 security property holds.
 */
export default function Markdown({ content, sessionId = null }: MarkdownProps) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <>{children}</>,
          a({ href, children, ...props }) {
            if (href?.startsWith('citation:')) {
              const separator = href.lastIndexOf(':')
              const encodedName = href.slice('citation:'.length, separator)
              const section = href.slice(separator + 1)
              try {
                return (
                  <CitationDrawer
                    sessionId={sessionId}
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
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? '')
            const text = String(children ?? '')
            if (!match) {
              return (
                <code className={className} {...props}>
                  {text}
                </code>
              )
            }
            return <CodeBlock language={match[1]!} code={text} />
          },
        }}
      >
        {linkifyCitations(content)}
      </ReactMarkdown>
    </div>
  )
}
