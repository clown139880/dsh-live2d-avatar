#!/usr/bin/env node
// 把 model json 中引用了 URL 危险字符（# % ? 等）的资源，在同一目录做“安全名”副本，
// 并把引用改写为安全名。原件不动。可用于 l2d / 浏览器 / 插件任何消费者。
//   node tools/model-browser/sanitize-refs.mjs [--dry]
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname, normalize, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const rootRef = process.env.MODEL_BROWSER_ROOT ?? join(here, '../../live2d-extracted/PC Live2D Files New/Live2D')
const root = normalize(rootRef)
const manifestPath = (process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(here, 'manifest.json'))
const dry = process.argv.includes('--dry')
const { models } = JSON.parse(readFileSync(manifestPath, 'utf8'))

// 从任意递归结构里收集看起来像资源路径的字符串（扩展名结尾即视为路径，允许任意字符如 # 空格 日文）
function collectPaths(raw, out = []) {
  if (typeof raw === 'string') {
    if (/\.(png|jpg|jpeg|webp|moc|moc3|mtn|motion3|exp3|physics3|pose3|cdi3)$/i.test(raw.trim())) out.push(raw.trim())
    return out
  }
  if (Array.isArray(raw)) { for (const v of raw) collectPaths(v, out); return out }
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) {
      if (typeof raw[k] === 'string' && /\.(png|jpg|jpeg|webp|moc|moc3|mtn|motion3|exp3|physics3|pose3|cdi3)$/i.test(raw[k])) out.push(raw[k])
      else collectPaths(raw[k], out)
    }
  }
  return out
}

const UNSAFE = /[#%?]/ // 会破坏 URL 的字符（空格大多数 fetch 会自动转义，先不动）
function sanitizeName(name) { return name.replace(UNSAFE, '_') }

const plan = { checked: 0, needFix: 0, filesToCopy: 0, entries: [] }
const seenJson = new Set()

for (const m of models) {
  const absJson = join(root, m.entry)
  let text
  try { text = readFileSync(absJson, 'utf8') } catch { continue }
  let raw
  try { raw = JSON.parse(text) } catch { continue } // 解析失败的条目跳过（多为 CG/坏文件）
  const paths = [...new Set(collectPaths(raw))].filter((p) => /\.(png|jpg|jpeg|webp|moc|moc3|mtn|motion3|exp3|physics3|pose3|cdi3)$/i.test(p))
  const unsafeSet = new Set(paths.filter((p) => UNSAFE.test(p)))
  if (!unsafeSet.size) continue
  const fixes = []
  for (const p of unsafeSet) {
    const abs = join(root, join(dirname(m.entry), p))
    if (!existsSync(abs)) { fixes.push({ from: p, note: 'src-missing' }); continue }
    // 安全名一律用正斜杠相对路径（Windows dirname 会给反斜杠，写进 JSON 会破坏转义）
    const segs = p.split('/')
    segs[segs.length - 1] = sanitizeName(segs[segs.length - 1])
    const safeRel = segs.join('/')
    if (safeRel === p) continue
    const absSafe = join(root, join(dirname(m.entry), safeRel))
    if (!dry && !existsSync(absSafe)) { try { copyFileSync(abs, absSafe) } catch { continue } }
    fixes.push({ from: p, to: safeRel })
  }
  if (!fixes.length) continue
  plan.needFix++
  plan.filesToCopy += fixes.filter((f) => f.to).length
  plan.entries.push({ entry: m.entry, fixes })
  if (dry || seenJson.has(absJson)) continue
  seenJson.add(absJson)
  // 原文按出现顺序替换（先长后短，避免部分替换干扰）
  let out = text
  for (const f of fixes.filter((x) => x.to)) {
    out = out.split(f.from).join(f.to)
  }
  if (out !== text) writeFileSync(absJson, out)
}

console.log(JSON.stringify({ dry, checked: models.length, needFix: plan.needFix, filesToCopy: plan.filesToCopy }, null, 2))
console.log('\n=== 明细（前 60 条）===')
plan.entries.slice(0, 60).forEach((e) => {
  console.log(`[${e.entry}]`)
  e.fixes.forEach((f) => console.log(`    ${f.from}  ->  ${f.to ?? '(skip ' + f.note + ')'}`))
})
if (plan.entries.length > 60) console.log(`… 还有 ${plan.entries.length - 60} 条`)
