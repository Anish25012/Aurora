// The app's single auth session and API client, wired to the real browser.
import { REDIRECT_URI, SPOTIFY_CLIENT_ID, SPOTIFY_SCOPES } from '../config'
import { createSpotifyApi } from './api'
import { createSpotifyAuth } from './auth'

export const auth = createSpotifyAuth({
  clientId: SPOTIFY_CLIENT_ID,
  redirectUri: REDIRECT_URI,
  scopes: SPOTIFY_SCOPES,
})

export const api = createSpotifyApi({ getAccessToken: auth.getAccessToken })
