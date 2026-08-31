'use client'

import { useEffect } from 'react'

/**
 * Registers the PWA service worker after the page has loaded.
 *
 * Rendered from the root layout. Client-only by design — service workers
 * have no effect during SSR and Next.js will strip the API usage otherwise.
 * The `if ('serviceWorker' in navigator)` guard keeps the page safe in
 * environments where SW is disabled (private mode quirks, etc).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    // Defer registration so the initial load isn't blocked.
    const onLoad = () => {
      navigator.serviceWorker.register('/sw/service-worker.js', { scope: '/' }).catch((err) => {
        // Non-fatal — log only. The app still works as a normal website.
        console.warn('[pwa] service worker registration failed:', err)
      })
    }

    if (document.readyState === 'complete') {
      onLoad()
    } else {
      window.addEventListener('load', onLoad, { once: true })
    }
  }, [])

  return null
}
