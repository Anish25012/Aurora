import type { Lastfm } from '../discovery/lastfm'
import { artistRadio, discoverWeekly, mapLimit, songRadio, weekNumber } from '../discovery/mixes'
import { appCache, keys } from '../lib/cache'
import type { PlayerControls } from '../player/usePlayer'
import type { Artist, SpotifyApi, Track } from '../spotify/api'

export type Discovery = ReturnType<typeof makeDiscovery>

/**
 * Discovery (Last.fm): radio, Daily Mixes, Discover Weekly, Fans also like.
 * Null without a Last.fm key, which hides all of it. A mix is made when you
 * press play, then kept for the session, so pressing it again starts instantly.
 */
export function useDiscovery(
  api: SpotifyApi,
  lastfm: Lastfm | null,
  player: Pick<PlayerControls, 'notify' | 'playTracks'>,
) {
  return lastfm && makeDiscovery(api, lastfm, player)
}

function makeDiscovery(api: SpotifyApi, lastfm: Lastfm, player: Pick<PlayerControls, 'notify' | 'playTracks'>) {
  const playMix = async (id: string, title: string, build: () => Promise<Track[]>) => {
    if (!appCache.peek(keys.mix(id))) player.notify(`Making ${title}…`)
    try {
      const tracks = await appCache.get(keys.mix(id), build, 6 * 60 * 60_000)
      if (tracks.length === 0) {
        appCache.invalidate(keys.mix(id))
        player.notify(`Couldn't find songs for ${title}.`)
      } else void player.playTracks(tracks)
    } catch {
      appCache.invalidate(keys.mix(id))
      player.notify(`Couldn't make ${title} right now.`)
    }
  }

  return {
    songRadio: (track: Track) =>
      void playMix(`song:${track.uri}`, `${track.name} radio`, () => songRadio(track, api, lastfm)),
    artistRadio: (artist: Artist) =>
      void playMix(`artist:${artist.id}`, `${artist.name} radio`, () => artistRadio(artist, api, lastfm)),
    dailyMix: (artist: Artist, i: number) =>
      void playMix(`daily:${artist.id}`, `Daily Mix ${i + 1}`, () =>
        artistRadio(artist, api, lastfm, 40, weekNumber() + i),
      ),
    discoverWeekly: () =>
      void playMix(`weekly:${weekNumber()}`, 'Discover Weekly', async () => {
        const [favourites, older, followed] = await Promise.all([
          api.topArtists('medium_term', 12),
          api.topArtists('long_term', 30).catch((): Artist[] => []),
          api.followedArtists(200).catch((): Artist[] => []),
        ])
        const known = new Set([...favourites, ...older, ...followed].map((a) => a.name.toLowerCase()))
        return discoverWeekly(favourites, known, api, lastfm)
      }),
    similarArtists: async (artist: Artist) => {
      const names = (await lastfm.similarArtists(artist.name, 16)).slice(0, 10)
      const found = await mapLimit(names, 4, (name) => api.findArtist(name))
      return found.filter((a): a is Artist => a !== null && a.id !== artist.id)
    },
  }
}
