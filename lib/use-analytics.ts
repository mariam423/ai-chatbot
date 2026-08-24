'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Client-side analytics hook. `track` posts an event to /api/analytics
 * (which forwards to PostHog server-side when configured); when tracking is
 * not configured the endpoint is a cheap no-op, so calling it freely is safe.
 *
 * Events are fire-and-forget with a short timeout — never blocking UI.
 */
export function useAnalytics() {
  const sentPageview = useRef(false)

  const track = useCallback(
    (event: string, properties?: Record<string, string | number | boolean>) => {
      void fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, properties }),
        signal: AbortSignal.timeout(3_000),
      }).catch(() => {})
    },
    [],
  )

  // Automatic pageview on mount (client-side nav within the SPA re-renders
  // this hook per route via a keyed provider; once per mount is enough).
  useEffect(() => {
    if (sentPageview.current) return
    sentPageview.current = true
    track('pageview', { currentUrl: window.location.pathname })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { track }
}

/** Canonical event names shared by the UI. */
export const EVENTS = {
  messageSent: 'chat_message_sent',
  sessionCreated: 'chat_session_created',
  exportChat: 'chat_exported',
  upgradeClicked: 'billing_upgrade_clicked',
} as const
