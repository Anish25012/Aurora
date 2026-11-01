import { createContext, useContext } from 'react'
import type { Track } from './spotify/api'

export interface ArtistRef {
  id: string
  name: string
}

export interface AlbumRef {
  id: string
  name: string
  images: { url: string; width: number | null }[]
}

export interface Navigation {
  openArtist: (artist: ArtistRef) => void
  openAlbum: (album: AlbumRef) => void
  /** Song actions for right-click menus. */
  addToQueue?: (track: Track) => void
  /** Start loading a page before it's opened (on hover), so it appears instantly. */
  prefetchArtist?: (artist: ArtistRef) => void
  prefetchAlbum?: (album: { id: string }) => void
  prefetchPlaylist?: (playlist: { id: string }) => void
  prefetchShow?: (show: { id: string }) => void
  /** Playlists you can add songs to (your own). */
  editablePlaylists?: () => Promise<{ id: string; name: string }[]>
  addToPlaylist?: (playlist: { id: string; name: string }, track: { uri: string; name: string }) => void
  /** Make a new playlist containing this song, and open it. */
  newPlaylistWith?: (track: { uri: string; name: string }) => void
  /** Play songs like this one (needs Last.fm). */
  startRadio?: (track: Track) => void
}

/**
 * In-app navigation for anything that shows an artist or album name (song
 * rows, the player bar...). Clicking a name opens that page inside Aurora,
 * instead of sending you out to Spotify.
 *
 * It's a context rather than props so every list and bar can use it without
 * threading callbacks through each page. Without a provider (e.g. in isolated
 * tests or the demo), names render as plain text.
 */
export const NavigationContext = createContext<Navigation | null>(null)

export function useNavigation(): Navigation | null {
  return useContext(NavigationContext)
}
