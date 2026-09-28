import { L2dAvatarEngine } from './client/avatar/l2d-engine.ts'
import { profileForModel } from './client/avatar/profiles.ts'
import { resolveModelUrl } from './shared/config.ts'

type PetWindow = Window & {
  chrome?: { webview?: { postMessage(message: unknown): void } }
  webkit?: { messageHandlers?: { pet?: { postMessage(message: unknown): void } } }
}
const petWindow = window as PetWindow
function send(message: Record<string, unknown>): void {
  if (petWindow.chrome?.webview) petWindow.chrome.webview.postMessage(message)
  else petWindow.webkit?.messageHandlers?.pet?.postMessage(JSON.stringify(message))
}

const canvas = document.querySelector<HTMLCanvasElement>('#heroine-pet-canvas')
const name = document.querySelector<HTMLElement>('#heroine-pet-name')
const smaller = document.querySelector<HTMLButtonElement>('#heroine-pet-smaller')
const larger = document.querySelector<HTMLButtonElement>('#heroine-pet-larger')
const close = document.querySelector<HTMLButtonElement>('#heroine-pet-close')
const back = document.querySelector<HTMLButtonElement>('#heroine-pet-back')
const params = new URLSearchParams(location.search)

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
  const url = location.protocol === 'file:'
    ? new URL(`../models/${modelEntry.replace(/^\/+/, '')}`, location.href).href
    : resolveModelUrl(modelEntry)
  void engine.load(url).catch(() => {})
  window.addEventListener('resize', () => engine.resize())
  window.addEventListener('beforeunload', () => engine.destroy())
}
if (name) { name.textContent = params.get('name') ?? 'Avatar'; name.hidden = params.get('nameplate') !== '1' }
smaller?.addEventListener('click', () => send({ type: 'resize', delta: -30 }))
larger?.addEventListener('click', () => send({ type: 'resize', delta: 30 }))
close?.addEventListener('click', () => send({ type: 'close' }))
back?.addEventListener('click', () => send({ type: 'return-stage' }))

let dragging = false
document.querySelector('#heroine-pet')?.addEventListener('pointerdown', (event) => {
  const e = event as PointerEvent
  if ((e.target as Element).closest('button')) return
  dragging = true
  send({ type: 'drag-start', screenX: e.screenX, screenY: e.screenY })
})
window.addEventListener('pointerup', () => { if (dragging) { dragging = false; send({ type: 'drag-end' }) } })
