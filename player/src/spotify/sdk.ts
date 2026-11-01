const SDK_URL = 'https://sdk.scdn.co/spotify-player.js'

let sdkPromise: Promise<typeof Spotify> | null = null

/**
 * Load Spotify's Web Playback SDK script once and resolve when it's ready.
 *
 * The SDK announces readiness by calling a global `onSpotifyWebPlaybackSDKReady`,
 * so we install that callback before adding the <script> tag. The promise is
 * cached at module level, so React re-mounts (StrictMode, hot reload) never
 * inject the script twice.
 */
export function loadSpotifySdk(): Promise<typeof Spotify> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve, reject) => {
    if (window.Spotify) {
      resolve(window.Spotify)
      return
    }
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify)
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onerror = () => {
      sdkPromise = null // allow a retry
      reject(new Error("Couldn't load Spotify's player. An ad or privacy blocker may be blocking sdk.scdn.co."))
    }
    document.body.appendChild(script)
  })
  return sdkPromise
}
