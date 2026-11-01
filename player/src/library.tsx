import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { appCache } from './lib/cache'
import type { SpotifyApi } from './spotify/api'
import { SpotifyApiError } from './spotify/api'

// Collect the songs that appear on screen for a moment, then ask Spotify about
// all of them in one request (up to 40 per request) rather than one by one.
const BATCH_DELAY_MS = 80

export interface Library {
  /** true / false once known; undefined while Spotify hasn't been asked yet. */
  isSaved: (uri: string) => boolean | undefined
  /** Ask about these items (liked song? followed artist?) if we don't know yet. */
  watch: (uris: string[]) => void
  /** Like / unlike, follow / unfollow. Updates instantly; reverts if Spotify refuses. */
  toggle: (uri: string, name?: string) => void
}

export const LibraryContext = createContext<Library | null>(null)

export function useLibrary(): Library | null {
  return useContext(LibraryContext)
}

/** The app's single record of what's in "Your Library". Created once in the Shell. */
export function useLibraryState(
  api: Pick<SpotifyApi, 'libraryContains' | 'saveToLibrary' | 'removeFromLibrary'>,
  notify: (message: string) => void,
): Library {
  const [saved, setSaved] = useState<Map<string, boolean>>(() => new Map())
  const asked = useRef(new Set<string>())
  const queue = useRef(new Set<string>())
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const flush = useCallback(() => {
    const uris = [...queue.current]
    queue.current.clear()
    if (uris.length === 0) return
    api.libraryContains(uris).then(
      (flags) =>
        setSaved((prev) => {
          const next = new Map(prev)
          uris.forEach((uri, i) => {
            // Don't overwrite a toggle the user made while this request was in flight.
            if (!next.has(uri)) next.set(uri, flags[i] ?? false)
          })
          return next
        }),
      () => uris.forEach((uri) => asked.current.delete(uri)), // try again next time they're shown
    )
  }, [api])

  const watch = useCallback(
    (uris: string[]) => {
      let added = false
      for (const uri of uris) {
        if (asked.current.has(uri)) continue
        asked.current.add(uri)
        queue.current.add(uri)
        added = true
      }
      if (!added) return
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, BATCH_DELAY_MS)
    },
    [flush],
  )

  const toggle = useCallback(
    (uri: string, name?: string) => {
      const was = saved.get(uri) ?? false
      setSaved((prev) => new Map(prev).set(uri, !was)) // show it immediately
      const kind = uri.split(':')[1] // track, album, show, artist...
      ;(was ? api.removeFromLibrary([uri]) : api.saveToLibrary([uri])).then(
        () => {
          appCache.invalidate('liked') // Liked Songs / Library pages will refresh
          appCache.invalidate('library')
          if (name && kind === 'track')
            notify(was ? `Removed “${name}” from Liked Songs` : `Added “${name}” to Liked Songs`)
          else if (name && kind !== 'artist')
            notify(was ? `Removed “${name}” from Your Library` : `Added “${name}” to Your Library`)
        },
        (err) => {
          setSaved((prev) => new Map(prev).set(uri, was)) // put it back
          notify(err instanceof SpotifyApiError ? err.message : "Couldn't update your library.")
        },
      )
    },
    [api, saved, notify],
  )

  return { isSaved: (uri) => saved.get(uri), watch, toggle }
}
