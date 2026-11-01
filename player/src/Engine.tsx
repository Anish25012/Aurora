import { useEffect, useState } from 'react'
import { useEngineBroadcast } from './player/remote'
import { usePlayer } from './player/usePlayer'
import type { SpotifyApi } from './spotify/api'
import type { SpotifyAuth } from './spotify/auth'

// desktop/launch-aurora.ps1 restarts the engine after 45 s without one.
const ALIVE_EVERY_MS = 5000

interface Props {
  auth: SpotifyAuth
  api: SpotifyApi
}

/**
 * The desktop app's hidden player window (/?engine). It's the "Aurora"
 * Spotify device and plays the music; the window you see is a remote control
 * for it (see player/remote.ts). It keeps running when that window is closed,
 * until you choose Exit Aurora from the tray icon.
 */
export function Engine({ auth, api }: Props) {
  useEffect(() => {
    document.title = 'Aurora Engine' // the launcher finds and hides this window by its title
  }, [])

  // Tell the desktop server we're still alive. If this page freezes or crashes
  // while its window stays open, the check-ins stop and the launcher restarts it.
  useEffect(() => {
    const checkIn = () => void fetch('/engine-alive', { method: 'POST' }).catch(() => {})
    checkIn()
    const id = window.setInterval(checkIn, ALIVE_EVERY_MS)
    return () => window.clearInterval(id)
  }, [])

  // Signing in happens in the window you see; the login is shared through
  // storage, so wait for it.
  const loggedIn = () => auth.isLoggedIn() && auth.hasAllScopes()
  const [ready, setReady] = useState(loggedIn)
  useEffect(() => {
    const check = () => setReady(loggedIn())
    window.addEventListener('storage', check)
    const id = window.setInterval(check, 2000)
    return () => {
      window.removeEventListener('storage', check)
      window.clearInterval(id)
    }
  })

  return ready ? <EngineRunner auth={auth} api={api} /> : <p>Waiting for you to sign in to Spotify…</p>
}

function EngineRunner({ auth, api }: Props) {
  const player = usePlayer(auth, api)
  // Signed out in the window: stop, and wait for the next sign-in.
  useEngineBroadcast(player, () => window.location.reload())
  return <p>Aurora is playing in the background.</p>
}
