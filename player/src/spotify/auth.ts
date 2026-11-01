/**
 * Spotify login with Authorization Code + PKCE.
 *
 * Why PKCE: this app runs entirely in the browser, so it can't keep a client
 * secret (anyone could read it from the page). PKCE replaces the secret with a
 * one-time random "code verifier": we send its SHA-256 hash when starting the
 * login, and the verifier itself when exchanging the code. An attacker who
 * intercepts the code can't use it without the verifier.
 *
 * Everything that touches the outside world (storage, fetch, the clock, page
 * navigation) is injected, so the whole flow can be unit tested.
 */

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const TOKENS_KEY = 'aurora.spotify.tokens'
const VERIFIER_KEY = 'aurora.spotify.verifier'
const STATE_KEY = 'aurora.spotify.state'
// Refresh a minute early, so a request never goes out with a token that
// expires mid-flight.
const REFRESH_MARGIN_MS = 60_000

export interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  /** Space-separated scopes the user actually granted. */
  scope?: string
}

export interface AuthConfig {
  clientId: string
  redirectUri: string
  scopes: string[]
}

export interface AuthDeps {
  storage?: Storage
  fetchFn?: typeof fetch
  now?: () => number
  navigate?: (url: string) => void
}

/** The session can't be recovered (refresh token revoked/expired): log in again. */
export class LoginRequiredError extends Error {
  constructor(message = 'Please log in to Spotify again.') {
    super(message)
    this.name = 'LoginRequiredError'
  }
}

// ---------------------------------------------------------------- PKCE bits

const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

export function generateRandomString(length = 64): string {
  // crypto.getRandomValues, not Math.random: the verifier must be unguessable.
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => VERIFIER_CHARS[b % VERIFIER_CHARS.length]).join('')
}

export function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(digest)
}

// ------------------------------------------------------------------ session

export function createSpotifyAuth(config: AuthConfig, deps: AuthDeps = {}) {
  const storage = deps.storage ?? localStorage
  const fetchFn = deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const now = deps.now ?? Date.now
  const navigate = deps.navigate ?? ((url: string) => window.location.assign(url))
  // If several requests notice an expired token at once, they share one refresh
  // instead of racing (a refresh can rotate the refresh token, so parallel
  // refreshes could invalidate each other).
  let refreshing: Promise<Tokens> | null = null

  function loadTokens(): Tokens | null {
    const raw = storage.getItem(TOKENS_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as Tokens
    } catch {
      return null
    }
  }

  function saveTokens(tokens: Tokens): void {
    storage.setItem(TOKENS_KEY, JSON.stringify(tokens))
  }

  async function requestTokens(body: Record<string, string>, previous?: Tokens): Promise<Tokens> {
    const response = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, ...body }),
    })
    if (!response.ok) {
      // 400 invalid_grant = the code or refresh token is no longer valid.
      throw new LoginRequiredError(`Spotify login failed (${response.status}). Please log in again.`)
    }
    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
      scope?: string
    }
    const tokens: Tokens = {
      accessToken: data.access_token,
      // Spotify may or may not rotate the refresh token. Keep the old one if
      // no new one is returned.
      refreshToken: data.refresh_token ?? previous?.refreshToken ?? '',
      expiresAt: now() + data.expires_in * 1000,
      scope: data.scope ?? previous?.scope,
    }
    saveTokens(tokens)
    return tokens
  }

  // On the desktop, two Aurora windows share this login (the hidden player and
  // the one you see). A refresh can replace the refresh token, so only one
  // window may refresh at a time: the other waits, then uses the new tokens.
  async function refreshOnce(seen: Tokens): Promise<Tokens> {
    const refresh = async () => {
      const latest = loadTokens()
      if (!latest) throw new LoginRequiredError()
      // Another window refreshed while we waited: use its tokens.
      if (latest.accessToken !== seen.accessToken && latest.expiresAt - now() > REFRESH_MARGIN_MS) return latest
      return requestTokens({ grant_type: 'refresh_token', refresh_token: latest.refreshToken }, latest)
    }
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    return locks ? locks.request('aurora-spotify-refresh', refresh) : refresh()
  }

  return {
    isLoggedIn(): boolean {
      return loadTokens() !== null
    },

    /**
     * Did the user grant every scope the app currently needs? When a new
     * version of Aurora adds a feature that needs more access, older logins
     * fail this check, and the app asks the user to connect again.
     */
    hasAllScopes(): boolean {
      const granted = new Set((loadTokens()?.scope ?? '').split(' '))
      return config.scopes.every((s) => granted.has(s))
    },

    /** Step 1: send the user to Spotify's consent page. */
    async beginLogin(): Promise<void> {
      const verifier = generateRandomString(64)
      // `state` ties the callback to this browser tab's login attempt (CSRF protection).
      const state = generateRandomString(16)
      storage.setItem(VERIFIER_KEY, verifier)
      storage.setItem(STATE_KEY, state)
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: config.redirectUri,
        scope: config.scopes.join(' '),
        code_challenge_method: 'S256',
        code_challenge: await codeChallengeFor(verifier),
        state,
      })
      navigate(`${AUTHORIZE_URL}?${params}`)
    },

    /** Step 2: Spotify redirected back with ?code=...&state=... */
    async completeLogin(callbackUrl: string): Promise<void> {
      const params = new URL(callbackUrl).searchParams
      const error = params.get('error')
      if (error) {
        throw new LoginRequiredError(
          error === 'access_denied' ? 'Spotify access was cancelled.' : `Spotify login failed: ${error}`,
        )
      }
      const expectedState = storage.getItem(STATE_KEY)
      const verifier = storage.getItem(VERIFIER_KEY)
      storage.removeItem(STATE_KEY)
      storage.removeItem(VERIFIER_KEY)
      if (!expectedState || params.get('state') !== expectedState || !verifier) {
        throw new LoginRequiredError('Login link was invalid or expired. Please try again.')
      }
      await requestTokens({
        grant_type: 'authorization_code',
        code: params.get('code') ?? '',
        redirect_uri: config.redirectUri,
        code_verifier: verifier,
      })
    },

    /** A valid access token, refreshed automatically when needed. */
    async getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
      const tokens = loadTokens()
      if (!tokens) throw new LoginRequiredError()
      if (!options.forceRefresh && tokens.expiresAt - now() > REFRESH_MARGIN_MS) {
        return tokens.accessToken
      }
      refreshing ??= refreshOnce(tokens).finally(() => {
        refreshing = null
      })
      try {
        return (await refreshing).accessToken
      } catch (err) {
        storage.removeItem(TOKENS_KEY)
        throw err
      }
    },

    logout(): void {
      storage.removeItem(TOKENS_KEY)
    },
  }
}

export type SpotifyAuth = ReturnType<typeof createSpotifyAuth>
