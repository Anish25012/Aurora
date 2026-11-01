import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../components/ThemeToggle'
import { applyTheme, initialTheme, loadSavedTheme, saveTheme } from './theme'
import { useTheme } from './useTheme'

function mockSystem(dark: boolean, reducedMotion = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion') ? reducedMotion : dark,
    media: query,
  }))
}

function mockViewTransitions() {
  let finish: () => void = () => {}
  document.startViewTransition = vi.fn((update?: () => void) => {
    update?.()
    return {
      ready: Promise.resolve(),
      finished: new Promise<void>((r) => (finish = r)),
      updateCallbackDone: Promise.resolve(),
      skipTransition: vi.fn(),
    }
  }) as unknown as typeof document.startViewTransition
  return { finish: () => finish() }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
  document.documentElement.classList.remove('theme-reveal')
  // @ts-expect-error test cleanup of the optional API
  delete document.startViewTransition
})

describe('theme storage', () => {
  it('starts in the OS theme until the user chooses, then remembers the choice', () => {
    mockSystem(true)
    expect(loadSavedTheme()).toBeNull()
    expect(initialTheme()).toBe('dark')

    saveTheme('light')
    expect(initialTheme()).toBe('light') // the saved choice wins over the OS
  })

  it('ignores garbage in storage', () => {
    mockSystem(false)
    localStorage.setItem('aurora.theme', 'neon')
    expect(initialTheme()).toBe('light')
  })

  it('applies the theme to <html> and the window colour', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(meta.content).toBe('#0e0e10')
    meta.remove()
  })
})

describe('useTheme', () => {
  it('switches with a circular reveal from the clicked point', async () => {
    mockSystem(false)
    const vt = mockViewTransitions()
    const animate = vi.fn()
    document.documentElement.animate = animate

    const { result } = renderHook(() => useTheme())
    await act(async () => result.current.setTheme('dark', { x: 100, y: 700 }))

    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('aurora.theme')).toBe('dark')
    expect(document.documentElement).toHaveClass('theme-reveal')
    const [keyframes, options] = animate.mock.calls[0]
    expect(keyframes.clipPath[0]).toBe('circle(0px at 100px 700px)')
    expect(options.pseudoElement).toBe('::view-transition-new(root)')

    await act(async () => vt.finish())
    expect(document.documentElement).not.toHaveClass('theme-reveal')
  })

  it('does nothing visible when choosing the theme that is already on', async () => {
    mockSystem(false)
    mockViewTransitions()
    const { result } = renderHook(() => useTheme())
    await act(async () => result.current.setTheme('light', { x: 0, y: 0 }))
    expect(document.startViewTransition).not.toHaveBeenCalled()
  })

  it('skips the circle when reduced motion is on (browser cross-fade only)', async () => {
    mockSystem(false, true)
    mockViewTransitions()
    const animate = vi.fn()
    document.documentElement.animate = animate
    const { result } = renderHook(() => useTheme())
    await act(async () => result.current.setTheme('dark', { x: 1, y: 1 }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(animate).not.toHaveBeenCalled()
  })

  it('switches instantly where the browser has no View Transitions', () => {
    mockSystem(false)
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('dark', { x: 0, y: 0 }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('ThemeToggle', () => {
  it('shows two labelled options and reports the choice', async () => {
    const onChange = vi.fn()
    render(<ThemeToggle theme="light" onChange={onChange} />)
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
    expect(screen.getByText('Dark')).toBeVisible() // a visible label, not just an icon

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(onChange).toHaveBeenCalledWith('dark', expect.objectContaining({ x: expect.any(Number) }))
  })
})
