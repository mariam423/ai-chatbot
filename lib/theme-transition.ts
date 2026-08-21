/**
 * Wraps a DOM mutation callback in the View Transitions API so that
 * theme switches (light ↔ dark) animate with a smooth crossfade instead
 * of snapping.
 *
 * Falls back to a simple class toggle when the API is unavailable.
 *
 * Usage:
 *   import { withThemeTransition } from '@/lib/theme-transition'
 *   withThemeTransition(() => {
 *     document.documentElement.classList.toggle('dark', isDark)
 *   })
 */
export function withThemeTransition(mutate: () => void): void {
  if (typeof document === 'undefined') {
    // SSR — just apply the change, no animation.
    mutate()
    return
  }

  if ('startViewTransition' in document) {
    // Tell the browser we're about to change the page appearance.
    // The callback runs synchronously — it should only do the
    // classList / style mutations that trigger the repaint.
    const transition = (
      document as Document & {
        startViewTransition: (cb: () => void) => { finished: Promise<void> }
      }
    ).startViewTransition(mutate)

    // Clean up the transition object after it finishes so the GC can
    // reclaim the snapshot data.  We don't await — fire-and-forget.
    transition.finished.catch(() => {
      // Transition was aborted (e.g. by another transition starting).
      // Nothing to do — the mutation already happened.
    })
  } else {
    // Fallback: just apply the change.
    mutate()
  }
}
