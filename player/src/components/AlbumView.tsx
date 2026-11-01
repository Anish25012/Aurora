import { ChevronLeft } from 'lucide-react'
import { keys, useCached } from '../lib/cache'
import type { Album, AlbumDetail, SpotifyApi } from '../spotify/api'
import { songsAndLength } from '../lib/format'
import { CollectionHero, Dot } from './CollectionHero'
import { TrackList } from './TrackList'

type AlbumApi = Pick<SpotifyApi, 'getAlbum'>

interface Props {
  /** What we already know (from the card that was clicked), shown while the full album loads. */
  album: Album
  api: AlbumApi
  /** Play this album, starting at a given song (or the first). */
  onPlayAlbum: (albumUri: string, startUri?: string) => void
  onTogglePlay: () => void
  onOpenArtist: (artist: { id: string; name: string }) => void
  onBack: () => void
  currentUri: string | null
  currentContextUri: string | null
  isPaused: boolean
}

export function AlbumView({
  album,
  api,
  onPlayAlbum,
  onTogglePlay,
  onOpenArtist,
  onBack,
  currentUri,
  currentContextUri,
  isPaused,
}: Props) {
  // Through the cache: usually already loaded by hovering the card, so the page appears instantly.
  const load = useCached<AlbumDetail>(keys.album(album.id), () => api.getAlbum(album.id))
  const full = load.status === 'ready' ? load.data : null

  // Opened from a song, we only know the album's id, name and cover until it loads.
  const info = full ?? album
  const artists = full?.artists ?? album.artists ?? []
  const kind = info.album_type === 'single' ? 'Single' : info.album_type === 'compilation' ? 'Compilation' : 'Album'
  const year = info.release_date.slice(0, 4)

  return (
    <section className="album-page" key={album.id}>
      <button className="back-button" onClick={onBack}>
        <ChevronLeft size={16} /> Back
      </button>

      <CollectionHero
        kind={kind}
        title={info.name}
        images={info.images}
        // "Playing here" = Spotify reports this album as the current context.
        playingHere={currentContextUri === album.uri}
        isPaused={isPaused}
        canPlay={Boolean(full && full.tracks.length > 0)}
        onPlay={() => onPlayAlbum(album.uri)}
        onTogglePlay={onTogglePlay}
        meta={
          <>
            {artists.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ', '}
                <button className="inline-link" onClick={() => onOpenArtist(a)}>
                  {a.name}
                </button>
              </span>
            ))}
            {year && (
              <>
                <Dot />
                {year}
              </>
            )}
            {full && (
              <>
                <Dot />
                {songsAndLength(full.tracks.map((t) => t.duration_ms))}
              </>
            )}
          </>
        }
      />

      <section className="shelf" aria-label="Songs">
        {load.status === 'loading' && [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" />)}
        {load.status === 'error' && <p className="shelf-error">{load.message}</p>}
        {full && (
          <TrackList
            label={`${album.name} songs`}
            tracks={full.tracks}
            numbered
            useTrackNumbers
            hideAlbum
            // Play within the album (not as a loose list), so Next follows the album's order.
            onPlay={(tracks, index) => onPlayAlbum(album.uri, tracks[index].uri)}
            onTogglePlay={onTogglePlay}
            currentUri={currentUri}
            isPaused={isPaused}
          />
        )}
      </section>

      {full && (
        <p className="attribution">
          Released {new Date(full.release_date).toLocaleDateString(undefined, { dateStyle: 'long' })} · Album data and
          artwork provided by Spotify.
        </p>
      )}
    </section>
  )
}
