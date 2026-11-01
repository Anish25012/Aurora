import { ChevronDown, ChevronLeft, Heart } from 'lucide-react'
import { useState } from 'react'
import { keys, useCached } from '../lib/cache'
import { songsAndLength } from '../lib/format'
import { useLoadMoreOnScroll } from '../lib/useLoadMoreOnScroll'
import type { SpotifyApi, Track } from '../spotify/api'
import { CollectionHero, Dot } from './CollectionHero'
import { TrackList } from './TrackList'

interface Props {
  api: Pick<SpotifyApi, 'likedSongs'>
  onPlayTracks: (tracks: Track[], index: number) => void
  onTogglePlay: () => void
  onBack: () => void
  currentUri: string | null
  currentContextUri: string | null
  isPaused: boolean
}

type Page = { tracks: Track[]; total: number; nextOffset: number | null }

// Spotify plays at most this many songs from a list we hand it, so playing
// starts from the clicked song and carries on through the next ones.
const PLAY_WINDOW = 100

/** Liked Songs: everything you've hearted, newest first, loaded 50 at a time. */
export function LikedSongsView({
  api,
  onPlayTracks,
  onTogglePlay,
  onBack,
  currentUri,
  currentContextUri,
  isPaused,
}: Props) {
  const first = useCached<Page>(keys.liked(0), () => api.likedSongs(0, 50))
  const [more, setMore] = useState<{ tracks: Track[]; nextOffset: number | null; loading: boolean }>({
    tracks: [],
    nextOffset: null,
    loading: false,
  })
  const base = first.status === 'ready' ? first.data : null
  const tracks = base ? [...base.tracks, ...more.tracks] : []
  const nextOffset = more.tracks.length > 0 || more.loading ? more.nextOffset : (base?.nextOffset ?? null)

  const loadMore = () => {
    if (nextOffset === null) return
    setMore((m) => ({ ...m, loading: true }))
    api.likedSongs(nextOffset, 50).then(
      (page) =>
        setMore((m) => ({ tracks: [...m.tracks, ...page.tracks], nextOffset: page.nextOffset, loading: false })),
      () => setMore((m) => ({ ...m, loading: false })),
    )
  }

  // The next 50 load by themselves as you near the bottom.
  const endRef = useLoadMoreOnScroll<HTMLDivElement>(loadMore, nextOffset !== null && !more.loading)

  const play = (list: Track[], index: number) => onPlayTracks(list.slice(index, index + PLAY_WINDOW), 0)
  // Playing "from Liked Songs" = a song from this list, played as a list (no album/playlist context).
  const playingHere = currentContextUri === null && tracks.some((t) => t.uri === currentUri)

  return (
    <section className="album-page">
      <button className="back-button" onClick={onBack}>
        <ChevronLeft size={16} /> Back
      </button>

      <CollectionHero
        kind="Playlist"
        title="Liked Songs"
        images={[]}
        art={
          <span className="album-cover liked-cover" aria-hidden>
            <Heart size={84} fill="currentColor" />
          </span>
        }
        playingHere={playingHere}
        isPaused={isPaused}
        canPlay={tracks.length > 0}
        onPlay={() => play(tracks, 0)}
        onTogglePlay={onTogglePlay}
        meta={
          base && (
            <>
              <strong className="meta-strong">You</strong>
              <Dot />
              {base.total} {base.total === 1 ? 'song' : 'songs'}
              {tracks.length === base.total && tracks.length > 0 && (
                <>
                  <Dot />
                  {songsAndLength(tracks.map((t) => t.duration_ms)).split(', ')[1]}
                </>
              )}
            </>
          )
        }
      />

      <section className="shelf" aria-label="Songs">
        {first.status === 'loading' && [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" />)}
        {first.status === 'error' && <p className="shelf-error">{first.message}</p>}
        {base && tracks.length === 0 && (
          <p className="hint">Songs you like show up here. Tap the ♥ on any song to save it.</p>
        )}
        {tracks.length > 0 && (
          <TrackList
            label="Liked Songs"
            tracks={tracks}
            numbered
            onPlay={play}
            onTogglePlay={onTogglePlay}
            currentUri={currentUri}
            isPaused={isPaused}
          />
        )}
        {more.loading && [0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
        {!more.loading && nextOffset !== null && (
          <button className="show-more" onClick={loadMore}>
            Show more <ChevronDown size={15} />
          </button>
        )}
        <div ref={endRef} aria-hidden />
      </section>
    </section>
  )
}
