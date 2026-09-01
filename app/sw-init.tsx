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

    const onIdle =
      'requestIdleCallback' in window
        ? window.requestIdleCallback(register, { timeout: 5_000 })
        : window.setTimeout(register, 1500)
    return () => {
      if ('requestIdleCallback' in window && typeof onIdle === 'number') {
        window.cancelIdleCallback(onIdle)
      } else {
        window.clearTimeout(onIdle)
      }
    }
  }, [])

  return null
}
