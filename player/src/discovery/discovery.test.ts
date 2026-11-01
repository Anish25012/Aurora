import { describe, expect, it, vi } from 'vitest'
import type { Artist, Track } from '../spotify/api'
import { createLastfm, type Lastfm } from './lastfm'
import { artistRadio, discoverWeekly, mapLimit, shuffle, songRadio } from './mixes'

function track(id: string, artist: string): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: `Song ${id}`,
    artists: [{ id: artist, name: artist }],
    album: { id: 'al', name: 'Album', images: [] },
    duration_ms: 1000,
    explicit: false,
    external_urls: {},
  }
}

const artist = (name: string): Artist => ({ id: name, uri: `spotify:artist:${name}`, name, images: [] })

function fakeLastfm(similar: Record<string, string[]>, tracks: { name: string; artist: string }[] = []): Lastfm {
  return {
    similarArtists: vi.fn(async (name: string) => similar[name] ?? []),
    similarTracks: vi.fn(async () => tracks),
  }
}

// Every artist has three songs: <name>1, <name>2, <name>3.
const api = {
  artistTopTracks: vi.fn(async (a: { name: string }, count = 5) =>
    [1, 2, 3].map((n) => track(`${a.name}${n}`, a.name)).slice(0, count),
  ),
  findTrack: vi.fn(async (name: string, by: string) => track(`${by}-${name}`, by)),
}

describe('lastfm', () => {
  it('reads similar artists, and treats "not found" as none', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ similarartists: { artist: [{ name: 'Tycho' }] } })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 6, message: 'The artist you supplied could not be found' })),
      )
    const lastfm = createLastfm('KEY', fetchFn as unknown as typeof fetch)
    expect(await lastfm.similarArtists('Bonobo')).toEqual(['Tycho'])
    const url = new URL(String(fetchFn.mock.calls[0][0]))
    expect(url.searchParams.get('method')).toBe('artist.getsimilar')
    expect(url.searchParams.get('api_key')).toBe('KEY')
    expect(await lastfm.similarArtists('Nobody at all')).toEqual([])
  })
})

describe('helpers', () => {
  it('shuffle is repeatable for a seed and keeps every item', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(shuffle(items, 42)).toEqual(shuffle(items, 42))
    expect([...shuffle(items, 42)].sort()).toEqual(items)
  })

  it('mapLimit runs a few at a time, and a failure counts as nothing found', async () => {
    let running = 0
    let most = 0
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++
      most = Math.max(most, running)
      await new Promise((r) => setTimeout(r, 1))
      running--
      if (n === 3) throw new Error('nope')
      return n * 10
    })
    expect(most).toBe(2)
    expect(out).toEqual([10, 20, null, 40, 50, 60])
  })
})

describe('mixes', () => {
  it('artist radio mixes the artist with similar artists, never the same artist twice in a row', async () => {
    const lastfm = fakeLastfm({ Bonobo: ['Tycho', 'Emancipator'] })
    const mix = await artistRadio({ name: 'Bonobo' }, api, lastfm, 30, 1)
    expect(mix).toHaveLength(6 + 3 + 3 - 3) // Bonobo's 3 songs (asked for 6), plus 3 each
    const artists = mix.map((t) => t.artists[0].name)
    expect(new Set(artists)).toEqual(new Set(['Bonobo', 'Tycho', 'Emancipator']))
    for (let i = 1; i < artists.length; i++) expect(artists[i]).not.toBe(artists[i - 1])
  })

  it('song radio starts with the song, then similar songs found on Spotify', async () => {
    const similar = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, artist: `A${i % 10}` }))
    const lastfm = fakeLastfm({}, similar)
    const seed = track('seed', 'Bonobo')
    const radio = await songRadio(seed, api, lastfm, 15)
    expect(radio[0]).toBe(seed)
    expect(radio).toHaveLength(15)
    expect(new Set(radio.map((t) => t.uri)).size).toBe(15) // no repeats
  })

  it('song radio falls back to the artist radio when Last.fm barely knows the song', async () => {
    const lastfm = fakeLastfm({ Bonobo: ['Tycho'] }, [])
    const radio = await songRadio(track('seed', 'Bonobo'), api, lastfm)
    expect(radio[0].uri).toBe('spotify:track:seed')
    expect(radio.some((t) => t.artists[0].name === 'Tycho')).toBe(true)
  })

  it('Discover Weekly skips artists you already know and is the same all week', async () => {
    const lastfm = fakeLastfm({ Bonobo: ['Tycho', 'Burial', 'Four Tet'], Burial: ['Four Tet', 'Jamie xx'] })
    const known = new Set(['bonobo', 'burial'])
    const favourites = [artist('Bonobo'), artist('Burial')]
    const week = await discoverWeekly(favourites, known, api, lastfm, 2900)
    const names = new Set(week.map((t) => t.artists[0].name))
    expect(names).toEqual(new Set(['Tycho', 'Four Tet', 'Jamie xx']))
    expect(week.map((t) => t.uri)).toEqual(
      (await discoverWeekly(favourites, known, api, lastfm, 2900)).map((t) => t.uri),
    )
  })
})
