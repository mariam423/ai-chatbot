'use client'

import { useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Wraps `next/navigation`'s `useRouter` so that every client-side navigation
 * is wrapped in `document.startViewTransition()` when the browser supports it.
 *
 * View Transitions let us run a single snapshot-then-morph animation across
 * the old and new DOM.  We pair this with CSS `view-transition-name` on key
 * elements and custom `::view-transition-*` pseudo-element rules in
 * `globals.css` to get smooth crossfade / morph transitions between the login
 * and chat pages.
 *
 * Falls back gracefully — if the browser doesn't support the API the
 * navigation proceeds normally with no animation.
 */
export function useViewTransitionRouter() {
  const router = useRouter()
  const transitioning = useRef(false)

  const navigate = useCallback(
    (href: string, options?: { scroll?: boolean; replace?: boolean }) => {
      // Prevent double-navigation while a transition is in-flight.
      if (transitioning.current) return

      const scroll = options?.scroll ?? false
      const useReplace = options?.replace ?? false

      const doNav = () => {
        if (useReplace) {
          router.replace(href, { scroll })
        } else {
          router.push(href, { scroll })
        }
      }

      // Feature-detect the View Transitions API.
      if (typeof document !== 'undefined' && 'startViewTransition' in document) {
        transitioning.current = true
        const transition = document.startViewTransition(doNav)
        transition.finished.finally(() => {
          transitioning.current = false
        })
      } else {
        doNav()
      }
    },
    [router],
  )

  return { navigate }
}
