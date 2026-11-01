export const SPOTIFY_CLIENT_ID: string = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? ''

// Must exactly match a Redirect URI registered in the Spotify dashboard.
export const REDIRECT_URI = `${window.location.origin}/callback`

// Only what the app actually uses. Adding a scope later makes Spotify show the
// consent screen again, so the user can see the app asking for more access.
export const SPOTIFY_SCOPES = [
  'streaming', // the Web Playback SDK: play audio in this browser tab
  'user-read-email', // the SDK's account check (listed in Spotify's SDK examples)
  'user-read-private', // the SDK's Premium check; search results for your market
  'user-read-playback-state', // read what's playing
  'user-modify-playback-state', // start playback of a chosen song on this device
  'user-read-recently-played', // Home: "Jump back in"
  'user-top-read', // Home: your top tracks and artists
  'playlist-read-private', // Home: your playlists, including private ones
  'user-library-read', // Albums: the albums saved in your library; liked songs
  'user-read-currently-playing', // the queue panel (GET /me/player/queue needs it)
  'user-library-modify', // liking songs, saving albums
  'user-follow-read', // artists you follow (Library)
  'user-follow-modify', // follow / unfollow an artist from their page
  'playlist-modify-private', // create and edit your private playlists
  'playlist-modify-public', // create and edit your public playlists
  'playlist-read-collaborative', // playlists you collaborate on
  'user-read-playback-position', // podcasts: resume where you left off
]

export const PLAYER_NAME = 'Aurora'

// Optional: a free Last.fm API key (last.fm/api) turns on radio, mixes,
// Discover Weekly and "Fans also like". Without one, those stay hidden.
export const LASTFM_API_KEY: string = import.meta.env.VITE_LASTFM_API_KEY ?? ''
