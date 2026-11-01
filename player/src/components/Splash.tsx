import { useEffect, useState } from 'react'
import { BrandMark } from './BrandMark'

// Long enough to register as a moment, short enough not to feel like waiting.
const HOLD_MS = 1500
const EXIT_MS = 450
const REDUCED_HOLD_MS = 500

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Launch animation: a northern-lights glow rises behind the logo, a halo ring
 * sweeps around it, and soft rings pulse outward. Then the whole screen
 * dissolves (scale + blur + fade) into the app underneath.
 *
 * The app renders beneath the splash the whole time, so the Spotify player is
 * already connecting while this plays. The animation hides real work rather
 * than adding a delay.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const hold = prefersReducedMotion() ? REDUCED_HOLD_MS : HOLD_MS
    const id = window.setTimeout(() => setExiting(true), hold)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!exiting) return
    const id = window.setTimeout(onDone, EXIT_MS)
    return () => window.clearTimeout(id)
  }, [exiting, onDone])

  // Any click or key skips straight to the exit. Never trap the user.
  useEffect(() => {
    const skip = () => setExiting(true)
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [])

  return (
    <div
      className={`splash${exiting ? ' is-exiting' : ''}`}
      onPointerDown={() => setExiting(true)}
      data-testid="splash"
      aria-hidden
    >
      <div className="splash-aurora" />
      <div className="splash-emblem">
        <div className="splash-glow" />
        <div className="splash-ring" />
        <div className="splash-ring" />
        <div className="splash-halo" />
        <BrandMark size={84} className="splash-mark" />
      </div>
      <div className="splash-word">Aurora</div>
    </div>
  )
}
