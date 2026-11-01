import { ChevronDown, ChevronLeft, Pause, Play, Radio } from 'lucide-react'
import { useEffect, useState } from 'react'
import { keys, useCached } from '../lib/cache'
import { useNavigation } from '../navigation'
import { useLibrary } from '../library'
import { pickImage } from '../lib/format'
import type { Album, Artist, SpotifyApi, Track } from '../spotify/api'
import { songKey } from '../spotify/api'
import { Discography } from './Discography'
import { MediaCard } from './MediaCard'
import { TrackList } from './TrackList'
import { CardRow } from './CardRow'

type ArtistApi = Pick<SpotifyApi, 'artistTopTracks' | 'artistDiscography' | 'artistSongs'>

interface Props {
  artist: Artist
  api: ArtistApi
  onPlayTracks: (tracks: Track[], index: number) => void
  onBack: () => void
  onTogglePlay: () => void
  onOpenAlbum: (album: Album) => void
  currentUri: string | null
  currentContextUri?: string | null
  isPaused: boolean
  /** Play this artist's radio (needs Last.fm). */
  onStartRadio?: (artist: Artist) => void
  /** Similar artists, from Last.fm ("Fans also like"). */
  similarArtists?: (artist: Artist) => Promise<Artist[]>
  onOpenArtist?: (artist: Artist) => void
}

export function ArtistView({
  artist,
  api,
  onPlayTracks,
  onBack,
  onTogglePlay,
  onOpenAlbum,
  currentUri,
  currentContextUri = null,
  isPaused,
  onStartRadio,
  similarArtists,
  onOpenArtist,
}: Props) {
  const nav = useNavigation()
  const fans = useCached(similarArtists ? keys.fans(artist.id) : null, () =>
    similarArtists ? similarArtists(artist) : Promise.resolve([]),
  )
  // Through the cache: hovering an artist starts these, so the page is usually ready on click.
  const top = useCached(keys.artistTop(artist.id), () => api.artistTopTracks(artist, 5))
  const albums = useCached(keys.artistDiscography(artist.id), () => api.artistDiscography(artist.id))
  const photo = pickImage(artist.images, 300)
  const library = useLibrary()
  useEffect(() => {
    library?.watch([artist.uri])
  }, [library, artist.uri])
  const following = library?.isSaved(artist.uri)
  const topTracks = top.status === 'ready' ? top.data : []
  // Is something from this page already playing? Then the big button becomes
  // Pause (||) / Resume rather than restarting from song 1.
  const playingHere = topTracks.some((t) => t.uri === currentUri)
  const showPause = playingHere && !isPaused
  const action = showPause ? 'Pause' : playingHere ? 'Resume' : 'Play'

  return (
    <section className="artist" key={artist.id}>
      <button className="back-button" onClick={onBack}>
        <ChevronLeft size={16} /> Back
      </button>

      <header className="artist-hero">
        {photo ? (
          <img className="artist-photo" src={photo} alt="" />
        ) : (
          <span className="artist-photo artist-photo-empty" aria-hidden>
            {artist.name.slice(0, 1)}
          </span>
        )}
        <div className="artist-hero-text">
          <p className="eyebrow">Artist</p>
          <h1 className="artist-name">{artist.name}</h1>
          <button
            className={`pill-button accent${showPause ? ' is-playing' : ''}`}
            disabled={topTracks.length === 0}
            onClick={() => (playingHere ? onTogglePlay() : onPlayTracks(topTracks, 0))}
            aria-pressed={playingHere ? showPause : undefined}
            aria-label={`${action} ${artist.name}'s top songs`}
          >
            {/* key: the icon swaps with a little pop, rather than just changing. */}
            <span className="pill-icon" key={showPause ? 'pause' : 'play'}>
              {showPause ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            </span>
            {action}
          </button>
          {library && (
            <button
              className={`pill-button outline${following ? ' is-on' : ''}`}
              onClick={() => library.toggle(artist.uri, artist.name)}
              aria-pressed={following === true}
              disabled={following === undefined}
            >
              {following ? 'Following' : 'Follow'}
            </button>
          )}
          {onStartRadio && (
            <button className="pill-button outline" onClick={() => onStartRadio(artist)}>
              <Radio size={15} /> Radio
            </button>
          )}
        </div>
      </header>

      <section className="shelf" aria-label="Top songs">
        <div className="shelf-head">
          <h2>Top songs</h2>
        </div>
        {top.status === 'loading' && [0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />)}
        {top.status === 'error' && <p className="shelf-error">{top.message}</p>}
        {top.status === 'ready' && top.data.length === 0 && (
          <p className="shelf-error">Spotify didn't return any songs for {artist.name}.</p>
        )}
        {topTracks.length > 0 && (
          <TrackList
            label={`${artist.name} top songs`}
            tracks={topTracks}
            numbered
            onPlay={onPlayTracks}
            onTogglePlay={onTogglePlay}
            currentUri={currentUri}
            isPaused={isPaused}
          />
        )}
      </section>

      {!(albums.status === 'ready' && albums.data.length === 0) && (
        <section className="shelf" aria-label="Discography">
          <div className="shelf-head">
            <h2>Discography</h2>
          </div>
          {albums.status === 'loading' && (
            <div className="album-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="card-art skeleton-block" />
              ))}
            </div>
          )}
          {albums.status === 'error' && <p className="shelf-error">{albums.message}</p>}
          {albums.status === 'ready' && (
            <Discography releases={albums.data} onOpenAlbum={onOpenAlbum} currentContextUri={currentContextUri} />
          )}
        </section>
      )}

      <MoreSongs
        key={artist.id}
        artist={artist}
        api={api}
        // Wait for the top 5, so the list below never repeats them.
        exclude={top.status === 'loading' ? null : topTracks}
        onPlayTracks={onPlayTracks}
        onTogglePlay={onTogglePlay}
        currentUri={currentUri}
        isPaused={isPaused}
      />

      {fans.status === 'ready' && fans.data.length > 0 && (
        <section className="shelf" aria-label="Fans also like">
          <div className="shelf-head">
            <h2>Fans also like</h2>
          </div>
          <CardRow label="Fans also like">
            {fans.data.map((a) => (
              <MediaCard
                key={a.id}
                round
                title={a.name}
                subtitle="Artist"
                images={a.images}
                onPlay={() => onOpenArtist?.(a)}
                playLabel={`Open ${a.name}`}
                prefetch={() => nav?.prefetchArtist?.(a)}
                showPlayBadge={false}
              />
            ))}
          </CardRow>
        </section>
      )}

      <p className="attribution">
        Artist data and artwork provided by Spotify.
        {fans.status === 'ready' && fans.data.length > 0 && ' Similar artists from Last.fm.'}
      </p>
    </section>
  )
}

type MoreState = {
  tracks: Track[]
  nextOffset: number | null
  status: 'loading' | 'idle' | 'error'
  message?: string
}

/** "More by <artist>": the rest of their songs, below the top 5, loaded a batch at a time. */
function MoreSongs({
  artist,
  api,
  exclude,
  onPlayTracks,
  onTogglePlay,
  currentUri,
  isPaused,
}: {
  artist: Artist
  api: Pick<SpotifyApi, 'artistSongs'>
  exclude: Track[] | null
  onPlayTracks: (tracks: Track[], index: number) => void
  onTogglePlay: () => void
  currentUri: string | null
  isPaused: boolean
}) {
  const [more, setMore] = useState<MoreState>({ tracks: [], nextOffset: 0, status: 'loading' })

  const load = (offset: number) => {
    setMore((m) => ({ ...m, status: 'loading' }))
    api.artistSongs(artist, offset, 3).then(
      ({ tracks, nextOffset }) =>
        setMore((m) => {
          // Skip songs already in the list (e.g. a remaster of one we have).
          const seen = new Set(m.tracks.map((t) => songKey(t.name)))
          const fresh = tracks.filter((t) => {
            const key = songKey(t.name)
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          return { tracks: [...m.tracks, ...fresh], nextOffset, status: 'idle' }
        }),
      (err: Error) => setMore((m) => ({ ...m, status: 'error', message: err.message })),
    )
  }

  // First batch once the top songs are known. (Keyed by artist in the parent,
  // so a new artist starts from scratch.)
  const ready = exclude !== null
  useEffect(() => {
    if (ready) load(0)
    // Only the first batch is loaded here; later batches come from "Show more".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const topKeys = new Set((exclude ?? []).map((t) => songKey(t.name)))
  const visible = more.tracks.filter((t) => !topKeys.has(songKey(t.name)))

  // Nothing beyond the top 5? Then there's nothing to show here.
  if (more.status === 'idle' && visible.length === 0 && more.nextOffset === null) return null

  return (
    <section className="shelf" aria-label={`More by ${artist.name}`}>
      <div className="shelf-head">
        <h2>More by {artist.name}</h2>
      </div>
      {visible.length > 0 && (
        <TrackList
          label={`More by ${artist.name}`}
          tracks={visible}
          onPlay={onPlayTracks}
          onTogglePlay={onTogglePlay}
          currentUri={currentUri}
          isPaused={isPaused}
        />
      )}
      {more.status === 'loading' && [0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
      {more.status === 'error' && <p className="shelf-error">{more.message}</p>}
      {more.status !== 'loading' && more.nextOffset !== null && (
        <button className="show-more" onClick={() => more.nextOffset !== null && load(more.nextOffset)}>
          {more.status === 'error' ? 'Try again' : 'Show more'} <ChevronDown size={15} />
        </button>
      )}
    </section>
  )
}
