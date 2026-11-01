import { ChevronLeft, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Playlist, SpotifyApi, Track } from '../spotify/api'
import { appCache, keys, useCached } from '../lib/cache'
import { plainText, songsAndLength } from '../lib/format'
import { useLoadMoreOnScroll } from '../lib/useLoadMoreOnScroll'
import { CollectionHero, Dot } from './CollectionHero'
import { PlaylistDetailsDialog } from './PlaylistDetailsDialog'
import { TrackList } from './TrackList'

interface Props {
  playlist: Playlist
  api: Pick<SpotifyApi, 'playlistTracks' | 'queue'> &
    Partial<Pick<SpotifyApi, 'removeFromPlaylist' | 'reorderPlaylist' | 'updatePlaylistDetails'>>
  /** It's your playlist: rename, reorder and remove songs. */
  editable?: boolean
  /** Open the Edit details dialog straight away (a brand-new playlist). */
  editOnOpen?: boolean
  onNotify?: (message: string) => void
  /** Play this playlist, starting at a given song (or the first). */
  onPlayPlaylist: (playlistUri: string, startUri?: string) => void
  onTogglePlay: () => void
  onBack: () => void
  currentUri: string | null
  currentContextUri: string | null
  isPaused: boolean
}

type Listing = { tracks: Track[]; total: number; restricted: boolean; nextOffset?: number | null }

// Queue retries after pressing Play: 0.3s, 0.6s, 1.2s, 2.4s, 4.8s.
const RETRIES = 5
const RETRY_BASE_MS = 300
// Songs seen for someone else's playlist are kept for the session (memory only).
const SESSION_MS = 12 * 60 * 60_000

export function PlaylistView({
  playlist,
  api,
  onPlayPlaylist,
  onTogglePlay,
  onBack,
  currentUri,
  currentContextUri,
  isPaused,
  editable = false,
  editOnOpen = false,
  onNotify = () => {},
}: Props) {
  // Through the cache: usually already loaded by hovering the card, so the page appears instantly.
  const cached = useCached<Listing>(keys.playlist(playlist.id), () => api.playlistTracks(playlist.id))
  const load = cached.status === 'ready' ? { status: 'ready' as const, ...cached.data } : cached
  const restricted = load.status === 'ready' && load.restricted
  const playingHere = currentContextUri === playlist.uri

  // Spotify won't list someone else's playlist, but once it's playing, the queue
  // shows what's playing and what's coming up (about 20 songs).
  //
  // Right after pressing Play, Spotify takes a moment to switch its queue over,
  // so the first answer can be empty or still the old songs. We retry with
  // short, growing pauses until the queue really is this playlist's. The list
  // is remembered, so reopening the page while it plays shows it instantly.
  const [live, setLive] = useState<Track[]>(() => appCache.peek<Track[]>(keys.playlistLive(playlist.id)) ?? [])
  useEffect(() => {
    if (!restricted || !playingHere) return
    let cancelled = false
    let timer: number | undefined
    let attempt = 0
    const fetchQueue = () => {
      api.queue().then(
        ({ current, upNext }) => {
          if (cancelled) return
          // Ready = Spotify's "now playing" is the song we expect (or we don't know
          // which yet), and there's something lined up after it.
          const caughtUp = current !== null && (currentUri === null || current.uri === currentUri)
          if (caughtUp && (upNext.length > 0 || attempt >= RETRIES)) {
            // Add what's new to what we've already seen, so the list grows as the
            // playlist plays, and stays when it stops (until Aurora closes).
            setLive((seen) => {
              const known = new Set(seen.map((t) => t.uri))
              const merged = [...seen, ...[current, ...upNext].filter((t) => !known.has(t.uri))]
              appCache.set(keys.playlistLive(playlist.id), merged, SESSION_MS)
              return merged
            })
          } else if (attempt < RETRIES) {
            attempt += 1
            timer = window.setTimeout(fetchQueue, RETRY_BASE_MS * 2 ** (attempt - 1))
          }
        },
        () => {
          if (!cancelled && attempt < RETRIES) {
            attempt += 1
            timer = window.setTimeout(fetchQueue, RETRY_BASE_MS * 2 ** (attempt - 1))
          }
        },
      )
    }
    fetchQueue()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [api, restricted, playingHere, currentUri, playlist.id])

  // Someone else's playlist: the songs Aurora has seen while it played (shown even when it's not playing).
  // Long playlists arrive 100 songs at a time: the rest load as you scroll down.
  const [extra, setExtra] = useState<{ id: string; tracks: Track[]; nextOffset: number | null; loading: boolean }>({
    id: playlist.id,
    tracks: [],
    nextOffset: null,
    loading: false,
  })
  const ownExtra = extra.id === playlist.id && (extra.tracks.length > 0 || extra.loading) ? extra : null
  const nextOffset = ownExtra ? ownExtra.nextOffset : load.status === 'ready' ? (load.nextOffset ?? null) : null
  // Songs removed here shift Spotify's positions; the next page starts that much earlier.
  const removedCount = useRef(0)
  const loaded = load.status === 'ready' ? (restricted ? live : [...load.tracks, ...(ownExtra?.tracks ?? [])]) : []

  // Your own playlist: edits show instantly, then are sent to Spotify. If Spotify
  // refuses, the list goes back to how it was. Keyed by playlist so another
  // playlist never shows these edits.
  const [edited, setEdited] = useState<{ id: string; tracks: Track[] } | null>(null)
  const tracks = edited?.id === playlist.id ? edited.tracks : loaded
  const [details, setDetails] = useState<{ id: string; name: string; description: string } | null>(null)
  const name = details?.id === playlist.id ? details.name : playlist.name
  const description =
    details?.id === playlist.id ? details.description : playlist.description ? plainText(playlist.description) : ''
  const [dialogOpen, setDialogOpen] = useState(editOnOpen)

  const loadMore = () => {
    if (nextOffset === null || ownExtra?.loading) return
    const id = playlist.id
    setExtra((e) => ({ ...(e.id === id ? e : { tracks: [] }), id, nextOffset, loading: true }))
    api.playlistTracks(id, 100, Math.max(0, nextOffset - removedCount.current)).then(
      (page) => {
        removedCount.current = 0
        setExtra((e) =>
          e.id === id
            ? { id, tracks: [...e.tracks, ...page.tracks], nextOffset: page.nextOffset ?? null, loading: false }
            : e,
        )
        // Keep any edits made meanwhile, with the new songs after them.
        setEdited((ed) => (ed?.id === id ? { id, tracks: [...ed.tracks, ...page.tracks] } : ed))
      },
      () => setExtra((e) => (e.id === id ? { ...e, loading: false } : e)),
    )
  }
  const endRef = useLoadMoreOnScroll<HTMLDivElement>(loadMore, !restricted && nextOffset !== null && !ownExtra?.loading)

  const commit = (next: Track[], send: () => Promise<void> | undefined, failMessage: string) => {
    const before = tracks
    setEdited({ id: playlist.id, tracks: next })
    const listing = load.status === 'ready' ? load : null
    Promise.resolve(send()).then(
      () => {
        removedCount.current += Math.max(0, before.length - next.length)
        if (listing)
          appCache.set(keys.playlist(playlist.id), {
            ...listing,
            tracks: next,
            total: listing.total - (before.length - next.length),
            nextOffset,
          })
      },
      () => {
        setEdited({ id: playlist.id, tracks: before })
        onNotify(failMessage)
      },
    )
  }
  const remove = (track: Track) =>
    commit(
      tracks.filter((t) => t.uri !== track.uri), // Spotify removes every copy of the song
      () => api.removeFromPlaylist?.(playlist.id, [track.uri]),
      "Couldn't remove that song.",
    )
  const reorder = (from: number, to: number) => {
    const next = [...tracks]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    commit(next, () => api.reorderPlaylist?.(playlist.id, from, to), "Couldn't move that song.")
  }
  const saveDetails = (d: { name: string; description: string }) => {
    const before = { name, description }
    setDetails({ id: playlist.id, ...d })
    setDialogOpen(false)
    Promise.resolve(api.updatePlaylistDetails?.(playlist.id, d)).then(
      () => appCache.invalidate('library'),
      () => {
        setDetails({ id: playlist.id, ...before })
        onNotify("Couldn't rename the playlist.")
      },
    )
  }

  return (
    <section className="album-page" key={playlist.id}>
      <button className="back-button" onClick={onBack}>
        <ChevronLeft size={16} /> Back
      </button>

      <CollectionHero
        kind="Playlist"
        title={name}
        images={playlist.images ?? []}
        playingHere={currentContextUri === playlist.uri}
        isPaused={isPaused}
        // Restricted playlists can still be played whole, even though we can't list them.
        canPlay={load.status === 'ready' && (tracks.length > 0 || load.restricted)}
        onPlay={() => onPlayPlaylist(playlist.uri)}
        onTogglePlay={onTogglePlay}
        actions={
          editable && (
            <button className="pill-button outline" onClick={() => setDialogOpen(true)}>
              <Pencil size={14} /> Edit
            </button>
          )
        }
        meta={
          <>
            {playlist.owner.display_name && <strong className="meta-strong">{playlist.owner.display_name}</strong>}
            {tracks.length > 0 && (
              <>
                {playlist.owner.display_name && <Dot />}
                {songsAndLength(tracks.map((t) => t.duration_ms))}
              </>
            )}
            {description && <span className="album-description">{description}</span>}
          </>
        }
      />

      <section className="shelf" aria-label="Songs">
        {load.status === 'loading' && [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" />)}
        {load.status === 'error' && <p className="shelf-error">{load.message}</p>}
        {restricted && !playingHere && tracks.length === 0 && <p className="hint">Press Play to see its songs.</p>}
        {restricted && playingHere && tracks.length === 0 && [0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
        {load.status === 'ready' && !load.restricted && tracks.length === 0 && (
          <p className="shelf-error">This playlist is empty.</p>
        )}
        {tracks.length > 0 && (
          <TrackList
            label={`${name} songs`}
            tracks={tracks}
            numbered
            // Play within the playlist, so Next follows the playlist's order.
            onPlay={(list, index) => onPlayPlaylist(playlist.uri, list[index].uri)}
            onTogglePlay={onTogglePlay}
            currentUri={currentUri}
            isPaused={isPaused}
            onReorder={editable && !restricted ? reorder : undefined}
            rowActions={
              editable && !restricted
                ? (track) => [
                    { label: 'Remove from this playlist', icon: <Trash2 size={16} />, onSelect: () => remove(track) },
                  ]
                : undefined
            }
          />
        )}
        {editable && !restricted && tracks.length > 1 && (
          <p className="attribution">Drag songs to reorder. Right-click a song to remove it.</p>
        )}
        {ownExtra?.loading && [0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
        {!restricted && nextOffset !== null && !ownExtra?.loading && tracks.length > 0 && (
          <button className="show-more" onClick={loadMore}>
            Show more songs
          </button>
        )}
        <div ref={endRef} aria-hidden />
      </section>

      <p className="attribution">Playlist data and artwork provided by Spotify.</p>
      {dialogOpen && (
        <PlaylistDetailsDialog
          name={name}
          description={description}
          onSave={saveDetails}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </section>
  )
}
