import { useCallback, useEffect, useRef, useState } from 'react'
import { LoginScreen, SetupScreen } from './components/Screens'
import { Splash } from './components/Splash'
import { LASTFM_API_KEY, SPOTIFY_CLIENT_ID } from './config'
import { createLastfm, type Lastfm } from './discovery/lastfm'
import { isDesktopWindow, useRemotePlayer } from './player/remote'
import { usePlayer } from './player/usePlayer'
import { Shell, type ShellProps } from './shell/Shell'
import type { SpotifyApi } from './spotify/api'
import type { SpotifyAuth } from './spotify/auth'
import { api as defaultApi, auth as defaultAuth } from './spotify/session'
import { useTheme } from './theme/useTheme'

type Phase = 'callback' | 'login' | 'app'

const SPLASH_KEY = 'aurora.splashSeen'

// sessionStorage can throw (e.g. some private-browsing modes). If it does,
// we simply show the splash again, which is harmless.
function splashSeen(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_KEY) === '1'
  } catch {
    return false
  }
}

function markSplashSeen(): void {
  try {
    sessionStorage.setItem(SPLASH_KEY, '1')
  } catch {
    // ignore
  }
}

interface AppProps {
  auth?: SpotifyAuth
  api?: SpotifyApi
  clientId?: string
  /** Last.fm, for radio and mixes; null hides them. */
  lastfm?: Lastfm | null
  /** Running in the desktop app's window (music plays in its hidden engine). */
  desktop?: boolean
}

const defaultLastfm = LASTFM_API_KEY ? createLastfm(LASTFM_API_KEY) : null

export default function App({
  auth = defaultAuth,
  api = defaultApi,
  clientId = SPOTIFY_CLIENT_ID,
  lastfm = defaultLastfm,
  desktop = isDesktopWindow(),
}: AppProps) {
  const ShellFor = desktop ? DesktopShell : LocalShell

  const [phase, setPhase] = useState<Phase>(() => {
    if (window.location.pathname === '/callback') return 'callback'
    // A login from an older version of Aurora may lack permissions that new
    // features need, so treat it as logged out and ask once to reconnect.
    return auth.isLoggedIn() && auth.hasAllScopes() ? 'app' : 'login'
  })
  // Lives at the top, so the theme applies to every screen (login, setup, app).
  const theme = useTheme()
  const [loginError, setLoginError] = useState<string | null>(() =>
    auth.isLoggedIn() && !auth.hasAllScopes()
      ? 'Aurora has new features that need a little more access. Please connect again.'
      : null,
  )
  // The launch animation plays once per browser-tab session: opening Aurora
  // shows it, but coming back from the Spotify login page doesn't replay it.
  const [showSplash, setShowSplash] = useState(() => !splashSeen())
  const hideSplash = useCallback(() => {
    markSplashSeen()
    setShowSplash(false)
  }, [])
  // StrictMode runs effects twice in development. Login codes are single-use,
  // so make sure we only exchange this one once.
  const callbackHandled = useRef(false)

  useEffect(() => {
    if (phase !== 'callback' || callbackHandled.current) return
    callbackHandled.current = true
    auth
      .completeLogin(window.location.href)
      .then(() => setPhase('app'))
      .catch((err: Error) => {
        setLoginError(err.message)
        setPhase('login')
      })
      // Drop ?code=... from the address bar so a refresh doesn't reuse it.
      .finally(() => window.history.replaceState(null, '', '/'))
  }, [phase, auth])

  let screen
  if (!clientId) screen = <SetupScreen />
  else if (phase === 'callback') screen = <main className="center-screen">Signing you in...</main>
  else if (phase === 'login') screen = <LoginScreen error={loginError} onLogin={() => void auth.beginLogin()} />
  else
    screen = (
      <ShellFor
        auth={auth}
        api={api}
        lastfm={lastfm}
        theme={theme}
        onLoggedOut={(message) => {
          auth.logout()
          setLoginError(message)
          setPhase('login')
        }}
      />
    )

  return (
    <>
      {screen}
      {showSplash && <Splash onDone={hideSplash} />}
    </>
  )
}

/** In a normal browser tab: the music plays in this tab. */
function LocalShell(props: ShellProps) {
  const player = usePlayer(props.auth, props.api)
  return <Shell {...props} player={player} />
}

/** In the desktop app: the music plays in the hidden engine window, so it carries on when this one closes. */
function DesktopShell({ onLoggedOut, ...props }: ShellProps) {
  const { signOutEverywhere, ...player } = useRemotePlayer()
  const logOut = useCallback(
    (msg: string | null) => {
      signOutEverywhere()
      onLoggedOut(msg)
    },
    [signOutEverywhere, onLoggedOut],
  )
  return <Shell {...props} onLoggedOut={logOut} player={player} />
}
