import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SpotifyApi, Track } from '../spotify/api'
import { TrackList } from './TrackList'

interface Props {
  api: Pick<SpotifyApi, 'queue'>
  onClose: () => void
  /** Changes when the song changes, so the queue refreshes as it moves along. */
  currentUri: string | null
  isPaused: boolean
  onPlayTracks: (tracks: Track[], index: number) => void
  onTogglePlay: () => void
}

type Load =
  | { status: 'loading' }
  | { status: 'ready'; current: Track | null; upNext: Track[] }
  | { status: 'error'; message: string }

/**
 * The queue: what's playing now and what's coming up. A side panel rather
 * than a page, so you can keep browsing while it's open (no dimming scrim).
 */
export function QueuePanel({ api, onClose, currentUri, isPaused, onPlayTracks, onTogglePlay }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    api.queue().then(
      ({ current, upNext }) => !cancelled && setLoad({ status: 'ready', current, upNext }),
      (err: Error) => !cancelled && setLoad({ status: 'error', message: err.message }),
    )
    return () => {
      cancelled = true
    }
  }, [api, currentUri])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="queue-panel" aria-label="Queue">
      <header className="queue-head">
        <h2>Queue</h2>
        <button className="icon-button subtle" onClick={onClose} aria-label="Close queue">
          <X size={18} />
        </button>
      </header>

      {load.status === 'loading' && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
      {load.status === 'error' && <p className="shelf-error">{load.message}</p>}
      {load.status === 'ready' && (
        <>
          <h3 className="queue-label">Now playing</h3>
          {load.current ? (
            <TrackList
              label="Now playing"
              tracks={[load.current]}
              hideAlbum
              onPlay={() => onTogglePlay()}
              onTogglePlay={onTogglePlay}
              currentUri={load.current.uri}
              isPaused={isPaused}
            />
          ) : (
            <p className="hint">Nothing is playing.</p>
          )}

          <h3 className="queue-label">Next up</h3>
          {load.upNext.length === 0 ? (
            <p className="hint">
              Nothing queued. Right-click any song and choose <strong>Add to queue</strong>.
            </p>
          ) : (
            <TrackList
              label="Next up"
              tracks={load.upNext}
              hideAlbum
              // Spotify can't jump to a position in the queue, so this plays from
              // the clicked song through the rest of what was coming up.
              onPlay={onPlayTracks}
              currentUri={currentUri}
              isPaused={isPaused}
            />
          )}
        </>
      )}
    </aside>
  )
}
