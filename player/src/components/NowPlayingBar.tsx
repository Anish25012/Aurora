import { ListMusic, Maximize2, MicVocal, MonitorSpeaker, Volume1, Volume2, VolumeX } from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react'
import { useLibrary } from '../library'
import { DEFAULT_VOLUME } from '../player/volume'
import type { PlayerControls } from '../player/usePlayer'
import { LikeButton } from './LikeButton'
import { AlbumLink, ArtistLinks } from './Links'
import { Transport } from './Transport'

type Props = Pick<
  PlayerControls,
  'status' | 'track' | 'clock' | 'volume' | 'togglePlay' | 'next' | 'previous' | 'seek' | 'setVolume'
> &
  Partial<
    Pick<PlayerControls, 'shuffle' | 'repeat' | 'toggleShuffle' | 'cycleRepeat' | 'remoteDevice' | 'buffering'>
  > & {
    /** Opens the queue: the song playing now and what's coming up. */
    onOpenQueue?: () => void
    queueOpen?: boolean
    /** Opens the device picker (play on your phone, a speaker...). */
    onOpenDevices?: () => void
    devicesOpen?: boolean
    /** Rendered above the bar's right-hand side (the device picker popover). */
    devicesPopover?: ReactNode
    /** Opens the full-screen player, with or without lyrics. */
    onOpenFullScreen?: (lyrics: boolean) => void
  }

export function NowPlayingBar({
  status,
  track,
  clock,
  volume,
  togglePlay,
  next,
  previous,
  seek,
  setVolume,
  shuffle = false,
  repeat = 'off',
  toggleShuffle,
  cycleRepeat,
  remoteDevice,
  buffering = false,
  onOpenQueue,
  queueOpen = false,
  onOpenDevices,
  devicesOpen = false,
  devicesPopover,
  onOpenFullScreen,
}: Props) {
  // Unmuting returns to the level you had, not a fixed (possibly loud) default.
  // Updated in the event handlers below, never during render.
  const lastAudible = useRef(volume > 0 ? volume : DEFAULT_VOLUME)
  const toggleMute = () => {
    if (volume > 0) {
      lastAudible.current = volume
      setVolume(0)
    } else {
      setVolume(lastAudible.current)
    }
  }
  const library = useLibrary()
  const playingUri = track?.uri
  useEffect(() => {
    if (playingUri) library?.watch([playingUri])
  }, [library, playingUri])
  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const disabled = status !== 'ready' || !track

  return (
    <footer className={`player-bar${remoteDevice ? ' is-remote' : ''}`} aria-label="Player">
      {/* The song corner: hover lights it up, clicking it opens the queue. The
          song and artist names are links of their own (album / artist page). */}
      <div
        className={`np-track${onOpenQueue && track ? ' is-clickable' : ''}${queueOpen ? ' is-open' : ''}`}
        onClick={track ? onOpenQueue : undefined}
      >
        {track ? (
          <>
            {onOpenQueue ? (
              <button
                className="np-art-button"
                onClick={(e) => {
                  e.stopPropagation() // the corner around it would toggle the queue a second time
                  onOpenQueue()
                }}
                aria-label="Show queue"
              >
                {/* key on the song: new artwork mounts fresh and fades in instead of snapping. */}
                <img key={track.uri} className="artwork artwork-fade" src={track.imageUrl ?? undefined} alt="" />
              </button>
            ) : (
              <img key={track.uri} className="artwork artwork-fade" src={track.imageUrl ?? undefined} alt="" />
            )}
            <div className="track-text">
              <div className="track-title">
                {/* The song title opens its album inside Aurora. */}
                {track.albumRef ? (
                  <AlbumLink album={{ ...track.albumRef, name: track.name }} className="inline-link" />
                ) : (
                  track.name
                )}
              </div>
              <div className="track-sub">
                {track.artistRefs.length > 0 ? <ArtistLinks artists={track.artistRefs} /> : track.artists}
              </div>
            </div>
            <span className="np-like">
              <LikeButton uri={track.uri} name={track.name} size={17} />
            </span>
          </>
        ) : (
          <span className="np-empty">
            {status === 'connecting' ? 'Connecting to Spotify...' : status === 'ready' ? 'Not playing' : ''}
          </span>
        )}
      </div>

      <div className="np-center">
        <Transport
          track={track}
          clock={clock}
          togglePlay={togglePlay}
          next={next}
          previous={previous}
          seek={seek}
          shuffle={shuffle}
          repeat={repeat}
          toggleShuffle={toggleShuffle}
          cycleRepeat={cycleRepeat}
          buffering={buffering}
          disabled={disabled}
        />
      </div>

      <div className="np-right">
        {/* Spotify's policy: shown content links back to Spotify. This small link is the
            only way out; every other name opens a page inside Aurora. */}
        {track?.spotifyUrl ? (
          <a className="via-spotify" href={track.spotifyUrl} target="_blank" rel="noreferrer">
            via Spotify
          </a>
        ) : (
          <span className="via-spotify">via Spotify</span>
        )}
        {onOpenFullScreen && (
          <button
            className="icon-button"
            onClick={() => onOpenFullScreen(true)}
            disabled={!track}
            aria-label="Lyrics"
            title="Lyrics"
          >
            <MicVocal size={17} />
          </button>
        )}
        {onOpenQueue && (
          <button
            className={`icon-button toggle${queueOpen ? ' is-on' : ''}`}
            onClick={onOpenQueue}
            aria-label="Queue"
            aria-pressed={queueOpen}
            title="Queue"
          >
            <ListMusic size={17} />
          </button>
        )}
        {onOpenDevices && (
          <span className="np-devices">
            <button
              className={`icon-button toggle${devicesOpen || remoteDevice ? ' is-on' : ''}`}
              onClick={onOpenDevices}
              aria-label="Choose a device"
              aria-expanded={devicesOpen}
              title={remoteDevice ? `Playing on ${remoteDevice.name}` : 'Play on another device'}
            >
              <MonitorSpeaker size={17} />
            </button>
            {devicesPopover}
          </span>
        )}
        {onOpenFullScreen && (
          <button
            className="icon-button"
            onClick={() => onOpenFullScreen(false)}
            disabled={!track}
            aria-label="Full screen"
            title="Full screen"
          >
            <Maximize2 size={16} />
          </button>
        )}
        <button className="icon-button" onClick={toggleMute} aria-label="Mute">
          <VolumeIcon size={18} />
        </button>
        <input
          className="slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          style={{ '--pct': `${volume * 100}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (v > 0) lastAudible.current = v // dragging to 0 then unmuting returns here
            setVolume(v)
          }}
          aria-label="Volume"
        />
      </div>

      {/* Like Spotify: a slim strip when the music is coming out of another device. */}
      {remoteDevice && (
        <div className="remote-strip" role="status">
          <MonitorSpeaker size={13} /> Playing on {remoteDevice.name}
        </div>
      )}
    </footer>
  )
}
