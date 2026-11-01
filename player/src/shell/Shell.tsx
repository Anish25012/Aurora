import { Home, Library, LogOut, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { BrandMark } from '../components/BrandMark'
import { DevicePicker } from '../components/DevicePicker'
import { HomeView } from '../components/HomeView'
import { LibraryView } from '../components/LibraryView'
import { NowPlayingBar } from '../components/NowPlayingBar'
import { NowPlayingView } from '../components/NowPlayingView'
import { QueuePanel } from '../components/QueuePanel'
import { Toast } from '../components/Screens'
import { SearchView } from '../components/SearchView'
import { ThemeToggle } from '../components/ThemeToggle'
import type { Lastfm } from '../discovery/lastfm'
import { LibraryContext, useLibraryState } from '../library'
import { type AlbumRef, NavigationContext } from '../navigation'
import { useKeyboardShortcuts } from '../player/useKeyboardShortcuts'
import type { PlayerControls } from '../player/usePlayer'
import type { Album, Artist, Episode, Playlist, Show, SpotifyApi, Track } from '../spotify/api'
import type { SpotifyAuth } from '../spotify/auth'
import { downloadLibrary, exportSpotifyLibrary } from '../spotify/exportLibrary'
import type { Theme } from '../theme/theme'
import { PageStack } from './PageStack'
import type { Page, Tab } from './pages'
import { makePrefetchers } from './prefetch'
import { useDiscovery } from './useDiscovery'
import { usePlaylistActions } from './usePlaylistActions'

const NAV: { tab: Tab; label: string; Icon: typeof Home }[] = [
  { tab: 'home', label: 'Home', Icon: Home },
  { tab: 'search', label: 'Search', Icon: Search },
  { tab: 'library', label: 'Library', Icon: Library },
]

export interface ShellProps {
  auth: SpotifyAuth
  api: SpotifyApi
  lastfm: Lastfm | null
  theme: { theme: Theme; setTheme: (t: Theme, origin?: { x: number; y: number }) => void }
  onLoggedOut: (msg: string | null) => void
}

/** The signed-in app: sidebar, the current tab or page, and the player bar. */
export function Shell({ api, lastfm, theme, onLoggedOut, player }: ShellProps & { player: PlayerControls }) {
  const { notice, clearNotice } = player
  const [tab, setTab] = useState<Tab>('home')
  // Tabs stay mounted once opened, so switching keeps your search and scroll
  // position, and Home doesn't reload every visit.
  const [opened, setOpened] = useState<Set<Tab>>(() => new Set<Tab>(['home']))
  const [pages, setPages] = useState<Page[]>([])
  const [queueOpen, setQueueOpen] = useState(false)
  // The full-screen player (and whether it opened on the lyrics).
  const [fullScreen, setFullScreen] = useState<{ lyrics: boolean } | null>(null)
  const closeFullScreen = useCallback(() => setFullScreen(null), [])
  // Liked songs and followed artists, shared by every heart and Follow button.
  const library = useLibraryState(api, player.notify)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [savingLibrary, setSavingLibrary] = useState(false)
  const saveLibrary = async () => {
    setSavingLibrary(true)
    try {
      const library = await exportSpotifyLibrary(api, player.notify)
      downloadLibrary(library)
      player.notify(
        `Saved ${library.liked.length} liked songs, ${library.playlists.length} playlists and ${library.albums.length} albums.`,
      )
    } catch {
      player.notify("Couldn't save your library. Try again in a minute.")
    } finally {
      setSavingLibrary(false)
    }
  }
  // Spotify's desktop shortcuts: Space, Ctrl+arrows, Ctrl+S, Ctrl+R.
  useKeyboardShortcuts(player)
  const page = pages.at(-1) ?? null

  const go = (next: Tab) => {
    setTab(next)
    setPages([]) // a sidebar tab always starts fresh
    setOpened((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
  }
  const push = (next: Page) => setPages((prev) => [...prev, next])
  const back = () => setPages((prev) => prev.slice(0, -1))

  const openArtist = (artist: Artist | { id: string; name: string }) => {
    if ('images' in artist) {
      push({ kind: 'artist', artist })
      return
    }
    // From an album page we only know the artist's id and name. Open the page
    // straight away, then fill in their photo when it arrives.
    push({ kind: 'artist', artist: { ...artist, uri: `spotify:artist:${artist.id}`, images: [] } })
    api.getArtist(artist.id).then(
      (full) =>
        setPages((prev) =>
          prev.map((p) => (p.kind === 'artist' && p.artist.id === full.id ? { kind: 'artist', artist: full } : p)),
        ),
      () => {}, // no photo is fine; the page works without it
    )
  }
  const openAlbum = (album: Album) => push({ kind: 'album', album })
  const openPlaylist = (playlist: Playlist) => push({ kind: 'playlist', playlist })
  const openShow = (show: Show) => push({ kind: 'show', show })
  // Album pages opened from a song name start with just the id, name and cover;
  // the page loads the rest.
  const openAlbumRef = (ref: AlbumRef) =>
    openAlbum({ ...ref, uri: `spotify:album:${ref.id}`, release_date: '', album_type: 'album', total_tracks: 0 })

  const discovery = useDiscovery(api, lastfm, player)
  const playlists = usePlaylistActions(api, player.notify, (created) =>
    push({ kind: 'playlist', playlist: created, editOnOpen: true }),
  )

  // Episodes play as a short list (this one, then the next few), not as the
  // whole podcast: Spotify starts a list much sooner than loading a show with
  // hundreds of episodes. Picks up where you left off.
  const playEpisode = (episode: Episode, show?: Show, after: Episode[] = []) => {
    const resume = episode.resume_point
    const at = resume && !resume.fully_played ? resume.resume_position_ms : undefined
    void player.playTracks(
      [episode, ...after.slice(0, 10)].map((e) => episodeAsTrack(e, show)),
      0,
      at,
    )
  }
  const playTracks = (tracks: Track[], index: number) => void player.playTracks(tracks, index)

  useEffect(() => {
    if (player.loginRequired) onLoggedOut('Your Spotify session ended. Please connect again.')
  }, [player.loginRequired, onLoggedOut])

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(clearNotice, 4000)
    return () => window.clearTimeout(id)
  }, [notice, clearNotice])

  // Includes what was just clicked, before Spotify confirms, so play buttons flip to pause instantly.
  const currentUri = player.currentUri
  const currentContextUri = player.currentContextUri
  const isPaused = !player.isPlaying
  // The glow behind the page: the artist's photo or album cover on their page,
  // otherwise the playing song's cover.
  const pageImage =
    page?.kind === 'artist'
      ? page.artist.images[0]?.url
      : page?.kind === 'album'
        ? page.album.images[0]?.url
        : undefined
  const ambientImage = pageImage ?? player.track?.imageUrl ?? null

  return (
    <LibraryContext.Provider value={library}>
      <NavigationContext.Provider
        value={{
          openArtist,
          openAlbum: openAlbumRef,
          addToQueue: (t) => void player.addToQueue(t),
          ...makePrefetchers(api),
          editablePlaylists: playlists.editablePlaylists,
          addToPlaylist: playlists.addToPlaylist,
          newPlaylistWith: (track) => void playlists.createPlaylist(track),
          startRadio: discovery?.songRadio,
        }}
      >
        <div className={`shell${queueOpen ? ' has-queue' : ''}`}>
          <nav className="sidebar" aria-label="Main">
            <div className="brand">
              <BrandMark size={24} />
              Aurora
            </div>
            {NAV.map(({ tab: t, label, Icon }) => (
              <button key={t} className="nav-item" aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
                <Icon size={17} /> {label}
              </button>
            ))}
            <button className="nav-item new-playlist" onClick={() => void playlists.createPlaylist()}>
              <Plus size={17} /> New playlist
            </button>
            <div className="sidebar-footer">
              <ThemeToggle theme={theme.theme} onChange={theme.setTheme} />
              <button className="link-button" onClick={() => onLoggedOut(null)}>
                <LogOut size={12} /> Log out
              </button>
            </div>
          </nav>

          <main className="main">
            {/* Ambient glow: the current album art, hugely blurred, behind the page (as in Apple Music). */}
            {ambientImage && (
              <div className="ambient" aria-hidden>
                <img key={ambientImage} src={ambientImage} alt="" />
              </div>
            )}
            {player.error && <p className="banner error">{player.error}</p>}

            {page && (
              <PageStack
                page={page}
                api={api}
                player={player}
                discovery={discovery}
                meId={playlists.meId}
                playTracks={playTracks}
                playEpisode={playEpisode}
                openAlbum={openAlbum}
                openArtist={openArtist}
                onBack={back}
              />
            )}

            <div hidden={page !== null || tab !== 'home'}>
              <HomeView
                api={api}
                madeForYou={
                  discovery ? { dailyMix: discovery.dailyMix, discoverWeekly: discovery.discoverWeekly } : undefined
                }
                currentUri={currentUri}
                onPlayTracks={playTracks}
                onOpenArtist={openArtist}
                onOpenPlaylist={openPlaylist}
                onTogglePlay={player.togglePlay}
                currentContextUri={currentContextUri}
                isPlaying={player.isPlaying}
              />
            </div>
            {opened.has('search') && (
              <div hidden={page !== null || tab !== 'search'}>
                <SearchView
                  search={api.searchAll}
                  onOpenPlaylist={openPlaylist}
                  onOpenShow={openShow}
                  onPlayEpisode={(e) => playEpisode(e)}
                  currentUri={currentUri}
                  isPaused={isPaused}
                  onTogglePlay={player.togglePlay}
                  onPlay={playTracks}
                />
              </div>
            )}
            {opened.has('library') && (
              <div hidden={page !== null || tab !== 'library'}>
                <LibraryView
                  api={api}
                  onOpenLiked={() => push({ kind: 'liked' })}
                  onOpenPlaylist={openPlaylist}
                  onOpenAlbum={openAlbum}
                  onOpenArtist={openArtist}
                  onOpenShow={openShow}
                  currentContextUri={currentContextUri}
                  onSaveLibrary={() => void saveLibrary()}
                  savingLibrary={savingLibrary}
                />
              </div>
            )}
          </main>

          {queueOpen && (
            <QueuePanel
              api={api}
              currentUri={currentUri}
              isPaused={isPaused}
              onPlayTracks={playTracks}
              onTogglePlay={player.togglePlay}
              onClose={() => setQueueOpen(false)}
            />
          )}

          <NowPlayingBar
            {...player}
            queueOpen={queueOpen}
            onOpenQueue={() => setQueueOpen((open) => !open)}
            devicesOpen={devicesOpen}
            onOpenDevices={() => setDevicesOpen((open) => !open)}
            onOpenFullScreen={(lyrics) => setFullScreen({ lyrics })}
            devicesPopover={
              devicesOpen && (
                <DevicePicker
                  api={api}
                  ownDeviceId={player.deviceId}
                  onPick={(id) => void player.transferTo(id)}
                  onClose={() => setDevicesOpen(false)}
                />
              )
            }
          />
          {fullScreen && <NowPlayingView {...player} showLyrics={fullScreen.lyrics} onClose={closeFullScreen} />}
          {notice && <Toast message={notice} />}
        </div>
      </NavigationContext.Provider>
    </LibraryContext.Provider>
  )
}

/** A podcast episode, in the shape the player plays (its show stands in for artist and album). */
function episodeAsTrack(e: Episode, show?: Show): Track {
  const from = e.show ?? show
  return {
    id: e.id,
    uri: e.uri,
    name: e.name,
    artists: [{ id: '', name: from?.name ?? '' }],
    album: { id: '', name: from?.name ?? '', images: e.images.length > 0 ? e.images : (from?.images ?? []) },
    duration_ms: e.duration_ms,
    explicit: Boolean(e.explicit),
    external_urls: e.external_urls ?? {},
  }
}
