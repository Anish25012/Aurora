# Aurora Player

A music player with an Apple-inspired design that plays **any song on Spotify, in full**, inside its own interface. Aurora registers itself as a Spotify Connect device (using Spotify's official Web Playback SDK), so the audio streams directly in the app. No AI, no separate Spotify app needed.

Your whole library (liked songs, playlists, albums) can also be saved from Spotify into a file Aurora owns: **Library → Save my library**.

**Features**

- **Home:** recently played, your most-played tracks and artists, and your playlists, with the current album art glowing behind the page.
- **Search,** grouped into songs, artists, albums, playlists and podcasts, with your recent searches remembered.
- **Artist, album, playlist and podcast pages.** Play anything in context, add to the queue, like songs, follow artists.
- **Library:** liked songs, saved albums and playlists. Create playlists and edit their details and tracks.
- **Full-screen player** with synced lyrics (from LRCLIB), a queue panel, shuffle and repeat, and a device picker. With nothing playing, the bar shows your last song, and Play carries on where you stopped, in the list it was playing from.
- **Discovery** (optional, needs a free Last.fm key): song and artist radio, Daily Mixes, Discover Weekly and "Fans also like".
- **Light and Dark** themes, keyboard shortcuts (Space, Ctrl+arrows, Ctrl+S, Ctrl+R), and a Windows desktop app with a tray icon.

## Requirements

- **Spotify Premium.** The Web Playback SDK only works with Premium accounts.
- Node.js 20+
- Chrome, Edge, Firefox or Safari. Protected audio (EME) must be allowed, so ad/privacy blockers may need to allow `sdk.scdn.co`.

## Setup

1. In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), open your app (or create one), then go to **Settings → Edit**:
   - Add the redirect URI `http://127.0.0.1:5173/callback` and save.
   - Under **APIs used**, tick **Web Playback SDK** (and Web API).
   - Under **User Management**, add your Spotify account's name and email.
2. Copy the **Client ID** into `player/.env.local`:
   ```
   VITE_SPOTIFY_CLIENT_ID=your_client_id
   ```
   No client secret is needed. See *Login* below for why.
   To turn on Discovery, also add a free [Last.fm API key](https://www.last.fm/api/account/create):
   ```
   VITE_LASTFM_API_KEY=your_lastfm_key
   ```
3. Run it:
   ```bash
   cd player
   npm install
   npm run dev        # opens http://127.0.0.1:5173
   ```

### Desktop app (Windows)

Run once to add **Aurora**, with its icon (an aurora over a skyline of sound-wave bars; artwork in `player/public/aurora-mark.svg`), to your Desktop and Start menu:

```powershell
powershell -ExecutionPolicy Bypass -File desktop\install-shortcuts.ps1
```

Clicking the icon opens Aurora in its own window (no tabs or address bar, its own taskbar icon). Behind the scenes, `desktop/launch-aurora.ps1`:

- rebuilds the app if any source changed;
- starts a hidden local server on `127.0.0.1:5173`;
- opens an off-screen player window (`/engine?engine`), which is the "Aurora" Spotify device and plays the music;
- opens the window you use (`/?desktop`), a remote control for the hidden player over a `BroadcastChannel`. Both are Google Chrome app-mode windows (Microsoft Edge if Chrome isn't installed), using a separate browser profile just for Aurora;
- puts an Aurora icon in the system tray.

Closing the window (its X, Alt+F4 or Ctrl+W) keeps the music playing. Click the tray icon to open the window again, or right-click it and choose **Exit Aurora** to close everything, including the server. The launcher stays light while it waits (about 0.2% CPU when idle). Opening Aurora from its shortcut while it's running brings the window back instead of starting a second copy.

It recovers on its own: windows left behind by a crash are closed at the next start (so hidden players can't pile up), and if the player window dies it's restarted. The player also checks in with the local server every 5 seconds, so if Chrome freezes or crashes the page but leaves its window open (which once left the window stuck on "Connecting to Spotify..."), the launcher notices within a minute and restarts it, allowing for the PC having been asleep. `launch-aurora.ps1 -Exit` closes a running Aurora cleanly.

Logs go to `%LOCALAPPDATA%\Aurora\launcher.log`. `desktop/uninstall-shortcuts.ps1` removes the shortcuts.

*Why a browser app window and not Electron or Tauri:* Spotify streams full songs through Widevine DRM. Chrome and Edge include it. Stock Electron doesn't, and it would need a separately licensed fork. App mode gives a real app window with working playback and nothing extra to install.

For development, `npm run dev` (or `start_aurora.bat`) still runs Aurora with hot reload; the desktop app reuses that server if it's running.

## Tests

```bash
npm test          # unit + component tests (Vitest + Testing Library)
npm run lint
npm run build     # type-check + production build
```

The desktop app has its own end-to-end check (about a minute; close Aurora first). It starts Aurora, checks the windows, the server and single-instance behaviour, simulates the player crashing, measures idle CPU and exits:

```powershell
powershell -ExecutionPolicy Bypass -File desktop\test-desktop.ps1
```

## How it works

| Piece | File | Job |
|---|---|---|
| Login | `src/spotify/auth.ts` | Authorization Code + PKCE, token storage, automatic refresh |
| API client | `src/spotify/api.ts` | Search, start playback on our device, friendly error messages |
| Player | `src/player/usePlayer.ts` | Loads the SDK, becomes the "Aurora" device, exposes state and controls to React |
| Desktop server | `server/aurora-server.mjs` | Serves the built app on 127.0.0.1:5173 for the desktop app (no dependencies) |
| Remote | `src/player/remote.ts` | Desktop app: the window you see controls the off-screen engine over a `BroadcastChannel` |
| Discovery | `src/discovery/` | Last.fm similar tracks/artists turned into radio and mixes |
| Library | `src/music/libraryFile.ts` | Aurora's own library format (exported once from Spotify by `src/spotify/exportLibrary.ts`) |
| Lyrics | `src/lib/lyrics.ts` | Time-synced lyrics from LRCLIB |
| UI | `src/components/` | Every page and panel. Styles live in `src/styles/`, one file per area |

**Design decisions**


- **Home loads each shelf independently**, so one slow or failing request (e.g. rate limiting) doesn't blank the whole page, and empty shelves simply don't appear.
- **Ambient colour from the album art.** The current cover, hugely blurred, glows behind the page. It's a single `<img>` with a CSS blur, with no colour extraction code to maintain.
- **Older logins are asked to reconnect** when a new feature needs a new Spotify scope, instead of failing with confusing 403s.
- **PKCE login, no backend.** A browser app can't keep a client secret secret. PKCE replaces it with a one-time code verifier, and the `state` parameter protects against forged callbacks (CSRF). The test suite checks the hashing against the official RFC 7636 example.
- **One shared token refresh.** If several requests find the token expired at once, they wait on a single refresh rather than racing. Spotify may rotate refresh tokens, so parallel refreshes could invalidate each other.
- **Playing a list, not a song.** Clicking a search result plays the whole result list starting at that song, so Next carries on through it, like Spotify does.
- **Smooth progress without polling or redrawing.** The SDK only reports position when something changes, so the player keeps a *clock* (position, when, playing or not) and only the progress bar and lyrics tick (`src/player/clock.ts`). The rest of the app redraws only when something actually changes. Before this, a playing song redrew every page 4 times a second, about 3.5% CPU; now it's about 0.1%.
- **Dependencies are injected.** Storage, `fetch`, the clock and navigation are passed in, so login and API code are tested without a real browser login or network.

**Spotify rules this follows:** song titles link back to Spotify, artwork and metadata are shown during playback, and the player is labelled "via Spotify". Spotify's [Developer Policy](https://developer.spotify.com/policy) doesn't allow apps that replace Spotify's core experience (III.11) or commercial use of the Web Playback SDK without approval. This is a **personal, non-commercial learning project** running in Spotify's Development Mode (up to 5 users, each added in the dashboard).
