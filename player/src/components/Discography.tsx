import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { Album } from '../spotify/api'
import { useNavigation } from '../navigation'
import { MediaCard } from './MediaCard'

type Filter = 'all' | 'album' | 'single' | 'compilation'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'album', label: 'Albums' },
  { value: 'single', label: 'Singles & EPs' },
  { value: 'compilation', label: 'Compilations' },
]

// One row of covers at a typical window size; "Show all" reveals the rest.
const COLLAPSED = 12

interface Props {
  releases: Album[]
  onOpenAlbum: (album: Album) => void
  currentContextUri: string | null
}

/** Every release by the artist, filterable by type, each opening its album page. */
export function Discography({ releases, onOpenAlbum, currentContextUri }: Props) {
  const nav = useNavigation()
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState(false)

  const counts: Record<Filter, number> = {
    all: releases.length,
    album: releases.filter((r) => r.album_type === 'album').length,
    single: releases.filter((r) => r.album_type === 'single').length,
    compilation: releases.filter((r) => r.album_type === 'compilation').length,
  }
  const shown = filter === 'all' ? releases : releases.filter((r) => r.album_type === filter)
  const visible = expanded ? shown : shown.slice(0, COLLAPSED)

  return (
    <>
      <div className="chips" role="tablist" aria-label="Release type">
        {FILTERS.filter((f) => f.value === 'all' || counts[f.value] > 0).map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            className="chip"
            onClick={() => {
              setFilter(f.value)
              setExpanded(false)
            }}
          >
            {f.label} <span className="chip-count">{counts[f.value]}</span>
          </button>
        ))}
      </div>

      <div className="album-grid discography-grid">
        {visible.map((album) => (
          <MediaCard
            key={album.id}
            title={album.name}
            subtitle={`${album.release_date.slice(0, 4)} · ${
              album.album_type === 'single'
                ? album.total_tracks > 3
                  ? 'EP'
                  : 'Single'
                : album.album_type === 'compilation'
                  ? 'Compilation'
                  : 'Album'
            }`}
            images={album.images}
            current={album.uri === currentContextUri}
            onPlay={() => onOpenAlbum(album)}
            playLabel={`Open ${album.name}`}
            prefetch={() => nav?.prefetchAlbum?.(album)}
            // Opens the album page (full track list) rather than playing straight away.
            showPlayBadge={false}
          />
        ))}
      </div>

      {shown.length > COLLAPSED && (
        <button className="show-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show all ${shown.length}`}
          <ChevronDown size={15} style={expanded ? { transform: 'rotate(180deg)' } : undefined} />
        </button>
      )}
    </>
  )
}
