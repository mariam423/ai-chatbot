/**
 * PWA Service Worker — Cache-First for static assets, Network-First for
 * navigations, with offline fallback to /offline.
 *
 * Naming the file `service-worker.js` (rather than `sw.js`) and placing it
 * under /sw/ keeps it out of Next.js's automatic static asset pipeline so
 * it can be served with a long cache lifetime without colliding with hashed
 * build outputs.
 *
 * The worker is registered from a client component (see <ServiceWorkerRegistrar>
 * in app/components/) so it only runs in the browser, never during SSR.
 */

const SW_VERSION = 'v1.0.0'
const STATIC_CACHE = `static-${SW_VERSION}`
const RUNTIME_CACHE = `runtime-${SW_VERSION}`
const OFFLINE_URL = '/offline'

// Precache the app shell and offline fallback at install time.
const PRECACHE_URLS = [OFFLINE_URL, '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only handle GET — never cache non-idempotent requests.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Don't cache NextAuth, API mutations, or streaming endpoints.
  if (url.pathname.startsWith('/api/')) {
    return
  }

  // Same-origin only — cross-origin (e.g. LLM provider images) goes straight to network.
  if (url.origin !== self.location.origin) {
    return
  }

  // Navigation requests: network-first, fall back to cache, then /offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          const cache = await caches.open(RUNTIME_CACHE)
          cache.put(request, fresh.clone())
          return fresh
        } catch {
          const cached = await caches.match(request)
          return cached || (await caches.match(OFFLINE_URL)) || new Response('Offline', { status: 503 })
        }
      })()
    )
    return
  }

  // Hashed Next.js assets (_next/static) — cache-first, they're immutable.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy))
            return response
          })
      )
    )
    return
  }

  // Other same-origin GETs — stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached)
      return cached || network
    })
  )
})

// Allow the page to trigger an immediate update when a new SW is waiting.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
