import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PLAYER_NAME } from '../config'
import type { RemotePlayback, RepeatMode, SpotifyApi, Track } from '../spotify/api'
import { SpotifyApiError } from '../spotify/api'
import type { SpotifyAuth } from '../spotify/auth'
import { loadSpotifySdk } from '../spotify/sdk'
import { type PlaybackClock, positionAt, stoppedAt } from './clock'
import { type LastPlayed, loadLastList, loadLastPlayed, saveLastList, saveLastPlayed } from './lastPlayed'
import { loadVolume, saveVolume, toGain } from './volume'

export type PlayerStatus = 'connecting' | 'ready' | 'error'

export interface NowPlaying {
  uri: string
  name: string
  artists: string
  album: string
  imageUrl: string | null
  spotifyUrl: string | null
  paused: boolean
  durationMs: number
  /** The album, artist or playlist this track is playing from, if any. */
  contextUri: string | null
  /** For in-app links: each artist, and the album (ids come from the SDK's Spotify URIs). */
  artistRefs: { id: string; name: string }[]
  albumRef: { id: string; name: string; images: { url: string; width: number | null }[] } | null
}

export interface PlayerControls {
  status: PlayerStatus
  /** Fatal problem: the player can't work (e.g. no Premium, unsupported browser). */
  error: string | null
  /** Short-lived message for a toast (e.g. "couldn't play that track"). */
  notice: string | null
  clearNotice: () => void
  /** Show a short message (toast). */
  notify: (message: string) => void
  loginRequired: boolean
  track: NowPlaying | null
  /**
   * What the UI should treat as playing. Includes what the user *just*
   * clicked, before Spotify confirms (see `optimistic` below), so buttons can
   * flip to pause instantly.
   */
  currentUri: string | null
  currentContextUri: string | null
  isPlaying: boolean
  /** Started, but the sound hasn't arrived yet (shows a spinner). */
  buffering: boolean
  /** Where the song is; read it with usePosition (see clock.ts). */
  clock: PlaybackClock
  /** Slider position, 0-1 (not raw gain; see volume.ts). */
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  /** This tab's Spotify Connect device id. */
  deviceId: string | null
  /** The music is playing on another device (phone, speaker...), which Aurora is remote-controlling. */
  remoteDevice: { id: string | null; name: string; type: string } | null
  playTracks: (tracks: Track[], startIndex?: number, positionMs?: number) => Promise<void>
  /** Play an album, artist or playlist. */
  playContext: (uri: string, startUri?: string, positionMs?: number) => Promise<void>
  addToQueue: (track: Track) => Promise<void>
  togglePlay: () => void
  next: () => void
  previous: () => void
  seek: (ms: number) => void
  setVolume: (volume: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  /** Move playback to a device (this one included). */
  transferTo: (deviceId: string) => Promise<void>
}

const REPEAT_FROM_SDK: RepeatMode[] = ['off', 'context', 'track']
const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'context', context: 'track', track: 'off' }
// How often to check on music playing elsewhere. Spotify's quota is shared
// across the account, so this stays gentle.
const REMOTE_POLL_MS = 5000
// Spotify plays at most this many songs from a list you pass it.
const MAX_LIST = 100

function toNowPlaying(state: Spotify.PlaybackState): NowPlaying | null {
  const t = state.track_window?.current_track
  if (!t) return null
  const episode = t.type === 'episode'
  // Pick the largest artwork; the bar is small but full-screen views reuse this.
  const image = [...(t.album?.images ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
  return {
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(', '),
    album: t.album?.name ?? '',
    imageUrl: image?.url ?? null,
    spotifyUrl: t.id ? `https://open.spotify.com/${episode ? 'episode' : 'track'}/${t.id}` : null,
    paused: state.paused,
    durationMs: state.duration,
    contextUri: state.context?.uri ?? null,
    // A podcast episode's "artist" and "album" are its show: no artist or album page to open.
    artistRefs: episode ? [] : t.artists.map((a) => ({ id: idFromUri(a.uri), name: a.name })).filter((a) => a.id),
    albumRef:
      !episode && t.album?.uri
        ? {
            id: idFromUri(t.album.uri),
            name: t.album.name,
            images: (t.album.images ?? []).map((i) => ({ url: i.url, width: i.width ?? null })),
          }
        : null,
  }
}

/** The same shape, built from the Web API (used when the music is on another device). */
function fromWebTrack(item: Track, playing: boolean, contextUri: string | null): NowPlaying {
  const image = [...item.album.images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
  return {
    uri: item.uri,
    name: item.name,
    artists: item.artists.map((a) => a.name).join(', '),
    album: item.album.name,
    imageUrl: image?.url ?? null,
    spotifyUrl: item.external_urls?.spotify ?? null,
    paused: !playing,
    durationMs: item.duration_ms,
    contextUri,
    artistRefs: item.artists,
    albumRef: item.album,
  }
}

/** 'spotify:artist:abc' -> 'abc' */
function idFromUri(uri: string | undefined): string {
  return uri?.split(':')[2] ?? ''
}

/** What the user just asked to play, shown as playing until Spotify confirms it. */
interface Optimistic {
  uri?: string
  contextUri?: string
}

// If Spotify never confirms (e.g. a silent failure), stop pretending after this long.
const OPTIMISTIC_TIMEOUT_MS = 6000

function confirms(pending: Optimistic, uri: string | undefined, contextUri: string | null | undefined): boolean {
  return (
    (pending.uri !== undefined && pending.uri === uri) ||
    (pending.contextUri !== undefined && pending.contextUri === contextUri)
  )
}

const SDK_ERRORS: Record<string, string> = {
  account_error: 'Aurora needs Spotify Premium to play full songs.',
  initialization_error:
    "This browser can't play protected audio. Try Chrome, Edge or Firefox, without private browsing.",
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof SpotifyApiError ? err.message : fallback
}

/**
 * Turns this browser tab into a Spotify Connect device called "Aurora" and
 * exposes its state and controls to React.
 *
 * When the music is moved to another device (phone, speaker), Aurora becomes
 * a remote control for it: it polls what's playing there, and the same
 * controls send Web API commands instead of local SDK calls.
 */
export function usePlayer(auth: SpotifyAuth, api: SpotifyApi): PlayerControls {
  const playerRef = useRef<Spotify.Player | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [status, setStatus] = useState<PlayerStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loginRequired, setLoginRequired] = useState(false)
  const [local, setLocal] = useState<NowPlaying | null>(null)
  const [remote, setRemote] = useState<RemotePlayback | null>(null)
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null)
  // Spotify has started the song but no sound yet (fetching; podcasts, especially
  // resumed mid-episode, can take a few seconds).
  const [buffering, setBuffering] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  // Start where the user left it last time, or in the middle on first use.
  const [volume, setVolumeState] = useState(loadVolume)
  // The SDK callbacks below are created once, so they read the latest volume from a ref.
  const volumeRef = useRef(volume)
  // The SDK reports position only when state changes. Between events the
  // progress bar works out the live position itself (see clock.ts).
  const [anchor, setAnchor] = useState<PlaybackClock>(() => ({ positionMs: 0, at: Date.now(), paused: true }))
  // The song you heard last (see lastPlayed.ts), shown when nothing is playing anywhere.
  const [lastPlayed, setLastPlayed] = useState<LastPlayed | null>(loadLastPlayed)

  useEffect(() => {
    let cancelled = false
    let player: Spotify.Player | null = null
    const disconnect = () => player?.disconnect()

    loadSpotifySdk()
      .then((SpotifySdk) => {
        if (cancelled) return
        player = new SpotifySdk.Player({
          name: PLAYER_NAME,
          // Called on connect and whenever the SDK needs a fresh token (hourly).
          getOAuthToken: (cb) => {
            auth.getAccessToken().then(cb, () => setLoginRequired(true))
          },
          volume: toGain(volumeRef.current),
          // Shows the song in the OS media controls and enables keyboard media keys.
          enableMediaSession: true,
        })
        player.addListener('ready', ({ device_id }) => {
          setDeviceId(device_id)
          setStatus('ready')
          // Spotify Connect can restore a device's previous (often loud) volume
          // when it connects, so re-apply ours once the device is live.
          void player?.setVolume(toGain(volumeRef.current))
        })
        player.addListener('not_ready', () => setNotice('Lost connection to Spotify. Reconnecting...'))
        player.addListener('player_state_changed', (state) => {
          if (!state) {
            setLocal(null) // playback moved to another device
            return
          }
          setLocal(toNowPlaying(state))
          setRemote(null) // it's playing here now
          setShuffle(state.shuffle)
          setRepeat(REPEAT_FROM_SDK[state.repeat_mode] ?? 'off')
          setBuffering(state.loading && !state.paused)
          // Hold the clock still while it's loading, so the time doesn't run on in silence.
          setAnchor({ positionMs: state.position, at: Date.now(), paused: state.paused || Boolean(state.loading) })
          // Spotify has caught up with the click: drop the stand-in. (Updates for the
          // *previous* song can still arrive first, so only clear on a real match.)
          const uri = state.track_window?.current_track?.uri
          setOptimistic((pending) => (pending && confirms(pending, uri, state.context?.uri) ? null : pending))
        })
        player.addListener('autoplay_failed', () => setNotice('Your browser blocked autoplay. Press play to start.'))
        player.addListener('authentication_error', () => setLoginRequired(true))
        player.addListener('playback_error', () => setNotice("Couldn't play that track."))
        for (const name of ['account_error', 'initialization_error'] as const) {
          player.addListener(name, ({ message }) => {
            setStatus('error')
            setError(SDK_ERRORS[name] ?? message)
          })
        }
        player.connect()
        playerRef.current = player
        // Tell Spotify this device is gone when the window closes, so it doesn't
        // linger as a dead "Aurora" in the device list.
        window.addEventListener('pagehide', disconnect)
      })
      .catch((err: Error) => {
        setStatus('error')
        setError(err.message)
      })

    return () => {
      cancelled = true
      window.removeEventListener('pagehide', disconnect)
      player?.disconnect()
      playerRef.current = null
    }
  }, [auth])

  // ---------------------------------------------------------------- remote

  const pollRemote = useCallback(() => {
    return api.playbackState().then(
      (state) => {
        // Another "Aurora" is a dead copy of this player (closed without saying
        // goodbye). Spotify lists it for a while, but it can't make a sound, so
        // don't send the music there.
        const elsewhere =
          state?.device && state.device.id !== deviceId && state.device.name !== PLAYER_NAME && state.item
            ? state
            : null
        setRemote(elsewhere)
        if (elsewhere) {
          setShuffle(elsewhere.shuffle_state)
          setRepeat(elsewhere.repeat_state)
          setAnchor({ positionMs: elsewhere.progress_ms ?? 0, at: Date.now(), paused: !elsewhere.is_playing })
          setOptimistic((pending) =>
            pending && confirms(pending, elsewhere.item?.uri, elsewhere.context?.uri) ? null : pending,
          )
        }
      },
      () => {}, // a missed poll is fine; the next one will catch up
    )
  }, [api, deviceId])

  // While nothing plays here, keep an eye on music playing on other devices.
  const playingHere = local !== null
  useEffect(() => {
    if (status !== 'ready' || playingHere) return
    void pollRemote()
    const id = window.setInterval(() => void pollRemote(), REMOTE_POLL_MS)
    return () => window.clearInterval(id)
  }, [status, playingHere, pollRemote])

  const remoteActive = !playingHere && remote !== null
  const liveTrack = useMemo(
    () => local ?? (remote?.item ? fromWebTrack(remote.item, remote.is_playing, remote.context?.uri ?? null) : null),
    [local, remote],
  )

  // ---------------------------------------------------------------- nothing playing

  // Keep the last song and where it got to, updated as playback events arrive
  // (a pause reports the exact spot). Set during render: it's derived from them.
  if (liveTrack && (lastPlayed?.track !== liveTrack || lastPlayed.positionMs !== anchor.positionMs))
    setLastPlayed({ track: liveTrack, positionMs: anchor.positionMs })
  useEffect(() => {
    if (lastPlayed) saveLastPlayed(lastPlayed)
  }, [lastPlayed])

  // Nothing playing on any device: show the last song, paused, ready to carry on.
  const idle = status === 'ready' && liveTrack === null
  // First time in Aurora: fall back to the last song you played on Spotify.
  useEffect(() => {
    if (!idle || lastPlayed) return
    let cancelled = false
    api.recentlyPlayed(1).then(
      ([recent]) => !cancelled && recent && setLastPlayed({ track: fromWebTrack(recent, false, null), positionMs: 0 }),
      () => {}, // then there's simply nothing to show
    )
    return () => {
      cancelled = true
    }
  }, [idle, lastPlayed, api])
  const track = liveTrack ?? (idle && lastPlayed ? { ...lastPlayed.track, paused: true } : null)
  const clock = useMemo(
    () => (liveTrack || !lastPlayed ? anchor : stoppedAt(lastPlayed.positionMs)),
    [liveTrack, lastPlayed, anchor],
  )

  useEffect(() => {
    if (!optimistic) return
    const id = window.setTimeout(() => setOptimistic(null), OPTIMISTIC_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [optimistic])

  // ---------------------------------------------------------------- actions

  // Shared by every "play something" action. Plays on the device the music is
  // already on: here, or the phone/speaker Aurora is controlling.
  const start = useCallback(
    async (begin: (deviceId: string) => Promise<void>, pending: Optimistic) => {
      // activateElement must run inside the click handler, before any await.
      // Browsers only allow audio to start in response to a user gesture.
      void playerRef.current?.activateElement()
      const target = remoteActive && remote?.device.id ? remote.device.id : deviceId
      if (!target) {
        setNotice('The player is still starting up. Try again in a second.')
        return
      }
      // Show it as playing right away; the network round trip takes a moment.
      setOptimistic(pending)
      try {
        await begin(target)
        // Starting playback through Spotify can reset the device volume too.
        if (target === deviceId) void playerRef.current?.setVolume(toGain(volumeRef.current))
        else window.setTimeout(() => void pollRemote(), 700)
      } catch (err) {
        setOptimistic(null) // it didn't start, so don't keep showing it as playing
        setNotice(errorMessage(err, "Couldn't start playback."))
      }
    },
    [deviceId, remote, remoteActive, pollRemote],
  )

  const playTracks = useCallback(
    async (tracks: Track[], startIndex = 0, positionMs?: number) => {
      if (tracks.length === 0) return
      // Remembered, so Next works straight away after reopening Aurora.
      saveLastList({ items: tracks, contextUri: null })
      // Spotify takes a list of up to 100 songs: keep the clicked one inside it.
      const from = Math.max(0, Math.min(startIndex, tracks.length - 1) - (MAX_LIST - 1))
      const uris = tracks.slice(from, from + MAX_LIST).map((t) => t.uri)
      const at = startIndex - from
      await start((id) => api.playTracks(id, uris, at, positionMs), { uri: uris[at] })
    },
    [api, start],
  )

  const playContext = useCallback(
    (uri: string, startUri?: string, positionMs?: number) =>
      start((id) => api.playContext(id, uri, startUri, positionMs), { contextUri: uri, uri: startUri }),
    [api, start],
  )

  const addToQueue = useCallback(
    async (item: Track) => {
      try {
        await api.addToQueue(item.uri, remoteActive ? undefined : (deviceId ?? undefined))
        setNotice(`Added “${item.name}” to the queue`)
      } catch (err) {
        setNotice(
          err instanceof SpotifyApiError && err.status === 404
            ? 'Play something first, then add songs to the queue.'
            : errorMessage(err, "Couldn't add that to the queue."),
        )
      }
    },
    [api, deviceId, remoteActive],
  )

  // Carry on with the last song, in what it was playing from: its album or
  // playlist, else the list it was in (remembered), else on its own. Shuffle
  // and repeat picked meanwhile apply too.
  const resume = useCallback(
    (fromStart = false) => {
      if (!lastPlayed) return Promise.resolve()
      const { uri, contextUri } = lastPlayed.track
      const at = fromStart ? 0 : Math.round(lastPlayed.positionMs)
      const list = loadLastList()
      const index = list ? list.items.findIndex((t) => t.uri === uri) : -1
      return start(
        async (id) => {
          if (contextUri) {
            try {
              await api.playContext(id, contextUri, uri, at)
            } catch {
              await api.playTracks(id, [uri], 0, at) // e.g. the playlist is gone: just the song
            }
          } else if (list && index >= 0) {
            const from = Math.max(0, index - (MAX_LIST - 1))
            await api.playTracks(
              id,
              list.items.slice(from, from + MAX_LIST).map((t) => t.uri),
              index - from,
              at,
            )
          } else await api.playTracks(id, [uri], 0, at)
          void api.setShuffle(shuffle, id).catch(() => {})
          void api.setRepeat(repeat, id).catch(() => {})
        },
        { uri, contextUri: contextUri ?? undefined },
      )
    },
    [api, lastPlayed, start, shuffle, repeat],
  )

  const togglePlay = useCallback(() => {
    if (idle) {
      void resume()
      return
    }
    if (remoteActive) {
      const playing = remote?.is_playing ?? false
      setRemote((r) => (r ? { ...r, is_playing: !playing } : r)) // flip the icon now
      setAnchor((a) => ({ positionMs: positionAt(a), at: Date.now(), paused: playing }))
      void (playing ? api.remotePause() : api.remoteResume()).catch((err) =>
        setNotice(errorMessage(err, "Couldn't reach that device.")),
      )
      return
    }
    void playerRef.current?.activateElement()
    // Flip the icon now; the SDK's state event confirms a moment later.
    setLocal((t) => (t ? { ...t, paused: !t.paused } : t))
    void playerRef.current?.togglePlay()
  }, [api, remote, remoteActive, idle, resume])

  const skip = useCallback(
    (direction: 'next' | 'previous') => {
      if (idle) {
        // Previous: the last song from its start. Next: start it, then move on
        // (once Spotify has made this the active device).
        if (direction === 'previous') void resume(true)
        else void resume().then(() => window.setTimeout(() => void playerRef.current?.nextTrack(), 1000))
        return
      }
      if (remoteActive) {
        void (direction === 'next' ? api.remoteNext() : api.remotePrevious())
          .then(() => window.setTimeout(() => void pollRemote(), 600))
          .catch((err) => setNotice(errorMessage(err, "Couldn't reach that device.")))
        return
      }
      void (direction === 'next' ? playerRef.current?.nextTrack() : playerRef.current?.previousTrack())
    },
    [api, remoteActive, pollRemote, idle, resume],
  )

  const seek = useCallback(
    (ms: number) => {
      if (idle) {
        setLastPlayed((last) => (last ? { ...last, positionMs: ms } : last)) // Play starts from there
        return
      }
      setAnchor((a) => ({ ...a, positionMs: ms, at: Date.now() })) // move the bar immediately
      if (remoteActive) void api.remoteSeek(Math.round(ms)).catch(() => {})
      else void playerRef.current?.seek(Math.round(ms))
    },
    [api, remoteActive, idle],
  )

  const setVolume = useCallback((position: number) => {
    volumeRef.current = position
    setVolumeState(position)
    saveVolume(position)
    void playerRef.current?.setVolume(toGain(position))
  }, [])

  const target = remoteActive ? undefined : (deviceId ?? undefined)

  const toggleShuffle = useCallback(() => {
    const next = !shuffle
    setShuffle(next) // show it immediately
    if (idle) return // applied when the music starts (resume)
    api.setShuffle(next, target).catch((err) => {
      setShuffle(!next)
      setNotice(errorMessage(err, "Couldn't change shuffle."))
    })
  }, [api, shuffle, target, idle])

  const cycleRepeat = useCallback(() => {
    const previous = repeat
    const next = NEXT_REPEAT[repeat]
    setRepeat(next)
    if (idle) return // applied when the music starts (resume)
    api.setRepeat(next, target).catch((err) => {
      setRepeat(previous)
      setNotice(errorMessage(err, "Couldn't change repeat."))
    })
  }, [api, repeat, target, idle])

  const transferTo = useCallback(
    async (id: string) => {
      if (id === deviceId) void playerRef.current?.activateElement() // audio starts here: needs the click
      try {
        await api.transferPlayback(id, true)
        if (id !== deviceId) window.setTimeout(() => void pollRemote(), 800)
      } catch (err) {
        setNotice(errorMessage(err, "Couldn't switch to that device."))
      }
    },
    [api, deviceId, pollRemote],
  )

  return {
    status,
    error,
    notice,
    clearNotice: useCallback(() => setNotice(null), []),
    notify: setNotice,
    loginRequired,
    track,
    currentUri: optimistic ? (optimistic.uri ?? null) : (track?.uri ?? null),
    currentContextUri: optimistic ? (optimistic.contextUri ?? null) : (track?.contextUri ?? null),
    isPlaying: optimistic !== null || (liveTrack !== null && !liveTrack.paused),
    buffering: optimistic !== null || (buffering && local !== null),
    clock,
    volume,
    shuffle,
    repeat,
    deviceId,
    remoteDevice: remoteActive && remote ? remote.device : null,
    playTracks,
    playContext,
    addToQueue,
    togglePlay,
    next: useCallback(() => skip('next'), [skip]),
    previous: useCallback(() => skip('previous'), [skip]),
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    transferTo,
  }
}
