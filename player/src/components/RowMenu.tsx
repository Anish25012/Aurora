import { ChevronLeft, ChevronRight, Disc3, Heart, ListMusic, ListPlus, Plus, Radio, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLibrary } from '../library'
import { useNavigation } from '../navigation'
import type { Track } from '../spotify/api'

/** A page-specific menu item, e.g. "Remove from this playlist". */
export interface MenuAction {
  label: string
  icon: ReactNode
  onSelect: () => void
}

interface Props {
  track: Track
  extra?: MenuAction[]
  /** Where to open (the click position), in viewport pixels. */
  at: { x: number; y: number }
  onClose: () => void
}

/** The right-click menu for a song: queue it, or jump to its artist or album. */
export function RowMenu({ track, at, onClose, extra = [] }: Props) {
  const nav = useNavigation()
  const library = useLibrary()
  const liked = library?.isSaved(track.uri) === true
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(at)
  // The menu has two panels: the main one, and "Add to playlist" (your playlists).
  const [panel, setPanel] = useState<'main' | 'playlists'>('main')
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[] | null>(null)
  const openPlaylists = () => {
    setPanel('playlists')
    nav?.editablePlaylists?.().then(setPlaylists, () => setPlaylists([]))
  }

  // Keep the menu on screen: flip it left/up if it would spill off an edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(at.x, window.innerWidth - width - 8),
      y: at.y + height > window.innerHeight - 8 ? Math.max(8, at.y - height) : at.y,
    })
  }, [at])

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    ref.current?.querySelector('button')?.focus()
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div
      className="menu"
      ref={ref}
      role="menu"
      aria-label={`${track.name} options`}
      style={{ left: pos.x, top: pos.y }}
    >
      {panel === 'playlists' ? (
        <>
          <button role="menuitem" className="menu-item menu-back" onClick={() => setPanel('main')}>
            <ChevronLeft size={16} /> Add to playlist
          </button>
          <div className="menu-sep" role="separator" />
          {nav?.newPlaylistWith && (
            <button role="menuitem" className="menu-item" onClick={run(() => nav.newPlaylistWith?.(track))}>
              <Plus size={16} /> New playlist
            </button>
          )}
          {playlists === null && <div className="menu-loading">Loading your playlists…</div>}
          <div className="menu-scroll">
            {playlists?.map((p) => (
              <button
                key={p.id}
                role="menuitem"
                className="menu-item"
                onClick={run(() => nav?.addToPlaylist?.(p, track))}
              >
                <ListMusic size={16} /> <span className="menu-label">{p.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {extra.map((action) => (
            <button key={action.label} role="menuitem" className="menu-item" onClick={run(action.onSelect)}>
              {action.icon} {action.label}
            </button>
          ))}
          {nav?.addToPlaylist && (
            <button role="menuitem" className="menu-item" onClick={openPlaylists}>
              <ListPlus size={16} /> Add to playlist <ChevronRight size={14} className="menu-chevron" />
            </button>
          )}
          {library && (
            <button role="menuitem" className="menu-item" onClick={run(() => library.toggle(track.uri, track.name))}>
              <Heart size={16} fill={liked ? 'currentColor' : 'none'} />{' '}
              {liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
            </button>
          )}
          {nav?.addToQueue && (
            <button role="menuitem" className="menu-item" onClick={run(() => nav.addToQueue?.(track))}>
              <ListMusic size={16} /> Add to queue
            </button>
          )}
          {nav?.startRadio && (
            <button role="menuitem" className="menu-item" onClick={run(() => nav.startRadio?.(track))}>
              <Radio size={16} /> Go to song radio
            </button>
          )}
          {nav && (
            <>
              <div className="menu-sep" role="separator" />
              {track.artists.map((a) => (
                <button key={a.id} role="menuitem" className="menu-item" onClick={run(() => nav.openArtist(a))}>
                  <UserRound size={16} /> Go to {track.artists.length > 1 ? a.name : 'artist'}
                </button>
              ))}
              {track.album.id && (
                <button role="menuitem" className="menu-item" onClick={run(() => nav.openAlbum(track.album))}>
                  <Disc3 size={16} /> Go to album
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
