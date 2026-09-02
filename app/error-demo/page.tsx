/**
 * Test-only route: renders the root error boundary (app/error.tsx) with a
 * mock error so the visual regression suite can snapshot the error state
 * deterministically. Real errors reach this UI through Next.js's boundary
 * mechanism; this route only reuses the same component for a static snapshot.
 *
 * Production: this route 404s. Visual regression tests for the error UI
 * are run against a local dev build (`npm run dev`) or against a preview
 * deploy with `E2E_INCLUDE_TEST_ROUTES=true` set so the test harness can
 * force the page to render. The point is to keep `/error-demo` out of the
 * public production bundle — there's no value in letting a curious user
 * land on a synthetic error page, and an exposed test surface is an
 * unnecessary foot-gun for future devs.
 *
 * Implemented as a server component (not 'use client') so the production
 * notFound() runs at request time, not after hydration, and so the static
 * build skips the page entirely. `force-dynamic` keeps the route from
 * being prerendered, which would otherwise bake the demo error into the
 * static page payload and ship it to the CDN.
 */
import { notFound } from 'next/navigation'
import ErrorPage from '@/app/error'

export const dynamic = 'force-dynamic'

export default function ErrorDemoPage() {
  if (process.env.NODE_ENV === 'production' && process.env.E2E_INCLUDE_TEST_ROUTES !== 'true') {
    notFound()
  }
  return <ErrorPage error={new Error('demo error')} reset={() => undefined} />
}
