// Recent searches: only the words you typed (no Spotify data), so they can be
// remembered between sessions. Storage can be blocked (private windows), so
// every read and write is allowed to fail quietly.

const KEY = 'aurora.recentSearches'
const MAX = 8

export function loadRecentSearches(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

function save(list: string[]): string[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Not remembered this time; the list still works for this session.
  }
  return list
}

/** Put `query` at the front (once, ignoring case). */
export function rememberSearch(list: string[], query: string): string[] {
  const q = query.trim()
  if (!q) return list
  return save([q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX))
}

export function forgetSearch(list: string[], query: string): string[] {
  return save(list.filter((x) => x !== query))
}

export function clearSearches(): string[] {
  return save([])
}
