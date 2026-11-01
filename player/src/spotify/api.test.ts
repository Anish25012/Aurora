import { describe, expect, it, vi } from 'vitest'
import { createSpotifyApi, friendlyMessage, SpotifyApiError } from './api'

function setup(...responses: Response[]) {
  const getAccessToken = vi.fn(async (opts?: { forceRefresh?: boolean }) => (opts?.forceRefresh ? 'fresh' : 'stale'))
  const fetchFn = vi.fn(async () => responses.shift() ?? new Response(null, { status: 204 }))
  return {
    api: createSpotifyApi({ getAccessToken, fetchFn: fetchFn as unknown as typeof fetch }),
    fetchFn,
    getAccessToken,
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const calledUrl = (fetchFn: ReturnType<typeof vi.fn>, i = 0) => String(fetchFn.mock.calls[i][0])
const calledInit = (fetchFn: ReturnType<typeof vi.fn>, i = 0) => fetchFn.mock.calls[i][1] as RequestInit

describe('searchTracks', () => {
  it('queries tracks, caps the limit at 10 and drops null items', async () => {
    const track = { id: 't1', uri: 'spotify:track:t1', name: 'Teardrop' }
    const { api, fetchFn } = setup(json({ tracks: { items: [track, null] } }))

    const tracks = await api.searchTracks('teardrop', 50)

    const url = new URL(calledUrl(fetchFn))
    expect(url.pathname).toBe('/v1/search')
    expect(url.searchParams.get('q')).toBe('teardrop')
    expect(url.searchParams.get('type')).toBe('track')
    expect(url.searchParams.get('limit')).toBe('10')
    expect((calledInit(fetchFn).headers as Record<string, string>).Authorization).toBe('Bearer stale')
    expect(tracks).toEqual([track])
  })
})

describe('playTracks', () => {
  it('plays the list on our device from the chosen position', async () => {
    const { api, fetchFn } = setup(new Response(null, { status: 204 }))
    await api.playTracks('device 1', ['spotify:track:a', 'spotify:track:b'], 1)

    expect(calledUrl(fetchFn)).toBe('https://api.spotify.com/v1/me/player/play?device_id=device%201')
    expect(calledInit(fetchFn).method).toBe('PUT')
    expect(JSON.parse(calledInit(fetchFn).body as string)).toEqual({
      uris: ['spotify:track:a', 'spotify:track:b'],
      offset: { position: 1 },
    })
  })
})

describe('errors', () => {
  it('refreshes the token and retries once after a 401', async () => {
    const { api, fetchFn, getAccessToken } = setup(
      json({ error: { status: 401 } }, 401),
      json({ tracks: { items: [] } }),
    )
    await api.searchTracks('x')
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(getAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true })
    expect((calledInit(fetchFn, 1).headers as Record<string, string>).Authorization).toBe('Bearer fresh')
  })

  it('gives up after a second 401', async () => {
    const { api } = setup(json({}, 401), json({}, 401))
    await expect(api.searchTracks('x')).rejects.toMatchObject({ status: 401 })
  })

  it('turns Premium errors into a clear message', async () => {
    const { api } = setup(
      json({ error: { status: 403, message: 'Premium required', reason: 'PREMIUM_REQUIRED' } }, 403),
    )
    const err = await api.playTracks('d', ['spotify:track:a']).catch((e) => e)
    expect(err).toBeInstanceOf(SpotifyApiError)
    expect(err.message).toBe('Playing music needs Spotify Premium.')
    expect(err.reason).toBe('PREMIUM_REQUIRED')
  })

  it('survives non-JSON error bodies', async () => {
    const { api } = setup(new Response('<html>Bad gateway</html>', { status: 502 }))
    await expect(api.searchTracks('x')).rejects.toThrow('having problems')
  })

  it.each([
    [403, 'User Management'],
    [404, "couldn't find"],
    [429, 'rate limiting'],
    [500, 'having problems'],
  ])('friendly message for %i', (status, expected) => {
    expect(friendlyMessage(status, '')).toContain(expected)
  })
})

describe('artist pages', () => {
  const t = (id: string, name: string, artistIds: string[]) => ({
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: artistIds.map((a) => ({ id: a, name: a })),
  })

  it('builds top songs from search: only the right artist, no remaster duplicates, max 5', async () => {
    const items = [
      t('1', 'Teardrop', ['ma']),
      t('2', 'Teardrop - 2019 Remaster', ['ma']), // same song
      t('3', 'Angel', ['ma']),
      t('4', 'Some Song', ['massive-attack-tribute']), // similarly named, different artist
      t('5', 'Unfinished Sympathy', ['ma']),
      t('6', 'Risingson', ['ma', 'guest']), // featuring counts
      t('7', 'Protection', ['ma']),
      t('8', 'Paradise Circus', ['ma']), // 6th distinct song: cut
    ]
    const { api, fetchFn } = setup(json({ tracks: { items } }))

    const top = await api.artistTopTracks({ id: 'ma', name: 'Massive "Attack"' })

    const url = new URL(calledUrl(fetchFn))
    expect(url.searchParams.get('q')).toBe('artist:"Massive Attack"') // quotes in names can't break the query
    expect(url.searchParams.get('limit')).toBe('10')
    expect(top.map((x) => x.name)).toEqual(['Teardrop', 'Angel', 'Unfinished Sympathy', 'Risingson', 'Protection'])
  })

  it('fetches the whole discography 10 at a time, merges duplicate editions, newest first', async () => {
    const album = (id: string, name: string, date: string) => ({
      id,
      uri: `spotify:album:${id}`,
      name,
      album_type: 'album',
      release_date: date,
    })
    const firstPage = Array.from({ length: 10 }, (_, i) => album(`a${i}`, `Album ${i}`, `20${10 + i}-01-01`))
    const { api, fetchFn } = setup(
      json({ total: 23, items: firstPage }),
      json({ total: 23, items: [album('b0', 'Mezzanine', '1998-04-20'), album('b1', 'Mezzanine', '1998-04-20')] }),
      json({ total: 23, items: [album('c0', 'Blue Lines', '1991-04-08'), null] }),
    )

    const releases = await api.artistDiscography('ma')

    const offsets = fetchFn.mock.calls.map((c) => new URL(String((c as unknown[])[0])).searchParams.get('offset'))
    expect(offsets).toEqual(['0', '10', '20'])
    expect(new URL(String((fetchFn.mock.calls[0] as unknown[])[0])).searchParams.get('limit')).toBe('10')
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('include_groups=album%2Csingle%2Ccompilation')
    expect(releases).toHaveLength(12) // 10 + Mezzanine once + Blue Lines
    expect(releases[0].release_date).toBe('2019-01-01')
    expect(releases.at(-1)?.name).toBe('Blue Lines')
  })

  it('plays an album or artist as a context', async () => {
    const { api, fetchFn } = setup(new Response(null, { status: 204 }))
    await api.playContext('dev', 'spotify:album:a1')
    expect(JSON.parse(calledInit(fetchFn).body as string)).toEqual({ context_uri: 'spotify:album:a1' })
  })
})

describe('albums', () => {
  it('loads an album and gives each track its album (for artwork and the vinyl label)', async () => {
    const { api } = setup(
      json({
        id: 'al1',
        uri: 'spotify:album:al1',
        name: 'Migration',
        images: [{ url: 'cover', width: 640 }],
        artists: [{ id: 'bon', name: 'Bonobo' }],
        release_date: '2017-01-13',
        album_type: 'album',
        total_tracks: 2,
        tracks: { items: [{ id: 't1', uri: 'spotify:track:t1', name: 'Migration', track_number: 1 }, null] },
      }),
    )
    const album = await api.getAlbum('al1')
    expect(album.tracks).toHaveLength(1)
    expect(album.tracks[0].album).toEqual({ id: 'al1', name: 'Migration', images: [{ url: 'cover', width: 640 }] })
    expect(album.tracks[0].track_number).toBe(1)
  })

  it('lists saved albums', async () => {
    const { api, fetchFn } = setup(json({ items: [{ album: { id: 'a1' } }, { album: null }] }))
    const albums = await api.savedAlbums()
    expect(calledUrl(fetchFn)).toContain('/me/albums?limit=50')
    expect(albums.map((a) => a.id)).toEqual(['a1'])
  })

  it('plays an album starting at a chosen song', async () => {
    const { api, fetchFn } = setup(new Response(null, { status: 204 }))
    await api.playContext('dev', 'spotify:album:al1', 'spotify:track:t7')
    expect(JSON.parse(calledInit(fetchFn).body as string)).toEqual({
      context_uri: 'spotify:album:al1',
      offset: { uri: 'spotify:track:t7' },
    })
  })
})

describe('artistSongs', () => {
  const page = (ids: string[], next: string | null) =>
    json({
      tracks: {
        items: ids.map((id) => ({
          id,
          uri: `spotify:track:${id}`,
          name: id,
          artists: [{ id: id === 'x' ? 'other' : 'ma', name: 'MA' }],
        })),
        next,
      },
    })

  it('fetches several search pages in parallel, keeps only the artist, and reports where to continue', async () => {
    const full = Array.from({ length: 10 }, (_, i) => `s${i}`)
    const { api, fetchFn } = setup(page(full, 'n'), page([...full.slice(0, 9), 'x'], 'n'))

    const result = await api.artistSongs({ id: 'ma', name: 'Massive Attack' }, 20, 2)

    const offsets = fetchFn.mock.calls.map((c) => new URL(String((c as unknown[])[0])).searchParams.get('offset'))
    expect(offsets).toEqual(['20', '30'])
    expect(result.tracks).toHaveLength(19) // 'x' is by someone else
    expect(result.nextOffset).toBe(40)
  })

  it('stops when Spotify runs out of results', async () => {
    const { api } = setup(page(['a', 'b'], null))
    const result = await api.artistSongs({ id: 'ma', name: 'Massive Attack' }, 0, 1)
    expect(result.nextOffset).toBeNull()
  })
})

describe('playlistTracks', () => {
  const t = (id: string) => ({ id, uri: `spotify:track:${id}`, name: id, artists: [] })

  it('reads pages in order, accepting both the new item and old track fields, skipping episodes and local files', async () => {
    const { api, fetchFn } = setup(
      json({
        total: 4,
        next: 'page2',
        items: [
          { item: t('a') },
          { track: t('b') },
          { item: { ...t('ep'), type: 'episode' } },
          { item: { ...t('x'), id: null } },
        ],
      }),
      json({ total: 4, next: null, items: [{ item: t('c') }] }),
    )
    const result = await api.playlistTracks('p1')
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('/playlists/p1/items?limit=50&offset=0')
    expect(String((fetchFn.mock.calls[1] as unknown[])[0])).toContain('offset=50')
    expect(result.tracks.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(result.restricted).toBe(false)
  })

  it('reports playlists the user does not own as restricted', async () => {
    const forbidden = setup(json({ error: { status: 403, message: 'Forbidden' } }, 403))
    expect(await forbidden.api.playlistTracks('p1')).toEqual({
      tracks: [],
      total: 0,
      restricted: true,
      nextOffset: null,
    })

    const metadataOnly = setup(json({ total: 30, next: null, items: [] }))
    expect((await metadataOnly.api.playlistTracks('p1')).restricted).toBe(true)
  })

  it('loads 100 at a time and says where the next page starts', async () => {
    const page = (from: number) =>
      json({
        total: 250,
        next: 'more',
        items: Array.from({ length: 50 }, (_, i) => ({ item: { id: `t${from + i}`, uri: `u${from + i}` } })),
      })
    const { api, fetchFn } = setup(page(100), page(150))
    const result = await api.playlistTracks('p1', 100, 100)
    expect(calledUrl(fetchFn)).toContain('offset=100')
    expect(result.tracks).toHaveLength(100)
    expect(result.nextOffset).toBe(200)
  })
})

describe('playlist editing', () => {
  it('creates a private playlist for the signed-in user', async () => {
    const { api, fetchFn } = setup(json({ id: 'new', name: 'My Playlist #1' }, 201))
    const created = await api.createPlaylist('My Playlist #1')
    expect(calledUrl(fetchFn)).toBe('https://api.spotify.com/v1/me/playlists')
    expect(calledInit(fetchFn).method).toBe('POST')
    expect(JSON.parse(String(calledInit(fetchFn).body))).toEqual({
      name: 'My Playlist #1',
      description: '',
      public: false,
    })
    expect(created.id).toBe('new')
  })

  it('adds songs in batches of 100', async () => {
    const { api, fetchFn } = setup()
    const uris = Array.from({ length: 150 }, (_, i) => `spotify:track:${i}`)
    await api.addToPlaylist('p1', uris)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(calledUrl(fetchFn)).toBe('https://api.spotify.com/v1/playlists/p1/items')
    expect(JSON.parse(String(calledInit(fetchFn, 1).body)).uris).toHaveLength(50)
  })

  it('removes songs by URI', async () => {
    const { api, fetchFn } = setup()
    await api.removeFromPlaylist('p1', ['spotify:track:a'])
    expect(calledInit(fetchFn).method).toBe('DELETE')
    expect(JSON.parse(String(calledInit(fetchFn).body))).toEqual({ items: [{ uri: 'spotify:track:a' }] })
  })

  it('reorders: moving down inserts before the slot after the target', async () => {
    const { api, fetchFn } = setup()
    await api.reorderPlaylist('p1', 0, 2)
    await api.reorderPlaylist('p1', 3, 1)
    expect(JSON.parse(String(calledInit(fetchFn, 0).body))).toEqual({
      range_start: 0,
      insert_before: 3,
      range_length: 1,
    })
    expect(JSON.parse(String(calledInit(fetchFn, 1).body))).toEqual({
      range_start: 3,
      insert_before: 1,
      range_length: 1,
    })
  })

  it('renames with PUT on the playlist', async () => {
    const { api, fetchFn } = setup()
    await api.updatePlaylistDetails('p1', { name: 'Late night' })
    expect(calledUrl(fetchFn)).toBe('https://api.spotify.com/v1/playlists/p1')
    expect(calledInit(fetchFn).method).toBe('PUT')
  })
})

describe('searchAll', () => {
  it('asks for every kind in one request and drops null items', async () => {
    const t = { id: 't1', uri: 'spotify:track:t1', name: 'Teardrop' }
    const { api, fetchFn } = setup(json({ tracks: { items: [t, null] }, shows: { items: [null] } }))
    const r = await api.searchAll('tear')
    const url = new URL(calledUrl(fetchFn))
    expect(url.searchParams.get('type')).toBe('track,artist,album,playlist,show,episode')
    expect(url.searchParams.get('market')).toBe('from_token')
    expect(r).toEqual({ tracks: [t], artists: [], albums: [], playlists: [], shows: [], episodes: [] })
  })
})

describe('podcasts', () => {
  it('getShow returns the first page of episodes and the total', async () => {
    const { api } = setup(json({ id: 's1', name: 'Show', episodes: { items: [{ id: 'e1' }, null], total: 120 } }))
    const show = await api.getShow('s1')
    expect(show.episodes).toEqual([{ id: 'e1' }])
    expect(show.totalEpisodes).toBe(120)
  })

  it('plays an episode inside its show, from where you left off', async () => {
    const { api, fetchFn } = setup()
    await api.playContext('d1', 'spotify:show:s1', 'spotify:episode:e1', 60_000)
    expect(JSON.parse(String(calledInit(fetchFn).body))).toEqual({
      context_uri: 'spotify:show:s1',
      offset: { uri: 'spotify:episode:e1' },
      position_ms: 60_000,
    })
  })
})

describe('playTracks with a start position', () => {
  it('sends position_ms, so a podcast resumes where you left off', async () => {
    const { api, fetchFn } = setup()
    await api.playTracks('d1', ['spotify:episode:e1', 'spotify:episode:e2'], 0, 90_000)
    expect(JSON.parse(String(calledInit(fetchFn).body))).toEqual({
      uris: ['spotify:episode:e1', 'spotify:episode:e2'],
      offset: { position: 0 },
      position_ms: 90_000,
    })
  })
})
