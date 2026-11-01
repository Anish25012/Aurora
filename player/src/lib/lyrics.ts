// Lyrics from LRCLIB (lrclib.net), a free, open lyrics database. Spotify's
// own lyrics aren't available to apps. Lyrics are copyrighted: they're shown
// for you while the song plays and kept in memory only.

const LRCLIB = 'https://lrclib.net/api'

export interface LyricLine {
  timeMs: number
  text: string
}

export interface Lyrics {
  /** Time-stamped lines, for highlighting along with the song. */
  synced: LyricLine[] | null
  /** Plain text, when there's no timing. */
  plain: string | null
  instrumental: boolean
}

export interface LyricsQuery {
  name: string
  artist: string
  album: string
  durationMs: number
}

interface LrclibRecord {
  trackName: string
  artistName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

/** Parse LRC ("[01:02.34] words"). A line can carry several timestamps (a repeated chorus). */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (stamps.length === 0) continue // metadata like [ar: ...], or blank
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const [, min, sec, frac = '0'] of stamps) {
      const ms = Number(frac.padEnd(3, '0').slice(0, 3))
      lines.push({ timeMs: Number(min) * 60_000 + Number(sec) * 1000 + ms, text })
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs)
}

/** The line being sung at `positionMs` (a hair early, so it lights up as it starts), or -1 before the first. */
export function activeLine(lines: LyricLine[], positionMs: number, leadMs = 250): number {
  let found = -1
  for (let i = 0; i < lines.length && lines[i].timeMs <= positionMs + leadMs; i++) found = i
  return found
}

/** "Song - Remastered 2011" and "Song (feat. X)" are found under "Song". */
export function cleanTitle(name: string): string {
  return name
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo|deluxe).*$/i, '')
    .replace(/\s*[([](feat\.|with|ft\.).*?[)\]]/i, '')
    .trim()
}

function toLyrics(r: LrclibRecord): Lyrics {
  return {
    synced: r.syncedLyrics ? parseLrc(r.syncedLyrics) : null,
    plain: r.plainLyrics,
    instrumental: r.instrumental,
  }
}

/**
 * Find lyrics for a song: an exact match first (title, artist, album and
 * length), then a search, keeping the closest length (prefer synced).
 * Returns null when there are none.
 */
export async function fetchLyrics(q: LyricsQuery, fetchFn: typeof fetch = fetch): Promise<Lyrics | null> {
  const seconds = Math.round(q.durationMs / 1000)
  const exact = new URLSearchParams({
    track_name: q.name,
    artist_name: q.artist,
    album_name: q.album,
    duration: String(seconds),
  })
  const res = await fetchFn(`${LRCLIB}/get?${exact}`)
  if (res.ok) return toLyrics((await res.json()) as LrclibRecord)
  if (res.status !== 404) throw new Error("Couldn't load lyrics right now.")

  const loose = new URLSearchParams({ track_name: cleanTitle(q.name), artist_name: q.artist })
  const found = await fetchFn(`${LRCLIB}/search?${loose}`)
  if (!found.ok) throw new Error("Couldn't load lyrics right now.")
  const candidates = ((await found.json()) as LrclibRecord[]).filter((r) => Math.abs(r.duration - seconds) <= 4)
  const best = candidates.find((r) => r.syncedLyrics) ?? candidates.find((r) => r.plainLyrics || r.instrumental)
  return best ? toLyrics(best) : null
}
