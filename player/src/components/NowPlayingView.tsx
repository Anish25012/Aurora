import { ChevronDown, MicVocal } from 'lucide-react'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { appCache, keys, useCached } from '../lib/cache'
import { activeLine, fetchLyrics, type Lyrics, type LyricsQuery } from '../lib/lyrics'
import { NavigationContext, type Navigation } from '../navigation'
import { type PlaybackClock, usePosition } from '../player/clock'
import type { PlayerControls } from '../player/usePlayer'
import { prefersReducedMotion } from '../theme/theme'
import { LikeButton } from './LikeButton'
import { AlbumLink, ArtistLinks } from './Links'
import { Transport } from './Transport'

type Props = Pick<PlayerControls, 'status' | 'track' | 'clock' | 'togglePlay' | 'next' | 'previous' | 'seek'> &
  Partial<Pick<PlayerControls, 'shuffle' | 'repeat' | 'toggleShuffle' | 'cycleRepeat' | 'buffering'>> & {
    onClose: () => void
    /** Open with the lyrics showing. */
    showLyrics?: boolean
    /** Where lyrics come from (tests pass a fake). */
    loadLyrics?: (q: LyricsQuery) => Promise<Lyrics | null>
  }

// Lyrics don't change: keep them for the whole session (memory only).
const LYRICS_TTL_MS = 24 * 60 * 60_000

/**
 * The full-screen player: big artwork on a record that spins while the song
 * plays, over a soft blur of the cover, with lyrics that follow along.
 */
export function NowPlayingView({ onClose, showLyrics = false, loadLyrics = fetchLyrics, ...player }: Props) {
  const { track, clock, status } = player
  const [lyricsOpen, setLyricsOpen] = useState(showLyrics)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Esc closes, like any sheet. Focus starts on the close button.
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Opening an artist or album from here closes the full-screen player first.
  const outer = useContext(NavigationContext)
  const nav = useMemo<Navigation | null>(
    () =>
      outer && {
        ...outer,
        openArtist: (a) => {
          onClose()
          outer.openArtist(a)
        },
        openAlbum: (a) => {
          onClose()
          outer.openAlbum(a)
        },
      },
    [outer, onClose],
  )

  const query: LyricsQuery | null = track
    ? {
        name: track.name,
        artist: track.artistRefs[0]?.name ?? track.artists,
        album: track.album,
        durationMs: track.durationMs,
      }
    : null
  const lyrics = useCached(
    lyricsOpen && track ? keys.lyrics(track.uri) : null,
    () => (query ? loadLyrics(query) : Promise.resolve(null)),
    LYRICS_TTL_MS,
  )

  const playing = Boolean(track && !track.paused)
  return (
    <NavigationContext.Provider value={nav}>
      <div className={`fs${lyricsOpen ? ' has-lyrics' : ''}`} role="dialog" aria-modal="true" aria-label="Now playing">
        <div
          className="fs-bg"
          aria-hidden
          style={track?.imageUrl ? { backgroundImage: `url("${track.imageUrl}")` } : undefined}
        />
        <header className="fs-top">
          <button ref={closeRef} className="icon-button fs-close" onClick={onClose} aria-label="Close now playing">
            <ChevronDown size={22} />
          </button>
          <span className="fs-label">Now playing</span>
          <button
            className={`icon-button toggle${lyricsOpen ? ' is-on' : ''}`}
            onClick={() => setLyricsOpen((o) => !o)}
            aria-pressed={lyricsOpen}
            aria-label="Lyrics"
            title="Lyrics"
          >
            <MicVocal size={19} />
          </button>
        </header>

        <div className="fs-body">
          <div className="fs-main">
            <div className={`fs-disc${playing ? ' is-playing' : ''}`}>
              <span className="fs-vinyl" aria-hidden>
                <span
                  className="fs-vinyl-label"
                  style={track?.imageUrl ? { backgroundImage: `url("${track.imageUrl}")` } : undefined}
                />
              </span>
              {track?.imageUrl ? (
                <img key={track.uri} className="fs-art artwork-fade" src={track.imageUrl} alt="" />
              ) : (
                <span className="fs-art card-art-empty" aria-hidden />
              )}
            </div>

            <div className="fs-meta">
              <div className="fs-text">
                <h2 className="fs-title">
                  {track?.albumRef ? (
                    <AlbumLink album={{ ...track.albumRef, name: track.name }} className="inline-link" />
                  ) : (
                    (track?.name ?? 'Not playing')
                  )}
                </h2>
                <p className="fs-artists">
                  {track && (track.artistRefs.length > 0 ? <ArtistLinks artists={track.artistRefs} /> : track.artists)}
                </p>
              </div>
              {track && <LikeButton uri={track.uri} name={track.name} size={22} />}
            </div>

            <Transport {...player} disabled={status !== 'ready' || !track} large />
          </div>

          {lyricsOpen && (
            <LyricsPanel
              key={track?.uri}
              state={lyrics}
              clock={clock}
              durationMs={track?.durationMs}
              onSeek={player.seek}
              onRetry={() => track && appCache.invalidate(keys.lyrics(track.uri))}
            />
          )}
        </div>
      </div>
    </NavigationContext.Provider>
  )
}

function LyricsPanel({
  state,
  clock,
  durationMs,
  onSeek,
  onRetry,
}: {
  state: ReturnType<typeof useCached<Lyrics | null>>
  clock: PlaybackClock
  durationMs?: number
  onSeek: (ms: number) => void
  onRetry: () => void
}) {
  const lyrics = state.status === 'ready' ? state.data : null
  const synced = lyrics?.synced && lyrics.synced.length > 0 ? lyrics.synced : null
  const positionMs = usePosition(clock, durationMs)
  const current = synced ? activeLine(synced, positionMs) : -1

  // Keep the sung line in the middle, unless you've just scrolled to read ahead.
  const panelRef = useRef<HTMLDivElement>(null)
  const userScrolledAt = useRef(0)
  useEffect(() => {
    if (current < 0 || Date.now() - userScrolledAt.current < 3000) return
    const line = panelRef.current?.querySelector<HTMLElement>(`[data-line="${current}"]`)
    line?.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [current])
  const noteScroll = () => {
    userScrolledAt.current = Date.now()
  }

  let body
  if (state.status === 'loading') {
    body = <p className="lyrics-note">Loading lyrics…</p>
  } else if (state.status === 'error') {
    body = (
      <p className="lyrics-note">
        {state.message}{' '}
        <button className="link-button" onClick={onRetry}>
          Try again
        </button>
      </p>
    )
  } else if (lyrics?.instrumental) {
    body = <p className="lyrics-note">♪ Instrumental</p>
  } else if (synced) {
    body = (
      <ol className="lyrics-lines">
        {synced.map((line, i) => (
          <li key={i} data-line={i} className={i === current ? 'is-active' : i < current ? 'is-past' : undefined}>
            {/* Click a line to jump there. */}
            <button onClick={() => onSeek(line.timeMs)} aria-current={i === current ? 'true' : undefined}>
              {line.text || '♪'}
            </button>
          </li>
        ))}
      </ol>
    )
  } else if (lyrics?.plain) {
    body = <p className="lyrics-plain">{lyrics.plain}</p>
  } else {
    body = <p className="lyrics-note">No lyrics found for this song.</p>
  }

  return (
    <aside className="fs-lyrics" aria-label="Lyrics" ref={panelRef} onWheel={noteScroll} onTouchMove={noteScroll}>
      {body}
      <p className="lyrics-credit">
        Lyrics from{' '}
        <a href="https://lrclib.net" target="_blank" rel="noreferrer">
          LRCLIB
        </a>
      </p>
    </aside>
  )
}
