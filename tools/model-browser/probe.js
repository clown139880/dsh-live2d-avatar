import { init } from '/l2d.js'

// Renders a batch of models with the real l2d engine and composes a labelled montage.
//  /probe.html?ids=100-150&cols=6&cell=220x300  (also comma lists, e.g. ids=102,104,881001)
const params = new URLSearchParams(location.search)
const statusEl = document.getElementById('probe-status')
const resultEl = document.getElementById('probe-result')
const work = document.getElementById('work')
const W = work.width
const H = work.height

function parseIds(raw) {
  const out = []
  for (const token of raw.split(',')) {
    const t = token.trim()
    if (!t) continue
    if (t.includes('-')) {
      const [a, b] = t.split('-').map((x) => x.trim())
      const lo = parseInt(a, 10); const hi = parseInt(b, 10)
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        for (let n = lo; n <= hi; n += 1) out.push(String(n))
      }
    } else out.push(t)
  }
  return out
}

async function main() {
  const ids = parseIds(params.get('ids') ?? '')
  const cols = Math.max(1, Number(params.get('cols') ?? 6))
  const per = Math.max(1, Number(params.get('per') ?? 1))
  const [cw, ch] = String(params.get('cell') ?? '220x300').split('x').map(Number)
  const width = cw || 220
  const height = ch || 300
  let manifest = []
  try {
    const res = await fetch('/manifest.json', { cache: 'no-store' })
    manifest = (await res.json()).models ?? []
  } catch (e) { statusEl.textContent = 'manifest 加载失败: ' + e.message; return }

  const rows = []
  for (const id of ids) {
    const models = manifest
      .filter((m) => m.id === id || m.variant === id || m.variant.startsWith(id))
      .sort((a, b) => a.variant.localeCompare(b.variant, undefined, { numeric: true }))
    rows.push(...models.slice(0, per))
  }
  if (!rows.length) { statusEl.textContent = '没有匹配的模型'; return }
  const rowsTotal = Math.ceil(rows.length / cols)
  const out = document.createElement('canvas')
  out.width = cols * width
  out.height = rowsTotal * height
  const octx = out.getContext('2d')
  octx.fillStyle = '#eef0f4'
  octx.fillRect(0, 0, out.width, out.height)

  let runtime = null
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  try { runtime = init(c) } catch { runtime = null }
  for (let i = 0; i < rows.length; i += 1) {
    const m = rows[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    statusEl.textContent = `渲染 ${i + 1}/${rows.length} · ${m.id}/${m.variant}`
    try {
      if (!runtime) throw new Error('WebGL unavailable')
      await Promise.race([
        runtime.load({ path: `/models/${m.entry}`, scale: 1.0, position: [0, 0.2], volume: 0, logLevel: 'error' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('超时')), 20000)),
      ])
      await new Promise((r) => setTimeout(r, 280))
      octx.drawImage(c, col * width, row * height, width, height)
    } catch (e) {
      octx.fillStyle = '#e8b4b4'
      octx.fillRect(col * width, row * height, width, height)
      if (m.texture) {
        try {
          const img = new Image()
          img.src = `/models/${m.texture}`
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
          octx.drawImage(img, col * width, row * height, width, height)
        } catch { /* texture also failed */ }
      }
    }
    octx.fillStyle = '#c0392b'
    octx.font = 'bold 17px system-ui'
    octx.fillText(`${m.id}/${m.variant}`, col * width + 6, row * height + 20)
    octx.strokeStyle = '#8890a0'
    octx.strokeRect(col * width + 0.5, row * height + 0.5, width - 1, height - 1)
  }
  if (runtime) { try { runtime.destroy() } catch { /* noop */ } }

  resultEl.replaceChildren(out)
  const img = document.createElement('img')
  img.id = 'probe-out'
  img.src = out.toDataURL('image/png')
  resultEl.replaceChildren(img)
  document.title = `probe ${ids.slice(0, 6).join(',')} (${rows.length})`
  statusEl.textContent = `完成：${rows.length} 个模型 · ${out.width}x${out.height}`
}

void main()
