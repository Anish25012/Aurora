import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { stoppedAt } from '../player/clock'
import { describe, expect, it, vi } from 'vitest'
import type { NowPlaying } from '../player/usePlayer'
import { NowPlayingView } from './NowPlayingView'

const track: NowPlaying = {
  uri: 'spotify:track:t1',
  name: 'Teardrop',
  artists: 'Massive Attack',
  album: 'Mezzanine',
  imageUrl: 'https://img/t1',
  spotifyUrl: null,
  paused: false,
  durationMs: 330_000,
  contextUri: null,
  artistRefs: [{ id: 'ma', name: 'Massive Attack' }],
  albumRef: { id: 'mz', name: 'Mezzanine', images: [] },
}

function renderView(props: Partial<Parameters<typeof NowPlayingView>[0]> = {}) {
  const all = {
    status: 'ready' as const,
    track,
    clock: stoppedAt(6000),
    togglePlay: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    onClose: vi.fn(),
    loadLyrics: vi.fn(async () => ({
      synced: [
        { timeMs: 1000, text: 'Love, love is a verb' },
        { timeMs: 5000, text: 'Love is a doing word' },
        { timeMs: 9000, text: 'Fearless on my breath' },
      ],
      plain: null,
      instrumental: false,
    })),
    ...props,
  }
  render(<NowPlayingView {...all} />)
  return all
}

describe('NowPlayingView', () => {
  it('shows the song, and Esc closes it', async () => {
    const props = renderView()
    expect(screen.getByRole('dialog', { name: 'Now playing' })).toBeInTheDocument()
    expect(screen.getByText('Teardrop')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalled()
  })

  it('lyrics follow the song, and clicking a line jumps there', async () => {
    const props = renderView({ showLyrics: true })
    const sung = await screen.findByRole('button', { name: 'Love is a doing word' })
    expect(sung).toHaveAttribute('aria-current', 'true')
    expect(props.loadLyrics).toHaveBeenCalledWith({
      name: 'Teardrop',
      artist: 'Massive Attack',
      album: 'Mezzanine',
      durationMs: 330_000,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Fearless on my breath' }))
    expect(props.seek).toHaveBeenCalledWith(9000)
    expect(screen.getByRole('link', { name: 'LRCLIB' })).toBeInTheDocument()
  })

  it('says so when there are no lyrics, and loads them only when asked', async () => {
    const loadLyrics = vi.fn(async () => null)
    renderView({ loadLyrics })
    expect(loadLyrics).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Lyrics' }))
    expect(await screen.findByText('No lyrics found for this song.')).toBeInTheDocument()
  })
})
