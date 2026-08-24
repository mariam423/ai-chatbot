'use client'

/**
 * Global error boundary (app/global-error.tsx). Next.js renders this when an
 * error escapes even the root layout — it must provide its own <html>/<body>
 * because the layout is not available at that point. Mirrors the root
 * error.tsx state so the user always gets a recoverable, on-brand page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  console.error('[global error boundary]', error)

  return (
    <html lang="en">
      <body>
        <div
          className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
          style={{ background: 'var(--bg-deep)' }}
        >
          <div
            className="mb-4 flex size-12 items-center justify-center rounded-2xl"
            style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)' }}
          >
            <span className="size-4 rounded-full" style={{ background: 'var(--error-text)' }} />
          </div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            The app hit an unexpected error
          </h1>
          <p className="mt-1 max-w-sm text-sm text-[var(--text-tertiary)]">
            Something broke at the app level. Try again — if it persists, reload the page.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-950 transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(to right, #10b981, #0d9488)' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
