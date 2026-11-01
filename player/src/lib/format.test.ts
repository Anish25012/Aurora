import { describe, expect, it } from 'vitest'
import { formatTime, pickImage } from './format'

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [9_999, '0:09'],
    [215_000, '3:35'],
    [3_725_000, '1:02:05'],
    [-5, '0:00'],
  ])('%i ms -> %s', (ms, expected) => {
    expect(formatTime(ms)).toBe(expected)
  })
})

describe('pickImage', () => {
  const images = [
    { url: 'big', width: 640 },
    { url: 'small', width: 64 },
    { url: 'medium', width: 300 },
  ]

  it('picks the smallest image that is big enough', () => {
    expect(pickImage(images, 48)).toBe('small')
    expect(pickImage(images, 200)).toBe('medium')
  })

  it('falls back to the largest, or null when there are none', () => {
    expect(pickImage(images, 1000)).toBe('big')
    expect(pickImage([], 64)).toBeNull()
  })
})
