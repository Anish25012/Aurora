import { useEffect, useRef } from 'react'
import type { PlayerControls } from './usePlayer'

type Controls = Pick<
  PlayerControls,
  'togglePlay' | 'next' | 'previous' | 'volume' | 'setVolume' | 'toggleShuffle' | 'cycleRepeat'
>

/** Spotify's desktop shortcuts, so muscle memory carries over. */
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Space', action: 'Play / pause' },
  { keys: 'Ctrl + →', action: 'Next song' },
  { keys: 'Ctrl + ←', action: 'Previous song' },
  { keys: 'Ctrl + ↑ / ↓', action: 'Volume up / down' },
  { keys: 'Ctrl + S', action: 'Shuffle' },
  { keys: 'Ctrl + R', action: 'Repeat' },
]

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export function useKeyboardShortcuts(controls: Controls, enabled = true): void {
  // Read the latest controls from a ref, so the listener is added once.
  const latest = useRef(controls)
  useEffect(() => {
    latest.current = controls
  })

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      // Never hijack typing (search box, playlist details).
      if (isTyping(e.target)) return
      const c = latest.current
      const ctrl = e.ctrlKey || e.metaKey

      if (e.key === ' ' && !ctrl) {
        // Space on a focused button already "clicks" it; don't also toggle playback.
        if ((e.target as HTMLElement)?.tagName === 'BUTTON') return
        e.preventDefault() // otherwise the page scrolls
        c.togglePlay()
        return
      }
      if (!ctrl) return
      const actions: Record<string, () => void> = {
        ArrowRight: c.next,
        ArrowLeft: c.previous,
        ArrowUp: () => c.setVolume(Math.min(1, Math.round((c.volume + 0.1) * 10) / 10)),
        ArrowDown: () => c.setVolume(Math.max(0, Math.round((c.volume - 0.1) * 10) / 10)),
        s: c.toggleShuffle,
        r: c.cycleRepeat,
      }
      const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key]
      if (!action) return
      e.preventDefault() // Ctrl+R would reload the page, Ctrl+S would try to save it
      action()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
