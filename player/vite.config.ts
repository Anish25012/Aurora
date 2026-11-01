/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Spotify only accepts loopback redirect URIs written as 127.0.0.1 (not
    // "localhost"), so the dev server must be reached at exactly this origin.
    // Binding to 127.0.0.1 also keeps the app private to this machine.
    host: '127.0.0.1',
    port: 5173,
    // Fail instead of silently moving to another port, which would no longer
    // match the redirect URI registered in the Spotify dashboard.
    strictPort: true,
  },
  // The desktop launcher serves the built app with `vite preview`. It must use
  // the same origin as development, because that's what's registered with
  // Spotify (redirect URI) and Google (JavaScript origin).
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
