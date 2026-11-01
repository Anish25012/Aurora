import { Mic } from 'lucide-react'
import { formatTime, pickImage } from '../lib/format'
import type { Episode } from '../spotify/api'
import { PlayBadge } from './MediaCard'

/** Podcast episodes: artwork, title, date, length and how far you got. */
export function EpisodeList({
  episodes,
  currentUri,
  isPaused,
  onPlay,
  onTogglePlay,
  showName = true,
}: {
  episodes: Episode[]
  currentUri: string | null
  isPaused: boolean
  onPlay: (episode: Episode) => void
  onTogglePlay?: () => void
  /** Hide the podcast name (on the podcast's own page). */
  showName?: boolean
}) {
  return (
    <ul className="episode-list" aria-label="Episodes">
      {episodes.map((episode) => {
        const current = episode.uri === currentUri
        const playing = current && !isPaused
        const resume = episode.resume_point
        const progress =
          resume && !resume.fully_played && resume.resume_position_ms > 0
            ? resume.resume_position_ms / episode.duration_ms
            : null
        const left = progress !== null ? episode.duration_ms - (resume?.resume_position_ms ?? 0) : null
        const src = pickImage(episode.images.length ? episode.images : (episode.show?.images ?? []), 120)
        return (
          <li key={episode.id} className={`episode${current ? ' is-current' : ''}`}>
            <button
              className="episode-hit"
              onClick={current && onTogglePlay ? onTogglePlay : () => onPlay(episode)}
              aria-label={current ? `${playing ? 'Pause' : 'Resume'} ${episode.name}` : `Play ${episode.name}`}
            >
              {src ? <img className="episode-art" src={src} alt="" loading="lazy" /> : <Mic className="episode-art" />}
              <span className="episode-body">
                <span className="episode-name">{episode.name}</span>
                {showName && episode.show && <span className="episode-show">{episode.show.name}</span>}
                <span className="episode-desc">{episode.description}</span>
                <span className="episode-meta">
                  {formatEpisodeDate(episode.release_date)} ·{' '}
                  {resume?.fully_played
                    ? 'Played'
                    : left !== null
                      ? `${formatTime(left)} left`
                      : formatTime(episode.duration_ms)}
                  {progress !== null && (
                    <span className="episode-progress" aria-hidden>
                      <span style={{ width: `${Math.round(progress * 100)}%` }} />
                    </span>
                  )}
                </span>
              </span>
              <PlayBadge playing={playing} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function formatEpisodeDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}
