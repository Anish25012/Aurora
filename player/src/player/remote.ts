// The desktop app runs the music in a hidden "engine" window, so closing the
// window you see doesn't stop it. That window becomes a remote control: the
// engine sends it the player's state, and it sends back what you pressed.
// Both are pages of the same app in the same browser, so they talk over a
// BroadcastChannel (no server involved).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerControls } from './usePlayer'

const CHANNEL = 'aurora-player'
// The engine repeats its state this often even when nothing changes, so the
// window can tell when the engine has gone away.
const HEARTBEAT_MS = 2000
const GONE_AFTER_MS = 6000

const ACTIONS = [
  'clearNotice',
  'notify',
  'playTracks',
  'playContext',
  'addToQueue',
  'togglePlay',
  'next',
  'previous',
  'seek',
  'setVolume',
  'toggleShuffle',
  'cycleRepeat',
  'transferTo',
] as const

type Action = (typeof ACTIONS)[number]
export type PlayerState = Omit<PlayerControls, Action>

type Message =
  | { type: 'hello' } // a window opened and wants the current state
  | { type: 'state'; state: PlayerState }
  | { type: 'call'; name: Action; args: unknown[] }
  | { type: 'logout' } // signed out in the window: the engine stops too

function stateOf(player: PlayerControls): PlayerState {
  const state: Record<string, unknown> = { ...player }
  for (const name of ACTIONS) delete state[name]
  return state as PlayerState
}

/**
 * A channel opened by an effect (so React's development double-run can't
 * leave us holding a closed one), and a `post` that's safe at any time.
 */
function useChannel(
  onMessage: (msg: Message, post: (msg: Message) => void) => void,
  onOpen?: (post: (msg: Message) => void) => () => void,
) {
  const ref = useRef<BroadcastChannel | null>(null)
  const handler = useRef(onMessage)
  const opened = useRef(onOpen)
  useEffect(() => {
    handler.current = onMessage
    opened.current = onOpen
  })
  const post = useMemo(() => (msg: Message) => ref.current?.postMessage(msg), [])
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL)
    ref.current = channel
    const listen = (e: MessageEvent<Message>) => handler.current(e.data, post)
    channel.addEventListener('message', listen)
    const stop = opened.current?.(post)
    return () => {
      stop?.()
      channel.removeEventListener('message', listen)
      channel.close()
      ref.current = null
    }
  }, [post])
  return post
}

/** In the engine: share the player's state, and do what the windows ask. */
export function useEngineBroadcast(player: PlayerControls, onLogout: () => void): void {
  const latest = useRef(player)
  useEffect(() => {
    latest.current = player
  })
  const sendState = (post: (msg: Message) => void) => post({ type: 'state', state: stateOf(latest.current) })

  const post = useChannel(
    (msg, reply) => {
      if (msg.type === 'hello') sendState(reply)
      else if (msg.type === 'logout') onLogout()
      else if (msg.type === 'call' && ACTIONS.includes(msg.name)) {
        const fn = latest.current[msg.name] as (...args: unknown[]) => unknown
        void Promise.resolve(fn(...msg.args)).catch(() => {}) // the player reports errors as notices
      }
    },
    (open) => {
      sendState(open)
      const heartbeat = window.setInterval(() => sendState(open), HEARTBEAT_MS)
      return () => window.clearInterval(heartbeat)
    },
  )

  // Every change (including the progress clock, a few times a second).
  useEffect(() => {
    post({ type: 'state', state: stateOf(player) })
  })
}

const WAITING: PlayerState = {
  status: 'connecting',
  error: null,
  notice: null,
  loginRequired: false,
  track: null,
  currentUri: null,
  currentContextUri: null,
  isPlaying: false,
  buffering: false,
  clock: { positionMs: 0, at: 0, paused: true },
  volume: 0.5,
  shuffle: false,
  repeat: 'off',
  deviceId: null,
  remoteDevice: null,
}

/** In the window you see: the engine's player, controlled from here. */
export function useRemotePlayer(): PlayerControls & { signOutEverywhere: () => void } {
  const [state, setState] = useState<PlayerState>(WAITING)
  const lastSeen = useRef(0)

  const post = useChannel(
    (msg) => {
      if (msg.type !== 'state') return
      lastSeen.current = Date.now()
      setState(msg.state)
    },
    (open) => {
      open({ type: 'hello' })
      // Keep asking until the engine answers (it may still be starting), and
      // show "connecting" if it stops answering.
      const check = window.setInterval(() => {
        if (Date.now() - lastSeen.current <= GONE_AFTER_MS) return
        setState((s) => (s.status === 'connecting' ? s : { ...WAITING, volume: s.volume }))
        open({ type: 'hello' })
      }, HEARTBEAT_MS)
      return () => window.clearInterval(check)
    },
  )

  const actions = useMemo(() => {
    const call =
      (name: Action) =>
      (...args: unknown[]) => {
        // Buttons call these straight from onClick, which passes the click
        // event. It can't cross a BroadcastChannel (postMessage throws), and
        // no action takes one, so leave it behind.
        post({ type: 'call', name, args: args.filter((a) => !(a instanceof Event) && !isReactEvent(a)) })
        return Promise.resolve()
      }
    return Object.fromEntries(ACTIONS.map((name) => [name, call(name)])) as unknown as Pick<PlayerControls, Action>
  }, [post])

  return useMemo(
    () => ({ ...state, ...actions, signOutEverywhere: () => post({ type: 'logout' }) }),
    [state, actions, post],
  )
}

/** React wraps DOM events in its own objects, which carry the original as `nativeEvent`. */
function isReactEvent(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'nativeEvent' in value
}

/**
 * Whether this window is the desktop app's (opened by the launcher with
 * ?desktop). Remembered for the tab, because signing in to Spotify comes back
 * to a different address.
 */
export function isDesktopWindow(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('desktop')) sessionStorage.setItem('aurora.desktop', '1')
    return sessionStorage.getItem('aurora.desktop') === '1'
  } catch {
    return new URLSearchParams(window.location.search).has('desktop')
  }
}
