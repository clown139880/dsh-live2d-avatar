import { init } from '/l2d.js'

const treeEl = document.getElementById('tree')
const searchEl = document.getElementById('search')
const countEl = document.getElementById('count')
const stage = document.getElementById('stage')
const statusEl = document.getElementById('status')
const metaTitle = document.getElementById('meta-title')
const metaSub = document.getElementById('meta-sub')

/** 默认聚焦的模型入口；为 null 时回退到第一个模型。 */
const DEFAULT_ENTRY = null

let MODELS = []
let RUNTIME = null
let CURRENT = null
let tapCursor = 0
let exprCursor = 0
let scale = 0.8
let MANAGE = false
let AUTO_LOOP = true
let loopCursor = 0

const btnManage = document.getElementById('btn-manage')
const btnLoop = document.getElementById('btn-loop')

function setStatus(text, isError = false) {
  statusEl.textContent = text
  statusEl.toggleAttribute('data-error', isError)
}

function variantBadges(m) {
  const parts = [m.ver === 'cubism3' ? 'C3' : m.ver === 'cubism2' ? 'C2' : '??']
  if (m.kind === 'effect') parts.push('演出/CG')
  if (m.physics) parts.push('物理')
  if (m.motions > 0) parts.push(`${m.motions}动作`)
  if (m.expressions > 0) parts.push(`${m.expressions}表情`)
  return parts.join(' · ')
}

// 该模型条目所在目录（posix 相对路径），删除模型的单位就是它
function entryFolder(entry) {
  const i = entry.lastIndexOf('/')
  return i > 0 ? entry.slice(0, i) : entry
}

async function apiManage(payload) {
  const res = await fetch('/api/manage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch { /* ignore */ }
  if (!res.ok || !data.ok) throw new Error(`删除失败 HTTP ${res.status} ${text.slice(0, 120)}`)
  return data
}

function noteDeleted(pred) {
  const before = MODELS.length
  MODELS = MODELS.filter((x) => !pred(x))
  return before - MODELS.length
}

async function deleteModelEntry(m) {
  const label = m.entry
  const folder = entryFolder(m.entry)
  if (!confirm(`确认删除该模型目录？\n\n${label}\n\n（连同贴图/动作等文件一并删除，不可恢复）`)) return
  try {
    const data = await apiManage({ action: 'deleteModel', entry: m.entry })
    const removed = noteDeleted((x) => x.entry === m.entry || (folder && x.entry.startsWith(folder + '/')))
    if (CURRENT && (CURRENT.entry === m.entry || (folder && CURRENT.entry.startsWith(folder + '/')))) {
      if (RUNTIME) { try { RUNTIME.destroy() } catch { /* noop */ } RUNTIME = null }
      CURRENT = null
      setStatus(`已删除 ${label}（服务端移除 ${data.removed}）`)
      await pickDefault()
    } else {
      setStatus(`已删除 ${label}（服务端移除 ${data.removed}）`)
    }
    renderTree(searchEl.value)
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true)
  }
}

async function deleteDirEntry(dir) {
  const cnt = MODELS.filter((x) => x.entry === dir || x.entry.startsWith(dir + '/') || x.id === dir).length
  if (!confirm(`确认删除整个目录（不可恢复）？\n\n${dir}\n\n其中 ${cnt} 个模型都会被一并删除。`)) return
  try {
    const data = await apiManage({ action: 'deleteDir', dir })
    const removed = noteDeleted((x) => x.entry === dir || x.entry.startsWith(dir + '/') || x.id === dir)
    if (CURRENT && (CURRENT.entry === dir || CURRENT.entry.startsWith(dir + '/') || CURRENT.id === dir)) {
      if (RUNTIME) { try { RUNTIME.destroy() } catch { /* noop */ } RUNTIME = null }
      CURRENT = null
      await pickDefault()
    }
    setStatus(`已删除目录 ${dir}（服务端移除 ${data.removed}，本地 ${removed}）`)
    renderTree(searchEl.value)
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true)
  }
}

function renderTree(query) {
  const q = query.trim().toLowerCase()
  treeEl.replaceChildren()
  const byId = new Map()
  for (const m of MODELS) {
    if (q && !m.id.toLowerCase().includes(q) && !m.variant.toLowerCase().includes(q)) continue
    if (!byId.has(m.id)) byId.set(m.id, [])
    byId.get(m.id).push(m)
  }
  const ids = [...byId.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const shown = ids.flatMap((id) => byId.get(id))
  const shownChar = shown.filter((m) => m.kind !== 'effect').length
  const shownEffect = shown.filter((m) => m.kind === 'effect').length
  countEl.textContent = `${ids.length} 个作品 · ${shown.length} 个模型（角色 ${shownChar} / 演出CG ${shownEffect}）`
  if (!ids.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = '没有匹配的模型'
    treeEl.appendChild(empty)
    return
  }
  for (const id of ids) {
    const group = document.createElement('div')
    group.className = 'tgroup'
    const head = document.createElement('button')
    head.type = 'button'
    head.className = 'thead'
    const arrow = document.createElement('span')
    arrow.className = 'tarrow'
    arrow.textContent = '▸'
    const title = document.createElement('span')
    title.className = 'ttitle'
    title.textContent = String(id)
    const meta = document.createElement('span')
    meta.className = 'tmeta'
    const groupModels = byId.get(id)
    const groupEffect = groupModels.filter((m) => m.kind === 'effect').length
    meta.textContent = groupEffect && groupEffect === groupModels.length
      ? `${groupModels.length} 个模型 · 全部演出/CG`
      : groupEffect
        ? `${groupModels.length} 个模型（演出/CG ${groupEffect}）`
        : `${groupModels.length} 个模型`
    head.append(arrow, title, meta)
    const headRow = document.createElement('div')
    headRow.className = 'tgroup-head'
    headRow.appendChild(head)
    let delDirBtn = null
    if (MANAGE) {
      delDirBtn = document.createElement('button')
      delDirBtn.type = 'button'
      delDirBtn.className = 'del'
      delDirBtn.textContent = '🗑'
      delDirBtn.title = `删除整个目录：${String(id)}`
      delDirBtn.addEventListener('click', (ev) => { ev.stopPropagation(); void deleteDirEntry(String(id)) })
      headRow.appendChild(delDirBtn)
    }
    const items = document.createElement('div')
    items.className = 'titems'
    items.hidden = true
    for (const m of byId.get(id).sort((a, b) => a.variant.localeCompare(b.variant, undefined, { numeric: true }))) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'titem' + (m.kind === 'effect' ? ' effect' : '') + (CURRENT?.entry === m.entry ? ' active' : '')
      const code = document.createElement('b')
      code.textContent = m.variant
      const badges = document.createElement('span')
      badges.className = 'tbadges'
      badges.textContent = variantBadges(m)
      item.append(code, badges)
      if (MANAGE) {
        const del = document.createElement('button')
        del.type = 'button'
        del.className = 'del'
        del.textContent = '🗑'
        del.title = `删除 ${m.entry}`
        del.addEventListener('click', (ev) => { ev.stopPropagation(); void deleteModelEntry(m) })
        item.appendChild(del)
      }
      item.addEventListener('click', () => void loadModel(m))
      items.appendChild(item)
    }
    head.addEventListener('click', () => {
      const open = !items.hidden
      items.hidden = open
      arrow.textContent = open ? '▾' : '▸'
    })
    if (q) {
      items.hidden = false
      arrow.textContent = '▾'
    }
    group.append(headRow, items)
    treeEl.appendChild(group)
  }
}

function toggleAll() {
  let anyHidden = false
  treeEl.querySelectorAll('.titems').forEach((el) => { if (el.hidden) anyHidden = true })
  const open = anyHidden
  treeEl.querySelectorAll('.titems').forEach((el) => {
    el.hidden = !open
    const arrow = el.previousElementSibling?.querySelector?.('.tarrow')
    if (arrow) arrow.textContent = open ? '▾' : '▸'
  })
}

function availableMotions() {
  if (!RUNTIME) return []
  try {
    const groups = RUNTIME.getMotions()
    return groups ? Object.values(groups).flat() : []
  } catch { return [] }
}

function labelFromFile(file) {
  const base = String(file).split('/').pop() ?? String(file)
  return base.replace(/\.motion3?\.json$/i, '').replace(/\.mtn$/i, '')
}

function clearLists() {
  const mb = document.getElementById('motion-block')
  const eb = document.getElementById('expr-block')
  document.getElementById('motion-list').replaceChildren()
  document.getElementById('expr-list').replaceChildren()
  if (mb) mb.hidden = true
  if (eb) eb.hidden = true
}

function buildButtons() {
  clearLists()
  if (!RUNTIME) return
  const mb = document.getElementById('motion-block')
  const eb = document.getElementById('expr-block')
  const ml = document.getElementById('motion-list')
  const el = document.getElementById('expr-list')
  const motions = availableMotions()
  if (motions.length) {
    mb.hidden = false
    for (const file of motions) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'mbtn'
      btn.textContent = labelFromFile(file)
      btn.addEventListener('click', () => { try { RUNTIME?.playMotionByFile(file, 4) } catch { /* noop */ } })
      ml.appendChild(btn)
    }
  }
  const exprs = RUNTIME.getExpressions?.() ?? []
  if (exprs.length) {
    eb.hidden = false
    for (const exp of exprs) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'ebtn'
      btn.textContent = String(exp)
      btn.addEventListener('click', () => {
        try { RUNTIME?.setExpression(String(exp)) } catch { /* noop */ }
        el.querySelectorAll('.ebtn').forEach((b) => b.classList.toggle('active', b === btn))
      })
      el.appendChild(btn)
    }
  }
}

async function loadModel(m, attempt = 0) {
  CURRENT = m
  renderTree(searchEl.value)
  setStatus(`加载中…${attempt ? `（降级尝试 ${attempt}/2）` : ''}`)
  clearLists()
  metaTitle.textContent = m.name ? `${m.name} · ${m.id} · ${m.variant}` : `${m.id} · ${m.variant}`
  metaSub.textContent = m.entry
  if (RUNTIME) { try { RUNTIME.destroy() } catch { /* noop */ } RUNTIME = null }
  tapCursor = 0
  exprCursor = 0
  loopCursor = 0
  // Cubism2 与 Cubism3 的画布单位/默认比例不同，给不同默认变换，避免忽大忽小
  const verDefault = m.ver === 'cubism2'
    ? { scale: 0.5, position: [0, 0.1] }
    : { scale: 0.8, position: [0, 0.12] }
  scale = verDefault.scale
  const pathBase = `/models/${m.entry.split('/').map(encodeURIComponent).join('/')}`
  const dl = (m.ver === 'cubism3' ? [0, 1, 2][attempt] : 0) ?? 0
  const path = dl ? `${pathBase}?dl=${dl}` : pathBase
  try {
    const rt = init(stage)
    if (!rt) throw new Error('浏览器无法初始化 Live2D/WebGL')
    RUNTIME = rt
    rt.on('tap', () => playTap())
    rt.on('motionend', () => loopNext())
    await rt.load({ path, scale, position: verDefault.position, volume: 0, logLevel: 'warn' })
    buildButtons()
    const motions = availableMotions().length
    const exprs = rt.getExpressions?.().length ?? 0
    const bigTex = m.texture && /\.(4096|8192)\//.test(m.texture) ? ' · 4K+贴图' : ''
    setStatus(`就绪 · ${motions} 动作 · ${exprs} 表情${bigTex}${dl ? `（降级 dl=${dl}）` : ''}${AUTO_LOOP ? ' · 自动循环中' : ''}`)
    if (AUTO_LOOP) loopNext()
  } catch (error) {
    if (m.ver === 'cubism3' && attempt < 2) {
      console.warn(`[model-browser] 加载失败，尝试降级 dl=${[1, 2][attempt]}`, error instanceof Error ? error.message : String(error))
      return loadModel(m, attempt + 1)
    }
    const msg = error instanceof Error ? error.message : String(error)
    window.__lastError = { entry: m.entry, message: msg, stack: error instanceof Error ? error.stack : '', dl }
    console.error('[model-browser] 加载失败', window.__lastError)
    let extra = ''
    try {
      const head = await fetch(`${pathBase}?dl=${dl}`, { method: 'HEAD' })
      const pruned = head.headers.get('x-l2d-pruned')
      if (pruned && Number(pruned) > 0) extra = `（服务器已剔除 ${pruned} 个缺失引用）`
    } catch { /* ignore */ }
    setStatus(`加载失败（${m.entry}）${attempt ? `降级 ${dl}/2 后` : ''}：${msg}${extra} · 详情见浏览器控制台`, true)
  }
}

function playTap() {
  const motions = availableMotions()
  if (!motions.length) return
  const file = motions[tapCursor % motions.length]
  tapCursor += 1
  try { RUNTIME.playMotionByFile(file, 4) } catch { /* noop */ }
}

function loopNext() {
  if (!AUTO_LOOP || !RUNTIME) return
  const motions = availableMotions()
  if (!motions.length) return
  const file = motions[loopCursor % motions.length]
  loopCursor = (loopCursor + 1) % motions.length
  try { RUNTIME.playMotionByFile(file, 4) } catch { /* noop */ }
}

async function loadRandom() {
  const list = MODELS.filter((m) => {
    const q = searchEl.value.trim().toLowerCase()
    return !q || m.id.toLowerCase().includes(q) || m.variant.toLowerCase().includes(q)
  })
  if (!list.length) return
  await loadModel(list[Math.floor(Math.random() * list.length)])
}

function pickDefault() {
  if (!MODELS.length) {
    setStatus('模型库为空')
    renderTree(searchEl.value)
    return
  }
  if (DEFAULT_ENTRY) {
    const m = MODELS.find((x) => x.entry === DEFAULT_ENTRY)
    if (m) return loadModel(m)
  }
  return loadModel(MODELS[0])
}

async function initApp() {
  let urlEntry = new URLSearchParams(location.search).get('entry')
  if (urlEntry) urlEntry = decodeURIComponent(urlEntry)
  let label = new URLSearchParams(location.search).get('label')
  const stageOnly = new URLSearchParams(location.search).get('stageonly') === '1'
  if (stageOnly) document.body.classList.add('stageonly')
  const res = await fetch('/manifest.json', { cache: 'no-store' })
  if (!res.ok) throw new Error(`manifest ${res.status}`)
  const data = await res.json()
  MODELS = Array.isArray(data?.models) ? data.models : []
  if (!MODELS.length) {
    treeEl.innerHTML = '<div class="empty">manifest.json 为空，请先运行 gen-manifest.mjs</div>'
    return
  }
  renderTree(searchEl.value)
  if (urlEntry) {
    const m = MODELS.find((x) => x.entry === urlEntry)
    if (m) { if (label) metaSub.textContent += ` · ${label}`; await loadModel(m) }
  } else {
    await pickDefault()
  }
}

searchEl.addEventListener('input', () => renderTree(searchEl.value))
document.getElementById('toggle-all').addEventListener('click', toggleAll)
document.getElementById('random').addEventListener('click', () => void loadRandom())
document.getElementById('btn-reset').addEventListener('click', () => {
  if (RUNTIME) { try { RUNTIME.destroy() } catch { /* noop */ } RUNTIME = null }
  CURRENT = null
  renderTree(searchEl.value)
  setStatus('已清空')
})
document.getElementById('btn-smaller').addEventListener('click', () => { scale = Math.max(0.1, +(scale - 0.1).toFixed(2)); RUNTIME?.setScale?.(scale) })
document.getElementById('btn-larger').addEventListener('click', () => { scale = Math.min(3, +(scale + 0.1).toFixed(2)); RUNTIME?.setScale?.(scale) })
document.getElementById('btn-expr').addEventListener('click', () => {
  if (!RUNTIME) return
  try {
    const exprs = RUNTIME.getExpressions?.() ?? []
    if (exprs.length) { RUNTIME.setExpression(exprs[exprCursor % exprs.length]); exprCursor += 1 }
  } catch { /* noop */ }
})

btnManage.addEventListener('click', () => {
  MANAGE = !MANAGE
  btnManage.classList.toggle('active', MANAGE)
  btnManage.textContent = MANAGE ? '✓ 管理' : '🛠 管理'
  renderTree(searchEl.value)
  setStatus(MANAGE ? '管理模式已开启：点 🗑 可删除模型或整个游戏目录' : '已退出管理模式')
})
btnLoop.addEventListener('click', () => {
  AUTO_LOOP = !AUTO_LOOP
  btnLoop.classList.toggle('active', AUTO_LOOP)
  btnLoop.textContent = AUTO_LOOP ? '🔁 循环开' : '🔁 循环关'
  setStatus(AUTO_LOOP ? '自动循环播放已开启' : '自动循环播放已关闭')
  if (AUTO_LOOP) loopNext()
})
btnManage.classList.toggle('active', MANAGE)
btnLoop.classList.toggle('active', AUTO_LOOP)

window.addEventListener('beforeunload', () => { if (RUNTIME) { try { RUNTIME.destroy() } catch { /* noop */ } } })

void initApp().catch((error) => {
  setStatus(`初始化失败：${error instanceof Error ? error.message : String(error)}`, true)
})
