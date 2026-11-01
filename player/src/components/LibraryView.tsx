import { Download, Heart } from 'lucide-react'
import { useState } from 'react'
import { keys, useCached } from '../lib/cache'
import { useNavigation } from '../navigation'
import type { Album, Artist, Playlist, Show, SpotifyApi } from '../spotify/api'
import { MediaCard } from './MediaCard'

type Filter = 'playlists' | 'albums' | 'artists' | 'podcasts'

interface Props {
  api: Pick<SpotifyApi, 'myPlaylists' | 'savedAlbums' | 'followedArtists'> & Partial<Pick<SpotifyApi, 'savedShows'>>
  onOpenLiked: () => void
  onOpenPlaylist: (playlist: Playlist) => void
  onOpenAlbum: (album: Album) => void
  onOpenArtist: (artist: Artist) => void
  onOpenShow?: (show: Show) => void
  currentContextUri: string | null
  /** Copy the whole library out of Spotify into a file Aurora owns. */
  onSaveLibrary?: () => void
  savingLibrary?: boolean
}

/** Your Library: Liked Songs, then your playlists, saved albums and followed artists. */
export function LibraryView({
  api,
  onOpenLiked,
  onOpenPlaylist,
  onOpenAlbum,
  onOpenArtist,
  onOpenShow,
  currentContextUri,
  onSaveLibrary,
  savingLibrary = false,
}: Props) {
  const nav = useNavigation()
  const [filter, setFilter] = useState<Filter>('playlists')
  // Each list loads only when its filter is chosen (null key = not yet).
  const playlists = useCached<Playlist[]>(keys.library('playlists'), () => api.myPlaylists(50))
  const albums = useCached<Album[]>(filter === 'albums' ? keys.savedAlbums() : null, () => api.savedAlbums(50))
  const artists = useCached<Artist[]>(filter === 'artists' ? keys.library('artists') : null, () =>
    api.followedArtists(),
  )
  const shows = useCached<Show[]>(filter === 'podcasts' && api.savedShows ? keys.library('shows') : null, () =>
    api.savedShows ? api.savedShows(50) : Promise.resolve([]),
  )
  const current =
    filter === 'playlists' ? playlists : filter === 'albums' ? albums : filter === 'artists' ? artists : shows

  return (
    <section className="library-page">
      <div className="library-head">
        <h1 className="page-title">Your Library</h1>
        {onSaveLibrary && (
          <button className="pill-button" onClick={onSaveLibrary} disabled={savingLibrary}>
            <Download size={15} /> {savingLibrary ? 'Saving your library…' : 'Save my library'}
          </button>
        )}
      </div>

      <button className="liked-tile" onClick={onOpenLiked}>
        <span className="liked-tile-art" aria-hidden>
          <Heart size={30} fill="currentColor" />
        </span>
        <span>
          <span className="liked-tile-title">Liked Songs</span>
          <span className="liked-tile-sub">Every song you've hearted</span>
        </span>
      </button>

      <div className="chips" role="tablist" aria-label="Show">
        {(
          [
            ['playlists', 'Playlists'],
            ['albums', 'Albums'],
            ['artists', 'Artists'],
            ...(onOpenShow ? ([['podcasts', 'Podcasts']] as const) : []),
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            className="chip"
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {current.status === 'error' && <p className="banner error">{current.message}</p>}
      {current.status === 'ready' && current.data.length === 0 && (
        <p className="hint">
          {filter === 'playlists'
            ? 'No playlists yet.'
            : filter === 'albums'
              ? 'Albums you save show up here.'
              : filter === 'artists'
                ? 'Artists you follow show up here. Follow one from their page.'
                : 'Podcasts you follow show up here. Find one in Search.'}
        </p>
      )}
      <div className="album-grid">
        {current.status === 'loading' &&
          Array.from({ length: 8 }, (_, i) => <span key={i} className="card-art skeleton-block" aria-hidden />)}
        {filter === 'playlists' &&
          playlists.status === 'ready' &&
          playlists.data.map((p) => (
            <MediaCard
              key={p.id}
              title={p.name}
              subtitle={p.owner.display_name ? `Playlist · ${p.owner.display_name}` : 'Playlist'}
              images={p.images ?? []}
              current={p.uri === currentContextUri}
              onPlay={() => onOpenPlaylist(p)}
              playLabel={`Open playlist ${p.name}`}
              prefetch={() => nav?.prefetchPlaylist?.(p)}
              showPlayBadge={false}
            />
          ))}
        {filter === 'albums' &&
          albums.status === 'ready' &&
          albums.data.map((a) => (
            <MediaCard
              key={a.id}
              title={a.name}
              subtitle={a.artists?.map((x) => x.name).join(', ') ?? a.release_date.slice(0, 4)}
              images={a.images}
              current={a.uri === currentContextUri}
              onPlay={() => onOpenAlbum(a)}
              playLabel={`Open ${a.name}`}
              prefetch={() => nav?.prefetchAlbum?.(a)}
              showPlayBadge={false}
            />
          ))}
        {filter === 'artists' &&
          artists.status === 'ready' &&
          artists.data.map((a) => (
            <MediaCard
              key={a.id}
              round
              title={a.name}
              subtitle="Artist"
              images={a.images}
              onPlay={() => onOpenArtist(a)}
              playLabel={`Open ${a.name}`}
              prefetch={() => nav?.prefetchArtist?.(a)}
              showPlayBadge={false}
            />
          ))}
        {filter === 'podcasts' &&
          shows.status === 'ready' &&
          shows.data.map((s) => (
            <MediaCard
              key={s.id}
              title={s.name}
              subtitle={s.publisher}
              images={s.images}
              current={s.uri === currentContextUri}
              onPlay={() => onOpenShow?.(s)}
              playLabel={`Open podcast ${s.name}`}
              prefetch={() => nav?.prefetchShow?.(s)}
              showPlayBadge={false}
            />
          ))}
      </div>
    </section>
  )
}
