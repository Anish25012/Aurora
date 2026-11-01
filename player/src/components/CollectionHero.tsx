import { Pause, Play } from 'lucide-react'
import type { ReactNode } from 'react'
import { pickImage } from '../lib/format'
import type { Image } from '../spotify/api'

interface Props {
  /** "Album", "Single", "Playlist"... */
  kind: string
  title: string
  images: Image[]
  /** The line under the title: artist/owner, year, song count... */
  meta: ReactNode
  /** Spotify reports this album/playlist as what's playing (paused or not). */
  playingHere: boolean
  isPaused: boolean
  canPlay: boolean
  onPlay: () => void
  onTogglePlay: () => void
  /** A designed cover instead of artwork (e.g. Liked Songs' heart). */
  art?: ReactNode
  /** Extra buttons beside Play (e.g. Edit). */
  actions?: ReactNode
}

/**
 * The top of an album or playlist page: the cover with a full-size record
 * that slides out of its sleeve as the page opens (and spins while this
 * collection plays), the title and details, and a Play / Pause button.
 */
export function CollectionHero({
  kind,
  title,
  images,
  meta,
  playingHere,
  isPaused,
  canPlay,
  onPlay,
  onTogglePlay,
  art,
  actions,
}: Props) {
  const cover = pickImage(images, 600)
  const spinning = playingHere && !isPaused
  const action = spinning ? 'Pause' : playingHere ? 'Resume' : 'Play'

  return (
    <header className="album-hero">
      <div className={`album-art${spinning ? ' is-spinning' : ''}`}>
        <span className="album-vinyl" aria-hidden>
          <span className="album-vinyl-label" style={cover ? { backgroundImage: `url("${cover}")` } : undefined} />
        </span>
        {art ? (
          art
        ) : cover ? (
          <img className="album-cover" src={cover} alt="" />
        ) : (
          <span className="album-cover album-cover-empty" aria-hidden>
            {title.slice(0, 1)}
          </span>
        )}
      </div>

      <div className="album-hero-text">
        <p className="eyebrow">{kind}</p>
        <h1 className="album-title">{title}</h1>
        <p className="album-meta">{meta}</p>
        <button
          className={`pill-button accent${spinning ? ' is-playing' : ''}`}
          disabled={!canPlay}
          onClick={() => (playingHere ? onTogglePlay() : onPlay())}
          aria-label={`${action} ${title}`}
          aria-pressed={playingHere ? spinning : undefined}
        >
          {/* key: the icon swaps with a little pop, rather than just changing. */}
          <span className="pill-icon" key={spinning ? 'pause' : 'play'}>
            {spinning ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </span>
          {action}
        </button>
        {actions}
      </div>
    </header>
  )
}

export function Dot() {
  return (
    <span className="dot" aria-hidden>
      ·
    </span>
  )
}
