import Link from 'next/link'
import { HugeiconsIcon } from '@hugeicons/react'
import { SearchCircleIcon } from '@hugeicons/core-free-icons'

/** 404 page — same shell styling as the error boundary, with a chat CTA. */
export default function NotFound() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
      style={{ background: 'var(--bg-deep)' }}
    >
      <div
        className="mb-4 flex size-12 items-center justify-center rounded-2xl"
        style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-medium)' }}
      >
        <HugeiconsIcon
          icon={SearchCircleIcon}
          size={20}
          strokeWidth={1.5}
          className="text-emerald-400"
        />
      </div>
      <p className="font-mono text-xs font-semibold tracking-widest text-[var(--text-muted)] uppercase">
        404
      </p>
      <h1 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">Page not found</h1>
      <p className="mt-1 max-w-sm text-sm text-[var(--text-tertiary)]">
        The page you&apos;re looking for doesn&apos;t exist or was moved.
      </p>
      <Link
        href="/"
        className="mt-5 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-950 transition-opacity hover:opacity-90"
        style={{ background: 'linear-gradient(to right, #10b981, #0d9488)' }}
      >
        Back to chat
      </Link>
    </div>
  )
}
