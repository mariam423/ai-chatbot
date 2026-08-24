'use client'

import ErrorPage from '@/app/error'

/**
 * Test-only route: renders the root error boundary (app/error.tsx) with a
 * mock error so the visual regression suite can snapshot the error state
 * deterministically. Real errors reach this UI through Next.js's boundary
 * mechanism; this route only reuses the same component for a static snapshot.
 */
export default function ErrorDemoPage() {
  return <ErrorPage error={new Error('demo error')} reset={() => undefined} />
}
