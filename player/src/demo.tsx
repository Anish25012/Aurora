/**
 * Design demo: the real components with sample data, no logins needed.
 * Dev only. Open http://127.0.0.1:5173/demo.html while `npm run dev` is running.
 * Not part of the production build (vite only builds index.html).
 *
 *   demo.html          Home
 *   demo.html#search   Search (with the playing row)
 *   demo.html#hover    Search, with the 4th row forced into its hover state
 *   demo.html#artist   An artist page
 *   demo.html#album    An album page
 *
 * (Hash variants exist for screenshots: headless browsers can't click or hover.)
 */
import { Home, Search } from 'lucide-react'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlbumView } from './components/AlbumView'
import { ArtistView } from './components/ArtistView'
import { BrandMark } from './components/BrandMark'
import { HomeView } from './components/HomeView'
import { NowPlayingBar } from './components/NowPlayingBar'
import { SearchView } from './components/SearchView'
import { ThemeToggle } from './components/ThemeToggle'
import { stoppedAt } from './player/clock'
import { useTheme } from './theme/useTheme'
import './index.css'
import type { Album, Artist, Playlist, Track } from './spotify/api'

// Placeholder "album art": soft gradients, so the demo needs no network.
function art(a: string, b: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const SAMPLES: [string, string, string, number, string, string][] = [
  ['Teardrop', 'Massive Attack', 'Mezzanine', 330_000, '#1f2937', '#9ca3af'],
  ['Angel', 'Massive Attack', 'Mezzanine', 379_000, '#312e81', '#a78bfa'],
  ['Midnight City', 'M83', "Hurry Up, We're Dreaming", 243_000, '#be185d', '#fbcfe8'],
  ['Intro', 'The xx', 'xx', 128_000, '#0f172a', '#e2e8f0'],
  ['Kiara', 'Bonobo', 'Black Sands', 229_000, '#065f46', '#a7f3d0'],
  ['Nightcall', 'Kavinsky', 'OutRun', 258_000, '#7c2d12', '#fdba74'],
  ['Breathe', 'Télépopmusik', 'Genetic World', 278_000, '#0c4a6e', '#7dd3fc'],
  ['Sunset Lover', 'Petit Biscuit', 'Presence', 238_000, '#9a3412', '#fde68a'],
]

const TRACKS: Track[] = SAMPLES.map(([name, artist, album, ms, a, b], i) => ({
  id: `t${i}`,
  uri: `spotify:track:t${i}`,
  name,
  artists: [{ id: `a${i}`, name: artist }],
  album: { id: `al${i}`, name: album, images: [{ url: art(a, b), width: 300 }] },
  duration_ms: ms,
  explicit: i === 5,
  external_urls: {},
}))

const ARTISTS: Artist[] = [
  ['Bonobo', '#065f46', '#6ee7b7'],
  ['Massive Attack', '#111827', '#6b7280'],
  ['M83', '#831843', '#f9a8d4'],
  ['The xx', '#1e293b', '#cbd5e1'],
  ['Kavinsky', '#7c2d12', '#fb923c'],
  ['Fred again..', '#1e3a8a', '#93c5fd'],
  ['Khruangbin', '#713f12', '#fcd34d'],
].map(([name, a, b], i) => ({
  id: `ar${i}`,
  uri: `spotify:artist:ar${i}`,
  name,
  images: [{ url: art(a, b), width: 300 }],
}))

const PLAYLISTS: Playlist[] = [
  ['Focus', '#312e81', '#818cf8'],
  ['Gym', '#7f1d1d', '#f87171'],
  ['Late night drive', '#0f172a', '#6366f1'],
  ['Sunday morning', '#78350f', '#fde68a'],
  ['Deep work', '#064e3b', '#34d399'],
  ['Throwbacks', '#701a75', '#f0abfc'],
].map(([name, a, b], i) => ({
  id: `p${i}`,
  uri: `spotify:playlist:p${i}`,
  name,
  description: null,
  images: [{ url: art(a, b), width: 300 }],
  owner: { display_name: 'You' },
}))

const BONOBO_SONGS: [string, string, string, string][] = [
  ['Kerala', 'Migration', '#0f766e', '#99f6e4'],
  ['Kiara', 'Black Sands', '#065f46', '#a7f3d0'],
  ['Cirrus', 'The North Borders', '#1e3a8a', '#bfdbfe'],
  ['Ketto', 'Days to Come', '#78350f', '#fcd34d'],
  ['Black Sands', 'Black Sands', '#1f2937', '#d1d5db'],
]
const ARTIST_TOP: Track[] = BONOBO_SONGS.map(([name, album, a, b], i) => ({
  id: `b${i}`,
  uri: `spotify:track:b${i}`,
  name,
  artists: [{ id: 'ar0', name: 'Bonobo' }],
  album: { id: `ba${i}`, name: album, images: [{ url: art(a, b), width: 300 }] },
  duration_ms: 240_000 + i * 17_000,
  explicit: false,
  external_urls: {},
}))
const ARTIST_ALBUMS: Album[] = [
  ['Fragments', '2022', '#4c1d95', '#c4b5fd'],
  ['Migration', '2017', '#0f766e', '#99f6e4'],
  ['The North Borders', '2013', '#1e3a8a', '#bfdbfe'],
  ['Black Sands', '2010', '#1f2937', '#d1d5db'],
  ['Days to Come', '2006', '#78350f', '#fcd34d'],
  ['Dial M for Monkey', '2003', '#7f1d1d', '#fca5a5'],
].map(([name, year, a, b], i) => ({
  id: `alb${i}`,
  uri: `spotify:album:alb${i}`,
  name,
  images: [{ url: art(a, b), width: 300 }],
  release_date: `${year}-01-01`,
  album_type: 'album' as const,
  total_tracks: 12,
}))
const MIGRATION = [
  'Migration',
  'Grains',
  'Second Sun',
  'Surface',
  'Break Apart',
  'Outlier',
  'Kerala',
  'Ontario',
  'No Reason',
  '7th Sevens',
  'Figures',
  'We Could Forever',
]
const albumApi = {
  getAlbum: async () => ({
    ...ARTIST_ALBUMS[1],
    artists: [{ id: 'ar0', name: 'Bonobo' }],
    tracks: MIGRATION.map((name, i) => ({
      id: `mg${i}`,
      uri: i === 6 ? ARTIST_TOP[0].uri : `spotify:track:mg${i}`,
      name,
      artists: [{ id: 'ar0', name: 'Bonobo' }],
      album: { id: 'alb1', name: 'Migration', images: ARTIST_ALBUMS[1].images },
      duration_ms: 200_000 + ((i * 37_000) % 160_000),
      explicit: false,
      external_urls: {},
      track_number: i + 1,
    })),
  }),
}

const MORE_BONOBO: Track[] = [
  'Cirrus',
  'Ketto',
  'Eyesdown',
  'Flashlight',
  'Bambro Koyo Ganda',
  'Pieces',
  'Linked',
  'First Fires',
].map((name, i) => ({ ...ARTIST_TOP[i % ARTIST_TOP.length], id: `more${i}`, uri: `spotify:track:more${i}`, name }))
const artistApi = {
  artistTopTracks: async () => ARTIST_TOP,
  artistDiscography: async () => ARTIST_ALBUMS,
  artistSongs: async () => ({ tracks: MORE_BONOBO, nextOffset: 30 }),
}

const homeApi = {
  recentlyPlayed: async () => TRACKS,
  topTracks: async () => [...TRACKS].reverse(),
  topArtists: async () => ARTISTS,
  myPlaylists: async () => PLAYLISTS,
}

// ------------------------------------------------------------------- the demo

type View = 'home' | 'search' | 'artist' | 'album'

// Entry point, not a reusable component, so fast-refresh export rules don't apply.
// oxlint-disable-next-line react/only-export-components
function Demo() {
  const hash = window.location.hash.slice(1)
  const [view, setView] = useState<View>(
    hash === 'search' || hash === 'hover'
      ? 'search'
      : hash === 'artist'
        ? 'artist'
        : hash === 'album'
          ? 'album'
          : 'home',
  )
  const [artist, setArtist] = useState<Artist>(ARTISTS[0])
  const theme = useTheme()
  const [current, setCurrent] = useState(1)
  const [paused, setPaused] = useState(false)
  const [volume, setVolume] = useState(0.5)
  const track = TRACKS[current]
  const play = (_: Track[], index: number) => {
    setCurrent(index)
    setPaused(false)
  }

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <BrandMark size={24} />
          Aurora
        </div>
        {(
          [
            ['home', 'Home', Home],
            ['search', 'Search', Search],
          ] as const
        ).map(([v, label, Icon]) => (
          <button
            key={v}
            className="nav-item"
            aria-current={view === v ? 'page' : undefined}
            onClick={() => setView(v)}
          >
            <Icon size={17} /> {label}
          </button>
        ))}
        <div className="sidebar-footer">
          <ThemeToggle theme={theme.theme} onChange={theme.setTheme} />
        </div>
      </nav>
      <main className="main">
        <div className="ambient" aria-hidden>
          <img
            key={view}
            src={
              view === 'artist'
                ? artist.images[0].url
                : view === 'album'
                  ? ARTIST_ALBUMS[1].images[0].url
                  : track.album.images[0].url
            }
            alt=""
          />
        </div>
        {view === 'home' && (
          <HomeView
            api={homeApi}
            currentUri={track.uri}
            onPlayTracks={play}
            onOpenPlaylist={() => {}}
            onTogglePlay={() => setPaused((p) => !p)}
            onOpenArtist={(a) => {
              setArtist(a)
              setView('artist')
            }}
          />
        )}
        {view === 'search' && (
          <SearchView
            initialQuery="massive"
            search={async () => ({
              tracks: TRACKS.slice(0, 6),
              artists: ARTISTS,
              albums: ARTIST_ALBUMS,
              playlists: PLAYLISTS,
            })}
            currentUri={track.uri}
            isPaused={paused}
            onPlay={play}
          />
        )}
        {view === 'artist' && (
          <ArtistView
            artist={artist}
            api={artistApi}
            currentUri={ARTIST_TOP[1].uri}
            isPaused={false}
            onPlayTracks={() => {}}
            onOpenAlbum={() => setView('album')}
            onBack={() => setView('home')}
            onTogglePlay={() => {}}
          />
        )}
        {view === 'album' && (
          <AlbumView
            album={{ ...ARTIST_ALBUMS[1], artists: [{ id: 'ar0', name: 'Bonobo' }] }}
            api={albumApi}
            currentUri={ARTIST_TOP[0].uri}
            currentContextUri={ARTIST_ALBUMS[1].uri}
            isPaused={false}
            onPlayAlbum={() => {}}
            onTogglePlay={() => {}}
            onOpenArtist={() => setView('artist')}
            onBack={() => setView('artist')}
          />
        )}
      </main>
      <NowPlayingBar
        status="ready"
        track={{
          uri: track.uri,
          name: track.name,
          artists: track.artists[0].name,
          album: track.album.name,
          imageUrl: track.album.images[0].url,
          spotifyUrl: null,
          paused,
          durationMs: track.duration_ms,
          contextUri: null,
          artistRefs: track.artists,
          albumRef: { id: track.album.id, name: track.album.name, images: track.album.images },
        }}
        clock={stoppedAt(track.duration_ms * 0.38)}
        volume={volume}
        togglePlay={() => setPaused((p) => !p)}
        next={() => setCurrent((c) => (c + 1) % TRACKS.length)}
        previous={() => setCurrent((c) => (c - 1 + TRACKS.length) % TRACKS.length)}
        seek={() => {}}
        setVolume={setVolume}
      />
    </div>
  )
}

if (window.location.hash === '#hover' || window.location.hash === '#artist') {
  const style = document.createElement('style')
  style.textContent = `
    .track-list li:nth-child(4) .track-row { background: var(--hover); }
    .track-list li:nth-child(4) .vinyl { transform: translateX(24px) rotate(40deg); }
    .track-list li:nth-child(4) .artwork-overlay { opacity: 1; }`
  document.head.appendChild(style)
}

// demo.html#homehover: Home with one card and one tile forced into their hover state.
if (window.location.hash === '#homehover') {
  const style = document.createElement('style')
  style.textContent = `
    .card-row .card:nth-child(2) { position: relative; z-index: 3; }
    .card-row .card:nth-child(2) .card-art-wrap { transform: translateY(-3px); }
    .card-row .card:nth-child(2) .card-vinyl { transform: translateX(40%) rotate(35deg); }
    .card-row .card:nth-child(2) .play-badge { opacity: 1; transform: none; }
    .tile-grid .tile:nth-child(4) .tile-vinyl { transform: translateX(26px) rotate(35deg); }
    .tile-grid .tile:nth-child(4) .tile-text { transform: translateX(26px); }
    .tile-grid .tile:nth-child(4) .play-badge { opacity: 1; transform: none; }`
  document.head.appendChild(style)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
)
