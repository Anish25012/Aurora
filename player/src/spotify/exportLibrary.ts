import { type AuroraLibrary, biggestImage, LIBRARY_VERSION, type LibraryTrack } from '../music/libraryFile'
import type { SpotifyApi, Track } from './api'

type ExportApi = Pick<
  SpotifyApi,
  'likedSongs' | 'allMyPlaylists' | 'playlistTracks' | 'allSavedAlbums' | 'getAlbum' | 'followedArtists' | 'me'
>

/**
 * Copies your Spotify library into Aurora's own format (music/libraryFile.ts):
 * liked songs, playlists with their songs, saved albums with their track
 * lists, and followed artists. One request at a time, so it stays well within
 * Spotify's rate limits; `onProgress` reports what it's doing.
 */
export async function exportSpotifyLibrary(
  api: ExportApi,
  onProgress: (message: string) => void = () => {},
): Promise<AuroraLibrary> {
  const tracks: Record<string, LibraryTrack> = {}
  // Full track objects (liked songs, playlists) carry the ISRC; album listings
  // don't, so a song seen both ways keeps the richer copy.
  const add = (t: Track): string => {
    const id = `sp:${t.id}`
    const existing = tracks[id]
    tracks[id] = {
      id,
      title: t.name,
      artists: t.artists.map((a) => a.name),
      album: t.album.name,
      durationMs: t.duration_ms,
      isrc: t.external_ids?.isrc ?? existing?.isrc ?? null,
      trackNumber: t.track_number ?? existing?.trackNumber ?? null,
      imageUrl: biggestImage(t.album.images) ?? existing?.imageUrl ?? null,
      explicit: t.explicit,
      spotifyId: t.id,
    }
    return id
  }

  const liked: AuroraLibrary['liked'] = []
  for (let offset: number | null = 0; offset !== null;) {
    const page = await api.likedSongs(offset, 50)
    for (const t of page.tracks) liked.push({ trackId: add(t), addedAt: null })
    onProgress(`Liked songs: ${liked.length} of ${page.total}`)
    offset = page.nextOffset
  }

  const me = await api.me()
  const playlists: AuroraLibrary['playlists'] = []
  const allPlaylists = await api.allMyPlaylists()
  for (const [i, p] of allPlaylists.entries()) {
    onProgress(`Playlists: ${i + 1} of ${allPlaylists.length} (${p.name})`)
    const { tracks: songs, restricted } = await api.playlistTracks(p.id, 10_000)
    playlists.push({
      id: `sp:${p.id}`,
      name: p.name,
      description: p.description ?? '',
      imageUrl: biggestImage(p.images),
      own: p.owner.id === me.id,
      trackIds: songs.map(add),
      incomplete: restricted,
    })
  }

  const albums: AuroraLibrary['albums'] = []
  const savedAlbums = await api.allSavedAlbums()
  for (const [i, a] of savedAlbums.entries()) {
    onProgress(`Albums: ${i + 1} of ${savedAlbums.length} (${a.name})`)
    const detail = await api.getAlbum(a.id)
    albums.push({
      id: `sp:${a.id}`,
      name: detail.name,
      artists: detail.artists.map((x) => x.name),
      imageUrl: biggestImage(detail.images),
      releaseDate: detail.release_date,
      trackIds: detail.tracks.map(add),
    })
  }

  onProgress('Artists you follow')
  const artists = (await api.followedArtists(1000)).map((a) => ({
    id: `sp:${a.id}`,
    name: a.name,
    imageUrl: biggestImage(a.images),
  }))

  return { version: LIBRARY_VERSION, exportedAt: new Date().toISOString(), tracks, liked, playlists, albums, artists }
}

/** Hands the library to the browser as a file download (aurora-library.json). */
export function downloadLibrary(library: AuroraLibrary): void {
  const blob = new Blob([JSON.stringify(library, null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'aurora-library.json'
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
