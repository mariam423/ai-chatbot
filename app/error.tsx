'use client'

import Link from 'next/link'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'

/**
 * Root error boundary (app/error.tsx). Catches render errors from the layout's
 * children and shows a calm, recoverable state instead of a white screen.
 * Next.js calls `reset()` to re-render the failed segment.
 *
 * Props are optional with defaults so the page can also be rendered directly
 * (e.g. the e2e visual-snapshot demo route) without a real error boundary
 * context.
 */
export default function ErrorPage({
  error = undefined,
  reset = () => undefined,
}: {
  error?: Error & { digest?: string }
  reset?: () => void
} = {}) {
  // Surface the error server-side for diagnosis; the client only sees a
  // generic message (no internals leak to the browser).
  console.error('[chat error boundary]', error)

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
      style={{ background: 'var(--bg-deep)' }}
    >
      <div
        className="mb-4 flex size-12 items-center justify-center rounded-2xl"
        style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)' }}
      >
        <HugeiconsIcon icon={Alert02Icon} size={20} strokeWidth={1.5} className="text-red-500" />
      </div>
      <h1 className="text-lg font-semibold text-[var(--text-primary)]">Something went wrong</h1>
      <p className="mt-1 max-w-sm text-sm text-[var(--text-tertiary)]">
        An unexpected error interrupted this page. Your conversations are saved — try again, or head
        back to the chat.
      </p>
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-950 transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(to right, #06b6d4, #0891b2)' }}
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)]"
          style={{ border: '1px solid var(--border-medium)' }}
        >
          Back to chat
        </Link>
      </div>
      {error?.digest && (
        <p className="mt-6 font-mono text-[10px] text-[var(--text-tertiary)]">
          Digest: {error.digest}
        </p>
      )}
    </div>
  )
}
