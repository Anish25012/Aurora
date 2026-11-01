import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { keys, useCached } from '../lib/cache'
import { plainText } from '../lib/format'
import { useLibrary } from '../library'
import type { Episode, Show, SpotifyApi } from '../spotify/api'
import { CollectionHero } from './CollectionHero'
import { EpisodeList } from './EpisodeList'

interface Props {
  show: Show
  api: Pick<SpotifyApi, 'getShow' | 'showEpisodes'>
  /** `after`: the episodes that follow it in this list, to play next. */
  onPlayEpisode: (episode: Episode, show: Show, after: Episode[]) => void
  onTogglePlay: () => void
  onBack: () => void
  currentUri: string | null
  currentContextUri: string | null
  isPaused: boolean
}

const PAGE = 50

/** A podcast: newest episodes first, where you left off, and Follow. */
export function ShowView({
  show,
  api,
  onPlayEpisode,
  onTogglePlay,
  onBack,
  currentUri,
  currentContextUri,
  isPaused,
}: Props) {
  const load = useCached(keys.show(show.id), () => api.getShow(show.id))
  const detail = load.status === 'ready' ? load.data : null
  // Older episodes, loaded on request ("Show more"), tagged with their show.
  const [older, setOlder] = useState<{ id: string; episodes: Episode[] }>({ id: show.id, episodes: [] })
  const [loadingMore, setLoadingMore] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const episodes = [...(detail?.episodes ?? []), ...(older.id === show.id ? older.episodes : [])]
  const total = detail?.totalEpisodes ?? show.total_episodes ?? 0

  const library = useLibrary()
  useEffect(() => {
    library?.watch([show.uri])
  }, [library, show.uri])
  const following = library?.isSaved(show.uri)

  const loadMore = () => {
    setLoadingMore(true)
    api.showEpisodes(show.id, episodes.length, PAGE).then(
      (more) => {
        setOlder((o) => ({ id: show.id, episodes: [...(o.id === show.id ? o.episodes : []), ...more] }))
        setLoadingMore(false)
      },
      () => setLoadingMore(false),
    )
  }

  const about = plainText(detail?.description ?? show.description ?? '')
  const play = (episode: Episode) => onPlayEpisode(episode, show, episodes.slice(episodes.indexOf(episode) + 1))

  return (
    <section className="album-page" key={show.id}>
      <button className="back-button" onClick={onBack}>
        <ChevronLeft size={16} /> Back
      </button>

      <CollectionHero
        kind="Podcast"
        title={show.name}
        images={show.images}
        // Episodes play as a list (quicker to start than the whole podcast), so
        // "playing here" means one of these episodes is on.
        playingHere={currentContextUri === show.uri || episodes.some((e) => e.uri === currentUri)}
        isPaused={isPaused}
        canPlay={episodes.length > 0}
        // Play the newest episode, picking up where you left off.
        onPlay={() => episodes[0] && play(episodes[0])}
        onTogglePlay={onTogglePlay}
        actions={
          library && (
            <button
              className={`pill-button outline${following ? ' is-on' : ''}`}
              onClick={() => library.toggle(show.uri, show.name)}
              aria-pressed={following === true}
              disabled={following === undefined}
            >
              {following ? 'Following' : 'Follow'}
            </button>
          )
        }
        meta={
          <>
            <strong>{show.publisher}</strong>
            {total > 0 && <span> · {total} episodes</span>}
          </>
        }
      />

      {about && (
        <section className="show-about" aria-label="About">
          <h2>About</h2>
          <p className={aboutOpen ? undefined : 'is-clamped'}>{about}</p>
          {about.length > 240 && (
            <button className="link-button" onClick={() => setAboutOpen((o) => !o)}>
              {aboutOpen ? 'Show less' : 'Show more'}
            </button>
          )}
        </section>
      )}

      {load.status === 'loading' && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
      {load.status === 'error' && <p className="banner error">{load.message}</p>}
      {episodes.length > 0 && (
        <EpisodeList
          episodes={episodes}
          currentUri={currentUri}
          isPaused={isPaused}
          onPlay={play}
          onTogglePlay={onTogglePlay}
          showName={false}
        />
      )}
      {detail && episodes.length < total && (
        <button className="pill-button outline more-button" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show more episodes'}
        </button>
      )}
      <p className="attribution">Podcast data and artwork provided by Spotify.</p>
    </section>
  )
}
