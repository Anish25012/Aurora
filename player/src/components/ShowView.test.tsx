import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Episode, Show, SpotifyApi } from '../spotify/api'
import { SearchView } from './SearchView'
import { ShowView } from './ShowView'

const show: Show = {
  id: 's1',
  uri: 'spotify:show:s1',
  name: 'Song Exploder',
  publisher: 'Hrishikesh Hirway',
  description: 'Musicians take apart their songs.',
  images: [],
  total_episodes: 3,
}

function episode(id: string, name: string, extra: Partial<Episode> = {}): Episode {
  return {
    id,
    uri: `spotify:episode:${id}`,
    name,
    description: `About ${name}`,
    release_date: '2024-05-01',
    duration_ms: 1_800_000,
    images: [],
    ...extra,
  }
}

const newest = episode('e1', 'Björk', { resume_point: { fully_played: false, resume_position_ms: 600_000 } })
const older = episode('e2', 'Wilco', { resume_point: { fully_played: true, resume_position_ms: 0 } })
const oldest = episode('e3', 'Metallica')

describe('ShowView', () => {
  function renderShow() {
    const api = {
      getShow: vi.fn(async () => ({ ...show, episodes: [newest, older], totalEpisodes: 3 })),
      showEpisodes: vi.fn(async () => [oldest]),
    }
    const onPlayEpisode = vi.fn()
    render(
      <ShowView
        show={show}
        api={api as unknown as Pick<SpotifyApi, 'getShow' | 'showEpisodes'>}
        onPlayEpisode={onPlayEpisode}
        onTogglePlay={vi.fn()}
        onBack={vi.fn()}
        currentUri={null}
        currentContextUri={null}
        isPaused
      />,
    )
    return { api, onPlayEpisode }
  }

  it('lists episodes with how far you got, and plays them in the podcast', async () => {
    const { onPlayEpisode } = renderShow()
    expect(await screen.findByText(/20:00 left/)).toBeInTheDocument() // 30 min, stopped at 10
    expect(screen.getByText(/Played/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Play Wilco' }))
    expect(onPlayEpisode).toHaveBeenCalledWith(older, show, []) // the last one listed: nothing after it
    await userEvent.click(screen.getByRole('button', { name: 'Play Song Exploder' }))
    expect(onPlayEpisode).toHaveBeenLastCalledWith(newest, show, [older]) // the big Play: the newest, then the rest
  })

  it('loads older episodes on request', async () => {
    const { api } = renderShow()
    await userEvent.click(await screen.findByRole('button', { name: 'Show more episodes' }))
    expect(api.showEpisodes).toHaveBeenCalledWith('s1', 2, 50)
    expect(await screen.findByRole('button', { name: 'Play Metallica' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more episodes' })).toBeNull()
  })
})

describe('podcasts in search', () => {
  it('a Podcasts filter lists shows and episodes', async () => {
    const onOpenShow = vi.fn()
    const onPlayEpisode = vi.fn()
    const found = { ...newest, show: { id: 's1', name: 'Song Exploder', images: [] } }
    render(
      <SearchView
        search={async () => ({ shows: [show], episodes: [found] })}
        onPlay={vi.fn()}
        currentUri={null}
        onOpenShow={onOpenShow}
        onPlayEpisode={onPlayEpisode}
      />,
    )
    await userEvent.type(screen.getByRole('searchbox'), 'song exploder')
    await userEvent.click(await screen.findByRole('tab', { name: 'Podcasts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Play Björk' }))
    expect(onPlayEpisode).toHaveBeenCalledWith(found)
    await userEvent.click(screen.getByRole('button', { name: 'Open podcast Song Exploder' }))
    expect(onOpenShow).toHaveBeenCalledWith(show)
  })
})
