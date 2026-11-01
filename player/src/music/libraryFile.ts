// Aurora's own music library: everything you like, in a file that belongs to
// you (not to a streaming service). It describes songs (title, artists, album,
// length, ISRC), not audio: the audio is found separately when you press play.
//
// Version 1 was made by exporting a Spotify library once (see
// spotify/exportLibrary.ts). Spotify ids are kept only as a reference.

export const LIBRARY_VERSION = 1

export interface LibraryTrack {
  /** Aurora's id for the song (stable across exports). */
  id: string
  title: string
  artists: string[]
  album: string
  durationMs: number
  /** The recording's industry code: the most reliable way to match it anywhere. */
  isrc: string | null
  trackNumber: number | null
  imageUrl: string | null
  explicit: boolean
  spotifyId: string | null
}

export interface LibraryPlaylist {
  id: string
  name: string
  description: string
  imageUrl: string | null
  /** Made by you (rather than followed). */
  own: boolean
  trackIds: string[]
  /** Its songs couldn't be read (Spotify only shares playlists you own). */
  incomplete: boolean
}

export interface LibraryAlbum {
  id: string
  name: string
  artists: string[]
  imageUrl: string | null
  releaseDate: string
  trackIds: string[]
}

export interface LibraryArtist {
  id: string
  name: string
  imageUrl: string | null
}

export interface AuroraLibrary {
  version: typeof LIBRARY_VERSION
  exportedAt: string
  /** Every song referenced below, by id. */
  tracks: Record<string, LibraryTrack>
  /** Liked songs, newest first. */
  liked: { trackId: string; addedAt: string | null }[]
  playlists: LibraryPlaylist[]
  albums: LibraryAlbum[]
  artists: LibraryArtist[]
}

/** Largest image's URL, or null. */
export function biggestImage(images: { url: string; width: number | null }[] | null | undefined): string | null {
  if (!images || images.length === 0) return null
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0].url
}
