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
      navigator.serviceWorker.register('/sw/service-worker.js', { scope: '/' }).catch((err) => {
        // Non-fatal — the app still works as a normal website. The most
        // common cause is the response lacking `Service-Worker-Allowed: /`,
        // which means the browser will reject the scope. We swallow it so
        // the warning doesn't surface in production logs as an error.
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[pwa] service worker registration failed:', err)
        }
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
