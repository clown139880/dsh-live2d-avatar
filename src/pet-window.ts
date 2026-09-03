import { L2dAvatarEngine } from './client/avatar/l2d-engine.ts'
import { profileForModel } from './client/avatar/profiles.ts'
import { resolveModelUrl } from './shared/config.ts'

const MIN_WIDTH = 180
const MAX_WIDTH = 480
const STEP = 30
const RATIO = 250 / 180
const SIZE_KEY = 'dsh-live2d-avatar:desktop-pet-size'
const POSITION_KEY = 'dsh-live2d-avatar:desktop-pet-position'

const canvas = document.querySelector<HTMLCanvasElement>('#heroine-pet-canvas')
const name = document.querySelector<HTMLElement>('#heroine-pet-name')
const smaller = document.querySelector<HTMLButtonElement>('#heroine-pet-smaller')
const larger = document.querySelector<HTMLButtonElement>('#heroine-pet-larger')
const close = document.querySelector<HTMLButtonElement>('#heroine-pet-close')
const back = document.querySelector<HTMLButtonElement>('#heroine-pet-back')
const params = new URLSearchParams(location.search)
let sizeSaveTimer: ReturnType<typeof setTimeout> | undefined

function currentWidth(): number {
  const width = window.outerWidth
  return Number.isFinite(width) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)) : 300
}

function resize(width: number): void {
  const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)))
  window.resizeTo(next, Math.round(next * RATIO))
  try { localStorage.setItem(SIZE_KEY, String(next)) } catch { /* storage can be unavailable */ }
  if (smaller) smaller.disabled = next <= MIN_WIDTH
  if (larger) larger.disabled = next >= MAX_WIDTH
}

function persistCurrentSize(): void {
  if (sizeSaveTimer !== undefined) clearTimeout(sizeSaveTimer)
  sizeSaveTimer = setTimeout(() => {
    const width = currentWidth()
    try { localStorage.setItem(SIZE_KEY, String(width)) } catch { /* storage can be unavailable */ }
    if (smaller) smaller.disabled = width <= MIN_WIDTH
    if (larger) larger.disabled = width >= MAX_WIDTH
  }, 120)
}

function restoreWindow(): void {
  try {
    const width = Number(localStorage.getItem(SIZE_KEY))
    if (Number.isFinite(width)) resize(width)
    const position = JSON.parse(localStorage.getItem(POSITION_KEY) ?? '') as { x?: unknown; y?: unknown }
    if (Number.isFinite(position.x) && Number.isFinite(position.y)) window.moveTo(Number(position.x), Number(position.y))
  } catch { /* keep Electron defaults */ }
}

if (canvas) {
  const modelEntry = params.get('model') ?? 'haru/Haru.model3.json'
  const scale = Number(params.get('scale'))
  const x = Number(params.get('x'))
  const y = Number(params.get('y'))
  const engine = new L2dAvatarEngine(canvas, profileForModel(modelEntry), (status, detail) => {
    document.body.dataset.status = status
    if (status === 'error') document.body.title = detail ?? 'Live2D 加载失败'
  }, {
    scale: Number.isFinite(scale) ? scale : 1.35,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0.1,
  })
  void engine.load(resolveModelUrl(modelEntry)).catch(() => {})
  window.addEventListener('resize', () => {
    engine.resize()
    persistCurrentSize()
  })
  window.addEventListener('beforeunload', () => engine.destroy())
}

if (name) {
  name.textContent = params.get('name') ?? 'Avatar'
  name.hidden = params.get('nameplate') !== '1'
}
smaller?.addEventListener('click', () => resize(currentWidth() - STEP))
larger?.addEventListener('click', () => resize(currentWidth() + STEP))
close?.addEventListener('click', () => {
  try { new BroadcastChannel('dsh-live2d-avatar:pet').postMessage({ type: 'close' }) } catch { /* optional */ }
  window.close()
})
back?.addEventListener('click', () => {
  try { new BroadcastChannel('dsh-live2d-avatar:pet').postMessage({ type: 'return-stage' }) } catch { /* optional */ }
})
window.addEventListener('beforeunload', () => {
  try {
    localStorage.setItem(SIZE_KEY, String(currentWidth()))
    localStorage.setItem(POSITION_KEY, JSON.stringify({ x: window.screenX, y: window.screenY }))
  } catch { /* optional */ }
})
restoreWindow()
