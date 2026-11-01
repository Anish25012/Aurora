// Aurora's local server for the desktop app: serves the built app (dist/) on
// http://127.0.0.1:5173, the address registered with Spotify as the login
// redirect. Listens on 127.0.0.1 only, so it's private to this PC. No
// dependencies, and lighter than running Vite just to serve files.
//
//   node server/aurora-server.mjs

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const port = Number(process.env.AURORA_PORT ?? 5173)
const dist = resolve(import.meta.dirname, '..', 'dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
}

// The engine (the hidden player page) checks in here every few seconds. The
// launcher reads how long ago that was, so it can restart a player page that
// froze or crashed while its window stayed open. Before the first check-in,
// the age counts from when the server started.
let engineSeenAt = Date.now()

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    if (url.pathname === '/engine-alive') {
      if (req.method === 'POST') engineSeenAt = Date.now()
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ageMs: Date.now() - engineSeenAt }))
      return
    }
    let path = normalize(join(dist, decodeURIComponent(url.pathname)))
    if (!path.startsWith(dist)) {
      res.writeHead(403).end()
      return
    }
    // The app's own routes (/callback, /engine...) are all index.html.
    if (!existsSync(path) || !extname(path)) path = join(dist, 'index.html')
    const body = await readFile(path)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      // Built files have content hashes in their names, so they never change.
      'Cache-Control': path.startsWith(join(dist, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
  } catch (err) {
    console.error(err)
    if (!res.headersSent) res.writeHead(500).end()
  }
}).listen(port, '127.0.0.1', () => console.log(`Aurora on http://127.0.0.1:${port}`))
