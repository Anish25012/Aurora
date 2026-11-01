import { Pause, Play } from 'lucide-react'
import { pickImage } from '../lib/format'
import { usePrefetchOnHover } from '../lib/prefetch'
import type { Image } from '../spotify/api'

/**
 * The round button that rises into view on hover. On the thing that's playing
 * it stays visible and shows pause (||), so you can see at a glance what's on.
 * Decorative: the whole card is the button.
 */
export function PlayBadge({ playing = false }: { playing?: boolean }) {
  return (
    <span className={`play-badge${playing ? ' is-playing' : ''}`} aria-hidden>
      {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
    </span>
  )
}

interface Props {
  title: string
  subtitle: string
  images: Image[]
  /** What clicking the card does: play it, or open a page (e.g. an artist). */
  onPlay: () => void
  playLabel: string
  round?: boolean
  current?: boolean
  /** This card is what's playing right now (shows pause, click pauses). */
  playing?: boolean
  /** Pause/resume, used instead of onPlay when this card is the current one. */
  onTogglePlay?: () => void
  /** Hide the play badge when clicking opens a page rather than playing music. */
  showPlayBadge?: boolean
  /** Start loading the page this card opens, when the pointer rests on it. */
  prefetch?: () => void
}

/** Square (or round, for artists) artwork card used in horizontal shelves. */
export function MediaCard({
  title,
  subtitle,
  images,
  onPlay,
  playLabel,
  round = false,
  current = false,
  playing = false,
  onTogglePlay,
  showPlayBadge = true,
  prefetch,
}: Props) {
  const prefetchHandlers = usePrefetchOnHover(prefetch)
  const toggles = current && onTogglePlay !== undefined
  const src = pickImage(images, 300)
  return (
    <button
      className={`card${round ? ' is-round' : ''}${current ? ' is-current' : ''}${playing ? ' is-playing' : ''}`}
      onClick={toggles ? onTogglePlay : onPlay}
      aria-label={toggles ? `${playing ? 'Pause' : 'Resume'} ${title}` : playLabel}
      aria-pressed={toggles ? playing : undefined}
      {...prefetchHandlers}
    >
      <span className="card-art-wrap">
        {/* Square covers hide a record that slides out on hover (and stays out,
            spinning, while playing). Round artist photos aren't records, so none. */}
        {!round && (
          <span className="card-vinyl" aria-hidden>
            <span className="card-vinyl-label" style={src ? { backgroundImage: `url("${src}")` } : undefined} />
          </span>
        )}
        {src ? (
          <img className="card-art" src={src} alt="" loading="lazy" />
        ) : (
          <span className="card-art card-art-empty" aria-hidden>
            {title.slice(0, 1)}
          </span>
        )}
        {showPlayBadge && <PlayBadge playing={playing} />}
      </span>
      <span className="card-title">{title}</span>
      <span className="card-sub">{subtitle}</span>
    </button>
  )
}
