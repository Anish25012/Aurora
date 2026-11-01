import { Heart } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useLibrary } from '../library'

/** ♥ for a song: filled when it's in Liked Songs. Click to like / unlike. */
export function LikeButton({ uri, name, size = 16 }: { uri: string; name: string; size?: number }) {
  const library = useLibrary()
  if (!library) return null
  const liked = library.isSaved(uri) === true
  const onClick = (e: MouseEvent) => {
    e.stopPropagation() // it sits on rows that play when clicked
    library.toggle(uri, name)
  }
  return (
    <button
      className={`inline-link like-button${liked ? ' is-liked' : ''}`}
      onClick={onClick}
      aria-label={liked ? `Remove ${name} from Liked Songs` : `Save ${name} to Liked Songs`}
      aria-pressed={liked}
      title={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
    >
      {/* key: a fresh icon on change, so the little "pop" animation replays */}
      <Heart key={String(liked)} size={size} fill={liked ? 'currentColor' : 'none'} />
    </button>
  )
}
