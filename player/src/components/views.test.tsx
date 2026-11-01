import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { appCache, keys } from '../lib/cache'
import { greetingFor } from '../lib/greeting'
import type { Artist, Playlist, SpotifyApi, Track } from '../spotify/api'
import { AlbumView } from './AlbumView'
import { ArtistView } from './ArtistView'
import { Discography } from './Discography'
import { HomeView } from './HomeView'
import { PlaylistView } from './PlaylistView'

function track(id: string, name: string): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: [{ id: 'a', name: 'Bonobo' }],
    album: { id: 'al', name: 'Migration', images: [{ url: `https://img/${id}`, width: 300 }] },
    duration_ms: 200_000,
    explicit: false,
    external_urls: {},
  }
}

// ------------------------------------------------------------------- home

describe('HomeView', () => {
  const recent = [track('r1', 'Kerala'), track('r2', 'Cirrus')]
  const top = [track('t1', 'Kiara'), track('t2', 'Ketto')]
  const artists: Artist[] = [{ id: 'ar1', uri: 'spotify:artist:ar1', name: 'Bonobo', images: [] }]
  const playlists: Playlist[] = [
    {
      id: 'p1',
      uri: 'spotify:playlist:p1',
      name: 'Focus',
      description: null,
      images: null,
      owner: { display_name: 'Me' },
    },
  ]

  function homeApi(overrides = {}) {
    return {
      recentlyPlayed: vi.fn(async () => recent),
      topTracks: vi.fn(async () => top),
      topArtists: vi.fn(async () => artists),
      myPlaylists: vi.fn(async () => playlists),
      ...overrides,
    }
  }

  it('greets by time of day', () => {
    expect(greetingFor(new Date(2026, 9, 21, 8))).toBe('Good morning')
    expect(greetingFor(new Date(2026, 9, 21, 14))).toBe('Good afternoon')
    expect(greetingFor(new Date(2026, 9, 21, 21))).toBe('Good evening')
    expect(greetingFor(new Date(2026, 9, 21, 2))).toBe('Good night')
  })

  it('fills every shelf and plays what you click', async () => {
    const onPlayTracks = vi.fn()
    const onOpenArtist = vi.fn()
    const onOpenPlaylist = vi.fn()
    render(
      <HomeView
        api={homeApi()}
        onPlayTracks={onPlayTracks}
        onOpenArtist={onOpenArtist}
        onOpenPlaylist={onOpenPlaylist}
        onTogglePlay={vi.fn()}
        currentUri={null}
        now={new Date(2026, 9, 21, 19)}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Good evening' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Play Cirrus by Bonobo' }))
    expect(onPlayTracks).toHaveBeenCalledWith(recent, 1)

    await userEvent.click(screen.getByRole('button', { name: 'Play Kiara by Bonobo' }))
    expect(onPlayTracks).toHaveBeenLastCalledWith(top, 0)

    // Artists open their page instead of playing something at random.
    await userEvent.click(screen.getByRole('button', { name: 'Open Bonobo' }))
    expect(onOpenArtist).toHaveBeenCalledWith(artists[0])

    // Playlists open their page (the song list), like albums.
    await userEvent.click(screen.getByRole('button', { name: 'Open playlist Focus' }))
    expect(onOpenPlaylist).toHaveBeenCalledWith(playlists[0])
  })

  it('keeps the page working when one shelf fails, and hides empty shelves', async () => {
    const api = homeApi({
      topArtists: vi.fn(async () => {
        throw new Error('Spotify is rate limiting requests.')
      }),
      myPlaylists: vi.fn(async () => []),
    })
    render(
      <HomeView
        api={api}
        onPlayTracks={vi.fn()}
        onOpenArtist={vi.fn()}
        onOpenPlaylist={vi.fn()}
        onTogglePlay={vi.fn()}
        currentUri={null}
      />,
    )

    const artistsShelf = await screen.findByRole('region', { name: 'Artists you love' })
    expect(await within(artistsShelf).findByText('Spotify is rate limiting requests.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Play Kerala/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Your playlists' })).not.toBeInTheDocument())
  })

  it('loads each shelf once, not on every re-render', async () => {
    const api = homeApi()
    const { rerender } = render(
      <HomeView
        api={api}
        onPlayTracks={vi.fn()}
        onOpenArtist={vi.fn()}
        onOpenPlaylist={vi.fn()}
        onTogglePlay={vi.fn()}
        currentUri={null}
      />,
    )
    rerender(
      <HomeView
        api={api}
        onPlayTracks={vi.fn()}
        onOpenArtist={vi.fn()}
        onOpenPlaylist={vi.fn()}
        onTogglePlay={vi.fn()}
        currentUri="spotify:track:t1"
      />,
    )
    await screen.findByRole('button', { name: /Play Kerala/ })
    expect(api.recentlyPlayed).toHaveBeenCalledOnce()
  })
})

// ----------------------------------------------------------------- artist

describe('ArtistView', () => {
  const artist: Artist = {
    id: 'bon',
    uri: 'spotify:artist:bon',
    name: 'Bonobo',
    images: [{ url: 'https://img/b', width: 300 }],
  }
  const top = ['Kerala', 'Kiara', 'Cirrus', 'Ketto', 'Black Sands'].map((n, i) => track(`k${i}`, n))
  const albums = [
    {
      id: 'al1',
      uri: 'spotify:album:al1',
      name: 'Migration',
      images: [],
      release_date: '2017-01-13',
      album_type: 'album' as const,
      total_tracks: 12,
    },
  ]

  function renderArtist(overrides = {}) {
    const props = {
      artist,
      api: {
        artistTopTracks: vi.fn(async () => top),
        artistDiscography: vi.fn(async () => albums),
        artistSongs: vi.fn(async () => ({ tracks: [], nextOffset: null })),
      },
      onPlayTracks: vi.fn(),
      onOpenAlbum: vi.fn(),
      onBack: vi.fn(),
      onTogglePlay: vi.fn(),
      currentUri: null,
      isPaused: true,
      ...overrides,
    }
    render(<ArtistView {...props} />)
    return props
  }

  it('shows the artist with their top 5 songs, numbered, each playable', async () => {
    const props = renderArtist()
    expect(screen.getByRole('heading', { name: 'Bonobo' })).toBeInTheDocument()

    const list = await screen.findByRole('list', { name: 'Bonobo top songs' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    expect(within(list).getByText('3')).toBeInTheDocument() // rank numbers

    await userEvent.click(within(list).getByRole('button', { name: 'Play Ketto by Bonobo' }))
    expect(props.onPlayTracks).toHaveBeenCalledWith(top, 3)
    expect(props.api.artistTopTracks).toHaveBeenCalledWith(artist, 5)
  })

  it('the big Play button plays the top songs from the first one', async () => {
    const props = renderArtist()
    await screen.findByRole('list', { name: 'Bonobo top songs' })
    await userEvent.click(screen.getByRole('button', { name: "Play Bonobo's top songs" }))
    expect(props.onPlayTracks).toHaveBeenCalledWith(top, 0)
  })

  it('opens an album from the albums shelf, and Back goes back', async () => {
    const props = renderArtist()
    await userEvent.click(await screen.findByRole('button', { name: 'Open Migration' }))
    expect(props.onOpenAlbum).toHaveBeenCalledWith(albums[0])
    expect(screen.getByText('2017 · Album')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(props.onBack).toHaveBeenCalled()
  })

  it('explains when no songs come back', async () => {
    renderArtist({
      api: {
        artistTopTracks: vi.fn(async () => []),
        artistDiscography: vi.fn(async () => []),
        artistSongs: vi.fn(async () => ({ tracks: [], nextOffset: null })),
      },
    })
    expect(await screen.findByText(/didn't return any songs/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Play Bonobo's top songs" })).toBeDisabled()
    expect(screen.queryByRole('region', { name: 'Discography' })).not.toBeInTheDocument()
  })
})

describe('artist Play button', () => {
  const artist: Artist = { id: 'bon', uri: 'spotify:artist:bon', name: 'Bonobo', images: [] }
  const top = ['Kerala', 'Kiara'].map((n, i) => track(`k${i}`, n))
  const api = {
    artistTopTracks: vi.fn(async () => top),
    artistDiscography: vi.fn(async () => []),
    artistSongs: vi.fn(async () => ({ tracks: [], nextOffset: null })),
  }

  function renderWith(currentUri: string | null, isPaused: boolean) {
    const props = {
      artist,
      api,
      onPlayTracks: vi.fn(),
      onOpenAlbum: vi.fn(),
      onBack: vi.fn(),
      onTogglePlay: vi.fn(),
      currentUri,
      isPaused,
    }
    render(<ArtistView {...props} />)
    return props
  }

  it('shows Pause (||) while one of their songs plays, and pauses rather than restarting', async () => {
    const props = renderWith('spotify:track:k1', false)
    const button = await screen.findByRole('button', { name: "Pause Bonobo's top songs" })
    expect(button).toHaveTextContent('Pause')
    await userEvent.click(button)
    expect(props.onTogglePlay).toHaveBeenCalledOnce()
    expect(props.onPlayTracks).not.toHaveBeenCalled()
  })

  it('offers Resume when paused on one of their songs', async () => {
    renderWith('spotify:track:k0', true)
    expect(await screen.findByRole('button', { name: "Resume Bonobo's top songs" })).toHaveTextContent('Resume')
  })

  it('says Play when something else (or nothing) is playing', async () => {
    const props = renderWith('spotify:track:other', false)
    await screen.findByRole('list', { name: 'Bonobo top songs' })
    await userEvent.click(screen.getByRole('button', { name: "Play Bonobo's top songs" }))
    expect(props.onPlayTracks).toHaveBeenCalledWith(top, 0)
  })
})

// ------------------------------------------------------------------ album

describe('AlbumView', () => {
  const album = {
    id: 'al1',
    uri: 'spotify:album:al1',
    name: 'Migration',
    images: [{ url: 'https://img/cover', width: 640 }],
    release_date: '2017-01-13',
    album_type: 'album' as const,
    total_tracks: 3,
    artists: [{ id: 'bon', name: 'Bonobo' }],
  }
  const tracks = ['Migration', 'Grains', 'Second Sun'].map((n, i) => ({
    ...track(`m${i}`, n),
    track_number: i + 1,
    duration_ms: 1_200_000, // 20 min each, so the total is easy to check
  }))

  function renderAlbum(overrides = {}) {
    const props = {
      album,
      api: { getAlbum: vi.fn(async () => ({ ...album, tracks })) },
      onPlayAlbum: vi.fn(),
      onTogglePlay: vi.fn(),
      onOpenArtist: vi.fn(),
      onBack: vi.fn(),
      currentUri: null,
      currentContextUri: null,
      isPaused: true,
      ...overrides,
    }
    const view = render(<AlbumView {...props} />)
    return { props, ...view }
  }

  it('shows the album, its details and every song by track number', async () => {
    renderAlbum()
    expect(screen.getByRole('heading', { name: 'Migration' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Migration songs' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText(/3 songs, 1 hr 0 min/)).toBeInTheDocument()
    // No album column: every row is this album.
    expect(list.querySelector('.track-album')).toBeNull()
  })

  it('plays within the album, from the clicked song, so Next follows the album order', async () => {
    const { props } = renderAlbum()
    const list = await screen.findByRole('list', { name: 'Migration songs' })
    await userEvent.click(within(list).getByRole('button', { name: /Play Grains/ }))
    expect(props.onPlayAlbum).toHaveBeenCalledWith('spotify:album:al1', 'spotify:track:m1')

    await userEvent.click(screen.getByRole('button', { name: 'Play Migration' }))
    expect(props.onPlayAlbum).toHaveBeenLastCalledWith('spotify:album:al1')
  })

  it('becomes Pause, and spins the record, while this album plays', async () => {
    const { props, container } = renderAlbum({ currentContextUri: 'spotify:album:al1', isPaused: false })
    await screen.findByRole('list', { name: 'Migration songs' })
    expect(container.querySelector('.album-art')).toHaveClass('is-spinning')
    await userEvent.click(screen.getByRole('button', { name: 'Pause Migration' }))
    expect(props.onTogglePlay).toHaveBeenCalled()
    expect(props.onPlayAlbum).not.toHaveBeenCalled()
  })

  it('links to the artist and goes back', async () => {
    const { props } = renderAlbum()
    await userEvent.click(screen.getByRole('button', { name: 'Bonobo' }))
    expect(props.onOpenArtist).toHaveBeenCalledWith({ id: 'bon', name: 'Bonobo' })
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(props.onBack).toHaveBeenCalled()
  })
})

describe('More by <artist>', () => {
  const artist: Artist = { id: 'bon', uri: 'spotify:artist:bon', name: 'Bonobo', images: [] }
  const top = ['Kerala', 'Kiara'].map((n, i) => track(`k${i}`, n))
  const batch1 = ['Kerala', 'Cirrus', 'Ketto', 'Kiara - Remastered'].map((n, i) => track(`b${i}`, n))
  const batch2 = ['Black Sands', 'Cirrus', 'Eyesdown'].map((n, i) => track(`c${i}`, n))

  function renderMore(artistSongs: unknown) {
    const props = {
      artist,
      api: {
        artistTopTracks: vi.fn(async () => top),
        artistDiscography: vi.fn(async () => []),
        artistSongs: artistSongs as SpotifyApi['artistSongs'],
      },
      onPlayTracks: vi.fn(),
      onOpenAlbum: vi.fn(),
      onBack: vi.fn(),
      onTogglePlay: vi.fn(),
      currentUri: null,
      isPaused: true,
    }
    render(<ArtistView {...props} />)
    return props
  }

  it('lists more songs below the top 5, without repeating them', async () => {
    renderMore(vi.fn(async () => ({ tracks: batch1, nextOffset: null })))
    const list = await screen.findByRole('list', { name: 'More by Bonobo' })
    const names = within(list)
      .getAllByRole('button', { name: /^Play / })
      .map((b) => b.getAttribute('aria-label'))
    // Kerala and Kiara (incl. its remaster) are already in the top songs.
    expect(names).toEqual(['Play Cirrus by Bonobo', 'Play Ketto by Bonobo'])
  })

  it('loads the next batch with Show more, and hides the button at the end', async () => {
    const artistSongs = vi
      .fn()
      .mockResolvedValueOnce({ tracks: batch1, nextOffset: 30 })
      .mockResolvedValueOnce({ tracks: batch2, nextOffset: null })
    renderMore(artistSongs)

    await userEvent.click(await screen.findByRole('button', { name: /Show more/ }))
    expect(artistSongs).toHaveBeenLastCalledWith(artist, 30, 3)
    const list = await screen.findByRole('list', { name: 'More by Bonobo' })
    await waitFor(() => expect(within(list).getByRole('button', { name: /^Play Eyesdown/ })).toBeInTheDocument())
    expect(within(list).getAllByRole('button', { name: /^Play Cirrus/ })).toHaveLength(1) // no duplicate across batches
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument()
  })

  it('plays from the clicked song through the rest of the list', async () => {
    const props = renderMore(vi.fn(async () => ({ tracks: batch1, nextOffset: null })))
    const list = await screen.findByRole('list', { name: 'More by Bonobo' })
    await userEvent.click(within(list).getByRole('button', { name: 'Play Ketto by Bonobo' }))
    expect(props.onPlayTracks).toHaveBeenCalledWith([batch1[1], batch1[2]], 1)
  })

  it('hides the section when the artist has nothing beyond the top songs', async () => {
    renderMore(vi.fn(async () => ({ tracks: top, nextOffset: null })))
    await screen.findByRole('list', { name: 'Bonobo top songs' })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'More by Bonobo' })).not.toBeInTheDocument())
  })
})

// --------------------------------------------------------------- playlist

describe('PlaylistView', () => {
  const playlist = {
    id: 'p1',
    uri: 'spotify:playlist:p1',
    name: 'Focus',
    description: 'Deep work &amp; <a href="spotify:x">quiet</a> beats',
    images: [{ url: 'https://img/focus', width: 640 }],
    owner: { display_name: 'You' },
  }
  const songs = ['Kerala', 'Cirrus', 'Ketto'].map((n, i) => ({ ...track(`p${i}`, n), track_number: 9 - i }))

  function renderPlaylist(result: unknown, overrides = {}) {
    const props = {
      playlist,
      api: {
        playlistTracks: vi.fn(async () => result) as unknown as SpotifyApi['playlistTracks'],
        queue: vi.fn(async () => ({ current: null, upNext: [] })) as unknown as SpotifyApi['queue'],
      },
      onPlayPlaylist: vi.fn(),
      onTogglePlay: vi.fn(),
      onBack: vi.fn(),
      currentUri: null,
      currentContextUri: null,
      isPaused: true,
      ...overrides,
    }
    const view = render(<PlaylistView {...props} />)
    return { props, ...view }
  }

  it('lists the songs, numbered by position in the playlist, and plays within it', async () => {
    const { props } = renderPlaylist({ tracks: songs, total: 3, restricted: false })
    const list = await screen.findByRole('list', { name: 'Focus songs' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByText('1')).toBeInTheDocument() // 1, 2, 3, not the album track numbers
    expect(within(list).queryByText('9')).toBeNull()

    await userEvent.click(within(list).getByRole('button', { name: /Play Cirrus/ }))
    expect(props.onPlayPlaylist).toHaveBeenCalledWith('spotify:playlist:p1', 'spotify:track:p1')
    await userEvent.click(screen.getByRole('button', { name: 'Play Focus' }))
    expect(props.onPlayPlaylist).toHaveBeenLastCalledWith('spotify:playlist:p1')
  })

  it('shows the owner and the description as plain text', async () => {
    renderPlaylist({ tracks: songs, total: 3, restricted: false })
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Deep work & quiet beats')).toBeInTheDocument()
    expect(await screen.findByText(/3 songs/)).toBeInTheDocument()
  })

  it('for playlists Spotify will not list: a short prompt, then the songs once it plays', async () => {
    const queue = vi.fn(async () => ({ current: songs[0], upNext: [songs[1], songs[2]] }))
    const api = {
      playlistTracks: vi.fn(async () => ({ tracks: [], total: 0, restricted: true })),
      queue,
    } as unknown as Pick<SpotifyApi, 'playlistTracks' | 'queue'>
    const props = {
      playlist,
      api,
      onPlayPlaylist: vi.fn(),
      onTogglePlay: vi.fn(),
      onBack: vi.fn(),
      currentUri: null as string | null,
      currentContextUri: null as string | null,
      isPaused: true,
    }
    const { rerender } = render(<PlaylistView {...props} />)

    expect(await screen.findByText('Press Play to see its songs.')).toBeInTheDocument()
    expect(screen.queryByText(/February 2026/)).not.toBeInTheDocument() // no long explanation
    await userEvent.click(screen.getByRole('button', { name: 'Play Focus' }))
    expect(props.onPlayPlaylist).toHaveBeenCalledWith('spotify:playlist:p1')

    // Now it's playing: the songs come from the queue.
    rerender(
      <PlaylistView
        {...props}
        currentContextUri="spotify:playlist:p1"
        currentUri="spotify:track:p0"
        isPaused={false}
      />,
    )
    const list = await screen.findByRole('list', { name: 'Focus songs' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(queue).toHaveBeenCalled()
  })

  it('keeps asking until Spotify has switched its queue over to this playlist', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const queue = vi
      .fn()
      .mockResolvedValueOnce({ current: track('old', 'Old song'), upNext: [] }) // not caught up yet
      .mockResolvedValueOnce({ current: songs[0], upNext: [songs[1], songs[2]] })
    const api = {
      playlistTracks: vi.fn(async () => ({ tracks: [], total: 0, restricted: true })),
      queue,
    } as unknown as Pick<SpotifyApi, 'playlistTracks' | 'queue'>
    render(
      <PlaylistView
        playlist={playlist}
        api={api}
        onPlayPlaylist={vi.fn()}
        onTogglePlay={vi.fn()}
        onBack={vi.fn()}
        currentUri="spotify:track:p0"
        currentContextUri="spotify:playlist:p1"
        isPaused={false}
      />,
    )
    await waitFor(() => expect(queue).toHaveBeenCalledTimes(1))
    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    const list = await screen.findByRole('list', { name: 'Focus songs' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(queue).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('remembers the songs it has seen, and shows them instantly next time (even when not playing)', async () => {
    appCache.set(keys.playlistLive('p1'), songs)
    const api = {
      playlistTracks: vi.fn(async () => ({ tracks: [], total: 0, restricted: true })),
      queue: vi.fn(),
    } as unknown as Pick<SpotifyApi, 'playlistTracks' | 'queue'>
    render(
      <PlaylistView
        playlist={playlist}
        api={api}
        onPlayPlaylist={vi.fn()}
        onTogglePlay={vi.fn()}
        onBack={vi.fn()}
        currentUri={null}
        currentContextUri={null}
        isPaused
      />,
    )
    const list = await screen.findByRole('list', { name: 'Focus songs' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByText('Press Play to see its songs.')).not.toBeInTheDocument()
    expect(api.queue).not.toHaveBeenCalled() // nothing is playing; nothing to ask
  })

  it('shows Pause while this playlist plays', async () => {
    renderPlaylist(
      { tracks: songs, total: 3, restricted: false },
      { currentContextUri: 'spotify:playlist:p1', isPaused: false },
    )
    expect(await screen.findByRole('button', { name: 'Pause Focus' })).toBeInTheDocument()
  })
})

describe('Discography', () => {
  const release = (id: string, type: 'album' | 'single' | 'compilation', year: string, tracks = 10) => ({
    id,
    uri: `spotify:album:${id}`,
    name: `Release ${id}`,
    images: [],
    release_date: `${year}-01-01`,
    album_type: type,
    total_tracks: tracks,
  })

  it('filters by type with counts, and opens a release', async () => {
    const releases = [
      release('a', 'album', '2022'),
      release('s', 'single', '2021', 1),
      release('e', 'single', '2020', 5),
    ]
    const onOpenAlbum = vi.fn()
    render(<Discography releases={releases} onOpenAlbum={onOpenAlbum} currentContextUri={null} />)

    expect(screen.getByRole('tab', { name: 'All 3' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: /Compilations/ })).not.toBeInTheDocument() // none, so no tab
    await userEvent.click(screen.getByRole('tab', { name: 'Singles & EPs 2' }))
    expect(screen.queryByRole('button', { name: 'Open Release a' })).not.toBeInTheDocument()
    expect(screen.getByText('2021 · Single')).toBeInTheDocument()
    expect(screen.getByText('2020 · EP')).toBeInTheDocument() // 4+ tracks reads as an EP

    await userEvent.click(screen.getByRole('button', { name: 'Open Release s' }))
    expect(onOpenAlbum).toHaveBeenCalledWith(releases[1])
  })

  it('shows 12 at first, then everything with Show all', async () => {
    const releases = Array.from({ length: 20 }, (_, i) => release(`r${i}`, 'album', String(2020 - i)))
    render(<Discography releases={releases} onOpenAlbum={vi.fn()} currentContextUri={null} />)
    expect(screen.getAllByRole('button', { name: /^Open Release/ })).toHaveLength(12)
    await userEvent.click(screen.getByRole('button', { name: /Show all 20/ }))
    expect(screen.getAllByRole('button', { name: /^Open Release/ })).toHaveLength(20)
  })
})

describe('PlaylistView: your own playlists', () => {
  const mine = {
    id: 'mine',
    uri: 'spotify:playlist:mine',
    name: 'Road trip',
    description: '',
    images: [],
    owner: { id: 'me', display_name: 'You' },
  }
  const songs = ['Kerala', 'Cirrus', 'Ketto'].map((n, i) => track(`m${i}`, n))

  function renderMine(overrides: Record<string, unknown> = {}) {
    const api = {
      playlistTracks: vi.fn(async () => ({ tracks: songs, total: 3, restricted: false })),
      queue: vi.fn(async () => ({ current: null, upNext: [] })),
      removeFromPlaylist: vi.fn(async () => {}),
      reorderPlaylist: vi.fn(async () => {}),
      updatePlaylistDetails: vi.fn(async () => {}),
      ...overrides,
    }
    const onNotify = vi.fn()
    render(
      <PlaylistView
        playlist={mine}
        api={api as unknown as Pick<SpotifyApi, 'playlistTracks' | 'queue'>}
        editable
        onNotify={onNotify}
        onPlayPlaylist={vi.fn()}
        onTogglePlay={vi.fn()}
        onBack={vi.fn()}
        currentUri={null}
        currentContextUri={null}
        isPaused
      />,
    )
    return { api, onNotify }
  }

  it('removes a song straight away', async () => {
    const { api } = renderMine()
    const list = await screen.findByRole('list', { name: 'Road trip songs' })
    fireEvent.contextMenu(within(list).getByRole('button', { name: /Play Cirrus/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Remove from this playlist/ }))
    expect(within(list).queryByText('Cirrus')).toBeNull()
    expect(api.removeFromPlaylist).toHaveBeenCalledWith('mine', ['spotify:track:m1'])
  })

  it('puts the song back if Spotify refuses', async () => {
    const { onNotify } = renderMine({ removeFromPlaylist: vi.fn(async () => Promise.reject(new Error('403'))) })
    const list = await screen.findByRole('list', { name: 'Road trip songs' })
    fireEvent.contextMenu(within(list).getByRole('button', { name: /Play Cirrus/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Remove from this playlist/ }))
    expect(await within(list).findByText('Cirrus')).toBeInTheDocument()
    expect(onNotify).toHaveBeenCalledWith("Couldn't remove that song.")
  })

  it('reorders by dragging', async () => {
    const { api } = renderMine()
    const list = await screen.findByRole('list', { name: 'Road trip songs' })
    const rows = within(list).getAllByRole('listitem')
    fireEvent.dragStart(rows[0].firstElementChild!, { dataTransfer: { effectAllowed: '' } })
    fireEvent.dragOver(rows[2].firstElementChild!)
    fireEvent.drop(rows[2].firstElementChild!)
    expect(within(list).getAllByRole('listitem')[2]).toHaveTextContent('Kerala')
    expect(api.reorderPlaylist).toHaveBeenCalledWith('mine', 0, 2)
  })

  it('renames through Edit details', async () => {
    const { api } = renderMine()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Night drive')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('heading', { name: 'Night drive' })).toBeInTheDocument()
    expect(api.updatePlaylistDetails).toHaveBeenCalledWith('mine', { name: 'Night drive', description: '' })
  })
})

describe('discovery (with Last.fm)', () => {
  const bonobo: Artist = { id: 'bon', uri: 'spotify:artist:bon', name: 'Bonobo', images: [] }
  const tycho: Artist = { id: 'ty', uri: 'spotify:artist:ty', name: 'Tycho', images: [] }

  it('Home: Made for you shows Daily Mixes and Discover Weekly, and plays them', async () => {
    const madeForYou = { dailyMix: vi.fn(), discoverWeekly: vi.fn() }
    render(
      <HomeView
        api={{
          recentlyPlayed: vi.fn(async () => []),
          topTracks: vi.fn(async () => []),
          topArtists: vi.fn(async () => [bonobo, tycho]),
          myPlaylists: vi.fn(async () => []),
        }}
        madeForYou={madeForYou}
        onPlayTracks={vi.fn()}
        onOpenArtist={vi.fn()}
        onOpenPlaylist={vi.fn()}
        onTogglePlay={vi.fn()}
        currentUri={null}
      />,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Play Daily Mix 2' }))
    expect(madeForYou.dailyMix).toHaveBeenCalledWith(tycho, 1)
    await userEvent.click(screen.getByRole('button', { name: 'Play Discover Weekly' }))
    expect(madeForYou.discoverWeekly).toHaveBeenCalled()
  })

  it('Home: no Made for you without Last.fm', async () => {
    render(
      <HomeView
        api={{
          recentlyPlayed: vi.fn(async () => []),
          topTracks: vi.fn(async () => []),
          topArtists: vi.fn(async () => [bonobo]),
          myPlaylists: vi.fn(async () => []),
        }}
        onPlayTracks={vi.fn()}
        onOpenArtist={vi.fn()}
        onOpenPlaylist={vi.fn()}
        onTogglePlay={vi.fn()}
        currentUri={null}
      />,
    )
    await screen.findByRole('button', { name: 'Open Bonobo' })
    expect(screen.queryByText('Made for you')).toBeNull()
  })

  it('Artist page: Radio, and Fans also like', async () => {
    const onStartRadio = vi.fn()
    const onOpenArtist = vi.fn()
    render(
      <ArtistView
        artist={bonobo}
        api={{
          artistTopTracks: vi.fn(async () => []),
          artistDiscography: vi.fn(async () => []),
          artistSongs: vi.fn(async () => ({ tracks: [], nextOffset: null })),
        }}
        similarArtists={async () => [tycho]}
        onStartRadio={onStartRadio}
        onOpenArtist={onOpenArtist}
        onPlayTracks={vi.fn()}
        onOpenAlbum={vi.fn()}
        onBack={vi.fn()}
        onTogglePlay={vi.fn()}
        currentUri={null}
        isPaused
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Radio/ }))
    expect(onStartRadio).toHaveBeenCalledWith(bonobo)
    const fans = await screen.findByRole('region', { name: 'Fans also like' })
    await userEvent.click(within(fans).getByRole('button', { name: 'Open Tycho' }))
    expect(onOpenArtist).toHaveBeenCalledWith(tycho)
  })
})
