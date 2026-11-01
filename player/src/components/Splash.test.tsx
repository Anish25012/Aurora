import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { SpotifyApi } from '../spotify/api'
import type { SpotifyAuth } from '../spotify/auth'
import { Splash } from './Splash'

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }))
}

beforeEach(() => {
  vi.useFakeTimers()
  mockReducedMotion(false)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('Splash', () => {
  it('holds, then plays its exit, then finishes', () => {
    const onDone = vi.fn()
    render(<Splash onDone={onDone} />)
    const splash = screen.getByTestId('splash')

    act(() => vi.advanceTimersByTime(1400))
    expect(splash).not.toHaveClass('is-exiting')

    act(() => vi.advanceTimersByTime(200))
    expect(splash).toHaveClass('is-exiting')
    expect(onDone).not.toHaveBeenCalled() // exit animation still running

    act(() => vi.advanceTimersByTime(450))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('can be skipped with a click or a key press', () => {
    const onDone = vi.fn()
    render(<Splash onDone={onDone} />)
    fireEvent.pointerDown(screen.getByTestId('splash'))
    expect(screen.getByTestId('splash')).toHaveClass('is-exiting')
    act(() => vi.advanceTimersByTime(450))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('skips on a key press too', () => {
    render(<Splash onDone={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('splash')).toHaveClass('is-exiting')
  })

  it('is much shorter when the user prefers reduced motion', () => {
    mockReducedMotion(true)
    const onDone = vi.fn()
    render(<Splash onDone={onDone} />)
    // Two steps: the exit timer is only scheduled once the hold has ended and React re-rendered.
    act(() => vi.advanceTimersByTime(500))
    act(() => vi.advanceTimersByTime(450))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('is hidden from screen readers (it is purely decorative)', () => {
    render(<Splash onDone={vi.fn()} />)
    expect(screen.getByTestId('splash')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Splash in the app', () => {
  const auth = {
    isLoggedIn: () => false,
    hasAllScopes: () => true,
    beginLogin: vi.fn(),
    completeLogin: vi.fn(),
    getAccessToken: vi.fn(),
    logout: vi.fn(),
  } as unknown as SpotifyAuth
  const api = {} as SpotifyApi

  it('plays once per session, over the screen already loaded underneath', () => {
    const first = render(<App auth={auth} api={api} clientId="abc" />)
    expect(screen.getByTestId('splash')).toBeInTheDocument()
    // The login screen is already rendered beneath the splash.
    expect(screen.getByRole('button', { name: 'Connect Spotify' })).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1500)) // hold
    act(() => vi.advanceTimersByTime(450)) // exit animation
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument()
    first.unmount()

    // Same tab session (e.g. coming back from the Spotify login page): no replay.
    render(<App auth={auth} api={api} clientId="abc" />)
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument()
  })
})
