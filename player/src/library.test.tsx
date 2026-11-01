import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ArtistView } from './components/ArtistView'
import { LibraryView } from './components/LibraryView'
import { LikedSongsView } from './components/LikedSongsView'
import { TrackList } from './components/TrackList'
import { type Library, LibraryContext, useLibraryState } from './library'
import { createSpotifyApi, type SpotifyApi, SpotifyApiError, type Track } from './spotify/api'

function track(id: string, name: string): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: [{ id: 'b', name: 'Bonobo' }],
    album: { id: 'al', name: 'Migration', images: [] },
    duration_ms: 200_000,
    explicit: false,
    external_urls: {},
  }
}

function fakeApi(saved: Set<string> = new Set()) {
  return {
    libraryContains: vi.fn(async (uris: string[]) => uris.map((u) => saved.has(u))),
    saveToLibrary: vi.fn(async () => {}),
    removeFromLibrary: vi.fn(async () => {}),
  }
}

/** Render with a real library state, the way the app does. */
function WithLibrary({ api, children }: { api: ReturnType<typeof fakeApi>; children: ReactNode }) {
  const library = useLibraryState(api, vi.fn())
  return <LibraryContext.Provider value={library}>{children}</LibraryContext.Provider>
}

describe('library state', () => {
  it('asks about everything on screen in one batched request', async () => {
    const api = fakeApi(new Set(['spotify:track:2']))
    const { result } = renderHook(() => useLibraryState(api, vi.fn()))
    act(() => {
      result.current.watch(['spotify:track:1', 'spotify:track:2'])
      result.current.watch(['spotify:track:2', 'spotify:track:3']) // overlapping lists
    })
    await waitFor(() => expect(result.current.isSaved('spotify:track:2')).toBe(true))
    expect(api.libraryContains).toHaveBeenCalledOnce()
    expect(api.libraryContains).toHaveBeenCalledWith(['spotify:track:1', 'spotify:track:2', 'spotify:track:3'])
    expect(result.current.isSaved('spotify:track:1')).toBe(false)
  })

  it('likes instantly, and puts it back if Spotify refuses', async () => {
    const api = fakeApi()
    api.saveToLibrary.mockRejectedValueOnce(new SpotifyApiError(429, 'Spotify is rate limiting requests.'))
    const notify = vi.fn()
    const { result } = renderHook(() => useLibraryState(api, notify))

    act(() => result.current.toggle('spotify:track:1', 'Kerala'))
    expect(result.current.isSaved('spotify:track:1')).toBe(true) // before Spotify answers

    await waitFor(() => expect(result.current.isSaved('spotify:track:1')).toBe(false))
    expect(notify).toHaveBeenCalledWith('Spotify is rate limiting requests.')
  })
})

describe('hearts on songs', () => {
  it('shows which songs are liked, and liking one does not play it', async () => {
    const api = fakeApi(new Set(['spotify:track:k1']))
    const onPlay = vi.fn()
    render(
      <WithLibrary api={api}>
        <TrackList
          label="Songs"
          tracks={[track('k0', 'Kerala'), track('k1', 'Kiara')]}
          onPlay={onPlay}
          currentUri={null}
        />
      </WithLibrary>,
    )
    expect(await screen.findByRole('button', { name: 'Remove Kiara from Liked Songs' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save Kerala to Liked Songs' }))
    expect(api.saveToLibrary).toHaveBeenCalledWith(['spotify:track:k0'])
    expect(onPlay).not.toHaveBeenCalled()
  })
})

describe('artist Follow button', () => {
  it('shows Following for followed artists and toggles', async () => {
    const artist = { id: 'bon', uri: 'spotify:artist:bon', name: 'Bonobo', images: [] }
    const api = fakeApi(new Set(['spotify:artist:bon']))
    const artistApi = {
      artistTopTracks: vi.fn(async () => []),
      artistDiscography: vi.fn(async () => []),
      artistSongs: vi.fn(async () => ({ tracks: [], nextOffset: null })),
    }
    render(
      <WithLibrary api={api}>
        <ArtistView
          artist={artist}
          api={artistApi}
          onPlayTracks={vi.fn()}
          onBack={vi.fn()}
          onTogglePlay={vi.fn()}
          onOpenAlbum={vi.fn()}
          currentUri={null}
          isPaused
        />
      </WithLibrary>,
    )
    const button = await screen.findByRole('button', { name: 'Following' })
    await userEvent.click(button)
    expect(api.removeFromLibrary).toHaveBeenCalledWith(['spotify:artist:bon'])
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument()
  })
})

describe('Your Library', () => {
  const library: Library = { isSaved: () => undefined, watch: vi.fn(), toggle: vi.fn() }

  it('opens Liked Songs, and switches between playlists, albums and artists', async () => {
    const api = {
      myPlaylists: vi.fn(async () => [
        {
          id: 'p1',
          uri: 'spotify:playlist:p1',
          name: 'Focus',
          description: null,
          images: [],
          owner: { display_name: 'You' },
        },
      ]),
      savedAlbums: vi.fn(async () => [
        {
          id: 'a1',
          uri: 'spotify:album:a1',
          name: 'Migration',
          images: [],
          release_date: '2017',
          album_type: 'album' as const,
          total_tracks: 12,
        },
      ]),
      followedArtists: vi.fn(async () => [{ id: 'bon', uri: 'spotify:artist:bon', name: 'Bonobo', images: [] }]),
    }
    const handlers = {
      onOpenLiked: vi.fn(),
      onOpenPlaylist: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    }
    render(
      <LibraryContext.Provider value={library}>
        <LibraryView api={api} currentContextUri={null} {...handlers} />
      </LibraryContext.Provider>,
    )

    await userEvent.click(screen.getByRole('button', { name: /Liked Songs/ }))
    expect(handlers.onOpenLiked).toHaveBeenCalled()

    await userEvent.click(await screen.findByRole('button', { name: 'Open playlist Focus' }))
    expect(handlers.onOpenPlaylist).toHaveBeenCalled()
    expect(api.savedAlbums).not.toHaveBeenCalled() // each list loads only when chosen

    await userEvent.click(screen.getByRole('tab', { name: 'Albums' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open Migration' }))
    expect(handlers.onOpenAlbum).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('tab', { name: 'Artists' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open Bonobo' }))
    expect(handlers.onOpenArtist).toHaveBeenCalled()
  })
})

describe('Liked Songs page', () => {
  it('lists liked songs, plays from the clicked one, and loads more', async () => {
    const page1 = Array.from({ length: 3 }, (_, i) => track(`l${i}`, `Liked ${i}`))
    const page2 = [track('l9', 'Older one')]
    const likedSongs = vi
      .fn()
      .mockResolvedValueOnce({ tracks: page1, total: 4, nextOffset: 50 })
      .mockResolvedValueOnce({ tracks: page2, total: 4, nextOffset: null })
    const onPlayTracks = vi.fn()
    render(
      <LikedSongsView
        api={{ likedSongs } as unknown as Pick<SpotifyApi, 'likedSongs'>}
        onPlayTracks={onPlayTracks}
        onTogglePlay={vi.fn()}
        onBack={vi.fn()}
        currentUri={null}
        currentContextUri={null}
        isPaused
      />,
    )
    const list = await screen.findByRole('list', { name: 'Liked Songs' })
    await userEvent.click(within(list).getByRole('button', { name: 'Play Liked 1 by Bonobo' }))
    expect(onPlayTracks).toHaveBeenCalledWith(page1.slice(1), 0)

    await userEvent.click(screen.getByRole('button', { name: /Show more/ }))
    expect(likedSongs).toHaveBeenLastCalledWith(50, 50)
    expect(await within(list).findByRole('button', { name: /Play Older one/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument()
  })
})

describe('library API', () => {
  it('sends at most 40 items per request', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(Array(40).fill(true)), { status: 200 }))
    const api = createSpotifyApi({ getAccessToken: async () => 't', fetchFn: fetchFn as unknown as typeof fetch })
    const uris = Array.from({ length: 85 }, (_, i) => `spotify:track:${i}`)

    await api.libraryContains(uris)
    expect(fetchFn).toHaveBeenCalledTimes(3) // 40 + 40 + 5
    const first = new URL(String((fetchFn.mock.calls[0] as unknown[])[0]))
    expect(first.pathname).toBe('/v1/me/library/contains')
    expect(first.searchParams.get('uris')?.split(',')).toHaveLength(40)

    fetchFn.mockClear()
    fetchFn.mockImplementation(async () => new Response(null, { status: 200 }))
    await api.saveToLibrary(['spotify:track:1'])
    expect((fetchFn.mock.calls[0] as unknown[])[1]).toMatchObject({ method: 'PUT' })
  })
})
