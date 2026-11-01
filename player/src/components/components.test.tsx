import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { NowPlaying } from '../player/usePlayer'
import type { Track } from '../spotify/api'
import { NavigationContext } from '../navigation'
import { stoppedAt } from '../player/clock'
import { NowPlayingBar } from './NowPlayingBar'
import { SearchView } from './SearchView'
import { TrackList } from './TrackList'

function track(id: string, name: string, artist = 'Massive Attack'): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: [{ id: 'a', name: artist }],
    album: { id: 'al', name: 'Mezzanine', images: [{ url: `https://img/${id}`, width: 64 }] },
    duration_ms: 330_000,
    explicit: id === 'explicit',
    external_urls: {},
  }
}

describe('SearchView', () => {
  it('searches after typing pauses and plays the clicked result in context', async () => {
    const results = [track('t1', 'Teardrop'), track('t2', 'Angel')]
    const search = vi.fn(async () => ({ tracks: results }))
    const onPlay = vi.fn()
    render(<SearchView search={search} onPlay={onPlay} currentUri={null} />)

    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'massive')
    const angel = await screen.findByRole('button', { name: 'Play Angel by Massive Attack' })

    expect(search).toHaveBeenCalledTimes(1) // debounced: one request, not seven
    expect(search).toHaveBeenCalledWith('massive')
    await userEvent.click(angel)
    expect(onPlay).toHaveBeenCalledWith(results, 1)
  })

  it('shows API errors', async () => {
    const search = vi.fn(async () => {
      throw new Error('Spotify is rate limiting requests.')
    })
    render(<SearchView search={search} onPlay={vi.fn()} currentUri={null} />)
    await userEvent.type(screen.getByRole('searchbox'), 'x')
    expect(await screen.findByText('Spotify is rate limiting requests.')).toBeInTheDocument()
  })

  it('shows a moving equaliser on the playing song, frozen when paused', async () => {
    const tracks = [track('t1', 'Teardrop'), track('t2', 'Angel')]
    const { container, rerender } = render(
      <SearchView search={async () => ({ tracks })} onPlay={vi.fn()} currentUri="spotify:track:t2" isPaused={false} />,
    )
    await userEvent.type(screen.getByRole('searchbox'), 'm')
    await screen.findByRole('button', { name: 'Pause Angel by Massive Attack' })

    const eqs = container.querySelectorAll('.eq')
    expect(eqs).toHaveLength(1) // only the playing row
    // The highlight and equaliser belong to the row around the (invisible) play button.
    expect(
      screen.getByRole('button', { name: 'Pause Angel by Massive Attack' }).closest('.track-row'),
    ).toContainElement(eqs[0] as HTMLElement)
    expect(eqs[0]).not.toHaveClass('is-paused')

    rerender(<SearchView search={async () => ({ tracks })} onPlay={vi.fn()} currentUri="spotify:track:t2" isPaused />)
    expect(container.querySelector('.eq')).toHaveClass('is-paused')
  })

  it('highlights the song that is playing', async () => {
    render(
      <SearchView
        search={async () => ({ tracks: [track('t1', 'Teardrop')] })}
        onPlay={vi.fn()}
        currentUri="spotify:track:t1"
      />,
    )
    await userEvent.type(screen.getByRole('searchbox'), 'tear')
    const row = (await screen.findByRole('button', { name: 'Pause Teardrop by Massive Attack' })).closest('.track-row')
    expect(row).toHaveClass('is-current')
  })
})

describe('NowPlayingBar', () => {
  const nowPlaying: NowPlaying = {
    uri: 'spotify:track:t1',
    name: 'Teardrop',
    artists: 'Massive Attack',
    album: 'Mezzanine',
    imageUrl: 'https://img/t1',
    spotifyUrl: 'https://open.spotify.com/track/t1',
    paused: false,
    durationMs: 330_000,
    contextUri: null,
    artistRefs: [{ id: 'ma', name: 'Massive Attack' }],
    albumRef: { id: 'mz', name: 'Mezzanine', images: [] },
  }

  function renderBar(overrides: Partial<Parameters<typeof NowPlayingBar>[0]> = {}) {
    const props = {
      status: 'ready' as const,
      track: nowPlaying,
      clock: stoppedAt(61_000),
      volume: 0.7,
      togglePlay: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
      seek: vi.fn(),
      setVolume: vi.fn(),
      ...overrides,
    }
    render(<NowPlayingBar {...props} />)
    return props
  }

  it('shows the track, a small link back to Spotify, and the progress', () => {
    renderBar()
    expect(screen.getByText('Teardrop')).toBeInTheDocument()
    // The only link out of Aurora (Spotify's attribution rule); names open pages inside Aurora.
    expect(screen.getByRole('link', { name: 'via Spotify' })).toHaveAttribute(
      'href',
      'https://open.spotify.com/track/t1',
    )
    expect(screen.getByText('1:01')).toBeInTheDocument()
    expect(screen.getByText('5:30')).toBeInTheDocument()
  })

  it('wires the transport buttons', async () => {
    const props = renderBar()
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(props.togglePlay).toHaveBeenCalledOnce()
    expect(props.next).toHaveBeenCalledOnce()
    expect(props.previous).toHaveBeenCalledOnce()
  })

  it('shows Play when paused, and disables controls with nothing loaded', () => {
    renderBar({ track: null })
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(screen.getByText('Not playing')).toBeInTheDocument()
  })

  it('seeks only when the user lets go of the slider', () => {
    const props = renderBar()
    const slider = screen.getByRole('slider', { name: 'Seek' })
    act(() => {
      fireEvent.change(slider, { target: { value: '120000' } })
    })
    expect(props.seek).not.toHaveBeenCalled()
    expect(screen.getByText('2:00')).toBeInTheDocument() // shows the drag position
    fireEvent.pointerUp(slider)
    expect(props.seek).toHaveBeenCalledWith(120_000)
  })

  it('changes volume with the slider', () => {
    const props = renderBar()
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.3' } })
    expect(props.setVolume).toHaveBeenCalledWith(0.3)
  })

  it('unmuting returns to the previous level, not a loud default', async () => {
    const setVolume = vi.fn()
    const { rerender } = render(
      <NowPlayingBar
        status="ready"
        track={nowPlaying}
        clock={stoppedAt(0)}
        volume={0.35}
        togglePlay={vi.fn()}
        next={vi.fn()}
        previous={vi.fn()}
        seek={vi.fn()}
        setVolume={setVolume}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(setVolume).toHaveBeenLastCalledWith(0)

    rerender(
      <NowPlayingBar
        status="ready"
        track={nowPlaying}
        clock={stoppedAt(0)}
        volume={0}
        togglePlay={vi.fn()}
        next={vi.fn()}
        previous={vi.fn()}
        seek={vi.fn()}
        setVolume={setVolume}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(setVolume).toHaveBeenLastCalledWith(0.35)
  })
})

describe('play / pause feedback', () => {
  it('clicking the playing song pauses it instead of restarting, and its label says so', async () => {
    const tracks = [track('t1', 'Teardrop'), track('t2', 'Angel')]
    const onPlay = vi.fn()
    const onTogglePlay = vi.fn()
    const { rerender } = render(
      <SearchView
        search={async () => ({ tracks })}
        onPlay={onPlay}
        onTogglePlay={onTogglePlay}
        currentUri="spotify:track:t2"
        isPaused={false}
      />,
    )
    await userEvent.type(screen.getByRole('searchbox'), 'm')

    const playing = await screen.findByRole('button', { name: 'Pause Angel by Massive Attack' })
    expect(playing).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(playing)
    expect(onTogglePlay).toHaveBeenCalledOnce()
    expect(onPlay).not.toHaveBeenCalled()

    rerender(
      <SearchView
        search={async () => ({ tracks })}
        onPlay={onPlay}
        onTogglePlay={onTogglePlay}
        currentUri="spotify:track:t2"
        isPaused
      />,
    )
    expect(screen.getByRole('button', { name: 'Resume Angel by Massive Attack' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

describe('in-app links', () => {
  const nav = { openArtist: vi.fn(), openAlbum: vi.fn() }

  it('song rows: artist and album names open pages in Aurora, and do not start the song', async () => {
    const onPlay = vi.fn()
    const tracks = [track('t1', 'Teardrop')]
    render(
      <NavigationContext.Provider value={nav}>
        <TrackList label="Songs" tracks={tracks} onPlay={onPlay} currentUri={null} />
      </NavigationContext.Provider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Massive Attack' }))
    expect(nav.openArtist).toHaveBeenCalledWith({ id: 'a', name: 'Massive Attack' })
    await userEvent.click(screen.getByRole('button', { name: 'Mezzanine' }))
    expect(nav.openAlbum).toHaveBeenCalledWith(expect.objectContaining({ id: 'al', name: 'Mezzanine' }))
    expect(onPlay).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Play Teardrop by Massive Attack' }))
    expect(onPlay).toHaveBeenCalledWith(tracks, 0)
  })

  it('the player bar: the song opens its album, the artist opens their page', async () => {
    render(
      <NavigationContext.Provider value={nav}>
        <NowPlayingBar
          status="ready"
          track={{
            uri: 'spotify:track:t1',
            name: 'Teardrop',
            artists: 'Massive Attack',
            album: 'Mezzanine',
            imageUrl: null,
            spotifyUrl: null,
            paused: false,
            durationMs: 1000,
            contextUri: null,
            artistRefs: [{ id: 'ma', name: 'Massive Attack' }],
            albumRef: { id: 'mz', name: 'Mezzanine', images: [] },
          }}
          clock={stoppedAt(0)}
          volume={0.5}
          togglePlay={vi.fn()}
          next={vi.fn()}
          previous={vi.fn()}
          seek={vi.fn()}
          setVolume={vi.fn()}
        />
      </NavigationContext.Provider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Teardrop' }))
    expect(nav.openAlbum).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'mz' }))
    await userEvent.click(screen.getByRole('button', { name: 'Massive Attack' }))
    expect(nav.openArtist).toHaveBeenLastCalledWith({ id: 'ma', name: 'Massive Attack' })
  })
})

describe('playlists from the song menu', () => {
  it('right-click → Add to playlist lists your playlists and adds the song', async () => {
    const nav = {
      openArtist: vi.fn(),
      openAlbum: vi.fn(),
      editablePlaylists: vi.fn(async () => [{ id: 'p1', name: 'Road trip' }]),
      addToPlaylist: vi.fn(),
      newPlaylistWith: vi.fn(),
    }
    const tracks = [track('t1', 'Teardrop')]
    render(
      <NavigationContext.Provider value={nav}>
        <TrackList label="Songs" tracks={tracks} onPlay={vi.fn()} currentUri={null} />
      </NavigationContext.Provider>,
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Play Teardrop by Massive Attack' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Add to playlist/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Road trip' }))
    expect(nav.addToPlaylist).toHaveBeenCalledWith({ id: 'p1', name: 'Road trip' }, tracks[0])
  })

  it('page-specific menu items, and drag to reorder', async () => {
    const remove = vi.fn()
    const onReorder = vi.fn()
    const tracks = [track('t1', 'Teardrop'), track('t2', 'Angel')]
    render(
      <TrackList
        label="Songs"
        tracks={tracks}
        onPlay={vi.fn()}
        currentUri={null}
        onReorder={onReorder}
        rowActions={(t) => [{ label: 'Remove from this playlist', icon: null, onSelect: () => remove(t) }]}
      />,
    )
    const rows = screen.getAllByRole('listitem')
    fireEvent.dragStart(rows[0].firstElementChild!, { dataTransfer: { effectAllowed: '' } })
    fireEvent.dragOver(rows[1].firstElementChild!)
    fireEvent.drop(rows[1].firstElementChild!)
    expect(onReorder).toHaveBeenCalledWith(0, 1)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Play Angel by Massive Attack' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Remove from this playlist/ }))
    expect(remove).toHaveBeenCalledWith(tracks[1])
  })
})

describe('grouped search', () => {
  const artist = { id: 'ma', uri: 'spotify:artist:ma', name: 'Massive Attack', images: [] }
  const album = {
    id: 'mz',
    uri: 'spotify:album:mz',
    name: 'Mezzanine',
    images: [],
    release_date: '1998-04-20',
    album_type: 'album' as const,
    total_tracks: 11,
    artists: [{ id: 'ma', name: 'Massive Attack' }],
  }
  const playlist = { id: 'pl', uri: 'spotify:playlist:pl', name: 'Trip hop', description: null, images: [], owner: {} }
  const results = {
    tracks: [track('t1', 'Teardrop'), track('t2', 'Angel')],
    artists: [artist],
    albums: [album],
    playlists: [playlist],
  }

  function renderSearch(extra = {}) {
    const nav = { openArtist: vi.fn(), openAlbum: vi.fn() }
    const props = {
      search: vi.fn(async () => results),
      onPlay: vi.fn(),
      onOpenPlaylist: vi.fn(),
      currentUri: null,
      ...extra,
    }
    render(
      <NavigationContext.Provider value={nav}>
        <SearchView {...props} />
      </NavigationContext.Provider>,
    )
    return { nav, props }
  }

  it('groups results: an exact artist match is the top result, then songs, albums and playlists', async () => {
    const { nav, props } = renderSearch()
    await userEvent.type(screen.getByRole('searchbox'), 'massive attack')
    const top = await screen.findByRole('region', { name: 'Top result' })
    await userEvent.click(within(top).getByRole('button', { name: 'Open Massive Attack' }))
    expect(nav.openArtist).toHaveBeenCalledWith(artist)

    await userEvent.click(screen.getByRole('button', { name: 'Open album Mezzanine' }))
    expect(nav.openAlbum).toHaveBeenCalledWith(album)
    await userEvent.click(screen.getByRole('button', { name: 'Open playlist Trip hop' }))
    expect(props.onOpenPlaylist).toHaveBeenCalledWith(playlist)
  })

  it('filter chips show one kind at a time', async () => {
    renderSearch()
    await userEvent.type(screen.getByRole('searchbox'), 'mass')
    await userEvent.click(await screen.findByRole('tab', { name: 'Albums' }))
    expect(screen.getByRole('button', { name: 'Open album Mezzanine' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Play Teardrop/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Podcasts' })).toBeNull() // no podcast support wired in
  })

  it('remembers searches you acted on, and they can be removed', async () => {
    localStorage.clear()
    const first = renderSearch()
    await userEvent.type(screen.getByRole('searchbox'), 'teardrop')
    await userEvent.click(await screen.findByRole('button', { name: 'Play Angel by Massive Attack' }))
    expect(first.props.onPlay).toHaveBeenCalled()
    await userEvent.clear(screen.getByRole('searchbox'))

    const recent = await screen.findByRole('region', { name: 'Recent searches' })
    await userEvent.click(within(recent).getByRole('button', { name: 'teardrop' }))
    expect(screen.getByRole('searchbox')).toHaveValue('teardrop')
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove teardrop from recent searches' }))
    expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull()
  })
})
