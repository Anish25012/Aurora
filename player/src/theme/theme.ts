/**
 * Light / dark theme.
 *
 * The page's colours are CSS variables, switched by `data-theme` on <html>
 * (see index.css). Until the user picks one, Aurora starts in whichever theme
 * the OS uses; after that their choice is remembered. The very first paint is
 * handled by a tiny inline script in index.html, so dark-mode users never see
 * a white flash while React loads.
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'aurora.theme'

// Matches --bg in index.css, so the window/title bar blends with the page.
const THEME_COLOR: Record<Theme, string> = { light: '#fbfbfd', dark: '#0e0e10' }

/** The theme the user chose before, or null if they never have. */
export function loadSavedTheme(storage: Storage = localStorage): Theme | null {
  try {
    const value = storage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function saveTheme(theme: Theme, storage: Storage = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage blocked: the choice just won't survive a restart.
  }
}

export function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function initialTheme(storage: Storage = localStorage): Theme {
  return loadSavedTheme(storage) ?? systemTheme()
}

export function applyTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
