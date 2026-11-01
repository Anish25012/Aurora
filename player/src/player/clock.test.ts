import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { positionAt, stoppedAt, usePosition } from './clock'

describe('playback clock', () => {
  beforeEach(() => void vi.useFakeTimers({ now: 100_000 }))
  afterEach(() => void vi.useRealTimers())

  it('works out the position from when it was last told', () => {
    const clock = { positionMs: 30_000, at: 100_000, paused: false }
    expect(positionAt(clock, 105_000)).toBe(35_000)
    expect(positionAt({ ...clock, paused: true }, 105_000)).toBe(30_000)
    expect(positionAt(clock, 99_000)).toBe(30_000) // never runs backwards
  })

  it('ticks only where the position is shown, and stops at the end of the song', () => {
    const clock = { positionMs: 9_000, at: 100_000, paused: false }
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return usePosition(clock, 10_000)
    })
    act(() => void vi.advanceTimersByTime(500))
    expect(result.current).toBe(9_500)
    expect(renders).toBeGreaterThan(1)
    act(() => void vi.advanceTimersByTime(5_000))
    expect(result.current).toBe(10_000)
  })

  it('a paused clock never re-renders', () => {
    let renders = 0
    renderHook(() => {
      renders++
      return usePosition(stoppedAt(4_000))
    })
    const before = renders
    act(() => void vi.advanceTimersByTime(5_000))
    expect(renders).toBe(before)
  })
})
