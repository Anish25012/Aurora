import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotifyApi, Track } from '../spotify/api'
import { SpotifyApiError } from '../spotify/api'
import type { SpotifyAuth } from '../spotify/auth'
import { positionAt } from './clock'
import { usePlayer } from './usePlayer'

/** A stand-in for Spotify.Player that lets tests fire SDK events. */
class FakePlayer {
  static last: FakePlayer
  listeners: Record<string, (payload: unknown) => void> = {}
  options: Spotify.PlayerInit
  connect = vi.fn(async () => true)
  disconnect = vi.fn()
  togglePlay = vi.fn(async () => {})
  nextTrack = vi.fn(async () => {})
  previousTrack = vi.fn(async () => {})
  seek = vi.fn(async () => {})
  setVolume = vi.fn(async () => {})
  activateElement = vi.fn(async () => {})

  constructor(options: Spotify.PlayerInit) {
    this.options = options
    FakePlayer.last = this
  }

  addListener(event: string, cb: (payload: unknown) => void) {
    this.listeners[event] = cb
    return true
  }

  emit(event: string, payload: unknown) {
    act(() => this.listeners[event]?.(payload))
  }
}

function playbackState(overrides: Record<string, unknown> = {}) {
  return {
    paused: false,
    position: 30_000,
    duration: 200_000,
    track_window: {
      current_track: {
        id: 't1',
        uri: 'spotify:track:t1',
        name: 'Teardrop',
        artists: [{ name: 'Massive Attack' }],
        album: {
          name: 'Mezzanine',
          images: [
            { url: 'small', width: 64 },
            { url: 'big', width: 640 },
          ],
        },
      },
    },
    ...overrides,
  }
}

const song = (id: string): Track => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Song ${id}`,
  artists: [{ id: 'ma', name: 'Massive Attack' }],
  album: { id: 'mz', name: 'Mezzanine', images: [] },
  duration_ms: 200_000,
  explicit: false,
  external_urls: {},
})

const auth = { getAccessToken: vi.fn(async () => 'token') } as unknown as SpotifyAuth

function makeApi(playTracks = vi.fn(async () => {})) {
  return {
    searchTracks: vi.fn(),
    playTracks,
    playContext: vi.fn(async () => {}),
    recentlyPlayed: vi.fn(async () => []),
    // Nothing playing elsewhere, unless a test says otherwise.
    playbackState: vi.fn(async () => null),
    addToQueue: vi.fn(async () => {}),
    setShuffle: vi.fn(async () => {}),
    setRepeat: vi.fn(async () => {}),
    transferPlayback: vi.fn(async () => {}),
  } as unknown as SpotifyApi
}

beforeEach(() => {
  localStorage.clear() // no "last played" song or list carried over between tests
  // The SDK loader resolves immediately when window.Spotify already exists.
  ;(window as unknown as { Spotify: unknown }).Spotify = { Player: FakePlayer }
})

async function renderReadyPlayer(api = makeApi()) {
  const hook = renderHook(() => usePlayer(auth, api))
  await waitFor(() => expect(FakePlayer.last?.connect).toHaveBeenCalled())
  FakePlayer.last.emit('ready', { device_id: 'dev1' })
  return { ...hook, api, player: FakePlayer.last }
}

describe('usePlayer', () => {
  it('registers as a device called Aurora and becomes ready', async () => {
    const { result, player } = await renderReadyPlayer()
    expect(player.options.name).toBe('Aurora')
    expect(result.current.status).toBe('ready')
  })

  it('gives the SDK tokens from the auth session', async () => {
    const { player } = await renderReadyPlayer()
    const cb = vi.fn()
    player.options.getOAuthToken(cb)
    await waitFor(() => expect(cb).toHaveBeenCalledWith('token'))
  })

  it('maps SDK state to the now-playing track with the largest artwork', async () => {
    const { result, player } = await renderReadyPlayer()
    player.emit('player_state_changed', playbackState())
    expect(result.current.track).toMatchObject({
      name: 'Teardrop',
      artists: 'Massive Attack',
      imageUrl: 'big',
      spotifyUrl: 'https://open.spotify.com/track/t1',
      paused: false,
      durationMs: 200_000,
    })
    expect(result.current.clock).toMatchObject({ positionMs: 30_000, paused: false })
  })

  it('while Spotify is still loading the audio: a spinner, and the clock waits (podcasts)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { result, player } = await renderReadyPlayer()
      player.emit('player_state_changed', playbackState({ loading: true, position: 60_000 }))
      expect(result.current.buffering).toBe(true)
      act(() => void vi.advanceTimersByTime(3000))
      expect(positionAt(result.current.clock)).toBe(60_000) // no time passing in silence

      player.emit('player_state_changed', playbackState({ loading: false, position: 60_000 }))
      expect(result.current.buffering).toBe(false)
      const playing = result.current.clock
      act(() => void vi.advanceTimersByTime(1000))
      expect(positionAt(result.current.clock)).toBeGreaterThan(60_000)
      // Time passing alone doesn't change the player's state (which would
      // redraw the whole app); only the progress bar ticks.
      expect(result.current.clock).toBe(playing)
    } finally {
      vi.useRealTimers()
    }
  })

  it('when playback stops everywhere, keeps showing the last song, paused where it stopped', async () => {
    const { result, player } = await renderReadyPlayer()
    player.emit('player_state_changed', playbackState({ paused: true, position: 45_000 }))
    player.emit('player_state_changed', null)
    await waitFor(() => expect(result.current.track).toMatchObject({ uri: 'spotify:track:t1', paused: true }))
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.clock).toMatchObject({ positionMs: 45_000, paused: true })
  })

  describe('nothing playing anywhere: the controls carry on with the last song', () => {
    const lastSong = (contextUri: string | null = 'spotify:album:mz') =>
      localStorage.setItem(
        'aurora.lastPlayed',
        JSON.stringify({
          track: {
            uri: 'spotify:track:t1',
            name: 'Teardrop',
            artists: 'Massive Attack',
            album: 'Mezzanine',
            imageUrl: null,
            spotifyUrl: null,
            paused: true,
            durationMs: 200_000,
            contextUri,
            artistRefs: [],
            albumRef: null,
          },
          positionMs: 61_000,
        }),
      )

    it('shows it, with its buttons working, instead of an empty bar', async () => {
      lastSong()
      const { result } = await renderReadyPlayer()
      expect(result.current.track).toMatchObject({ name: 'Teardrop', paused: true })
      expect(positionAt(result.current.clock)).toBe(61_000)
    })

    it('Play carries on in its album, from where it stopped', async () => {
      lastSong()
      const { result, api } = await renderReadyPlayer()
      act(() => result.current.togglePlay())
      await waitFor(() =>
        expect(api.playContext).toHaveBeenCalledWith('dev1', 'spotify:album:mz', 'spotify:track:t1', 61_000),
      )
    })

    it('a song from a list (not an album or playlist) carries on in that list', async () => {
      const { result, api } = await renderReadyPlayer()
      await act(() => result.current.playTracks([song('a'), song('t1'), song('c')], 1))
      lastSong(null)
      const reopened = await renderReadyPlayer(api)
      act(() => reopened.result.current.togglePlay())
      await waitFor(() =>
        expect(api.playTracks).toHaveBeenLastCalledWith(
          'dev1',
          ['spotify:track:a', 'spotify:track:t1', 'spotify:track:c'],
          1,
          61_000,
        ),
      )
    })

    it('Previous starts it from the beginning; Next starts it and moves on', async () => {
      lastSong()
      const { result, api, player } = await renderReadyPlayer()
      act(() => result.current.previous())
      await waitFor(() =>
        expect(api.playContext).toHaveBeenLastCalledWith('dev1', 'spotify:album:mz', 'spotify:track:t1', 0),
      )
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        act(() => result.current.next())
        await waitFor(() => expect(api.playContext).toHaveBeenCalledTimes(2))
        await act(async () => void vi.advanceTimersByTime(1100))
        expect(player.nextTrack).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('shuffle and repeat wait for the music, then apply', async () => {
      lastSong()
      const { result, api } = await renderReadyPlayer()
      act(() => result.current.toggleShuffle())
      act(() => result.current.cycleRepeat())
      expect(result.current.shuffle).toBe(true)
      expect(api.setShuffle).not.toHaveBeenCalled() // nothing to apply it to yet
      act(() => result.current.togglePlay())
      await waitFor(() => expect(api.setShuffle).toHaveBeenCalledWith(true, 'dev1'))
      expect(api.setRepeat).toHaveBeenCalledWith('context', 'dev1')
    })

    it('first time in Aurora: uses the last song played on Spotify', async () => {
      const api = makeApi()
      vi.mocked(api.recentlyPlayed).mockResolvedValue([{ ...song('r1'), name: 'Angel' }])
      const { result } = await renderReadyPlayer(api)
      await waitFor(() => expect(result.current.track).toMatchObject({ name: 'Angel', paused: true }))
    })
  })

  it('ignores a dead copy of itself that Spotify still lists, and plays here', async () => {
    const api = makeApi()
    vi.mocked(api.playbackState).mockResolvedValue({
      device: { id: 'old-aurora', name: 'Aurora', type: 'Computer', volume_percent: 50 },
      is_playing: true,
      progress_ms: 0,
      shuffle_state: false,
      repeat_state: 'off',
      context: null,
      item: {
        id: 'x',
        uri: 'spotify:track:x',
        name: 'Confidence',
        artists: [],
        album: { name: '', images: [] },
        duration_ms: 1,
      },
    } as never)
    const { result } = await renderReadyPlayer(api)
    await waitFor(() => expect(api.playbackState).toHaveBeenCalled())
    expect(result.current.remoteDevice).toBeNull()
    expect(result.current.track).toBeNull()
    await act(() => result.current.playTracks([song('a')]))
    expect(api.playTracks).toHaveBeenCalledWith('dev1', ['spotify:track:a'], 0, undefined)
  })

  it('says goodbye to Spotify when the window closes', async () => {
    const { player } = await renderReadyPlayer()
    window.dispatchEvent(new Event('pagehide'))
    expect(player.disconnect).toHaveBeenCalled()
  })

  it('plays tracks on its own device after activating audio', async () => {
    const { result, api, player } = await renderReadyPlayer()
    await act(() => result.current.playTracks([song('a'), song('b')], 1))
    expect(player.activateElement).toHaveBeenCalled()
    expect(api.playTracks).toHaveBeenCalledWith('dev1', ['spotify:track:a', 'spotify:track:b'], 1, undefined)
  })

  it('shows a notice if playback fails', async () => {
    const api = makeApi(
      vi.fn(async () => {
        throw new SpotifyApiError(403, 'Playing music needs Spotify Premium.')
      }),
    )
    const { result } = await renderReadyPlayer(api)
    await act(() => result.current.playTracks([song('a')]))
    expect(result.current.notice).toBe('Playing music needs Spotify Premium.')
  })

  it('reports a missing Premium subscription as a fatal error', async () => {
    const { result, player } = await renderReadyPlayer()
    player.emit('account_error', { message: 'raw sdk message' })
    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('Spotify Premium')
  })

  it('asks for a new login when the SDK rejects the token', async () => {
    const { result, player } = await renderReadyPlayer()
    player.emit('authentication_error', { message: 'bad token' })
    expect(result.current.loginRequired).toBe(true)
  })

  it('forwards controls to the SDK', async () => {
    const { result, player } = await renderReadyPlayer()
    player.emit('player_state_changed', playbackState())
    act(() => {
      result.current.togglePlay()
      result.current.next()
      result.current.previous()
      result.current.seek(12_345.6)
      result.current.setVolume(0.2)
    })
    expect(player.togglePlay).toHaveBeenCalled()
    expect(player.nextTrack).toHaveBeenCalled()
    expect(player.previousTrack).toHaveBeenCalled()
    expect(player.seek).toHaveBeenCalledWith(12_346)
    expect(player.setVolume).toHaveBeenLastCalledWith(0.2 * 0.2) // slider 0.2 -> gain 0.04
    expect(result.current.volume).toBe(0.2)
  })

  it('starts at a medium volume on first use', async () => {
    const { result, player } = await renderReadyPlayer()
    expect(result.current.volume).toBe(0.5)
    expect(player.options.volume).toBe(0.25) // halfway slider = quarter gain
  })

  it('re-applies its volume once connected, overriding any loud Spotify default', async () => {
    const { player } = await renderReadyPlayer()
    expect(player.setVolume).toHaveBeenCalledWith(0.25)
  })

  it('re-applies its volume after starting playback', async () => {
    const { result, player } = await renderReadyPlayer()
    player.setVolume.mockClear()
    await act(() => result.current.playTracks([song('a')]))
    expect(player.setVolume).toHaveBeenCalledWith(0.25)
  })

  it('remembers the chosen volume for next time', async () => {
    const first = await renderReadyPlayer()
    act(() => first.result.current.setVolume(0.3))
    first.unmount()

    const second = await renderReadyPlayer()
    expect(second.result.current.volume).toBe(0.3)
    expect(second.player.options.volume).toBeCloseTo(0.09)
  })

  it('disconnects on unmount', async () => {
    const { unmount, player } = await renderReadyPlayer()
    unmount()
    expect(player.disconnect).toHaveBeenCalled()
  })

  it('treats a clicked song as playing immediately, before Spotify confirms', async () => {
    let resolvePlay: () => void = () => {}
    const api = makeApi(vi.fn(() => new Promise<void>((r) => (resolvePlay = r))))
    const { result, player } = await renderReadyPlayer(api)

    act(() => void result.current.playTracks([song('a'), song('b')], 1))
    expect(result.current.currentUri).toBe('spotify:track:b') // instantly
    expect(result.current.isPlaying).toBe(true)

    // An update about the *previous* song doesn't cancel it...
    player.emit('player_state_changed', playbackState({ paused: true }))
    expect(result.current.currentUri).toBe('spotify:track:b')

    // ...Spotify confirming the new song does.
    const confirmed = playbackState()
    confirmed.track_window.current_track = { ...confirmed.track_window.current_track, uri: 'spotify:track:b' }
    player.emit('player_state_changed', confirmed)
    await act(async () => resolvePlay())
    expect(result.current.currentUri).toBe('spotify:track:b')
    expect(result.current.track?.uri).toBe('spotify:track:b')
  })

  it('stops showing a song as playing if starting it failed', async () => {
    const api = makeApi(
      vi.fn(async () => {
        throw new SpotifyApiError(403, 'Playing music needs Spotify Premium.')
      }),
    )
    const { result } = await renderReadyPlayer(api)
    await act(() => result.current.playTracks([song('a')]))
    expect(result.current.currentUri).toBeNull()
    expect(result.current.isPlaying).toBe(false)
  })

  it('flips play/pause instantly when toggling', async () => {
    const { result, player } = await renderReadyPlayer()
    player.emit('player_state_changed', playbackState({ paused: false }))
    act(() => result.current.togglePlay())
    expect(result.current.isPlaying).toBe(false)
    expect(player.togglePlay).toHaveBeenCalled()
  })
})
