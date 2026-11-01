import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { type CSSProperties, useState } from 'react'
import { formatTime } from '../lib/format'
import { usePosition } from '../player/clock'
import type { PlayerControls } from '../player/usePlayer'

export type TransportProps = Pick<PlayerControls, 'track' | 'clock' | 'togglePlay' | 'next' | 'previous' | 'seek'> &
  Partial<Pick<PlayerControls, 'shuffle' | 'repeat' | 'toggleShuffle' | 'cycleRepeat' | 'buffering'>> & {
    disabled: boolean
    /** The full-screen player's bigger buttons. */
    large?: boolean
  }

/** Shuffle, previous, play/pause, next, repeat, and the progress slider. */
export function Transport({
  track,
  clock,
  togglePlay,
  next,
  previous,
  seek,
  shuffle = false,
  repeat = 'off',
  toggleShuffle,
  cycleRepeat,
  buffering = false,
  disabled,
  large = false,
}: TransportProps) {
  // While dragging the progress slider, show where the user is dragging, not
  // the live position. Otherwise the knob jumps back under their finger.
  const [scrubMs, setScrubMs] = useState<number | null>(null)
  const duration = track?.durationMs ?? 0
  const positionMs = usePosition(clock, duration)
  const shownMs = scrubMs ?? positionMs
  const pct = duration ? `${(shownMs / duration) * 100}%` : '0%'
  const icon = large ? 26 : 18
  const small = large ? 20 : 16
  const commit = () => {
    if (scrubMs !== null) seek(scrubMs)
    setScrubMs(null)
  }

  return (
    <div className={`transport${large ? ' is-large' : ''}`}>
      <div className="controls">
        {toggleShuffle && (
          <button
            className={`icon-button toggle${shuffle ? ' is-on' : ''}`}
            onClick={toggleShuffle}
            disabled={disabled}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            title={shuffle ? 'Shuffle: on' : 'Shuffle: off'}
          >
            <Shuffle size={small} />
          </button>
        )}
        <button className="icon-button" onClick={previous} disabled={disabled} aria-label="Previous">
          <SkipBack size={icon} fill="currentColor" />
        </button>
        <button
          className={`icon-button primary${buffering ? ' is-buffering' : ''}`}
          onClick={togglePlay}
          disabled={disabled}
          aria-label={track && !track.paused ? 'Pause' : 'Play'}
          aria-busy={buffering || undefined}
          title={buffering ? 'Loading…' : undefined}
        >
          {track && !track.paused ? (
            <Pause size={icon} fill="currentColor" />
          ) : (
            <Play size={icon} fill="currentColor" />
          )}
        </button>
        <button className="icon-button" onClick={next} disabled={disabled} aria-label="Next">
          <SkipForward size={icon} fill="currentColor" />
        </button>
        {cycleRepeat && (
          <button
            className={`icon-button toggle${repeat !== 'off' ? ' is-on' : ''}`}
            onClick={cycleRepeat}
            disabled={disabled}
            aria-label={`Repeat: ${repeat === 'track' ? 'this song' : repeat === 'context' ? 'all' : 'off'}`}
            title={repeat === 'track' ? 'Repeat this song' : repeat === 'context' ? 'Repeat all' : 'Repeat: off'}
          >
            {repeat === 'track' ? <Repeat1 size={small} /> : <Repeat size={small} />}
          </button>
        )}
      </div>
      <div className="progress">
        <span>{formatTime(shownMs)}</span>
        <input
          className="slider"
          type="range"
          min={0}
          max={duration || 1}
          value={Math.min(shownMs, duration || 1)}
          disabled={disabled}
          style={{ '--pct': pct } as CSSProperties}
          onChange={(e) => setScrubMs(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          aria-label="Seek"
        />
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}
