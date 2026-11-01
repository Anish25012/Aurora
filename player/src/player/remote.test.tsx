import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEngineBroadcast, useRemotePlayer } from './remote'
import type { Track } from '../spotify/api'
import type { PlayerControls } from './usePlayer'

function song(id: string): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: `Song ${id}`,
    artists: [{ id: 'ar', name: 'Artist' }],
    album: { id: 'al', name: 'Album', images: [] },
    duration_ms: 200_000,
    explicit: false,
    external_urls: {},
  }
}

function fakePlayer(overrides: Partial<PlayerControls> = {}): PlayerControls {
  return {
    status: 'ready',
    error: null,
    notice: null,
    clearNotice: vi.fn(),
    notify: vi.fn(),
    loginRequired: false,
    track: null,
    currentUri: 'spotify:track:t1',
    currentContextUri: null,
    isPlaying: true,
    buffering: false,
    clock: { positionMs: 42_000, at: 1000, paused: false },
    volume: 0.4,
    shuffle: false,
    repeat: 'off',
    deviceId: 'engine-device',
    remoteDevice: null,
    playTracks: vi.fn(async () => {}),
    playContext: vi.fn(async () => {}),
    addToQueue: vi.fn(async () => {}),
    togglePlay: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    toggleShuffle: vi.fn(),
    cycleRepeat: vi.fn(),
    transferTo: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('desktop: the hidden engine and the window you see', () => {
  it('the window shows the engine’s player, and its buttons control it', async () => {
    const player = fakePlayer()
    const onLogout = vi.fn()
    renderHook(() => useEngineBroadcast(player, onLogout))
    const { result } = renderHook(() => useRemotePlayer())

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.clock).toEqual({ positionMs: 42_000, at: 1000, paused: false })
    expect(result.current.deviceId).toBe('engine-device')

    result.current.togglePlay()
    // Whole songs (not just ids) cross over: the engine needs their details to find them.
    const songs = [song('a'), song('b')]
    await result.current.playTracks(songs, 1, 5000)
    await waitFor(() => expect(player.playTracks).toHaveBeenCalledWith(songs, 1, 5000))
    expect(player.togglePlay).toHaveBeenCalled()

    result.current.signOutEverywhere()
    await waitFor(() => expect(onLogout).toHaveBeenCalled())
  })

  it('buttons wired straight to onClick work (the click event stays behind)', async () => {
    const player = fakePlayer()
    renderHook(() => useEngineBroadcast(player, vi.fn()))
    const { result } = renderHook(() => useRemotePlayer())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    render(
      <>
        <button onClick={result.current.next}>Next</button>
        <button onClick={result.current.togglePlay}>Play</button>
      </>,
    )
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Play'))
    await waitFor(() => expect(player.next).toHaveBeenCalledWith())
    await waitFor(() => expect(player.togglePlay).toHaveBeenCalledWith())
  })

  it('waits as "connecting" until the engine is there', () => {
    const { result } = renderHook(() => useRemotePlayer())
    expect(result.current.status).toBe('connecting')
    expect(result.current.track).toBeNull()
  })
})
