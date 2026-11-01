import { appCache, keys, useCached } from '../lib/cache'
import type { Playlist, SpotifyApi } from '../spotify/api'

/** Adding to, and creating, your own playlists. */
export function usePlaylistActions(
  api: SpotifyApi,
  notify: (message: string) => void,
  /** Open a playlist that was just created, ready to edit its details. */
  onCreated: (playlist: Playlist) => void,
) {
  // Who's signed in: playlists they own get Edit, reorder and remove.
  const meLoad = useCached(keys.me(), () => api.me(), 60 * 60_000)
  const meId = meLoad.status === 'ready' ? meLoad.data.id : null

  const editablePlaylists = async () => {
    const [me, all] = await Promise.all([
      appCache.get(keys.me(), () => api.me(), 60 * 60_000),
      appCache.get(keys.library('playlists'), () => api.myPlaylists(50)),
    ])
    return all.filter((p) => p.owner.id === me.id)
  }
  const playlistsChanged = (playlistId?: string) => {
    appCache.invalidate('library') // Library and the right-click menu list
    if (playlistId) appCache.invalidate(keys.playlist(playlistId)) // its page reloads
  }
  const addToPlaylist = (playlist: { id: string; name: string }, track: { uri: string; name: string }) =>
    void api.addToPlaylist(playlist.id, [track.uri]).then(
      () => {
        notify(`Added “${track.name}” to ${playlist.name}`)
        playlistsChanged(playlist.id)
      },
      () => notify(`Couldn't add that to ${playlist.name}.`),
    )
  // Like Spotify: a new playlist is called "My Playlist #n", and opens with
  // its details ready to edit.
  const createPlaylist = async (withTrack?: { uri: string; name: string }) => {
    try {
      const owned = await editablePlaylists().catch(() => [])
      const created = await api.createPlaylist(`My Playlist #${owned.length + 1}`)
      if (withTrack) await api.addToPlaylist(created.id, [withTrack.uri])
      playlistsChanged()
      onCreated(created)
    } catch {
      notify("Couldn't create a playlist.")
    }
  }

  return { meId, editablePlaylists, addToPlaylist, createPlaylist }
}
