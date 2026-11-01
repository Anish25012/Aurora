// Last.fm: "people who listen to X also listen to Y". Spotify removed its own
// recommendations and related artists for apps like this one, so Aurora asks
// Last.fm who's similar, then finds those songs on Spotify to play them.
// Free for non-commercial use; data credited to Last.fm wherever it shows.

const BASE = 'https://ws.audioscrobbler.com/2.0/'

export interface SimilarTrack {
  name: string
  artist: string
}

export function createLastfm(apiKey: string, fetchFn: typeof fetch = (...a) => fetch(...a)) {
  async function call<T>(method: string, params: Record<string, string>): Promise<T | null> {
    const query = new URLSearchParams({ method, ...params, api_key: apiKey, format: 'json', autocorrect: '1' })
    const res = await fetchFn(`${BASE}?${query}`)
    const data = (await res.json().catch(() => null)) as (T & { error?: number; message?: string }) | null
    // Error 6: Last.fm doesn't know that artist or song. Not a failure, just nothing similar.
    if (data?.error === 6) return null
    if (!res.ok || !data || data.error) throw new Error(data?.message ?? "Couldn't reach Last.fm.")
    return data
  }

  return {
    /** Names of artists similar to `artist`, most similar first. */
    async similarArtists(artist: string, limit = 30): Promise<string[]> {
      const data = await call<{ similarartists?: { artist: { name: string }[] } }>('artist.getsimilar', {
        artist,
        limit: String(limit),
      })
      return (data?.similarartists?.artist ?? []).map((a) => a.name)
    },

    /** Songs similar to `track` by `artist`, most similar first. */
    async similarTracks(artist: string, track: string, limit = 60): Promise<SimilarTrack[]> {
      const data = await call<{ similartracks?: { track: { name: string; artist: { name: string } }[] } }>(
        'track.getsimilar',
        { artist, track, limit: String(limit) },
      )
      return (data?.similartracks?.track ?? []).map((t) => ({ name: t.name, artist: t.artist.name }))
    },
  }
}

export type Lastfm = ReturnType<typeof createLastfm>
