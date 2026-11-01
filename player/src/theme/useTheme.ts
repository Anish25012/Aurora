import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { applyTheme, initialTheme, prefersReducedMotion, saveTheme, type Theme } from './theme'

const REVEAL_MS = 620

/**
 * The current theme, plus a setter that animates the switch.
 *
 * The animation uses the View Transitions API. The browser snapshots the page,
 * we swap the theme, and then the new theme is revealed as a circle growing
 * out of the button that was clicked. Browsers without the API (or users who
 * prefer reduced motion) get an instant switch or a gentle cross-fade.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => initialTheme())

  useEffect(() => applyTheme(theme), [theme])

  const setTheme = useCallback(
    (next: Theme, origin?: { x: number; y: number }) => {
      saveTheme(next)
      if (next === theme) return
      const commit = () => {
        // flushSync: the DOM must already show the new theme when the browser
        // takes its "after" snapshot, which happens right after this returns.
        flushSync(() => setThemeState(next))
        applyTheme(next)
      }

      if (typeof document.startViewTransition !== 'function') {
        commit()
        return
      }
      // Reduced motion: keep the browser's default soft cross-fade, without the expanding circle.
      const reveal = !prefersReducedMotion() && origin !== undefined
      // While this class is on, CSS turns off the default cross-fade so only the circle animates.
      if (reveal) document.documentElement.classList.add('theme-reveal')
      const transition = document.startViewTransition(commit)
      void transition.finished.finally(() => document.documentElement.classList.remove('theme-reveal'))
      if (!reveal || !origin) return

      void transition.ready.then(() => {
        // The circle must reach the farthest corner of the window.
        const radius = Math.hypot(
          Math.max(origin.x, window.innerWidth - origin.x),
          Math.max(origin.y, window.innerHeight - origin.y),
        )
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${origin.x}px ${origin.y}px)`,
              `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
            ],
          },
          { duration: REVEAL_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
        )
      })
    },
    [theme],
  )

  return { theme, setTheme }
}
