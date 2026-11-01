// Radio, Daily Mixes and Discover Weekly, built from Last.fm's "similar"
// data and played from Spotify. Each one is made when you press play (not in
// the background), and every Spotify lookup is a search, so they're kept to a
// few dozen requests, four at a time.

import { cleanTitle } from '../lib/lyrics'
import type { Artist, SpotifyApi, Track } from '../spotify/api'
import type { Lastfm } from './lastfm'

export type DiscoveryApi = Pick<SpotifyApi, 'findTrack' | 'artistTopTracks'>

const CONCURRENCY = 4

/** Run `fn` over `items`, at most `limit` at a time; failures count as nothing found. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]).catch(() => null)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** A repeatable random order: the same `seed` always gives the same shuffle. */
export function shuffle<T>(items: T[], seed = Math.random() * 2 ** 32): T[] {
  let a = seed >>> 0
  const random = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Weeks since 1970: Discover Weekly stays the same all week, then changes. */
export function weekNumber(now = new Date()): number {
  return Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000))
}

function unique(tracks: (Track | null)[]): Track[] {
  const seen = new Set<string>()
  return tracks.filter((t): t is Track => t !== null && !seen.has(t.uri) && Boolean(seen.add(t.uri)))
}

/** Top songs by each named artist, `per` each, in the artists' order. */
async function topSongsOf(names: string[], per: number, api: DiscoveryApi): Promise<Track[][]> {
  const found = await mapLimit(names, CONCURRENCY, (name) => api.artistTopTracks({ name }, per))
  return found.map((tracks) => tracks ?? [])
}

/** Deal from each list in turn (a, b, c, a, b, c...), so no artist plays twice in a row. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i])
  return out
}

/**
 * Song radio: the song, then songs like it. Falls back to the artist's
 * radio when Last.fm doesn't know the song well enough.
 */
export async function songRadio(seed: Track, api: DiscoveryApi, lastfm: Lastfm, size = 30): Promise<Track[]> {
  const artist = seed.artists[0]?.name ?? ''
  const similar = await lastfm.similarTracks(artist, cleanTitle(seed.name), 80)
  // At most two songs per artist, so the radio wanders.
  const perArtist = new Map<string, number>()
  const picks = similar.filter((t) => {
    const n = perArtist.get(t.artist) ?? 0
    perArtist.set(t.artist, n + 1)
    return n < 2
  })
  const found = unique(await mapLimit(picks.slice(0, size + 10), CONCURRENCY, (t) => api.findTrack(t.name, t.artist)))
  const songs = found.filter((t) => t.uri !== seed.uri)
  if (songs.length < 10) {
    const radio = await artistRadio({ name: artist }, api, lastfm, size)
    return unique([seed, ...radio]).slice(0, size)
  }
  return [seed, ...shuffle(songs).slice(0, size - 1)]
}

/** Artist radio (and each Daily Mix): the artist's hits mixed with similar artists' hits. */
export async function artistRadio(
  artist: { name: string; id?: string },
  api: DiscoveryApi,
  lastfm: Lastfm,
  size = 30,
  seed?: number,
): Promise<Track[]> {
  const similar = (await lastfm.similarArtists(artist.name, 20)).slice(0, 12)
  const [own, others] = await Promise.all([
    api.artistTopTracks(artist, 6).catch((): Track[] => []),
    topSongsOf(similar, 3, api),
  ])
  // The artist's own songs spread through the mix, like a Daily Mix.
  const mixed = interleave([shuffle(own, seed), ...shuffle(others, seed).map((l) => shuffle(l, seed))])
  return unique(mixed).slice(0, size)
}

/**
 * Discover Weekly: artists similar to the ones you play most, that you don't
 * already listen to; one song from each. The same all week.
 */
export async function discoverWeekly(
  favourites: Artist[],
  known: Set<string>,
  api: DiscoveryApi,
  lastfm: Lastfm,
  week = weekNumber(),
  size = 30,
): Promise<Track[]> {
  const lists = await mapLimit(favourites.slice(0, 6), CONCURRENCY, (a) => lastfm.similarArtists(a.name, 25))
  // Artists suggested by several of your favourites rank first.
  const votes = new Map<string, number>()
  for (const list of lists) for (const name of list ?? []) votes.set(name, (votes.get(name) ?? 0) + 1)
  const isKnown = (name: string) => known.has(name.toLowerCase())
  const fresh = [...votes.entries()]
    .filter(([name]) => !isKnown(name))
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
  // A different slice each week, from the best-ranked ones.
  const chosen = shuffle(fresh.slice(0, size * 2), week).slice(0, size + 6)
  const songs = await topSongsOf(chosen, 3, api)
  // One song per artist, not always their biggest.
  const picks = songs.map((list, i) => list[(week + i) % Math.max(list.length, 1)] ?? null)
  return shuffle(unique(picks), week).slice(0, size)
}
