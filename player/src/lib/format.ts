/** 215000 -> "3:35". Durations over an hour get an hour part: "1:02:05". */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** Smallest image at least `minWidth` wide, so a 48px thumbnail doesn't download a 640px image. */
export function pickImage(images: { url: string; width: number | null }[], minWidth: number): string | null {
  if (images.length === 0) return null
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return (sorted.find((i) => (i.width ?? 0) >= minWidth) ?? sorted[sorted.length - 1]).url
}

/** "3 songs, 1 hr 4 min" */
export function songsAndLength(durations: number[]): string {
  const minutes = Math.round(durations.reduce((sum, ms) => sum + ms, 0) / 60_000)
  const length = minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`
  return `${durations.length} ${durations.length === 1 ? 'song' : 'songs'}, ${length}`
}

/** Spotify descriptions can contain HTML (links, &amp;). Show them as plain text. */
export function plainText(html: string): string {
  // DOMParser builds an inert document: nothing in it runs or loads.
  return new DOMParser().parseFromString(html, 'text/html').documentElement.textContent?.trim() ?? ''
}
