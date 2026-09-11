#!/usr/bin/env node
// 审计 manifest 里每个模型条目的引用完整性 + 版本归类。
//   node tools/model-browser/audit.mjs [manifest路径] [根目录]
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const manifestPath = process.argv[2] ?? join(here, 'manifest.json')
const root = resolve(process.argv[3] ?? process.env.MODEL_BROWSER_ROOT ?? join(here, '../../live2d-extracted/PC Live2D Files New/Live2D'))

const { models } = JSON.parse(readFileSync(manifestPath, 'utf8'))

// 解析 model 文件内部引用的字段（尽量温和，容错）
function readRefs(entry) {
  // 返回 { ver, core, textures, motions, expressions, physics, pose, parseError }
  let raw
  try {
    raw = JSON.parse(readFileSync(join(root, entry), 'utf8'))
  } catch (e) {
    return { ver: 'unknown', core: null, textures: [], motions: [], expressions: [], physics: [], pose: [], parseError: String(e) }
  }
  const out = { ver: 'cubism3', core: null, textures: [], motions: [], expressions: [], physics: [], pose: [], parseError: null }
  // 通用收集：凡是"资源扩展名"结尾的字符串都算路径
  const collect = (v, bucket) => {
    if (typeof v === 'string') {
      const e = v.trim()
      if (/\.(png|jpe?g|webp)$/i.test(e)) out.textures.push(e)
      else if (/\.(mtn|motion3\.json)$/i.test(e)) out.motions.push(e)
      else if (/\.exp3?\.json$/i.test(e)) out.expressions.push(e)
      else if (/\.(physics3?|phys3)\.json$/i.test(e)) out.physics.push(e)
      else if (/\.pose3?\.json$/i.test(e)) out.pose.push(e)
      else if (/\.(moc3?)$/i.test(e)) out.core = e
      return
    }
    if (Array.isArray(v)) { for (const x of v) collect(x); return }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) collect(v[k]) }
  }
  collect(raw)
  if (raw.FileReferences && typeof raw.FileReferences.Moc === 'string') out.ver = 'cubism3'
  else if (typeof raw.model === 'string' && Array.isArray(raw.textures)) out.ver = 'cubism2'
  else out.ver = 'other'
  return out
}

function existsUnder(root, abs) {
  try {
    const p = resolve(abs)
    if (p !== root && !p.startsWith(root + sep)) return false
    return existsSync(p) && statSync(p).isFile()
  } catch { return false }
}

const summary = { total: models.length, cubism2: 0, cubism3: 0, other: 0, ok: 0,
  brokenOnlyMotions: 0, missingCore: 0, missingTexture: 0, missingMotion: 0, missingExpression: 0, missingPhysics: 0, missingPose: 0, parseError: 0 }
const broken = []

for (const m of models) {
  const dir = resolve(join(root, dirname(m.entry)))
  const refs = readRefs(m.entry)
  if (refs.ver === 'cubism2') summary.cubism2++
  else if (refs.ver === 'cubism3') summary.cubism3++
  else summary.other++
  if (refs.parseError) {
    summary.parseError++
    broken.push({ entry: m.entry, kind: 'parse-error', detail: refs.parseError.slice(0, 120) })
    continue
  }
  const miss = (list) => list.filter((t) => !existsUnder(root, join(dir, t)))
  const missTex = miss(refs.textures)
  const missMot = miss(refs.motions)
  const missExpr = miss(refs.expressions)
  const missPhy = miss(refs.physics)
  const missPose = miss(refs.pose)
  const coreMissing = !refs.core || !existsUnder(root, join(dir, refs.core))
  if (missTex.length) { summary.missingTexture += missTex.length; broken.push({ entry: m.entry, kind: 'missing-texture', detail: `${missTex.length} 个: ${missTex.slice(0, 2).join(', ')}` }) }
  if (missMot.length) { summary.missingMotion += missMot.length; broken.push({ entry: m.entry, kind: 'missing-motion', detail: `${missMot.length} 个: ${missMot.slice(0, 3).join(', ')}` }) }
  if (missExpr.length) { summary.missingExpression += missExpr.length; broken.push({ entry: m.entry, kind: 'missing-expression', detail: `${missExpr.length} 个` }) }
  if (missPhy.length) { summary.missingPhysics += missPhy.length; broken.push({ entry: m.entry, kind: 'missing-physics', detail: `${missPhy.length} 个` }) }
  if (missPose.length) { summary.missingPose += missPose.length; broken.push({ entry: m.entry, kind: 'missing-pose', detail: `${missPose.length} 个` }) }
  if (coreMissing) { summary.missingCore++; broken.push({ entry: m.entry, kind: 'missing-core', detail: refs.core }) }
  if (!coreMissing && !missTex.length && !missMot.length && !missExpr.length && !missPhy.length && !missPose.length) summary.ok++
}
summary.brokenOnlyMotions = broken.filter((b) => b.kind === 'missing-motion').length

console.log('=== 审计汇总 ===')
console.log(JSON.stringify(summary, null, 2))
console.log(`\n=== 问题条目（前 50 / 共 ${broken.length} 条标记）===`)
broken.slice(0, 50).forEach((b) => console.log(`[${b.kind}] ${b.entry}  ->  ${b.detail}`))
