import { appCache, keys } from '../lib/cache'
import type { ArtistRef } from '../navigation'
import type { SpotifyApi } from '../spotify/api'

/**
 * Loading pages ahead of time (on hover), through the same cache keys and
 * loaders the pages use, so a click usually finds the data already there.
 */
export function makePrefetchers(api: SpotifyApi) {
  const quietly = (p: Promise<unknown>) => void p.catch(() => {}) // the page will retry and show any error
  return {
    prefetchArtist: (a: ArtistRef) => {
      quietly(appCache.get(keys.artistTop(a.id), () => api.artistTopTracks(a, 5)))
      quietly(appCache.get(keys.artistDiscography(a.id), () => api.artistDiscography(a.id)))
    },
    prefetchAlbum: (album: { id: string }) => quietly(appCache.get(keys.album(album.id), () => api.getAlbum(album.id))),
    prefetchShow: (show: { id: string }) => quietly(appCache.get(keys.show(show.id), () => api.getShow(show.id))),
    prefetchPlaylist: (playlist: { id: string }) =>
      quietly(appCache.get(keys.playlist(playlist.id), () => api.playlistTracks(playlist.id))),
  }
}
