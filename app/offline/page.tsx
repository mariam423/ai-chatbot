export const dynamic = 'force-static'

/**
 * Offline fallback page served by the service worker when no cached copy of
 * a navigation request is available. Stays static so it can be precached.
 */
export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>You're offline</h1>
        <p style={{ opacity: 0.7 }}>
          This page hasn't been cached yet. Reconnect to the internet and try again.
        </p>
      </div>
    </main>
  )
}
