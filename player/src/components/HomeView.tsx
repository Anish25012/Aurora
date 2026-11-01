import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { pickImage } from '../lib/format'
import { greetingFor } from '../lib/greeting'
import type { Artist, Playlist, SpotifyApi, Track } from '../spotify/api'
import { useNavigation } from '../navigation'
import { MediaCard, PlayBadge } from './MediaCard'
import { CardRow } from './CardRow'

type HomeApi = Pick<SpotifyApi, 'recentlyPlayed' | 'topTracks' | 'topArtists' | 'myPlaylists'>

interface Props {
  api: HomeApi
  onPlayTracks: (tracks: Track[], index: number) => void
  onOpenArtist: (artist: Artist) => void
  onOpenPlaylist: (playlist: Playlist) => void
  onTogglePlay: () => void
  currentUri: string | null
  /** The album/artist/playlist currently playing from, to mark the matching playlist card. */
  currentContextUri?: string | null
  isPlaying?: boolean
  /** For tests: a fixed "now", so the greeting is predictable. */
  now?: Date
  /** Daily Mixes and Discover Weekly (shown only with Last.fm). */
  madeForYou?: {
    dailyMix: (artist: Artist, index: number) => void
    discoverWeekly: () => void
  }
}

type Section<T> = { status: 'loading' } | { status: 'ready'; items: T[] } | { status: 'error'; message: string }

/** Load one section independently, so a slow or failing one doesn't hold up the rest. */
function useSection<T>(load: () => Promise<T[]>): Section<T> {
  const [state, setState] = useState<Section<T>>({ status: 'loading' })
  // Load once per mount. The loader is kept in a ref, because callers pass a
  // fresh arrow function on every render and we don't want to refetch each time.
  const loadRef = useRef(load)
  useEffect(() => {
    let cancelled = false
    loadRef.current().then(
      (items) => !cancelled && setState({ status: 'ready', items }),
      (err: Error) => !cancelled && setState({ status: 'error', message: err.message }),
    )
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

export function HomeView({
  api,
  onPlayTracks,
  onOpenArtist,
  onOpenPlaylist,
  onTogglePlay,
  currentUri,
  currentContextUri = null,
  isPlaying = false,
  now: nowProp,
  madeForYou,
}: Props) {
  const nav = useNavigation()
  // Fixed for the life of the page, so the greeting doesn't change mid-render.
  const [now] = useState(() => nowProp ?? new Date())
  const recent = useSection(() => api.recentlyPlayed(20))
  const topTracks = useSection(() => api.topTracks('short_term', 12))
  const artists = useSection(() => api.topArtists('medium_term', 12))
  const playlists = useSection(() => api.myPlaylists(20))

  return (
    <section className="home">
      <header className="home-header">
        <p className="eyebrow">
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="page-title">{greetingFor(now)}</h1>
      </header>

      <Shelf title="Jump back in" section={recent} layout="grid" skeleton={<div className="tile skeleton-block" />}>
        {(tracks) =>
          tracks.slice(0, 6).map((track, i) => {
            const current = track.uri === currentUri
            const action = current ? (isPlaying ? 'Pause' : 'Resume') : 'Play'
            return (
              <button
                key={track.id}
                className={`tile${current ? ' is-current' : ''}${current && isPlaying ? ' is-playing' : ''}`}
                // The tile that's playing pauses/resumes instead of restarting.
                onClick={() => (current ? onTogglePlay() : onPlayTracks(tracks, i))}
                aria-label={`${action} ${track.name} by ${artistNames(track)}`}
                aria-pressed={current ? isPlaying : undefined}
              >
                {/* The record behind the small cover slides out on hover, like the rows in Search. */}
                <span className="tile-art-wrap">
                  <span className="tile-vinyl" aria-hidden>
                    <span
                      className="tile-vinyl-label"
                      style={{ backgroundImage: `url("${pickImage(track.album.images, 64) ?? ''}")` }}
                    />
                  </span>
                  <img
                    className="tile-art"
                    src={pickImage(track.album.images, 64) ?? undefined}
                    alt=""
                    loading="lazy"
                  />
                </span>
                <span className="tile-text">
                  <span className="tile-title">{track.name}</span>
                  <span className="tile-sub">{artistNames(track)}</span>
                </span>
                <PlayBadge playing={current && isPlaying} />
              </button>
            )
          })
        }
      </Shelf>

      <Shelf title="On repeat" subtitle="Your most-played this month" section={topTracks} skeleton={<CardSkeleton />}>
        {(tracks) =>
          tracks.map((track, i) => (
            <MediaCard
              key={track.id}
              title={track.name}
              subtitle={artistNames(track)}
              images={track.album.images}
              current={track.uri === currentUri}
              playing={track.uri === currentUri && isPlaying}
              onTogglePlay={onTogglePlay}
              onPlay={() => onPlayTracks(tracks, i)}
              playLabel={`Play ${track.name} by ${artistNames(track)}`}
            />
          ))
        }
      </Shelf>

      {madeForYou && (
        <Shelf
          title="Made for you"
          subtitle="Mixes from what you play, with Last.fm"
          section={mixesFrom(artists, madeForYou)}
          skeleton={<CardSkeleton />}
        >
          {(mixes) =>
            mixes.map((mix) => (
              <button key={mix.id} className="card mix-card" onClick={mix.play} aria-label={`Play ${mix.title}`}>
                <span className="card-art-wrap">
                  <span
                    className="card-art mix-cover"
                    style={
                      {
                        '--hue': mix.hue,
                        backgroundImage: mix.image ? `url("${mix.image}")` : undefined,
                      } as CSSProperties
                    }
                    aria-hidden
                  >
                    <span className="mix-label">{mix.title}</span>
                  </span>
                  <PlayBadge />
                </span>
                <span className="card-title">{mix.title}</span>
                <span className="card-sub">{mix.subtitle}</span>
              </button>
            ))
          }
        </Shelf>
      )}

      <Shelf title="Artists you love" section={artists} skeleton={<CardSkeleton round />}>
        {(items: Artist[]) =>
          items.map((artist) => (
            <MediaCard
              key={artist.id}
              round
              title={artist.name}
              subtitle="Artist"
              images={artist.images}
              // Opens the artist's page (top songs + albums) rather than playing at random.
              onPlay={() => onOpenArtist(artist)}
              playLabel={`Open ${artist.name}`}
              prefetch={() => nav?.prefetchArtist?.(artist)}
              showPlayBadge={false}
            />
          ))
        }
      </Shelf>

      <Shelf title="Your playlists" section={playlists} skeleton={<CardSkeleton />}>
        {(items: Playlist[]) =>
          items.map((playlist) => (
            <MediaCard
              key={playlist.id}
              title={playlist.name}
              subtitle={playlist.owner.display_name ? `By ${playlist.owner.display_name}` : 'Playlist'}
              images={playlist.images ?? []}
              current={playlist.uri === currentContextUri}
              playing={playlist.uri === currentContextUri && isPlaying}
              // Opens the playlist page (its song list), like albums.
              onPlay={() => onOpenPlaylist(playlist)}
              playLabel={`Open playlist ${playlist.name}`}
              prefetch={() => nav?.prefetchPlaylist?.(playlist)}
              showPlayBadge={false}
            />
          ))
        }
      </Shelf>

      <p className="attribution">Music, artwork and recommendations data provided by Spotify.</p>
    </section>
  )
}

function artistNames(track: Track): string {
  return track.artists.map((a) => a.name).join(', ')
}

function Shelf<T>({
  title,
  subtitle,
  section,
  layout = 'row',
  skeleton,
  children,
}: {
  title: string
  subtitle?: string
  section: Section<T>
  layout?: 'row' | 'grid'
  skeleton: ReactNode
  children: (items: T[]) => ReactNode
}) {
  // An empty section (e.g. a brand-new account with no history) just isn't shown.
  if (section.status === 'ready' && section.items.length === 0) return null
  const items =
    section.status === 'loading'
      ? Array.from({ length: layout === 'grid' ? 6 : 7 }, (_, i) => <div key={i}>{skeleton}</div>)
      : section.status === 'ready'
        ? children(section.items)
        : null
  return (
    <section className="shelf" aria-label={title}>
      <div className="shelf-head">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {section.status === 'error' ? (
        <p className="shelf-error">{section.message}</p>
      ) : layout === 'grid' ? (
        <div className="tile-grid">{items}</div>
      ) : (
        <CardRow label={title}>{items}</CardRow>
      )}
    </section>
  )
}

function CardSkeleton({ round = false }: { round?: boolean }) {
  return (
    <div className="card" aria-hidden>
      <span className={`card-art skeleton-block${round ? ' is-round' : ''}`} />
      <span className="skeleton-line" />
      <span className="skeleton-line short" />
    </div>
  )
}

interface Mix {
  id: string
  title: string
  subtitle: string
  image: string | null
  hue: number
  play: () => void
}

/** Daily Mix 1-3 from your three favourite artists, then Discover Weekly. */
function mixesFrom(artists: Section<Artist>, made: NonNullable<Props['madeForYou']>): Section<Mix> {
  if (artists.status !== 'ready') return artists
  const daily = artists.items.slice(0, 3).map((artist, i) => ({
    id: `daily-${artist.id}`,
    title: `Daily Mix ${i + 1}`,
    subtitle: `${artist.name} and more`,
    image: pickImage(artist.images, 300),
    hue: [262, 18, 158][i],
    play: () => made.dailyMix(artist, i),
  }))
  const weekly = {
    id: 'weekly',
    title: 'Discover Weekly',
    subtitle: 'New to you, picked every week',
    image: null,
    hue: 205,
    play: made.discoverWeekly,
  }
  return { status: 'ready', items: [...daily, weekly] }
}
