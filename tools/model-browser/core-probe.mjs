#!/usr/bin/env node
// 在 Node 中直接调用 l2d 捆绑的 CubismCore：
//   1) 报出核心版本
//   2) 用 CubismMoc.create() 实测多个 moc3 能否解析（v1 vs v4）
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

// ---- 桩：bundle 导入时需要的最小浏览器全局 ----
globalThis.window = globalThis
globalThis.self = globalThis
// 注入的旧版 Cubism2 运行时文本必须真正执行（它定义 AMotion 等全局）
const runScript = (text) => { try { (0, eval)(text) } catch (e) { console.error('[script-eval]', e.message) } }
globalThis.document = {
  head: { append: (el) => { /* script 文本在 element.append 里执行 */ } },
  createElement: () => ({ append: (text) => { if (typeof text === 'string') runScript(text) }, setAttribute: () => {} }),
}
globalThis.performance = globalThis.performance ?? { now: () => Date.now() }

const bundle = pathToFileURL(fileURLToPath(new URL('../../node_modules/l2d/dist/index.js', import.meta.url))).href
await import(bundle)

const core = globalThis.Live2DCubismCore
if (!core) {
  console.error('Live2DCubismCore 未挂到全局，bundle 初始化失败（缺桩？）')
  process.exit(1)
}

const v = core.Version.csmGetVersion()
console.log(`core csmGetVersion = 0x${v.toString(16)} (${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${v & 0xffff})`)
console.log(`latestMocVersion = ${core.Version.csmGetLatestMocVersion()}`)
console.log(`Moc api keys: ${core.Moc ? Object.keys(core.Moc).join(', ') : '(undefined)'}`)
console.log(`Model api keys: ${core.Model ? Object.keys(core.Model).join(', ') : '(undefined)'}`)
console.log(`Version api keys: ${core.Version ? Object.keys(core.Version).join(', ') : '(undefined)'}`)
// 捕获核心日志
try { core.Logging.csmSetLogFunction((msg) => process.stdout.write(`  [core-log] ${msg}\n`)) } catch { /* noop */ }

const root = 'C:/Users/clown/Workspace/dsh-live2d-heroine/assets/models/galgame live2d'
const cases = [
  ['v1·mori_miko(对照)', 'Fox Hime Zero/mori_miko/mori_miko.moc3'],
  ['v1·a2(对照)', '[200228] [North Box] モノノ系彼女/a2/a2model.moc3'],
  ['v4·ev_cg001_02s(目标)', 'おっぱいバニー学園/01/ev_cg001_02s.moc3'],
  ['v4·ev_cg002_40(同游戏)', 'おっぱいバニー学園/04/ev_cg002_40.moc3'],
]

for (const [label, rel] of cases) {
  const p = join(root, rel)
  let buf
  try { buf = readFileSync(p) } catch (e) { console.log(`[${label}] 读取失败: ${e.message}`); continue }
  const u8 = new Uint8Array(buf)
  try {
    const mocVersion = typeof core.Version.csmGetMocVersion === 'function'
      ? core.Version.csmGetMocVersion(u8.buffer, u8.byteOffset)
      : '?'
    const moc = core.Moc.fromArrayBuffer(u8.buffer, u8.byteOffset, u8.length) ?? core.Moc.fromArrayBuffer(u8.buffer)
    if (!moc) {
      console.log(`[${label}] mocVer=${mocVersion}  Moc.fromArrayBuffer() → null（创建失败）`)
      continue
    }
    console.log(`[${label}] mocVer=${mocVersion}  Moc.fromArrayBuffer() → OK`)
    // 尝试 CPU 侧建模型（不涉及 WebGL），可暴露更深层不兼容
    try {
      const model = core.Model.fromMoc(moc)
      console.log(`[${label}]   Model.fromMoc() → ${model ? 'OK' : 'null'}`)
      if (model) core.Model.delete(model)
    } catch (e2) {
      console.log(`[${label}]   Model.fromMoc() 抛错: ${e2 instanceof Error ? e2.message : String(e2)}`)
    }
    core.Moc.delete(moc)
  } catch (e) {
    console.log(`[${label}] Moc.fromArrayBuffer() 抛错: ${e instanceof Error ? e.message : String(e)}`)
  }
}
