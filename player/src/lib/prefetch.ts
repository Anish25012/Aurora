import { useEffect, useRef } from 'react'

// How long the pointer must rest on something before we start loading its page.
// Long enough that sweeping across a row of covers doesn't fire dozens of
// requests (Spotify's quota is per account); short enough that by the time
// you click, the data is usually here.
export const HOVER_INTENT_MS = 150

/**
 * Handlers that call `prefetch` when the user pauses on an element (or
 * focuses it with the keyboard). Spread them onto the card or link.
 */
export function usePrefetchOnHover(prefetch: (() => void) | undefined) {
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  if (!prefetch) return {}
  return {
    onPointerEnter: () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(prefetch, HOVER_INTENT_MS)
    },
    onPointerLeave: () => window.clearTimeout(timer.current),
    onFocus: prefetch,
  }
}
