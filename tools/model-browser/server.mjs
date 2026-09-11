#!/usr/bin/env node
// Zero-dependency model browser server: static + 管理接口（删模型/删游戏目录）+
// Live2D 配置清洗（剔除缺失文件的引用，避免 load() 因缺动作/贴图而整体失败）。
//   node tools/model-browser/server.mjs [port]
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs'
import { join, resolve, sep, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../..')
const extractRoot = resolve(process.env.MODEL_BROWSER_ROOT ?? join(repoRoot, 'live2d-extracted/PC Live2D Files New/Live2D'))
const manifestFile = join(here, 'manifest.json')
const l2dModule = resolve(join(repoRoot, 'node_modules/l2d/dist/index.js'))
const port = Number(process.env.MODEL_BROWSER_PORT ?? process.argv[2] ?? 8590)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.moc3': 'application/octet-stream',
  '.moc': 'application/octet-stream',
  '.mtn': 'application/octet-stream',
  '.phys3.json': 'application/json; charset=utf-8',
  '.exp3.json': 'application/json; charset=utf-8',
  '.motion3.json': 'application/json; charset=utf-8',
}

function send(res, status, body, type) {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-cache',
  })
  res.end(body)
}

// ---------- 路径安全 ----------
function insideRoot(p) {
  p = resolve(p)
  return p === extractRoot || p.startsWith(extractRoot + sep)
}

// ---------- Live2D 配置清洗：剔除指向不存在文件的引用 ----------
// 模型 json 引用了缺失的动作/物理/表情/贴图时，l2d 的 load() 会 404 整个失败。
// 这里按模型文件所在目录解析每个相对引用，缺失的引用直接去掉，尽量让模型可加载。
function pruneMissing(text, absDir) {
  let raw
  try { raw = JSON.parse(text) } catch { return { text, pruned: 0 } }
  const okFs = (ref) => {
    if (!ref || typeof ref !== 'string') return false
    try { return statSync(resolve(absDir, ref)).isFile() } catch { return false }
  }
  let pruned = 0
  const drop = (arr) => {
    const keep = arr.filter((x) => okFs((x && (x.File ?? x.file)) || null))
    pruned += arr.length - keep.length
    return keep
  }
  const nullify = (key, obj) => {
    if (typeof obj[key] === 'string' && obj[key] && !okFs(obj[key])) { obj[key] = ''; pruned++ }
  }
  if (raw.FileReferences && typeof raw.FileReferences.Moc === 'string') {
    const fr = raw.FileReferences
    if (Array.isArray(fr.Textures)) { const k = fr.Textures.filter((t) => okFs(t)); pruned += fr.Textures.length - k.length; fr.Textures = k }
    if (fr.Motions && typeof fr.Motions === 'object') {
      for (const group of Object.keys(fr.Motions)) {
        const arr = fr.Motions[group]
        if (!Array.isArray(arr)) continue
        const keep = drop(arr)
        if (keep.length) fr.Motions[group] = keep; else delete fr.Motions[group]
      }
    }
    if (Array.isArray(fr.Expressions)) fr.Expressions = drop(fr.Expressions)
    for (const k of ['Physics', 'Pose', 'DisplayInfo', 'Cdi3', 'UserData']) nullify(k, fr)
  } else if (typeof raw.model === 'string' && Array.isArray(raw.textures)) {
    const k = raw.textures.filter((t) => okFs(t)); pruned += raw.textures.length - k.length; raw.textures = k
    if (raw.motions && typeof raw.motions === 'object') {
      for (const group of Object.keys(raw.motions)) {
        const arr = raw.motions[group]
        if (!Array.isArray(arr)) continue
        const keep = drop(arr)
        if (keep.length) raw.motions[group] = keep; else delete raw.motions[group]
      }
    }
    if (Array.isArray(raw.expressions)) raw.expressions = drop(raw.expressions)
    for (const k of ['physics', 'pose']) nullify(k, raw)
  } else {
    return { text, pruned: 0 }
  }
  return { text: JSON.stringify(raw), pruned }
}

// cubism3 配置降级：dl=1 去掉可能有问题的可选文件并修正空组名；dl=2 只留 Moc+贴图
function degradeConfig(raw, level) {
  const fr = raw && raw.FileReferences
  if (!raw || !fr) return raw
  const del = (k) => { delete fr[k] }
  del('Physics'); del('Pose'); del('DisplayInfo'); del('UserData')
  if (level >= 2) {
    del('Motions'); del('Expressions'); del('Cdi3')
    delete raw.Groups; delete raw.HitAreas; delete raw.Layout
    if (!Array.isArray(fr.Textures) || fr.Textures.length === 0) delete fr.Textures
  } else {
    if (fr.Motions && typeof fr.Motions === 'object') {
      if (Object.prototype.hasOwnProperty.call(fr.Motions, '')) {
        fr.Motions.Idle = fr.Motions['']
        delete fr.Motions['']
      }
    }
  }
  return raw
}

// ---------- manifest 更新（删除后同步） ----------
function dropFromManifest(pred) {
  let removed = 0
  try {
    if (!existsSync(manifestFile)) return 0
    const m = JSON.parse(readFileSync(manifestFile, 'utf8'))
    const kept = m.models.filter((x) => { if (pred(x)) { removed++; return false } return true })
    writeFileSync(manifestFile, JSON.stringify({ ...m, count: kept.length, models: kept }, null, 2))
  } catch { /* keep going */ }
  return removed
}

// ---------- 管理接口：删除模型(所在目录) / 删除整个游戏目录 ----------
async function handleManage(req, res) {
  let body = ''
  try { for await (const chunk of req) { if (body.length > 1e6) break; body += chunk } } catch { /* fallthrough */ }
  let data
  try { data = JSON.parse(body || '{}') } catch { send(res, 400, 'bad json', 'text/plain'); return }

  if (data.action === 'deleteModel') {
    const entry = String(data.entry || '').replace(/^\/+/, '')
    if (!entry) { send(res, 400, 'no entry', 'text/plain'); return }
    const absFile = resolve(extractRoot, entry)
    if (!insideRoot(absFile)) { send(res, 403, 'forbidden', 'text/plain'); return }
    // 删除对象 = 该模型文件所在目录（单模型目录）；若模型直接在根目录则只删文件
    let target = resolve(absFile) // 默认删文件本身
    const relDir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : ''
    if (relDir) target = resolve(extractRoot, relDir)
    if (!insideRoot(target)) { send(res, 403, 'forbidden', 'text/plain'); return }
    rmSync(target, { recursive: true, force: true })
    const prefix = relDir || entry
    const removed = dropFromManifest((m) => m.entry === entry || m.entry.startsWith(prefix + '/'))
    send(res, 200, JSON.stringify({ ok: true, removed, target: prefix }), 'application/json')
    return
  }

  if (data.action === 'deleteDir' || data.action === 'deleteGame') {
    const dir = String(data.dir ?? data.id ?? '').replace(/^\/+/, '').replace(/[\\/]+$/, '')
    if (!dir) { send(res, 400, 'no dir', 'text/plain'); return }
    const target = resolve(extractRoot, dir)
    if (!insideRoot(target) || target === extractRoot) { send(res, 403, 'forbidden', 'text/plain'); return }
    rmSync(target, { recursive: true, force: true })
    const removed = dropFromManifest((m) => m.entry === dir || m.entry.startsWith(dir + '/') || m.id === dir)
    send(res, 200, JSON.stringify({ ok: true, removed, target: dir }), 'application/json')
    return
  }

  send(res, 400, 'unknown action', 'text/plain')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '', 'http://local')
  const pathname = decodeURIComponent(url.pathname)

  // 管理接口
  if (pathname === '/api/manage') {
    if (req.method !== 'POST') { send(res, 405, 'POST only', 'text/plain'); return }
    await handleManage(req, res)
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'method not allowed', 'text/plain')
    return
  }

  if (pathname === '/models' || pathname.startsWith('/models/')) {
    const relative = pathname.slice('/models'.length).replace(/^\/+/, '')
    const target = resolve(extractRoot, relative)
    if (!insideRoot(target) || target === extractRoot) {
      send(res, 403, 'forbidden', 'text/plain')
      return
    }
    try {
      if (statSync(target).isFile()) {
        let body = readFileSync(target)
        let pruned = 0
        let dl = Number(url.searchParams.get('dl') || 0)
        if (!Number.isFinite(dl) || dl < 0) dl = 0
        // 模型配置文件：剔除缺失引用；dl>0 时降级(仅 cubism3)
        if (/\.model(3)?\.json$/i.test(relative)) {
          try {
            let text = readFileSync(target, 'utf8')
            if (dl > 0) {
              const raw = JSON.parse(text)
              text = JSON.stringify(degradeConfig(raw, dl))
            }
            const r = pruneMissing(text, dirname(target))
            body = Buffer.from(r.text)
            pruned = r.pruned
          } catch { /* serve raw */ }
        } else {
          dl = 0
        }
        const type = MIME[extname(target).toLowerCase()] ?? (extname(target) === '.json' ? 'application/json; charset=utf-8' : 'application/octet-stream')
        res.writeHead(200, {
          'content-type': type,
          'content-length': body.byteLength,
          'cache-control': 'no-cache',
          ...(pruned ? { 'x-l2d-pruned': String(pruned) } : {}),
          ...(dl ? { 'x-l2d-dl': String(dl) } : {}),
        })
        res.end(req.method === 'HEAD' ? undefined : body)
        return
      }
      send(res, 404, 'not a file', 'text/plain')
    } catch {
      send(res, 404, 'not found', 'text/plain')
    }
    return
  }

  const direct = {
    '/': [join(here, 'index.html'), '.html'],
    '/index.html': [join(here, 'index.html'), '.html'],
    '/app.js': [join(here, 'app.js'), '.js'],
    '/style.css': [join(here, 'style.css'), '.css'],
    '/probe.html': [join(here, 'probe.html'), '.html'],
    '/probe.js': [join(here, 'probe.js'), '.js'],
    '/manifest.json': [manifestFile, '.json'],
    '/l2d.js': [l2dModule, '.js'],
  }[pathname]
  if (direct) {
    try {
      const body = readFileSync(direct[0])
      res.writeHead(200, {
        'content-type': MIME[direct[1]] ?? 'application/octet-stream',
        'content-length': body.byteLength,
        'cache-control': 'no-cache',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch {
      send(res, 404, 'not found', 'text/plain')
    }
    return
  }

  if (pathname === '/healthz') { send(res, 200, 'ok', 'text/plain'); return }
  send(res, 404, 'not found', 'text/plain')
})

if (!existsSync(manifestFile)) {
  console.error('manifest.json missing — run: node tools/model-browser/gen-manifest.mjs')
  process.exitCode = 1
} else {
  server.listen(port, '127.0.0.1', () => {
    console.log(`model browser: http://127.0.0.1:${port}/  (extract root: ${extractRoot})`)
  })
}
