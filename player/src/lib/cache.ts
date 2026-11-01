import { useEffect, useRef, useState } from 'react'

/**
 * A small in-memory cache for API results, so pages appear instantly.
 *
 * - Hovering a card or link *prefetches* its page (see `appCache.get` calls in
 *   App.tsx), so by the time you click, the data is usually already here.
 * - Revisiting a page (Back, or opening it again) uses what was loaded before.
 * - Concurrent requests for the same thing share one network call.
 *
 * In memory only, for the session: nothing is written to disk. Spotify's
 * developer terms don't allow storing their content beyond immediate use.
 */

export const DEFAULT_TTL_MS = 10 * 60_000

interface Entry {
  promise: Promise<unknown>
  value?: unknown
  settled: boolean
  at: number
  ttl: number
}

export function createCache(now: () => number = Date.now) {
  const store = new Map<string, Entry>()
  // Pages showing a key get told when it's invalidated, so they reload by themselves.
  const listeners = new Map<string, Set<() => void>>()

  function fresh(entry: Entry | undefined): entry is Entry {
    return entry !== undefined && now() - entry.at < entry.ttl
  }

  return {
    /** The cached value, or start (or join) loading it. Failures aren't cached. */
    get<T>(key: string, load: () => Promise<T>, ttl = DEFAULT_TTL_MS): Promise<T> {
      const existing = store.get(key)
      if (fresh(existing)) return existing.promise as Promise<T>
      const entry: Entry = { promise: Promise.resolve(), settled: false, at: now(), ttl }
      entry.promise = load().then(
        (value) => {
          entry.value = value
          entry.settled = true
          return value
        },
        (err) => {
          if (store.get(key) === entry) store.delete(key) // let the next attempt retry
          throw err
        },
      )
      store.set(key, entry)
      return entry.promise as Promise<T>
    },

    /** Store a value directly (something we worked out, rather than fetched). */
    set<T>(key: string, value: T, ttl = DEFAULT_TTL_MS): void {
      store.set(key, { promise: Promise.resolve(value), value, settled: true, at: now(), ttl })
    },

    /** The value if it's already loaded and fresh; otherwise undefined. Synchronous. */
    peek<T>(key: string): T | undefined {
      const entry = store.get(key)
      return fresh(entry) && entry.settled ? (entry.value as T) : undefined
    },

    /** Forget something that changed (e.g. after liking a song); pages showing it reload. */
    invalidate(prefix: string): void {
      for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key)
      for (const [key, fns] of listeners) if (key.startsWith(prefix)) fns.forEach((fn) => fn())
    },

    /** Be told when `key` is invalidated. Returns an unsubscribe function. */
    subscribe(key: string, fn: () => void): () => void {
      const set = listeners.get(key) ?? new Set()
      set.add(fn)
      listeners.set(key, set)
      return () => {
        set.delete(fn)
        if (set.size === 0) listeners.delete(key)
      }
    },

    clear(): void {
      store.clear()
    },
  }
}

/** The app's shared cache. */
export const appCache = createCache()

/** Cache keys, in one place so prefetching and pages always agree. */
export const keys = {
  me: () => 'me',
  fans: (artistId: string) => `fans:${artistId}`,
  mix: (id: string) => `mix:${id}`,
  show: (id: string) => `show:${id}`,
  lyrics: (uri: string) => `lyrics:${uri}`,
  album: (id: string) => `album:${id}`,
  playlist: (id: string) => `playlist:${id}`,
  playlistLive: (id: string) => `playlist-live:${id}`,
  artist: (id: string) => `artist:${id}`,
  artistTop: (id: string) => `artist-top:${id}`,
  artistDiscography: (id: string) => `artist-discography:${id}`,
  artistSongs: (id: string, offset: number) => `artist-songs:${id}:${offset}`,
  savedAlbums: () => 'library:saved-albums',
  library: (section: string) => `library:${section}`,
  liked: (offset: number) => `liked:${offset}`,
  home: (section: string) => `home:${section}`,
}

export type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string }

/**
 * Load `key` through the cache. If it's already there, the very first render
 * shows it, with no loading placeholder and no flicker.
 * Pass `null` as the key to wait (load nothing yet).
 */
export function useCached<T>(key: string | null, load: () => Promise<T>, ttl = DEFAULT_TTL_MS): Load<T> {
  const [result, setResult] = useState<{ key: string; value: Load<T> } | null>(null)
  // Bumped when the key is invalidated, which re-runs the load below. The old
  // data stays on screen until the new data arrives (no flash of skeletons).
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (key === null) return
    return appCache.subscribe(key, () => setRevision((r) => r + 1))
  }, [key])
  // Callers pass a fresh arrow function each render; keep the latest in a ref.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    if (key === null) return
    let cancelled = false
    appCache
      .get(key, () => loadRef.current(), ttl)
      .then(
        (data) => !cancelled && setResult({ key, value: { status: 'ready', data } }),
        (err: Error) => !cancelled && setResult({ key, value: { status: 'error', message: err.message } }),
      )
    return () => {
      cancelled = true
    }
  }, [key, ttl, revision])

  if (key === null) return { status: 'loading' }
  if (result?.key === key) return result.value
  const hit = appCache.peek<T>(key)
  return hit !== undefined ? { status: 'ready', data: hit } : { status: 'loading' }
}
