import { Search, X } from 'lucide-react'
import { type ReactNode, useContext, useEffect, useState } from 'react'
import { pickImage } from '../lib/format'
import { clearSearches, forgetSearch, loadRecentSearches, rememberSearch } from '../lib/recentSearches'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { NavigationContext } from '../navigation'
import type { Album, Artist, Episode, Playlist, SearchResults, Show, Track } from '../spotify/api'
import { EpisodeList } from './EpisodeList'
import { MediaCard, PlayBadge } from './MediaCard'
import { TrackList } from './TrackList'
import { CardRow } from './CardRow'

interface Props {
  /** Search every kind at once; kinds left out are treated as "nothing found". */
  search: (query: string) => Promise<Partial<SearchResults>>
  onPlay: (tracks: Track[], index: number) => void
  currentUri: string | null
  /** Whether the current track is paused; the equaliser animates only while playing. */
  isPaused?: boolean
  /** Clicking the song that's playing pauses/resumes it. */
  onTogglePlay?: () => void
  onOpenPlaylist?: (playlist: Playlist) => void
  /** Podcasts appear only when these are given. */
  onOpenShow?: (show: Show) => void
  onPlayEpisode?: (episode: Episode) => void
  /** Pre-filled search text (used by the design demo page). */
  initialQuery?: string
}

type Filter = 'all' | 'songs' | 'artists' | 'albums' | 'playlists' | 'podcasts'

const EMPTY: SearchResults = { tracks: [], artists: [], albums: [], playlists: [], shows: [], episodes: [] }

type Top =
  | { kind: 'artist'; artist: Artist }
  | { kind: 'track'; track: Track }
  | { kind: 'album'; album: Album }
  | { kind: 'playlist'; playlist: Playlist }
  | { kind: 'show'; show: Show }

/**
 * The single best match, like Spotify's "Top result": an exact name match
 * wins (artist first, since typing a name usually means the artist), then
 * an artist whose name starts with what you typed, then the first song.
 */
function pickTopResult(query: string, r: SearchResults): Top | null {
  const q = query.trim().toLowerCase()
  const exact = (name: string) => name.toLowerCase() === q
  const artist = r.artists.find((a) => exact(a.name))
  if (artist) return { kind: 'artist', artist }
  const track = r.tracks.find((t) => exact(t.name))
  if (track) return { kind: 'track', track }
  const album = r.albums.find((a) => exact(a.name))
  if (album) return { kind: 'album', album }
  if (r.artists[0]?.name.toLowerCase().startsWith(q)) return { kind: 'artist', artist: r.artists[0] }
  if (r.tracks[0]) return { kind: 'track', track: r.tracks[0] }
  if (r.artists[0]) return { kind: 'artist', artist: r.artists[0] }
  if (r.albums[0]) return { kind: 'album', album: r.albums[0] }
  if (r.playlists[0]) return { kind: 'playlist', playlist: r.playlists[0] }
  if (r.shows[0]) return { kind: 'show', show: r.shows[0] }
  return null
}

const names = (artists: { name: string }[] = []) => artists.map((a) => a.name).join(', ')
const year = (date: string) => date.slice(0, 4)

export function SearchView({
  search,
  onPlay,
  onTogglePlay,
  currentUri,
  isPaused = false,
  onOpenPlaylist,
  onOpenShow,
  onPlayEpisode,
  initialQuery = '',
}: Props) {
  const nav = useContext(NavigationContext)
  const [query, setQuery] = useState(initialQuery)
  const [filter, setFilter] = useState<Filter>('all')
  const [recent, setRecent] = useState(loadRecentSearches)
  // Wait for a pause in typing before searching, so "teardrop" makes one
  // request instead of eight.
  const debounced = useDebouncedValue(query.trim(), 300)
  // The last completed search, tagged with the query it answers. Loading and
  // error states are worked out from it during render, not kept as separate state.
  const [result, setResult] = useState<{ query: string; results: SearchResults; error: string | null }>({
    query: '',
    results: EMPTY,
    error: null,
  })

  useEffect(() => {
    if (!debounced) return
    // Ignore responses from searches the user has already typed past, so a
    // slow old request can't overwrite newer results.
    let stale = false
    search(debounced).then(
      (found) => !stale && setResult({ query: debounced, results: { ...EMPTY, ...found }, error: null }),
      (err: Error) => !stale && setResult({ query: debounced, results: EMPTY, error: err.message }),
    )
    return () => {
      stale = true
    }
  }, [debounced, search])

  const loading = Boolean(debounced) && result.query !== debounced
  // While a new search loads, keep showing the previous results (less flicker).
  const r = debounced ? result.results : EMPTY
  const error = debounced && result.query === debounced ? result.error : null
  const podcasts = onOpenShow !== undefined
  const nothing =
    r.tracks.length + r.artists.length + r.albums.length + r.playlists.length + (podcasts ? r.shows.length : 0) === 0

  // Opening or playing something from the results is what makes a search
  // worth remembering (not every half-typed word).
  const remember = () => setRecent((list) => rememberSearch(list, debounced))
  const play = (tracks: Track[], index: number) => {
    remember()
    onPlay(tracks, index)
  }
  const openArtist = (artist: Artist) => {
    remember()
    nav?.openArtist(artist)
  }
  const openAlbum = (album: Album) => {
    remember()
    nav?.openAlbum(album)
  }
  const openPlaylist = (playlist: Playlist) => {
    remember()
    onOpenPlaylist?.(playlist)
  }
  const openShow = (show: Show) => {
    remember()
    onOpenShow?.(show)
  }

  const songs = (tracks: Track[], label: string) => (
    <TrackList
      key={result.query}
      label={label}
      tracks={tracks}
      onPlay={play}
      onTogglePlay={onTogglePlay}
      currentUri={currentUri}
      isPaused={isPaused}
    />
  )
  const artistCards = (artists: Artist[]) =>
    artists.map((artist) => (
      <MediaCard
        key={artist.id}
        round
        title={artist.name}
        subtitle="Artist"
        images={artist.images}
        onPlay={() => openArtist(artist)}
        playLabel={`Open ${artist.name}`}
        prefetch={() => nav?.prefetchArtist?.(artist)}
        showPlayBadge={false}
      />
    ))
  const albumCards = (albums: Album[]) =>
    albums.map((album) => (
      <MediaCard
        key={album.id}
        title={album.name}
        subtitle={[year(album.release_date), names(album.artists)].filter(Boolean).join(' · ')}
        images={album.images}
        onPlay={() => openAlbum(album)}
        playLabel={`Open album ${album.name}`}
        prefetch={() => nav?.prefetchAlbum?.(album)}
        showPlayBadge={false}
      />
    ))
  const playlistCards = (playlists: Playlist[]) =>
    playlists.map((playlist) => (
      <MediaCard
        key={playlist.id}
        title={playlist.name}
        subtitle={playlist.owner.display_name ? `By ${playlist.owner.display_name}` : 'Playlist'}
        images={playlist.images ?? []}
        onPlay={() => openPlaylist(playlist)}
        playLabel={`Open playlist ${playlist.name}`}
        prefetch={() => nav?.prefetchPlaylist?.(playlist)}
        showPlayBadge={false}
      />
    ))
  const showCards = (shows: Show[]) =>
    shows.map((show) => (
      <MediaCard
        key={show.id}
        title={show.name}
        subtitle={show.publisher}
        images={show.images}
        onPlay={() => openShow(show)}
        playLabel={`Open podcast ${show.name}`}
        prefetch={() => nav?.prefetchShow?.(show)}
        showPlayBadge={false}
      />
    ))

  const chips: [Filter, string, number][] = [
    ['all', 'All', 0],
    ['songs', 'Songs', r.tracks.length],
    ['artists', 'Artists', r.artists.length],
    ['albums', 'Albums', r.albums.length],
    ['playlists', 'Playlists', r.playlists.length],
    ...(podcasts ? ([['podcasts', 'Podcasts', r.shows.length + r.episodes.length]] as [Filter, string, number][]) : []),
  ]
  const top = pickTopResult(debounced, r)

  return (
    <section>
      {/* Sticky header: results scroll underneath it and blur softly at its edge. */}
      <header className="page-header">
        <h1 className="page-title">Search</h1>
        <label className="search-field">
          <Search size={17} aria-hidden />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={podcasts ? 'Songs, artists, albums, podcasts' : 'Songs, artists, albums'}
            aria-label="Search for songs"
          />
        </label>
        {debounced && (
          <div className="chips search-chips" role="tablist" aria-label="Show">
            {chips
              .filter(([value, , count]) => value === 'all' || count > 0)
              .map(([value, label]) => (
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
        )}
      </header>

      {error && <p className="banner error">{error}</p>}

      {!debounced &&
        (recent.length > 0 ? (
          <section className="recent-searches" aria-label="Recent searches">
            <div className="shelf-head with-action">
              <h2>Recent searches</h2>
              <button className="link-button" onClick={() => setRecent(clearSearches())}>
                Clear
              </button>
            </div>
            <ul className="recent-list">
              {recent.map((q) => (
                <li key={q} className="recent-chip">
                  <button className="recent-query" onClick={() => setQuery(q)}>
                    <Search size={14} aria-hidden /> {q}
                  </button>
                  <button
                    className="recent-remove"
                    aria-label={`Remove ${q} from recent searches`}
                    onClick={() => setRecent((list) => forgetSearch(list, q))}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="hint">Find any song, artist, album or playlist, then click it to play.</p>
        ))}

      {loading && nothing && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
      {debounced && !loading && !error && nothing && (
        <p className="hint">No results for “{debounced}”. Check the spelling, or try fewer words.</p>
      )}

      {debounced && !nothing && filter === 'all' && (
        <div className="search-results" key={result.query}>
          {(top || r.tracks.length > 0) && (
            <div className="search-top">
              {top && (
                <section aria-label="Top result">
                  <h2 className="search-heading">Top result</h2>
                  <TopResult
                    top={top}
                    currentUri={currentUri}
                    isPaused={isPaused}
                    onTogglePlay={onTogglePlay}
                    onPlayTrack={(t) => play(r.tracks, Math.max(0, r.tracks.indexOf(t)))}
                    onOpenArtist={openArtist}
                    onOpenAlbum={openAlbum}
                    onOpenPlaylist={openPlaylist}
                    onOpenShow={openShow}
                  />
                </section>
              )}
              {r.tracks.length > 0 && (
                <section aria-label="Songs" className="search-songs">
                  <h2 className="search-heading">Songs</h2>
                  {songs(r.tracks.slice(0, 4), 'Search results')}
                </section>
              )}
            </div>
          )}
          <Row title="Artists">{artistCards(r.artists)}</Row>
          <Row title="Albums">{albumCards(r.albums)}</Row>
          <Row title="Playlists">{playlistCards(r.playlists)}</Row>
          {podcasts && <Row title="Podcasts">{showCards(r.shows)}</Row>}
        </div>
      )}

      {debounced && filter === 'songs' && r.tracks.length > 0 && songs(r.tracks, 'Search results')}
      {debounced && filter === 'artists' && <div className="album-grid">{artistCards(r.artists)}</div>}
      {debounced && filter === 'albums' && <div className="album-grid">{albumCards(r.albums)}</div>}
      {debounced && filter === 'playlists' && <div className="album-grid">{playlistCards(r.playlists)}</div>}
      {debounced && filter === 'podcasts' && (
        <>
          {r.shows.length > 0 && <div className="album-grid">{showCards(r.shows)}</div>}
          {r.episodes.length > 0 && (
            <section aria-label="Episodes" className="shelf">
              <div className="shelf-head">
                <h2>Episodes</h2>
              </div>
              <EpisodeList
                episodes={r.episodes}
                currentUri={currentUri}
                isPaused={isPaused}
                onTogglePlay={onTogglePlay}
                onPlay={(e) => {
                  remember()
                  onPlayEpisode?.(e)
                }}
              />
            </section>
          )}
        </>
      )}
    </section>
  )
}

function Row({ title, children }: { title: string; children: ReactNode[] }) {
  if (children.length === 0) return null
  return (
    <section className="shelf" aria-label={title}>
      <div className="shelf-head">
        <h2>{title}</h2>
      </div>
      <CardRow label={title}>{children}</CardRow>
    </section>
  )
}

function TopResult({
  top,
  currentUri,
  isPaused,
  onTogglePlay,
  onPlayTrack,
  onOpenArtist,
  onOpenAlbum,
  onOpenPlaylist,
  onOpenShow,
}: {
  top: Top
  currentUri: string | null
  isPaused: boolean
  onTogglePlay?: () => void
  onPlayTrack: (track: Track) => void
  onOpenArtist: (artist: Artist) => void
  onOpenAlbum: (album: Album) => void
  onOpenPlaylist: (playlist: Playlist) => void
  onOpenShow: (show: Show) => void
}) {
  let card: { name: string; kind: string; sub: string; images: { url: string; width: number | null }[] }
  let action: () => void
  let label: string
  let round = false
  let playing = false
  switch (top.kind) {
    case 'artist':
      card = { name: top.artist.name, kind: 'Artist', sub: '', images: top.artist.images }
      action = () => onOpenArtist(top.artist)
      label = `Open ${top.artist.name}`
      round = true
      break
    case 'track': {
      const current = top.track.uri === currentUri
      playing = current && !isPaused
      card = { name: top.track.name, kind: 'Song', sub: names(top.track.artists), images: top.track.album.images }
      action = current && onTogglePlay ? onTogglePlay : () => onPlayTrack(top.track)
      label = current ? `${playing ? 'Pause' : 'Resume'} ${top.track.name}` : `Play ${top.track.name}`
      break
    }
    case 'album':
      card = { name: top.album.name, kind: 'Album', sub: names(top.album.artists), images: top.album.images }
      action = () => onOpenAlbum(top.album)
      label = `Open album ${top.album.name}`
      break
    case 'playlist':
      card = {
        name: top.playlist.name,
        kind: 'Playlist',
        sub: top.playlist.owner.display_name ?? '',
        images: top.playlist.images ?? [],
      }
      action = () => onOpenPlaylist(top.playlist)
      label = `Open playlist ${top.playlist.name}`
      break
    case 'show':
      card = { name: top.show.name, kind: 'Podcast', sub: top.show.publisher, images: top.show.images }
      action = () => onOpenShow(top.show)
      label = `Open podcast ${top.show.name}`
      break
  }
  const src = pickImage(card.images, 300)
  return (
    <button className={`top-result${playing ? ' is-playing' : ''}`} onClick={action} aria-label={label}>
      {src ? (
        <img className={`top-result-art${round ? ' is-round' : ''}`} src={src} alt="" />
      ) : (
        <span className={`top-result-art card-art-empty${round ? ' is-round' : ''}`} aria-hidden />
      )}
      <span className="top-result-name">{card.name}</span>
      <span className="top-result-meta">
        <span className="kind-pill">{card.kind}</span>
        {card.sub && <span>{card.sub}</span>}
      </span>
      {top.kind === 'track' && <PlayBadge playing={playing} />}
    </button>
  )
}
