import { useEffect, useState } from 'react'

/**
 * Where the song was, and when: the position at `at` (a Date.now() time), and
 * whether it's moving. The player only changes this when something happens
 * (play, pause, seek, a new song), never just because time passes. So the app
 * doesn't redraw every page a few times a second while music plays; only the
 * parts that show the position (`usePosition`) tick.
 */
export interface PlaybackClock {
  positionMs: number
  at: number
  paused: boolean
}

/** A clock standing still at `positionMs`. */
export const stoppedAt = (positionMs: number): PlaybackClock => ({ positionMs, at: 0, paused: true })

/** The position at time `now`. max(0, ...): `now` can be slightly older than a fresh clock. */
export function positionAt(clock: PlaybackClock, now = Date.now()): number {
  return clock.paused ? clock.positionMs : clock.positionMs + Math.max(0, now - clock.at)
}

/** The live position, re-rendering only the calling component (4 times a second, while playing). */
export function usePosition(clock: PlaybackClock, durationMs?: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (clock.paused) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [clock])
  const position = positionAt(clock, now)
  return durationMs ? Math.min(position, durationMs) : position
}
