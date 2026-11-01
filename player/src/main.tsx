import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Engine } from './Engine.tsx'
import { api, auth } from './spotify/session'

// The desktop app's hidden player window opens at /engine?engine; everything else is the app.
const isEngine = new URLSearchParams(window.location.search).has('engine')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isEngine ? <Engine auth={auth} api={api} /> : <App />}</StrictMode>,
)
