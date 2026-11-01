import { Laptop, MonitorSpeaker, Smartphone, Speaker, Tv } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Device, SpotifyApi } from '../spotify/api'

interface Props {
  api: Pick<SpotifyApi, 'devices'>
  /** This tab's own device id ("This computer"). */
  ownDeviceId: string | null
  onPick: (deviceId: string) => void
  onClose: () => void
}

function DeviceIcon({ type }: { type: string }) {
  const t = type.toLowerCase()
  if (t === 'smartphone' || t === 'tablet') return <Smartphone size={18} />
  if (t === 'speaker' || t === 'avr' || t === 'stb') return <Speaker size={18} />
  if (t === 'tv' || t === 'castvideo') return <Tv size={18} />
  if (t === 'computer') return <Laptop size={18} />
  return <MonitorSpeaker size={18} />
}

/** "Play on...": every device on your Spotify account. Picking one moves the music there. */
export function DevicePicker({ api, ownDeviceId, onPick, onClose }: Props) {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.devices().then(setDevices, (err: Error) => setError(err.message))
  }, [api])

  // Close on Escape or a click anywhere outside the popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element
      if (ref.current && !ref.current.contains(target) && !target.closest('.np-devices')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  // This computer first, then the rest.
  const sorted = [...(devices ?? [])].sort((a, b) => Number(b.id === ownDeviceId) - Number(a.id === ownDeviceId))

  return (
    <div className="device-popover" ref={ref} role="dialog" aria-label="Play on">
      <h3>Play on</h3>
      {devices === null && !error && <div className="skeleton device-skeleton" />}
      {error && <p className="shelf-error">{error}</p>}
      {devices && devices.length === 0 && (
        <p className="hint">No devices found. Open Spotify on your phone or a speaker, and it will appear here.</p>
      )}
      <ul>
        {sorted.map((d) => (
          <li key={d.id ?? d.name}>
            <button
              className={`device-item${d.is_active ? ' is-active' : ''}`}
              disabled={!d.id || d.is_restricted}
              onClick={() => {
                if (d.id) onPick(d.id)
                onClose()
              }}
            >
              <DeviceIcon type={d.type} />
              <span className="device-text">
                <span className="device-name">{d.id === ownDeviceId ? 'This computer (Aurora)' : d.name}</span>
                <span className="device-sub">{d.is_active ? 'Playing here' : d.type}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
