import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../theme/theme'

/**
 * A sideways shelf of cards with ‹ › buttons at its edges, like Apple Music:
 * each click moves along by a screenful, and a button fades away once you've
 * reached that end. Trackpad and touch scrolling still work as before.
 */
export function CardRow({ children, label }: { children: ReactNode; label?: string }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [ends, setEnds] = useState({ atStart: true, atEnd: true })

  const measure = useCallback(() => {
    const el = rowRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // A couple of pixels of slack: scroll positions aren't always whole numbers.
    setEnds({ atStart: el.scrollLeft <= 2, atEnd: el.scrollLeft >= max - 2 })
  }, [])

  // Re-check when the window resizes or cards arrive (e.g. after loading).
  useEffect(() => {
    measure()
    const el = rowRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure, children])

  const page = (direction: 1 | -1) => {
    const el = rowRef.current
    if (!el) return
    el.scrollBy({
      left: direction * el.clientWidth * 0.85,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }

  return (
    <div className="card-row-wrap">
      <button
        className="row-arrow is-prev"
        onClick={() => page(-1)}
        hidden={ends.atStart}
        aria-label={label ? `Scroll ${label} left` : 'Scroll left'}
      >
        <ChevronLeft size={20} />
      </button>
      <div className="card-row" ref={rowRef} onScroll={measure}>
        {children}
      </div>
      <button
        className="row-arrow is-next"
        onClick={() => page(1)}
        hidden={ends.atEnd}
        aria-label={label ? `Scroll ${label} right` : 'Scroll right'}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  )
}
