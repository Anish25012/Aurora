import { AlbumView } from '../components/AlbumView'
import { ArtistView } from '../components/ArtistView'
import { LikedSongsView } from '../components/LikedSongsView'
import { PlaylistView } from '../components/PlaylistView'
import { ShowView } from '../components/ShowView'
import type { PlayerControls } from '../player/usePlayer'
import type { Album, Artist, Episode, Show, SpotifyApi, Track } from '../spotify/api'
import type { Page } from './pages'
import type { Discovery } from './useDiscovery'

interface Props {
  page: Page
  api: SpotifyApi
  player: PlayerControls
  discovery: Discovery | null
  /** Who's signed in, so their own playlists can be edited. */
  meId: string | null
  playTracks: (tracks: Track[], index: number) => void
  playEpisode: (episode: Episode, show?: Show, after?: Episode[]) => void
  openAlbum: (album: Album) => void
  openArtist: (artist: Artist | { id: string; name: string }) => void
  onBack: () => void
}

/** The detail page on top of the stack: an artist, album, playlist, podcast or Liked Songs. */
export function PageStack({
  page,
  api,
  player,
  discovery,
  meId,
  playTracks,
  playEpisode,
  openAlbum,
  openArtist,
  onBack,
}: Props) {
  // Includes what was just clicked, before Spotify confirms, so play buttons flip to pause instantly.
  const playing = {
    currentUri: player.currentUri,
    currentContextUri: player.currentContextUri,
    isPaused: !player.isPlaying,
    onTogglePlay: player.togglePlay,
  }

  switch (page.kind) {
    case 'artist':
      return (
        <ArtistView
          artist={page.artist}
          api={api}
          {...playing}
          onPlayTracks={playTracks}
          onOpenAlbum={openAlbum}
          onOpenArtist={openArtist}
          onStartRadio={discovery?.artistRadio}
          similarArtists={discovery?.similarArtists}
          onBack={onBack}
        />
      )
    case 'album':
      return (
        <AlbumView
          album={page.album}
          api={api}
          {...playing}
          onPlayAlbum={(uri, startUri) => void player.playContext(uri, startUri)}
          onOpenArtist={openArtist}
          onBack={onBack}
        />
      )
    case 'liked':
      return <LikedSongsView api={api} {...playing} onPlayTracks={playTracks} onBack={onBack} />
    case 'playlist':
      return (
        <PlaylistView
          key={page.playlist.id}
          playlist={page.playlist}
          editable={meId !== null && page.playlist.owner.id === meId}
          editOnOpen={page.editOnOpen}
          onNotify={player.notify}
          api={api}
          {...playing}
          onPlayPlaylist={(uri, startUri) => void player.playContext(uri, startUri)}
          onBack={onBack}
        />
      )
    case 'show':
      return (
        <ShowView
          key={page.show.id}
          show={page.show}
          api={api}
          {...playing}
          onPlayEpisode={playEpisode}
          onBack={onBack}
        />
      )
  }
}
