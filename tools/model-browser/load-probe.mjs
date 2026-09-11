#!/usr/bin/env node
// 在 Node 里用桩复制 l2d 的浏览器加载链路，复现某个模型的真实加载异常。
//   假 WebGL2 上下文 + fetch(映射到本机文件) + 假贴图(Image/createImageBitmap)
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, relative, resolve, sep } from 'node:path'
import { existsSync } from 'node:fs'

const ROOT = 'C:/Users/clown/Workspace/dsh-live2d-heroine/assets/models/galgame live2d'

// ---------- 浏览器全局桩 ----------
globalThis.window = globalThis
globalThis.self = globalThis
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.devicePixelRatio = 1
globalThis.innerWidth = 800
globalThis.innerHeight = 800
const runScript = (t) => { try { (0, eval)(t) } catch (e) { console.error('[v2-eval]', e.message) } }
globalThis.performance = globalThis.performance ?? { now: () => Date.now() }
globalThis.HTMLCanvasElement = class HTMLCanvasElementStub {}
globalThis.WebGLRenderingContext = class WebGL1Stub {}
globalThis.WebGL2RenderingContext = class WebGL2Stub {}

function glContext(canvas) {
  const fn = () => undefined
  const target = {
    canvas,
    getParameter: () => 0,
    getExtension: () => null,
    getError: () => 0,
    getProgramParameter: () => 1,
    getShaderParameter: () => 1,
    getUniformLocation: () => 0,
    getAttribLocation: () => 0,
    getContextAttributes: () => ({ alpha: true }),
  }
  Object.setPrototypeOf(target, globalThis.WebGL2RenderingContext.prototype)
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === 'MAX_TEXTURE_SIZE') return 8192
      return fn
    },
    has: () => true,
  })
}

function makeCanvas() {
  const canvas = {
    width: 560, height: 760,
    clientWidth: 560, clientHeight: 760,
    style: {},
    addEventListener: () => {},
    getContext: (type) => (type.startsWith('webgl') ? glContext(canvas) : null),
  }
  Object.setPrototypeOf(canvas, globalThis.HTMLCanvasElement.prototype)
  return canvas
}

globalThis.getComputedStyle = () => ({})
globalThis.ResizeObserver = class { constructor(_cb) {} observe() {} unobserve() {} disconnect() {} }
globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return [] } }
globalThis.document = {
  head: { append: (el) => { /* v2 script 文本在 element.append 里执行 */ } },
  body: { appendChild: () => {}, style: {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tag) => {
    if (tag === 'canvas') return makeCanvas()
    return { append: (t) => { if (typeof t === 'string') runScript(t) }, setAttribute: () => {}, addEventListener: () => {}, style: {} }
  },
}
globalThis.Image = class {
  set src(_v) { Promise.resolve().then(() => this.onload?.()) }
}
globalThis.createImageBitmap = async () => ({ width: 4096, height: 4096, close: () => {} })
globalThis.URL.createObjectURL = () => 'blob:stub'
globalThis.URL.revokeObjectURL = () => {}

// ---------- fetch 桩：/models/... → 本机文件 ----------
globalThis.fetch = async (input) => {
  const raw = typeof input === 'string' ? input : input.url
  const u = new URL(raw, 'http://local')
  let rel = decodeURIComponent(u.pathname)
  if (rel.startsWith('/models/')) rel = rel.slice('/models/'.length)
  else if (rel === '/models') rel = ''
  else throw new Error(`fetch stub: 未识别的路径 ${rel}`)
  const abs = join(ROOT, ...rel.split('/').filter(Boolean))
  if (!existsSync(abs) && !abs.startsWith(ROOT)) throw new Error(`fetch stub: 路径越界 ${abs}`)
  if (!existsSync(abs)) {
    console.error(`   [fetch-stub 404] ${rel}`)
    return { ok: false, status: 404, arrayBuffer: async () => { throw new Error('404') } }
  }
  const buf = readFileSync(abs)
  return {
    ok: true, status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    blob: async () => new Blob([buf]),
    text: async () => buf.toString('utf8'),
    json: async () => JSON.parse(buf.toString('utf8')),
    headers: { get: () => null },
  }
}

// ---------- 载入 bundle ----------
const bundle = pathToFileURL(fileURLToPath(new URL('../../node_modules/l2d/dist/index.js', import.meta.url))).href
const l2dMod = await import(bundle)
const { init } = l2dMod

const cases = [
  ['v1·mori_miko(对照)', 'Fox Hime Zero/mori_miko/mori_miko.model3.json'],
  ['c2·神楽_s_chihaya01(已修复,漏逗号)', '神楽黎明記～Live2d/神乐黎明记Live2d/model/s_chihaya01/s_chihaya01.model.json'],
  ['c2·神楽_s_kanade01(已修复,尾逗号)', '神楽黎明記～Live2d/神の章～s/s_kanade01/s_kanade01.model.json'],
]

for (const [label, entry] of cases) {
  console.log(`\n========== ${label} ==========`)
  const canvas = makeCanvas()
  let rt
  try {
    rt = init(canvas)
  } catch (e) {
    console.log(`init() 抛错: ${e instanceof Error ? e.message : String(e)}`)
    continue
  }
  if (!rt) { console.log('init() 返回 null'); continue }
  let events = []
  for (const ev of ['loadstart', 'loadprogress', 'motionstart', 'motionend', 'tap', 'destroy']) {
    rt.on(ev, (...a) => events.push([ev, ...a]))
  }
  try {
    await rt.load({ path: `/models/${entry}`, scale: 0.8, position: [0, 0.12], volume: 0, logLevel: 'warn' })
    const motions = rt.getMotions?.()
    let mc = 0
    if (motions) for (const k of Object.keys(motions)) mc += motions[k].length
    console.log(`load() → 成功  动作数=${mc}  表情=${(rt.getExpressions?.() ?? []).length}`)
    console.log(`事件: ${events.map((e) => e[0]).join(', ')}`)
  } catch (e) {
    console.log(`load() 抛错: ${e instanceof Error ? e.message : String(e)}`)
    console.log(`事件: ${events.map((e) => e[0]).join(', ')}`)
  }
  try { rt.destroy() } catch { /* noop */ }
}
