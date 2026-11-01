/**
 * Volume: what the slider shows vs. what the speakers get.
 *
 * Hearing is roughly logarithmic, so a linear slider sounds nearly full by the
 * halfway mark and all the useful control is crammed into the bottom third.
 * Mapping slider -> gain with a square curve (the approach most OS and Apple
 * volume controls take) makes "halfway" actually sound medium, and gives
 * finer control at low levels, where ears are most sensitive.
 */

const STORAGE_KEY = 'aurora.volume'

/** Where the slider starts the first time: the middle. */
export const DEFAULT_VOLUME = 0.5

/** Slider position (0-1) -> audio gain (0-1). 0.5 -> 0.25. */
export function toGain(position: number): number {
  const p = clamp(position)
  return p * p
}

export function loadVolume(storage: Storage = localStorage): number {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) ? clamp(value) : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME // storage blocked (e.g. some private modes): use the default
  }
}

export function saveVolume(position: number, storage: Storage = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, String(clamp(position)))
  } catch {
    // Not being able to remember the volume isn't worth interrupting anyone over.
  }
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v))
}
