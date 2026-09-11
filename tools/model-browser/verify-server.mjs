#!/usr/bin/env node
// Tiny static server (zero deps) that serves the megumi(-dress) model dirs and the l2d runtime,
// so a live browser page can load the recoloured model for visual verification.
import { createServer } from 'node:http'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../..')
const l2dModule = resolve(join(repoRoot, 'node_modules/l2d/dist/index.js'))
const port = Number(process.env.PORT ?? process.argv[2] ?? 8650)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.moc3': 'application/octet-stream',
  '.moc': 'application/octet-stream',
  '.mtn': 'application/octet-stream',
  '.exp.json': 'application/json; charset=utf-8',
  '.physics.json': 'application/json; charset=utf-8',
  '.pose.json': 'application/json; charset=utf-8',
}

function send(res, status, body, type) {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-cache',
  })
  res.end(body)
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain')
  const url = new URL(req.url ?? '', 'http://local')
  const pathname = decodeURIComponent(url.pathname)

  if (pathname === '/l2d.js') {
    send(res, 200, readFileSync(l2dModule), 'text/javascript; charset=utf-8')
    return
  }

  if (pathname === '/viewer.html') {
    send(res, 200, readFileSync(join(here, 'viewer.html')), 'text/html; charset=utf-8')
    return
  }

  if (pathname === '/viewer.js') {
    send(res, 200, readFileSync(join(here, 'viewer.js')), 'text/javascript; charset=utf-8')
    return
  }

  // serve /models/... from assets/models (safe traversal-guarded)
  if (pathname.startsWith('/models/')) {
    const root = resolve(join(repoRoot, 'assets/models'))
    const target = resolve(join(root, pathname.slice('/models/'.length)))
    if (target !== root && !target.startsWith(root + sep)) return send(res, 403, 'forbidden', 'text/plain')
    if (!existsSync(target)) return send(res, 404, 'not found', 'text/plain')
    try {
      const st = statSync(target)
      if (st.isDirectory()) return send(res, 200, JSON.stringify({ dir: true }), 'application/json')
      const body = readFileSync(target)
      send(res, 200, body, MIME[extname(target)] ?? 'application/octet-stream')
    } catch { send(res, 404, 'not found', 'text/plain') }
    return
  }

  send(res, 404, 'not found', 'text/plain')
})

server.listen(port, () => {
  console.log(`megumi verify server on http://127.0.0.1:${port}/viewer.html`)
})
