import { Ellipsis, Pause, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatTime, pickImage } from '../lib/format'
import type { Track } from '../spotify/api'
import { AlbumLink, ArtistLinks } from './Links'
import { useLibrary } from '../library'
import { LikeButton } from './LikeButton'
import { type MenuAction, RowMenu } from './RowMenu'

interface Props {
  tracks: Track[]
  onPlay: (tracks: Track[], index: number) => void
  currentUri: string | null
  /** Whether the current track is paused; the equaliser and record spin only while playing. */
  isPaused?: boolean
  /** Clicking the song that's already playing pauses/resumes it instead of restarting. */
  onTogglePlay?: () => void
  label: string
  /** Show 1, 2, 3... beside each row (e.g. an artist's top songs). Album tracks use their track number. */
  numbered?: boolean
  /** On an album page every row is the same album, so the column is just noise. */
  hideAlbum?: boolean
  /** Number rows by their position on the album (album pages), not 1, 2, 3 down the list. */
  useTrackNumbers?: boolean
  /** Extra right-click items for this list (e.g. "Remove from this playlist"). */
  rowActions?: (track: Track, index: number) => MenuAction[]
  /** Lets rows be dragged to a new position (your own playlists). */
  onReorder?: (from: number, to: number) => void
}

/** Three bars that bounce while the row's song plays, and rest when paused. */
function Equalizer({ paused }: { paused: boolean }) {
  return (
    <span className={`eq${paused ? ' is-paused' : ''}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

/**
 * Rows of songs with the vinyl-sleeve hover effect. Shared by Search, artist,
 * album and playlist pages.
 *
 * Each row is a container with an invisible full-size play button stretched
 * across it, and the artist and album names as their own links on top. That
 * way clicking anywhere plays the song, but clicking a name opens that page
 * (a button can't contain other buttons, so the row itself can't be one).
 */
export function TrackList({
  tracks,
  onPlay,
  onTogglePlay,
  currentUri,
  isPaused = false,
  label,
  numbered = false,
  hideAlbum = false,
  useTrackNumbers = false,
  rowActions,
  onReorder,
}: Props) {
  // The right-click menu: which song, and where the click was.
  const [menu, setMenu] = useState<{ track: Track; index: number; at: { x: number; y: number } } | null>(null)
  // Drag to reorder: which row is being dragged, and where it would land.
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null)
  // Which of these songs are liked? Asked in one batch for the whole list.
  const library = useLibrary()
  const uris = tracks.map((t) => t.uri).join(',')
  useEffect(() => {
    if (uris) library?.watch(uris.split(','))
  }, [library, uris])

  return (
    <>
      <ul className={`track-list${numbered ? ' is-numbered' : ''}${hideAlbum ? ' no-album' : ''}`} aria-label={label}>
        {tracks.map((track, index) => {
          const isCurrent = track.uri === currentUri
          const cover = pickImage(track.album.images, 64)
          const artists = track.artists.map((a) => a.name).join(', ')
          return (
            <li key={track.id}>
              <div
                className={`track-row${isCurrent ? ' is-current' : ''}${isCurrent && !isPaused ? ' is-playing' : ''}`}
                draggable={onReorder !== undefined}
                data-drop={
                  drag?.over === index && drag.from !== index ? (drag.from < index ? 'after' : 'before') : undefined
                }
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  setDrag({ from: index, over: null })
                }}
                onDragOver={(e) => {
                  if (!drag) return
                  e.preventDefault() // allow dropping here
                  if (drag.over !== index) setDrag({ ...drag, over: index })
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (drag && drag.from !== index) onReorder?.(drag.from, index)
                  setDrag(null)
                }}
                onDragEnd={() => setDrag(null)}
                onContextMenu={(e) => {
                  e.preventDefault() // our menu instead of the browser's
                  setMenu({ track, index, at: { x: e.clientX, y: e.clientY } })
                }}
              >
                <button
                  className="track-hit"
                  onClick={() => (isCurrent && onTogglePlay ? onTogglePlay() : onPlay(tracks, index))}
                  aria-label={`${isCurrent ? (isPaused ? 'Resume' : 'Pause') : 'Play'} ${track.name} by ${artists}`}
                  aria-pressed={isCurrent ? !isPaused : undefined}
                />
                {numbered && (
                  <span className="track-rank" aria-hidden>
                    {useTrackNumbers ? (track.track_number ?? index + 1) : index + 1}
                  </span>
                )}
                <span className="artwork-wrap">
                  {/* A record tucked behind its sleeve: slides out on hover, stays
                    out (and spins) for the song that's playing. */}
                  <span className="vinyl" aria-hidden>
                    <span className="vinyl-label" style={cover ? { backgroundImage: `url("${cover}")` } : undefined} />
                  </span>
                  <img className="artwork" src={cover ?? undefined} alt="" loading="lazy" />
                  <span className="artwork-overlay" aria-hidden>
                    {isCurrent ? (
                      <>
                        {/* At rest: the equaliser. On hover: what a click will do. */}
                        <Equalizer paused={isPaused} />
                        <span className="overlay-action">
                          {isPaused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
                        </span>
                      </>
                    ) : (
                      <Play size={16} fill="currentColor" />
                    )}
                  </span>
                </span>
                <div className="track-text">
                  <div className="track-title">{track.name}</div>
                  <div className="track-sub">
                    {track.explicit && (
                      <span className="explicit" title="Explicit">
                        E
                      </span>
                    )}
                    <ArtistLinks artists={track.artists} />
                  </div>
                </div>
                {!hideAlbum && (
                  <div className="track-album">
                    <AlbumLink album={track.album} />
                  </div>
                )}
                <div className="track-time">
                  <LikeButton uri={track.uri} name={track.name} />
                  {formatTime(track.duration_ms)}
                  {/* The same menu as right-click, for people who don't right-click. */}
                  <button
                    className="inline-link row-more"
                    aria-label={`More options for ${track.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      const r = e.currentTarget.getBoundingClientRect()
                      setMenu({ track, index, at: { x: r.left, y: r.bottom + 4 } })
                    }}
                  >
                    <Ellipsis size={16} />
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {menu && (
        <RowMenu
          track={menu.track}
          at={menu.at}
          extra={rowActions?.(menu.track, menu.index)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
