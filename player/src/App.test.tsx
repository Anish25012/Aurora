import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { SpotifyApi } from './spotify/api'
import type { SpotifyAuth } from './spotify/auth'

function fakeAuth(overrides: Partial<SpotifyAuth> = {}): SpotifyAuth {
  return {
    isLoggedIn: () => false,
    hasAllScopes: () => true,
    beginLogin: vi.fn(async () => {}),
    completeLogin: vi.fn(async () => {}),
    getAccessToken: vi.fn(async () => 'token'),
    logout: vi.fn(),
    ...overrides,
  }
}

const api = {
  searchTracks: vi.fn(async () => []),
  playTracks: vi.fn(),
  recentlyPlayed: vi.fn(async () => []),
  topTracks: vi.fn(async () => []),
  topArtists: vi.fn(async () => []),
  myPlaylists: vi.fn(async () => []),
  artistTopTracks: vi.fn(async () => []),
  artistDiscography: vi.fn(async () => []),
  savedAlbums: vi.fn(async () => []),
  followedArtists: vi.fn(async () => []),
  likedSongs: vi.fn(async () => ({ tracks: [], total: 0, nextOffset: null })),
  libraryContains: vi.fn(async (uris: string[]) => uris.map(() => false)),
  saveToLibrary: vi.fn(async () => {}),
  removeFromLibrary: vi.fn(async () => {}),
  playlistTracks: vi.fn(async () => ({ tracks: [], total: 0, restricted: false })),
  artistSongs: vi.fn(async () => ({ tracks: [], nextOffset: null })),
  me: vi.fn(async () => ({ id: 'me', display_name: 'You' })),
  getAlbum: vi.fn(),
  getArtist: vi.fn(),
} as unknown as SpotifyApi

afterEach(() => window.history.replaceState(null, '', '/'))

describe('App', () => {
  it('asks for setup when no client ID is configured', () => {
    render(<App auth={fakeAuth()} api={api} clientId="" />)
    expect(screen.getByText(/VITE_SPOTIFY_CLIENT_ID/)).toBeInTheDocument()
  })

  it('shows the login screen and starts login on click', async () => {
    const auth = fakeAuth()
    render(<App auth={auth} api={api} clientId="abc" />)
    await userEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }))
    expect(auth.beginLogin).toHaveBeenCalled()
  })

  it('completes the login on the callback page and cleans the URL', async () => {
    window.history.replaceState(null, '', '/callback?code=c&state=s')
    const auth = fakeAuth()
    ;(window as unknown as { Spotify: unknown }).Spotify = {
      Player: class {
        addListener() {}
        connect() {}
        disconnect() {}
      },
    }
    render(<App auth={auth} api={api} clientId="abc" />)

    // Lands on Home, greeted by time of day.
    expect(await screen.findByRole('heading', { name: /^Good / })).toBeInTheDocument()
    expect(auth.completeLogin).toHaveBeenCalledTimes(1)
    expect(auth.completeLogin).toHaveBeenCalledWith(expect.stringContaining('code=c'))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(window.location.search).toBe('')
  })

  it('shows the error if the callback fails', async () => {
    window.history.replaceState(null, '', '/callback?error=access_denied')
    const auth = fakeAuth({
      completeLogin: vi.fn(async () => Promise.reject(new Error('Spotify access was cancelled.'))),
    })
    render(<App auth={auth} api={api} clientId="abc" />)
    expect(await screen.findByText('Spotify access was cancelled.')).toBeInTheDocument()
  })

  it('asks an older login to reconnect when new permissions are needed', () => {
    render(<App auth={fakeAuth({ isLoggedIn: () => true, hasAllScopes: () => false })} api={api} clientId="abc" />)
    expect(screen.getByRole('button', { name: 'Connect Spotify' })).toBeInTheDocument()
    expect(screen.getByText(/need a little more access/)).toBeInTheDocument()
  })

  it('switches between Home, Search and Library', async () => {
    ;(window as unknown as { Spotify: unknown }).Spotify = {
      Player: class {
        addListener() {}
        connect() {}
        disconnect() {}
      },
    }
    render(<App auth={fakeAuth({ isLoggedIn: () => true })} api={api} clientId="abc" />)
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByRole('heading', { name: 'Search' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens an artist page from Home and goes back', async () => {
    ;(window as unknown as { Spotify: unknown }).Spotify = {
      Player: class {
        addListener() {}
        connect() {}
        disconnect() {}
      },
    }
    const withArtist = {
      ...api,
      topArtists: vi.fn(async () => [{ id: 'bon', uri: 'spotify:artist:bon', name: 'Bonobo', images: [] }]),
    } as unknown as SpotifyApi
    render(<App auth={fakeAuth({ isLoggedIn: () => true })} api={withArtist} clientId="abc" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Open Bonobo' }))
    expect(await screen.findByRole('heading', { name: 'Bonobo' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: /^Good / })).toBeVisible()
  })

  it('stacks pages: artist, then album, then Back twice returns home', async () => {
    ;(window as unknown as { Spotify: unknown }).Spotify = {
      Player: class {
        addListener() {}
        connect() {}
        disconnect() {}
      },
    }
    const album = {
      id: 'al1',
      uri: 'spotify:album:al1',
      name: 'Migration',
      images: [],
      release_date: '2017',
      album_type: 'album',
      total_tracks: 1,
    }
    const nav = {
      ...api,
      topArtists: vi.fn(async () => [{ id: 'bon', uri: 'spotify:artist:bon', name: 'Bonobo', images: [] }]),
      artistDiscography: vi.fn(async () => [album]),
      getAlbum: vi.fn(async () => ({ ...album, artists: [{ id: 'bon', name: 'Bonobo' }], tracks: [] })),
    } as unknown as SpotifyApi
    render(<App auth={fakeAuth({ isLoggedIn: () => true })} api={nav} clientId="abc" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Open Bonobo' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open Migration' }))
    expect(await screen.findByRole('heading', { name: 'Migration' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Bonobo' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: /^Good / })).toBeVisible()
  })

  it('has a Library tab in the sidebar', async () => {
    ;(window as unknown as { Spotify: unknown }).Spotify = {
      Player: class {
        addListener() {}
        connect() {}
        disconnect() {}
      },
    }
    render(<App auth={fakeAuth({ isLoggedIn: () => true })} api={api} clientId="abc" />)
    await userEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.getByRole('heading', { name: 'Your Library' })).toBeVisible()
  })
})
