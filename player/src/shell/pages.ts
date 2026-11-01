import type { Album, Artist, Playlist, Show } from '../spotify/api'

export type Tab = 'home' | 'search' | 'library'

/** Detail pages open on top of a tab, and stack: Home → artist → album, then Back, Back. */
export type Page =
  | { kind: 'artist'; artist: Artist }
  | { kind: 'album'; album: Album }
  | { kind: 'playlist'; playlist: Playlist; editOnOpen?: boolean }
  | { kind: 'show'; show: Show }
  | { kind: 'liked' }
