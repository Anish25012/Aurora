import { describe, expect, it, vi } from 'vitest'
import { activeLine, cleanTitle, fetchLyrics, parseLrc } from './lyrics'

describe('parseLrc', () => {
  it('reads timestamps, skips metadata, and expands repeated lines', () => {
    const lines = parseLrc('[ar: Massive Attack]\n[00:12.50] Love, love is a verb\n[00:05.00][01:00.0] Chorus\n\n')
    expect(lines).toEqual([
      { timeMs: 5000, text: 'Chorus' },
      { timeMs: 12500, text: 'Love, love is a verb' },
      { timeMs: 60000, text: 'Chorus' },
    ])
  })
})

describe('activeLine', () => {
  const lines = [
    { timeMs: 1000, text: 'a' },
    { timeMs: 5000, text: 'b' },
  ]
  it('is -1 before the first line, then the last line that has started', () => {
    expect(activeLine(lines, 0)).toBe(-1)
    expect(activeLine(lines, 4800)).toBe(1) // lights up a moment early
    expect(activeLine(lines, 3000)).toBe(0)
  })
})

describe('cleanTitle', () => {
  it('drops remaster and feature notes', () => {
    expect(cleanTitle('Angel - 2018 Remaster')).toBe('Angel')
    expect(cleanTitle('Song (feat. Someone)')).toBe('Song')
  })
})

describe('fetchLyrics', () => {
  const q = { name: 'Teardrop - Remastered', artist: 'Massive Attack', album: 'Mezzanine', durationMs: 330_400 }
  const record = (over = {}) => ({
    trackName: 'Teardrop',
    artistName: 'Massive Attack',
    duration: 330,
    instrumental: false,
    plainLyrics: 'Love, love is a verb',
    syncedLyrics: '[00:01.00] Love, love is a verb',
    ...over,
  })

  it('uses the exact match when there is one', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(record())))
    const lyrics = await fetchLyrics(q, fetchFn as unknown as typeof fetch)
    const url = new URL(String((fetchFn.mock.calls[0] as unknown[])[0]))
    expect(url.pathname).toBe('/api/get')
    expect(url.searchParams.get('duration')).toBe('330')
    expect(lyrics?.synced).toEqual([{ timeMs: 1000, text: 'Love, love is a verb' }])
  })

  it('falls back to a search, keeping a result of about the same length', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([record({ duration: 200 }), record({ syncedLyrics: null, plainLyrics: 'plain' })])),
      )
    const lyrics = await fetchLyrics(q, fetchFn as unknown as typeof fetch)
    expect(new URL(String(fetchFn.mock.calls[1][0])).searchParams.get('track_name')).toBe('Teardrop')
    expect(lyrics).toEqual({ synced: null, plain: 'plain', instrumental: false })
  })

  it('returns null when nothing matches', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('[]'))
    expect(await fetchLyrics(q, fetchFn as unknown as typeof fetch)).toBeNull()
  })
})
