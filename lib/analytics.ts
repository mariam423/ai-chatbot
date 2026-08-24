/**
 * Env-gated user-activity tracking.
 *
 * Providers:
 *   - PostHog capture (POSTHOG_API_KEY + optional POSTHOG_HOST). Events are
 *     sent server-side via plain fetch so the key never reaches the client.
 *   - Debug logging (ANALYTICS_DEBUG=true) prints events to the server log
 *     for local development without any external service.
 *
 * When neither is configured, tracking is a complete no-op — the app never
 * phones home by default. `trackEvent` is deliberately best-effort: failures
 * are swallowed (tracking must never break the chat flow).
 */

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com'

function enabled(): 'posthog' | 'debug' | null {
  if (process.env.POSTHOG_API_KEY) return 'posthog'
  if (process.env.ANALYTICS_DEBUG === 'true') return 'debug'
  return null
}

export interface AnalyticsEvent {
  /** Event name, e.g. "chat_message_sent". */
  event: string
  /** Arbitrary string properties; flattened onto the capture payload. */
  properties?: Record<string, string | number | boolean>
  /** Optional distinct id (e.g. user id) for cross-session attribution. */
  distinctId?: string
}

/**
 * Record an event. Best-effort: never throws, and returns a boolean so
 * callers can tell whether the event was actually emitted.
 */
export async function trackEvent(input: AnalyticsEvent): Promise<boolean> {
  const provider = enabled()
  if (!provider) return false

  const props = { ...input.properties, $current_url: input.properties?.currentUrl }

  if (provider === 'posthog') {
    try {
      const response = await fetch(`${POSTHOG_HOST}/capture/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: process.env.POSTHOG_API_KEY,
          event: input.event,
          distinct_id: input.distinctId ?? 'anonymous',
          properties: props,
          timestamp: new Date().toISOString(),
        }),
        // Tracking is auxiliary — give it a short leash and move on.
        signal: AbortSignal.timeout(3_000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  // Debug mode: log to the server console for local development.
  console.info(`[analytics:debug] ${input.event}`, props)
  return true
}
