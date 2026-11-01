import { Fragment, type MouseEvent } from 'react'
import { usePrefetchOnHover } from '../lib/prefetch'
import { type AlbumRef, type ArtistRef, useNavigation } from '../navigation'

// Links sit on top of rows that play when clicked, so they must not also
// trigger the row.
const only = (fn: () => void) => (event: MouseEvent) => {
  event.stopPropagation()
  fn()
}

/** "Massive Attack, Tricky": each name opens that artist's page in Aurora. */
export function ArtistLinks({ artists }: { artists: ArtistRef[] }) {
  const nav = useNavigation()
  if (!nav) return <>{artists.map((a) => a.name).join(', ')}</>
  return (
    <>
      {artists.map((artist, i) => (
        <Fragment key={artist.id}>
          {i > 0 && ', '}
          <ArtistLink artist={artist} />
        </Fragment>
      ))}
    </>
  )
}

function ArtistLink({ artist }: { artist: ArtistRef }) {
  const nav = useNavigation()
  const prefetch = usePrefetchOnHover(nav?.prefetchArtist ? () => nav.prefetchArtist?.(artist) : undefined)
  if (!nav) return <>{artist.name}</>
  return (
    <button className="inline-link subtle" onClick={only(() => nav.openArtist(artist))} {...prefetch}>
      {artist.name}
    </button>
  )
}

/** An album name that opens the album's page in Aurora. */
export function AlbumLink({ album, className = 'inline-link subtle' }: { album: AlbumRef; className?: string }) {
  const nav = useNavigation()
  const prefetch = usePrefetchOnHover(nav?.prefetchAlbum ? () => nav.prefetchAlbum?.(album) : undefined)
  if (!nav || !album.id) return <>{album.name}</>
  return (
    <button className={className} onClick={only(() => nav.openAlbum(album))} {...prefetch}>
      {album.name}
    </button>
  )
}
