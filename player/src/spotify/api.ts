/**
 * A small, typed client for the Spotify Web API endpoints Aurora uses.
 *
 * Note (Feb 2026): new Development Mode apps get at most 10 search results per
 * request, and several endpoints (recommendations, batch lookups, browse) are
 * gone. Everything here is on the still-available list.
 */

const API_BASE = 'https://api.spotify.com/v1'
export const SEARCH_MAX_LIMIT = 10
// The library endpoints take at most 40 URIs per request.
const LIBRARY_BATCH = 40

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface Track {
  id: string
  uri: string
  name: string
  artists: { id: string; name: string }[]
  album: { id: string; name: string; images: Image[] }
  duration_ms: number
  explicit: boolean
  external_urls: { spotify?: string }
  /** Position on its album (present on album track listings). */
  track_number?: number
  /** The recording's industry code (ISRC), on full track objects: the same on every service. */
  external_ids?: { isrc?: string }
}

export interface Image {
  url: string
  width: number | null
}

export interface Artist {
  id: string
  uri: string
  name: string
  images: Image[]
}

export interface Album {
  id: string
  uri: string
  name: string
  images: Image[]
  release_date: string
  album_type: 'album' | 'single' | 'compilation'
  total_tracks: number
  artists?: { id: string; name: string }[]
}

/** An album with its full track list (for the album page). */
export interface AlbumDetail extends Album {
  artists: { id: string; name: string }[]
  tracks: Track[]
}

/** "Song (Remastered 2011)" and "Song - 2019 Remaster" are the same song for a top-5 list. */
export function songKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*[-([].*(remaster|version|edit|mix|live|mono|stereo|deluxe).*$/i, '')
    .trim()
}

export interface Playlist {
  id: string
  uri: string
  name: string
  description: string | null
  images: Image[] | null
  owner: { id?: string; display_name?: string }
}

/** A podcast. */
export interface Show {
  id: string
  uri: string
  name: string
  publisher: string
  description?: string
  images: Image[]
  total_episodes?: number
  external_urls?: { spotify?: string }
}

/** One podcast episode. `resume_point` says how far you got. */
export interface Episode {
  id: string
  uri: string
  name: string
  description: string
  release_date: string
  duration_ms: number
  images: Image[]
  explicit?: boolean
  resume_point?: { fully_played: boolean; resume_position_ms: number }
  /** Present in search results and saved episodes, not in a show's own listing. */
  show?: { id: string; name: string; publisher?: string; images: Image[] }
  external_urls?: { spotify?: string }
}

export interface ShowDetail extends Show {
  episodes: Episode[]
  /** How many episodes there are in all (the first page is in `episodes`). */
  totalEpisodes: number
}

/** Everything a search found, grouped by kind. */
export interface SearchResults {
  tracks: Track[]
  artists: Artist[]
  albums: Album[]
  playlists: Playlist[]
  shows: Show[]
  episodes: Episode[]
}

export type TimeRange = 'short_term' | 'medium_term' | 'long_term'

export type RepeatMode = 'off' | 'context' | 'track'

export interface Device {
  id: string | null
  name: string
  type: string // 'Computer' | 'Smartphone' | 'Speaker' | ...
  is_active: boolean
  is_restricted: boolean
  volume_percent: number | null
}

/** What's playing on whichever device is active (used when that isn't Aurora). */
export interface RemotePlayback {
  device: Device
  is_playing: boolean
  progress_ms: number | null
  shuffle_state: boolean
  repeat_state: RepeatMode
  item: Track | null
  context: { uri: string } | null
}

/** An error with a message that makes sense to the person using the app. */
export class SpotifyApiError extends Error {
  readonly status: number
  readonly reason?: string

  constructor(status: number, message: string, reason?: string) {
    super(message)
    this.name = 'SpotifyApiError'
    this.status = status
    this.reason = reason
  }
}

export function friendlyMessage(status: number, apiMessage: string, reason?: string): string {
  if (reason === 'PREMIUM_REQUIRED' || /premium/i.test(apiMessage)) {
    return 'Playing music needs Spotify Premium.'
  }
  if (status === 401) return 'Your Spotify session expired. Please log in again.'
  if (status === 403) {
    return 'Spotify refused that. Check that your account is listed under User Management in the Spotify Developer Dashboard.'
  }
  if (status === 404) return "Spotify couldn't find that, or the player isn't ready yet."
  if (status === 429) return 'Spotify is rate limiting requests. Wait a moment and try again.'
  if (status >= 500) return 'Spotify is having problems right now. Try again shortly.'
  return apiMessage || `Spotify error ${status}`
}

interface ApiDeps {
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string>
  fetchFn?: typeof fetch
}

export function createSpotifyApi({ getAccessToken, fetchFn }: ApiDeps) {
  const doFetch = fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T | null> {
    const token = await getAccessToken({ forceRefresh: retried })
    const response = await doFetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
    })
    // A 401 can happen if the token was revoked or expired early. Refresh once
    // and retry. Twice in a row means the session really is gone.
    if (response.status === 401 && !retried) return request<T>(path, init, true)
    if (response.status === 204 || response.status === 202) return null
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      // Some failures (e.g. gateway errors) come back as HTML, not JSON.
    }
    if (!response.ok) {
      const err = data?.error ?? {}
      throw new SpotifyApiError(
        response.status,
        friendlyMessage(response.status, err.message ?? '', err.reason),
        err.reason,
      )
    }
    return data as T
  }

  return {
    async searchTracks(query: string, limit = SEARCH_MAX_LIMIT): Promise<Track[]> {
      const params = new URLSearchParams({ q: query, type: 'track', limit: String(Math.min(limit, SEARCH_MAX_LIMIT)) })
      const data = await request<{ tracks?: { items: (Track | null)[] } }>(`/search?${params}`)
      // Search results can contain null entries; drop them.
      return (data?.tracks?.items ?? []).filter((t): t is Track => t !== null)
    },

    /**
     * Search every kind at once: songs, artists, albums, playlists and podcasts.
     * One request; Spotify caps each kind at 10 for apps like this one.
     */
    async searchAll(query: string): Promise<SearchResults> {
      const params = new URLSearchParams({
        q: query,
        type: 'track,artist,album,playlist,show,episode',
        limit: String(SEARCH_MAX_LIMIT),
        market: 'from_token', // podcasts only come back with a market
      })
      type Page<T> = { items: (T | null)[] } | undefined
      const data = await request<{
        tracks?: Page<Track>
        artists?: Page<Artist>
        albums?: Page<Album>
        playlists?: Page<Playlist>
        shows?: Page<Show>
        episodes?: Page<Episode>
      }>(`/search?${params}`)
      const items = <T>(page: Page<T>) => (page?.items ?? []).filter((x): x is T => x !== null)
      return {
        tracks: items(data?.tracks),
        artists: items(data?.artists),
        albums: items(data?.albums),
        playlists: items(data?.playlists),
        shows: items(data?.shows),
        episodes: items(data?.episodes),
      }
    },

    /** The Spotify artist with this name (for names that come from elsewhere, like Last.fm). */
    async findArtist(name: string): Promise<Artist | null> {
      const params = new URLSearchParams({ q: name, type: 'artist', limit: '5' })
      const data = await request<{ artists?: { items: (Artist | null)[] } }>(`/search?${params}`)
      const found = (data?.artists?.items ?? []).filter((a): a is Artist => a !== null)
      return found.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? found[0] ?? null
    },

    /** The Spotify song with this title by this artist, if there is one. */
    async findTrack(name: string, artist: string): Promise<Track | null> {
      const clean = (s: string) => s.replace(/"/g, '')
      const params = new URLSearchParams({
        q: `track:"${clean(name)}" artist:"${clean(artist)}"`,
        type: 'track',
        limit: '3',
      })
      const data = await request<{ tracks?: { items: (Track | null)[] } }>(`/search?${params}`)
      const found = (data?.tracks?.items ?? []).filter((t): t is Track => t !== null)
      const wanted = artist.toLowerCase()
      return found.find((t) => t.artists.some((a) => a.name.toLowerCase() === wanted)) ?? null
    },

    /** Recently played tracks, newest first, with repeats removed. */
    async recentlyPlayed(limit = 20): Promise<Track[]> {
      const data = await request<{ items: { track: Track | null }[] }>(`/me/player/recently-played?limit=${limit}`)
      const seen = new Set<string>()
      const tracks: Track[] = []
      for (const item of data?.items ?? []) {
        // People replay songs, but "Jump back in" should show each one once.
        if (item.track && !seen.has(item.track.id)) {
          seen.add(item.track.id)
          tracks.push(item.track)
        }
      }
      return tracks
    },

    async topTracks(timeRange: TimeRange = 'short_term', limit = 12): Promise<Track[]> {
      const data = await request<{ items: Track[] }>(`/me/top/tracks?time_range=${timeRange}&limit=${limit}`)
      return data?.items ?? []
    },

    async topArtists(timeRange: TimeRange = 'medium_term', limit = 12): Promise<Artist[]> {
      const data = await request<{ items: Artist[] }>(`/me/top/artists?time_range=${timeRange}&limit=${limit}`)
      return data?.items ?? []
    },

    async myPlaylists(limit = 20): Promise<Playlist[]> {
      const data = await request<{ items: (Playlist | null)[] }>(`/me/playlists?limit=${limit}`)
      return (data?.items ?? []).filter((p): p is Playlist => p !== null)
    },

    /**
     * An artist's most popular songs.
     *
     * Spotify removed GET /artists/{id}/top-tracks for new apps (Feb 2026), so
     * this asks search for the artist's tracks instead. Search ranks by
     * popularity, so the first results are almost always their biggest songs.
     * We keep only tracks the artist is actually credited on (search also
     * matches similarly named artists), and drop repeats like remasters.
     */
    async artistTopTracks(artist: { id?: string; name: string }, count = 5): Promise<Track[]> {
      const q = `artist:"${artist.name.replace(/"/g, '')}"`
      const params = new URLSearchParams({ q, type: 'track', limit: String(SEARCH_MAX_LIMIT) })
      const data = await request<{ tracks?: { items: (Track | null)[] } }>(`/search?${params}`)
      const seen = new Set<string>()
      const top: Track[] = []
      for (const track of data?.tracks?.items ?? []) {
        // By id when we have one; by name for artists named elsewhere (Last.fm).
        const credited = (a: { id: string; name: string }) =>
          artist.id ? a.id === artist.id : a.name.toLowerCase() === artist.name.toLowerCase()
        if (!track || !track.artists.some(credited)) continue
        const key = songKey(track.name)
        if (seen.has(key)) continue
        seen.add(key)
        top.push(track)
        if (top.length === count) break
      }
      return top
    },

    /**
     * More of an artist's songs, a few search pages at a time ("Show more").
     *
     * Search returns at most 10 results per request for new apps, so this
     * fetches `pages` pages in parallel from `offset`. Like artistTopTracks, it
     * keeps only songs the artist is credited on. `nextOffset` is null once
     * Spotify has no more results. Callers drop songs they already show.
     */
    async artistSongs(
      artist: { id: string; name: string },
      offset = 0,
      pages = 3,
    ): Promise<{ tracks: Track[]; nextOffset: number | null }> {
      const q = `artist:"${artist.name.replace(/"/g, '')}"`
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) => {
          const params = new URLSearchParams({
            q,
            type: 'track',
            limit: String(SEARCH_MAX_LIMIT),
            offset: String(offset + i * SEARCH_MAX_LIMIT),
          })
          return request<{ tracks?: { items: (Track | null)[]; next: string | null } }>(`/search?${params}`)
        }),
      )
      const tracks = results
        .flatMap((r) => r?.tracks?.items ?? [])
        .filter((t): t is Track => t !== null && t.artists.some((a) => a.id === artist.id))
      const last = results.at(-1)?.tracks
      const more = Boolean(last?.next) && (last?.items.length ?? 0) === SEARCH_MAX_LIMIT
      return { tracks, nextOffset: more ? offset + pages * SEARCH_MAX_LIMIT : null }
    },

    /**
     * An artist's complete discography: albums, singles/EPs and compilations,
     * newest first, without duplicate editions.
     *
     * Spotify caps this endpoint at 10 results per request for new apps, so we
     * read the first page to learn the total, then fetch the remaining pages a
     * few at a time (all at once could trip the rate limit for big catalogues).
     */
    async artistDiscography(artistId: string, maxReleases = 300): Promise<Album[]> {
      const PAGE = 10
      const CONCURRENCY = 3
      const path = (offset: number) => {
        const params = new URLSearchParams({
          include_groups: 'album,single,compilation',
          limit: String(PAGE),
          offset: String(offset),
        })
        return `/artists/${encodeURIComponent(artistId)}/albums?${params}`
      }
      type Page = { items: (Album | null)[]; total: number }

      const first = await request<Page>(path(0))
      const total = Math.min(first?.total ?? 0, maxReleases)
      const pages: Page[] = first ? [first] : []
      const offsets: number[] = []
      for (let offset = PAGE; offset < total; offset += PAGE) offsets.push(offset)
      for (let i = 0; i < offsets.length; i += CONCURRENCY) {
        const batch = await Promise.all(offsets.slice(i, i + CONCURRENCY).map((o) => request<Page>(path(o))))
        pages.push(...batch.filter((p): p is Page => p !== null))
      }

      const seen = new Set<string>()
      return pages
        .flatMap((p) => p.items)
        .filter((album): album is Album => {
          if (!album) return false
          // e.g. the explicit and clean editions of one album
          const key = `${album.album_type}:${album.name.toLowerCase()}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .sort((a, b) => b.release_date.localeCompare(a.release_date))
    },

    /** Play an album, artist or playlist on our device. */
    async playContext(deviceId: string, contextUri: string, startUri?: string, positionMs?: number): Promise<void> {
      // Starting *within* the album/playlist (offset), rather than playing a
      // list of songs, means Next continues through the album in order and
      // Spotify reports the album as what's playing.
      const body: Record<string, unknown> = { context_uri: contextUri }
      if (startUri) body.offset = { uri: startUri }
      if (positionMs) body.position_ms = positionMs // e.g. carry on a podcast where you left off
      await request(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    },

    /** One album with its tracks. Album track listings omit each track's album, so we add it back. */
    async getAlbum(albumId: string): Promise<AlbumDetail> {
      type RawAlbum = Omit<AlbumDetail, 'tracks'> & { tracks: { items: (Omit<Track, 'album'> | null)[] } }
      const raw = await request<RawAlbum>(`/albums/${encodeURIComponent(albumId)}`)
      if (!raw) throw new SpotifyApiError(404, "Spotify couldn't find that album.")
      const { tracks, ...album } = raw
      const albumRef = { id: album.id, name: album.name, images: album.images }
      return {
        ...album,
        tracks: (tracks?.items ?? [])
          .filter((t): t is Omit<Track, 'album'> => t !== null)
          .map((t) => ({ ...t, album: albumRef })),
      }
    },

    /**
     * The songs in a playlist, in playlist order (up to `max`).
     *
     * Since Feb 2026, Spotify only returns the contents of playlists the user
     * owns or collaborates on; for anything else it returns no items. We report
     * that as `restricted`, so the page can explain it (the playlist can still be
     * played as a whole). Podcast episodes and local files are skipped.
     */
    /**
     * A playlist's songs, `max` at a time from `start` (pass the previous
     * `nextOffset` to carry on). `nextOffset` is null at the end.
     */
    async playlistTracks(
      playlistId: string,
      max = 100,
      start = 0,
    ): Promise<{ tracks: Track[]; total: number; restricted: boolean; nextOffset: number | null }> {
      type Entry = { item?: Track | null; track?: Track | null }
      const tracks: Track[] = []
      let total = 0
      let offset = start
      let more = false
      for (;;) {
        let page: { items: (Entry | null)[]; total: number; next: string | null } | null
        try {
          page = await request(`/playlists/${encodeURIComponent(playlistId)}/items?limit=50&offset=${offset}`)
        } catch (err) {
          if (err instanceof SpotifyApiError && (err.status === 403 || err.status === 404)) {
            return { tracks: [], total: 0, restricted: true, nextOffset: null }
          }
          throw err
        }
        total = page?.total ?? 0
        for (const entry of page?.items ?? []) {
          // Feb 2026 renamed each entry's `track` to `item`; accept either.
          const t = entry?.item ?? entry?.track
          if (t && t.id && (t as { type?: string }).type !== 'episode') tracks.push(t)
        }
        offset += 50
        more = Boolean(page?.next)
        if (!more || tracks.length >= max) break
      }
      return {
        tracks,
        total,
        restricted: start === 0 && total > 0 && tracks.length === 0,
        nextOffset: more ? offset : null,
      }
    },

    // ------------------------------------------------------------- library
    // Since Feb 2026 one set of endpoints covers everything in "Your Library":
    // liked songs, saved albums, followed artists... identified by Spotify URI,
    // at most 40 per request.

    /** Save (like / follow) items. */
    async saveToLibrary(uris: string[]): Promise<void> {
      for (const batch of chunks(uris, LIBRARY_BATCH)) {
        await request(`/me/library?${new URLSearchParams({ uris: batch.join(',') })}`, { method: 'PUT' })
      }
    },

    /** Remove (unlike / unfollow) items. */
    async removeFromLibrary(uris: string[]): Promise<void> {
      for (const batch of chunks(uris, LIBRARY_BATCH)) {
        await request(`/me/library?${new URLSearchParams({ uris: batch.join(',') })}`, { method: 'DELETE' })
      }
    },

    /** For each URI: is it in the library (liked / saved / followed)? */
    async libraryContains(uris: string[]): Promise<boolean[]> {
      const results: boolean[] = []
      for (const batch of chunks(uris, LIBRARY_BATCH)) {
        const data = await request<boolean[]>(`/me/library/contains?${new URLSearchParams({ uris: batch.join(',') })}`)
        results.push(...(data ?? batch.map(() => false)))
      }
      return results
    },

    /** Liked Songs, newest first, a page at a time. */
    async likedSongs(offset = 0, limit = 50): Promise<{ tracks: Track[]; total: number; nextOffset: number | null }> {
      const data = await request<{ items: { track: Track | null }[]; total: number; next: string | null }>(
        `/me/tracks?limit=${limit}&offset=${offset}`,
      )
      return {
        tracks: (data?.items ?? []).map((i) => i.track).filter((t): t is Track => t !== null && Boolean(t.id)),
        total: data?.total ?? 0,
        nextOffset: data?.next ? offset + limit : null,
      }
    },

    /** Every artist the user follows (cursor-paged, 50 at a time). */
    async followedArtists(max = 500): Promise<Artist[]> {
      const artists: Artist[] = []
      let after: string | null = null
      do {
        const params = new URLSearchParams({ type: 'artist', limit: '50' })
        if (after) params.set('after', after)
        const data: { artists: { items: Artist[]; cursors: { after: string | null } } } | null = await request(
          `/me/following?${params}`,
        )
        artists.push(...(data?.artists.items ?? []))
        after = data?.artists.cursors.after ?? null
      } while (after && artists.length < max)
      return artists
    },

    // ----------------------------------------------------------- playlists

    /** The signed-in user (for knowing which playlists are theirs to edit). */
    async me(): Promise<{ id: string; display_name: string | null }> {
      const data = await request<{ id: string; display_name: string | null }>('/me')
      if (!data) throw new SpotifyApiError(404, "Couldn't load your Spotify profile.")
      return data
    },

    async createPlaylist(name: string, description = '', isPublic = false): Promise<Playlist> {
      const created = await request<Playlist>('/me/playlists', {
        method: 'POST',
        body: JSON.stringify({ name, description, public: isPublic }),
      })
      if (!created) throw new SpotifyApiError(500, "Spotify didn't create the playlist.")
      return created
    },

    async updatePlaylistDetails(playlistId: string, details: { name?: string; description?: string }): Promise<void> {
      await request(`/playlists/${encodeURIComponent(playlistId)}`, { method: 'PUT', body: JSON.stringify(details) })
    },

    /** Add songs (100 per request), at the end or at `position`. */
    async addToPlaylist(playlistId: string, uris: string[], position?: number): Promise<void> {
      for (const [i, batch] of chunks(uris, 100).entries()) {
        const body: Record<string, unknown> = { uris: batch }
        if (position !== undefined) body.position = position + i * 100
        await request(`/playlists/${encodeURIComponent(playlistId)}/items`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
      }
    },

    /** Remove songs (every copy of each URI), 100 per request. */
    async removeFromPlaylist(playlistId: string, uris: string[]): Promise<void> {
      for (const batch of chunks(uris, 100)) {
        await request(`/playlists/${encodeURIComponent(playlistId)}/items`, {
          method: 'DELETE',
          body: JSON.stringify({ items: batch.map((uri) => ({ uri })) }),
        })
      }
    },

    /** Move the song at `from` so it ends up at index `to`. */
    async reorderPlaylist(playlistId: string, from: number, to: number): Promise<void> {
      // Spotify's insert_before counts positions *before* the move, so moving
      // down means inserting before the slot after the target.
      const insertBefore = to > from ? to + 1 : to
      await request(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: 'PUT',
        body: JSON.stringify({ range_start: from, insert_before: insertBefore, range_length: 1 }),
      })
    },

    /** Albums saved in the user's Spotify library, most recently added first. */
    /** Every playlist in your library (made or followed), a page of 50 at a time. */
    async allMyPlaylists(): Promise<Playlist[]> {
      const all: Playlist[] = []
      for (let offset = 0; ; offset += 50) {
        const data = await request<{ items: (Playlist | null)[]; next: string | null }>(
          `/me/playlists?limit=50&offset=${offset}`,
        )
        all.push(...(data?.items ?? []).filter((p): p is Playlist => p !== null))
        if (!data?.next) return all
      }
    },

    /** Every saved album, a page of 50 at a time. */
    async allSavedAlbums(): Promise<Album[]> {
      const all: Album[] = []
      for (let offset = 0; ; offset += 50) {
        const data = await request<{ items: { album: Album | null }[]; next: string | null }>(
          `/me/albums?limit=50&offset=${offset}`,
        )
        all.push(...(data?.items ?? []).map((i) => i.album).filter((a): a is Album => a !== null))
        if (!data?.next) return all
      }
    },

    async savedAlbums(limit = 50): Promise<Album[]> {
      const data = await request<{ items: { album: Album | null }[] }>(`/me/albums?limit=${limit}`)
      return (data?.items ?? []).map((i) => i.album).filter((a): a is Album => a !== null)
    },

    // ------------------------------------------------------------ podcasts

    /** A podcast with its newest episodes (50 at a time; pass `offset` for more). */
    async getShow(showId: string): Promise<ShowDetail> {
      type RawShow = Show & { episodes: { items: (Episode | null)[]; total: number } }
      const show = await request<RawShow>(`/shows/${encodeURIComponent(showId)}?market=from_token`)
      if (!show) throw new SpotifyApiError(404, "Spotify couldn't find that podcast.")
      const { episodes, ...rest } = show
      return {
        ...rest,
        episodes: episodes.items.filter((e): e is Episode => e !== null),
        totalEpisodes: episodes.total,
      }
    },

    async showEpisodes(showId: string, offset: number, limit = 50): Promise<Episode[]> {
      const params = new URLSearchParams({ offset: String(offset), limit: String(limit), market: 'from_token' })
      const data = await request<{ items: (Episode | null)[] }>(
        `/shows/${encodeURIComponent(showId)}/episodes?${params}`,
      )
      return (data?.items ?? []).filter((e): e is Episode => e !== null)
    },

    /** Podcasts you follow, most recently added first. */
    async savedShows(limit = 50): Promise<Show[]> {
      const data = await request<{ items: { show: Show | null }[] }>(`/me/shows?limit=${limit}`)
      return (data?.items ?? []).map((i) => i.show).filter((s): s is Show => s !== null)
    },

    /** A single artist (used when opening an artist from an album page). */
    async getArtist(artistId: string): Promise<Artist> {
      const artist = await request<Artist>(`/artists/${encodeURIComponent(artistId)}`)
      if (!artist) throw new SpotifyApiError(404, "Spotify couldn't find that artist.")
      return artist
    },

    /**
     * Play `uris` on our device, starting at `startIndex`. Passing the whole
     * list (not just one song) means "next" carries on through the list, the
     * way clicking a song in a Spotify search result does.
     */
    // ------------------------------------------------------------ playback

    /** Upcoming songs (Spotify returns the queue you added to, then the rest of the album/playlist). */
    async queue(): Promise<{ current: Track | null; upNext: Track[] }> {
      const data = await request<{ currently_playing: Track | null; queue: (Track | null)[] }>('/me/player/queue')
      return {
        current: data?.currently_playing ?? null,
        // Podcast episodes have no album; keep songs only, so rows render safely.
        upNext: (data?.queue ?? []).filter((t): t is Track => t !== null && 'album' in t),
      }
    },

    async addToQueue(uri: string, deviceId?: string): Promise<void> {
      const params = new URLSearchParams({ uri })
      if (deviceId) params.set('device_id', deviceId)
      await request(`/me/player/queue?${params}`, { method: 'POST' })
    },

    async setShuffle(on: boolean, deviceId?: string): Promise<void> {
      const params = new URLSearchParams({ state: String(on) })
      if (deviceId) params.set('device_id', deviceId)
      await request(`/me/player/shuffle?${params}`, { method: 'PUT' })
    },

    async setRepeat(mode: RepeatMode, deviceId?: string): Promise<void> {
      const params = new URLSearchParams({ state: mode })
      if (deviceId) params.set('device_id', deviceId)
      await request(`/me/player/repeat?${params}`, { method: 'PUT' })
    },

    async devices(): Promise<Device[]> {
      const data = await request<{ devices: Device[] }>('/me/player/devices')
      return data?.devices ?? []
    },

    /** Move playback to another device (phone, speaker...), keeping it playing. */
    async transferPlayback(deviceId: string, play = true): Promise<void> {
      await request('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play }) })
    },

    /** What's playing anywhere on the account; null if nothing is. */
    async playbackState(): Promise<RemotePlayback | null> {
      return request<RemotePlayback>('/me/player')
    },

    // Remote-control commands, for when the music is on another device.
    async remotePause(): Promise<void> {
      await request('/me/player/pause', { method: 'PUT' })
    },
    async remoteResume(): Promise<void> {
      await request('/me/player/play', { method: 'PUT' })
    },
    async remoteNext(): Promise<void> {
      await request('/me/player/next', { method: 'POST' })
    },
    async remoteSeek(positionMs: number): Promise<void> {
      await request(`/me/player/seek?position_ms=${positionMs}`, { method: 'PUT' })
    },
    async remotePrevious(): Promise<void> {
      await request('/me/player/previous', { method: 'POST' })
    },

    async playTracks(deviceId: string, uris: string[], startIndex = 0, positionMs?: number): Promise<void> {
      const body: Record<string, unknown> = { uris, offset: { position: startIndex } }
      if (positionMs) body.position_ms = positionMs // e.g. carry on a podcast where you left off
      await request(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    },
  }
}

export type SpotifyApi = ReturnType<typeof createSpotifyApi>
