import { useEffect, useRef } from 'react'

/**
 * Infinite scroll: returns a ref for an element at the end of a list. When it
 * comes within `margin` of the visible area, `loadMore` runs, and again each
 * time it reappears, until `enabled` is false (no more pages, or a page is
 * already loading).
 */
export function useLoadMoreOnScroll<T extends Element>(loadMore: () => void, enabled: boolean, margin = 600) {
  const ref = useRef<T>(null)
  // The latest callback, without re-creating the observer every render.
  const loadRef = useRef(loadMore)
  useEffect(() => {
    loadRef.current = loadMore
  })

  useEffect(() => {
    const el = ref.current
    // jsdom (tests) has no IntersectionObserver; the "Show more" button still works there.
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadRef.current(), {
      rootMargin: `0px 0px ${margin}px 0px`,
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled, margin])

  return ref
}
