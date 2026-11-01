import { describe, expect, it } from 'vitest'
import { DEFAULT_VOLUME, loadVolume, saveVolume, toGain } from './volume'

describe('toGain', () => {
  it('uses a perceptual curve: halfway on the slider is a quarter of the gain', () => {
    expect(toGain(0)).toBe(0)
    expect(toGain(0.5)).toBe(0.25)
    expect(toGain(1)).toBe(1)
  })

  it('clamps out-of-range input', () => {
    expect(toGain(-1)).toBe(0)
    expect(toGain(2)).toBe(1)
  })
})

describe('loadVolume / saveVolume', () => {
  it('starts in the middle the first time', () => {
    expect(DEFAULT_VOLUME).toBe(0.5)
    expect(loadVolume()).toBe(0.5)
  })

  it('remembers the last level', () => {
    saveVolume(0.32)
    expect(loadVolume()).toBe(0.32)
  })

  it('ignores garbage and falls back to the default', () => {
    localStorage.setItem('aurora.volume', 'loud')
    expect(loadVolume()).toBe(0.5)
  })

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(loadVolume(broken)).toBe(0.5)
    expect(() => saveVolume(0.4, broken)).not.toThrow()
  })
})
