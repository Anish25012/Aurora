import { act, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlbumView } from '../components/AlbumView'
import { appCache, createCache, keys, useCached } from './cache'
import { HOVER_INTENT_MS, usePrefetchOnHover } from './prefetch'

describe('cache', () => {
  it('shares one request between callers, then serves the value instantly', async () => {
    const cache = createCache()
    const load = vi.fn(async () => 'data')
    const [a, b] = await Promise.all([cache.get('k', load), cache.get('k', load)])
    expect([a, b]).toEqual(['data', 'data'])
    expect(load).toHaveBeenCalledOnce()
    expect(cache.peek('k')).toBe('data')
  })

  it('expires entries after their time to live', async () => {
    let t = 0
    const cache = createCache(() => t)
    const load = vi.fn(async () => t)
    await cache.get('k', load, 1000)
    t = 1500
    expect(cache.peek('k')).toBeUndefined()
    await cache.get('k', load, 1000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not remember failures, so the next attempt retries', async () => {
    const cache = createCache()
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('ok')
    await expect(cache.get('k', load)).rejects.toThrow('offline')
    expect(await cache.get('k', load)).toBe('ok')
  })

  it('can forget a group of entries', async () => {
    const cache = createCache()
    await cache.get('album:1', async () => 1)
    await cache.get('artist:1', async () => 2)
    cache.invalidate('album:')
    expect(cache.peek('album:1')).toBeUndefined()
    expect(cache.peek('artist:1')).toBe(2)
  })
})

describe('useCached', () => {
  it('shows already-loaded data on the very first render (no loading flash)', async () => {
    await appCache.get('k', async () => 'ready already')
    const load = vi.fn(async () => 'fresh')
    const { result } = renderHook(() => useCached('k', load))
    expect(result.current).toEqual({ status: 'ready', data: 'ready already' })
    expect(load).not.toHaveBeenCalled()
  })

  it('loads when nothing is cached', async () => {
    const { result } = renderHook(() => useCached('fresh-key', async () => 42))
    expect(result.current.status).toBe('loading')
    await act(async () => {})
    expect(result.current).toEqual({ status: 'ready', data: 42 })
  })
})

describe('instant pages', () => {
  it('an album that was prefetched opens with its songs already showing', async () => {
    const album = {
      id: 'al1',
      uri: 'spotify:album:al1',
      name: 'Migration',
      images: [],
      release_date: '2017-01-13',
      album_type: 'album' as const,
      total_tracks: 1,
    }
    const track = {
      id: 't1',
      uri: 'spotify:track:t1',
      name: 'Kerala',
      artists: [{ id: 'b', name: 'Bonobo' }],
      album: { id: 'al1', name: 'Migration', images: [] },
      duration_ms: 240_000,
      explicit: false,
      external_urls: {},
    }
    // What hovering the album's card does:
    await appCache.get(keys.album('al1'), async () => ({ ...album, artists: [], tracks: [track] }))

    const getAlbum = vi.fn()
    render(
      <AlbumView
        album={album}
        api={{ getAlbum }}
        onPlayAlbum={vi.fn()}
        onTogglePlay={vi.fn()}
        onOpenArtist={vi.fn()}
        onBack={vi.fn()}
        currentUri={null}
        currentContextUri={null}
        isPaused
      />,
    )
    // Synchronously, on the first render: no skeletons, no second request.
    expect(screen.getByRole('button', { name: 'Play Kerala by Bonobo' })).toBeInTheDocument()
    expect(document.querySelector('.skeleton')).toBeNull()
    expect(getAlbum).not.toHaveBeenCalled()
  })
})

describe('usePrefetchOnHover', () => {
  it('waits for the pointer to rest before prefetching, and cancels if it moves on', () => {
    vi.useFakeTimers()
    const prefetch = vi.fn()
    const { result } = renderHook(() => usePrefetchOnHover(prefetch))

    result.current.onPointerEnter?.()
    result.current.onPointerLeave?.() // just passing over
    vi.advanceTimersByTime(HOVER_INTENT_MS * 2)
    expect(prefetch).not.toHaveBeenCalled()

    result.current.onPointerEnter?.()
    vi.advanceTimersByTime(HOVER_INTENT_MS)
    expect(prefetch).toHaveBeenCalledOnce()

    result.current.onFocus?.() // keyboard users get it immediately
    expect(prefetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
