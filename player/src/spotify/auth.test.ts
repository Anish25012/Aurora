import { describe, expect, it, vi } from 'vitest'
import { codeChallengeFor, createSpotifyAuth, generateRandomString, LoginRequiredError } from './auth'

const CONFIG = {
  clientId: 'client123',
  redirectUri: 'http://127.0.0.1:5173/callback',
  scopes: ['streaming', 'user-read-private'],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function setup(fetchImpl?: (url: string, init: RequestInit) => Promise<Response>, startTime = 1_000_000) {
  let clock = startTime
  const navigate = vi.fn()
  const fetchFn = vi.fn(
    fetchImpl ?? (async () => jsonResponse({ access_token: 'access1', refresh_token: 'refresh1', expires_in: 3600 })),
  )
  const auth = createSpotifyAuth(CONFIG, {
    storage: localStorage,
    fetchFn: fetchFn as unknown as typeof fetch,
    now: () => clock,
    navigate,
  })
  return { auth, fetchFn, navigate, advance: (ms: number) => (clock += ms) }
}

async function logIn(ctx: ReturnType<typeof setup>) {
  await ctx.auth.beginLogin()
  const state = new URL(ctx.navigate.mock.calls[0][0]).searchParams.get('state')
  await ctx.auth.completeLogin(`${CONFIG.redirectUri}?code=thecode&state=${state}`)
}

function bodyOf(call: unknown[]): URLSearchParams {
  return (call[1] as RequestInit).body as URLSearchParams
}

describe('PKCE helpers', () => {
  it('matches the RFC 7636 example challenge', async () => {
    // Appendix B of RFC 7636: the reference verifier -> challenge pair.
    expect(await codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('generates verifiers from the allowed character set', () => {
    const v = generateRandomString(64)
    expect(v).toHaveLength(64)
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/)
    expect(generateRandomString(64)).not.toBe(v)
  })
})

describe('login flow', () => {
  it('sends the user to Spotify with the right parameters', async () => {
    const ctx = setup()
    await ctx.auth.beginLogin()

    const url = new URL(ctx.navigate.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize')
    const p = url.searchParams
    expect(p.get('client_id')).toBe('client123')
    expect(p.get('response_type')).toBe('code')
    expect(p.get('redirect_uri')).toBe(CONFIG.redirectUri)
    expect(p.get('scope')).toBe('streaming user-read-private')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('code_challenge')).toBe(await codeChallengeFor(localStorage.getItem('aurora.spotify.verifier')!))
    expect(p.get('state')).toHaveLength(16)
  })

  it('exchanges the code with the verifier and stores tokens', async () => {
    const ctx = setup()
    await ctx.auth.beginLogin()
    const verifier = localStorage.getItem('aurora.spotify.verifier')
    const state = new URL(ctx.navigate.mock.calls[0][0]).searchParams.get('state')

    await ctx.auth.completeLogin(`${CONFIG.redirectUri}?code=thecode&state=${state}`)

    const body = bodyOf(ctx.fetchFn.mock.calls[0])
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('thecode')
    expect(body.get('code_verifier')).toBe(verifier)
    expect(body.get('client_id')).toBe('client123')
    expect(ctx.auth.isLoggedIn()).toBe(true)
    // One-time values are cleaned up.
    expect(localStorage.getItem('aurora.spotify.verifier')).toBeNull()
  })

  it('rejects a callback whose state does not match (CSRF)', async () => {
    const ctx = setup()
    await ctx.auth.beginLogin()
    await expect(ctx.auth.completeLogin(`${CONFIG.redirectUri}?code=x&state=forged`)).rejects.toBeInstanceOf(
      LoginRequiredError,
    )
    expect(ctx.fetchFn).not.toHaveBeenCalled()
  })

  it('explains a cancelled login', async () => {
    const ctx = setup()
    await expect(ctx.auth.completeLogin(`${CONFIG.redirectUri}?error=access_denied&state=s`)).rejects.toThrow(
      'cancelled',
    )
  })
})

describe('getAccessToken', () => {
  it('returns the stored token while it is fresh', async () => {
    const ctx = setup()
    await logIn(ctx)
    expect(await ctx.auth.getAccessToken()).toBe('access1')
    expect(ctx.fetchFn).toHaveBeenCalledTimes(1) // only the login exchange
  })

  it('refreshes near expiry and keeps the old refresh token if none is returned', async () => {
    const ctx = setup()
    await logIn(ctx)
    ctx.fetchFn.mockImplementation(async () => jsonResponse({ access_token: 'access2', expires_in: 3600 }))
    ctx.advance(3600_000 - 30_000) // inside the 60s safety margin

    expect(await ctx.auth.getAccessToken()).toBe('access2')
    const body = bodyOf(ctx.fetchFn.mock.calls[1])
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('refresh1')
    expect(JSON.parse(localStorage.getItem('aurora.spotify.tokens')!).refreshToken).toBe('refresh1')
  })

  it('shares one refresh between concurrent callers', async () => {
    const ctx = setup()
    await logIn(ctx)
    ctx.fetchFn.mockImplementation(async () => jsonResponse({ access_token: 'access2', expires_in: 3600 }))
    ctx.advance(4000_000)

    const tokens = await Promise.all([ctx.auth.getAccessToken(), ctx.auth.getAccessToken(), ctx.auth.getAccessToken()])
    expect(tokens).toEqual(['access2', 'access2', 'access2'])
    expect(ctx.fetchFn).toHaveBeenCalledTimes(2) // login + exactly one refresh
  })

  it('logs out when the refresh token is rejected', async () => {
    const ctx = setup()
    await logIn(ctx)
    ctx.fetchFn.mockImplementation(async () => jsonResponse({ error: 'invalid_grant' }, 400))
    ctx.advance(4000_000)

    await expect(ctx.auth.getAccessToken()).rejects.toBeInstanceOf(LoginRequiredError)
    expect(ctx.auth.isLoggedIn()).toBe(false)
  })

  it('requires login when there are no tokens', async () => {
    await expect(setup().auth.getAccessToken()).rejects.toBeInstanceOf(LoginRequiredError)
  })
})
