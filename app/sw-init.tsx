'use client'

import { useEffect } from 'react'

/**
 * Registers the PWA service worker after the page has loaded.
 *
 * Rendered from the root layout. Client-only by design — service workers
 * have no effect during SSR and Next.js will strip the API usage otherwise.
 * The `if ('serviceWorker' in navigator)` guard keeps the page safe in
 * environments where SW is disabled (private mode quirks, etc).
 *
 * The registration runs on `requestIdleCallback` (with a `setTimeout` fallback
 * for Safari) so it can't block the initial React render or the post-login
 * client-side navigation. The `Service-Worker-Allowed: /` header on the
 * server response is what lets the SW claim the root scope; if that header
 * is missing, `register()` resolves with a 307 redirect and throws — a
 * known Vercel quirk that we've already handled in `next.config.ts`.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker
        .register('/sw/service-worker.js', { scope: '/' })
        .then((registration) => {
          // Informational only — confirms the scope the browser accepted so
          // a mismatch with the manifest's "/" scope is visible in the log.
          // Dev-only to avoid noise in production consoles.
          if (process.env.NODE_ENV !== 'production') {
            console.info(`[pwa] service worker registered (scope: ${registration.scope})`)
          }
        })
        .catch((err: unknown) => {
          // Non-fatal — the app still works as a normal website. Logging in
          // production too (not just dev) so PWA install failures — wrong
          // scope header, TLS/private-mode quirks, or a missing manifest —
          // are diagnosable from the browser console instead of silently
          // killing installability. Structured name/message only; the raw
          // error can embed URLs but never secrets.
          const name = err instanceof Error ? err.name : 'UnknownError'
          const message = err instanceof Error ? err.message : String(err)
          console.warn(`[pwa] service worker registration failed (${name}): ${message}`)
        })
    }

    let cancelIdle: (() => void) | null = null
    // `requestIdleCallback` and `cancelIdleCallback` aren't in the lib.dom
    // types for older TS targets, so we read them off `window` cast as
    // `any`. The runtime check stays correct: `'requestIdleCallback' in
    // window` returns false in Safari and any other browser missing the API.
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    if (typeof w.requestIdleCallback === 'function') {
      const handle = w.requestIdleCallback(register, { timeout: 5_000 })
      cancelIdle = () => w.cancelIdleCallback?.(handle)
    } else {
      const handle = window.setTimeout(register, 1500)
      cancelIdle = () => window.clearTimeout(handle)
    }
    return () => {
      cancelIdle?.()
    }
  }, [])

  return null
}
