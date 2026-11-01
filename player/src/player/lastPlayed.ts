import type { Track } from '../spotify/api'
import type { NowPlaying } from './usePlayer'

// What you were listening to last, so that when nothing is playing the player
// bar still shows it, and Play carries on from where you stopped (like
// Spotify's own app), instead of a bar of greyed-out buttons. The list it was
// playing from is kept too, so Next works straight away after reopening.

const KEY = 'aurora.lastPlayed'
const LIST_KEY = 'aurora.lastList'
// Enough for any album or playlist, without filling storage.
const MAX_LIST = 500

export interface LastPlayed {
  track: NowPlaying
  positionMs: number
}

export interface LastList {
  items: Track[]
  contextUri: string | null
}

export function loadLastPlayed(): LastPlayed | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LastPlayed | null
    return saved?.track?.uri ? saved : null
  } catch {
    return null // storage blocked or unreadable: start without it
  }
}

export function saveLastPlayed(last: LastPlayed): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...last, track: { ...last.track, paused: true } }))
  } catch {
    // ignore: it's a convenience
  }
}

export function loadLastList(): LastList | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_KEY) ?? 'null') as LastList | null
    return Array.isArray(saved?.items) && saved.items.length > 0 ? saved : null
  } catch {
    return null
  }
}

export function saveLastList(list: LastList): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify({ ...list, items: list.items.slice(0, MAX_LIST) }))
  } catch {
    // ignore: Play still works from the song alone
  }
}
