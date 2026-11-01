import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CardRow } from './CardRow'

// jsdom has no layout: give the row a size (800 wide, 2000 of cards) and a working scrollBy.
function stubScrolling() {
  const scrollBy = vi.fn(function (this: HTMLElement, opts: ScrollToOptions) {
    this.scrollLeft += opts.left ?? 0
    fireEvent.scroll(this)
  })
  Object.defineProperties(HTMLElement.prototype, {
    scrollWidth: { configurable: true, get: () => 2000 },
    clientWidth: { configurable: true, get: () => 800 },
  })
  HTMLElement.prototype.scrollBy = scrollBy as unknown as HTMLElement['scrollBy']
  return scrollBy
}

describe('CardRow', () => {
  it('‹ › move along a screenful at a time, and each disappears at its end', async () => {
    const scrollBy = stubScrolling()
    try {
      render(
        <CardRow label="Your playlists">
          <span>card</span>
        </CardRow>,
      )
      expect(screen.queryByRole('button', { name: 'Scroll Your playlists left' })).toBeNull() // at the start
      const next = screen.getByRole('button', { name: 'Scroll Your playlists right' })
      await userEvent.click(next)
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 680 }))
      expect(screen.getByRole('button', { name: 'Scroll Your playlists left' })).toBeVisible()

      await userEvent.click(next) // 1360: past the end (1200)
      expect(screen.queryByRole('button', { name: 'Scroll Your playlists right' })).toBeNull()
    } finally {
      // Back to jsdom's own (zero) sizes for the other tests.
      for (const prop of ['scrollWidth', 'clientWidth']) Reflect.deleteProperty(HTMLElement.prototype, prop)
    }
  })
})
