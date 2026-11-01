// Full-page states shown instead of the main app: setup, login, errors.
import { BrandMark } from './BrandMark'

export function SetupScreen() {
  return (
    <main className="center-screen">
      <div className="center-card">
        <BrandMark size={64} />
        <h1>Almost there</h1>
        <p>
          Add your Spotify app's Client ID to <code>player/.env.local</code> as <code>VITE_SPOTIFY_CLIENT_ID=...</code>,
          then restart Aurora.
        </p>
      </div>
    </main>
  )
}

export function LoginScreen({ onLogin, error }: { onLogin: () => void; error: string | null }) {
  return (
    <main className="center-screen">
      <div className="center-card">
        <BrandMark size={64} />
        <h1>Aurora</h1>
        <p>Every song, beautifully played. Connect your Spotify Premium account to start listening.</p>
        <button className="pill-button" onClick={onLogin}>
          Connect Spotify
        </button>
        {error && <p className="banner error">{error}</p>}
      </div>
    </main>
  )
}

export function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}
