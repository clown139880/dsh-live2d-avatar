#!/usr/bin/env node
// 递归扫描任意深度目录里的 Live2D 模型，生成给浏览器用的 manifest.json。
//   node tools/model-browser/gen-manifest.mjs
// 环境变量：EXTRACTED_L2D_ROOT（默认本仓库 live2d-extracted 里的编号库）
// 产出字段：id=顶层作品名, variant=角色/文件名, name=显示名,
//   entry, texture(缩略图), motions, expressions, physics, ver(cubism2/3), kind(character/effect)
import { readFileSync, statSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(process.env.EXTRACTED_L2D_ROOT ?? join(here, '../../live2d-extracted/PC Live2D Files New/Live2D'))
const outFile = join(here, 'manifest.json')

const namesFile = join(here, 'names.json')
let nameMap = {}
if (existsSync(namesFile)) {
  try { nameMap = JSON.parse(readFileSync(namesFile, 'utf8')) } catch { /* ignore */ }
}

// 演出/CG 类目启发式：这些“模型”其实是过场 CG、演出素材或 Unity 场景切片，不是角色立绘
const EFFECT_RE = /(ev\d+|^cg$|sharedassets|アニメ|素材|おさわり|後背位|第一画面|第二画面|演目|stage|scene)/i

function sniffVer(text) {
  let raw
  try { raw = JSON.parse(text) } catch { return { ver: 'other' } }
  if (raw.FileReferences && typeof raw.FileReferences.Moc === 'string') return { ver: 'cubism3' }
  if (typeof raw.model === 'string' && Array.isArray(raw.textures)) return { ver: 'cubism2' }
  return { ver: 'other' }
}

function firstTexture(dir) {
  const names = []
  try { names.push(...readdirSync(dir)) } catch { return null }
  const png = names.find((f) => /\.(png|jpg|webp)$/i.test(f))
  if (png) return png
  for (const sub of ['textures', ...names.filter((n) => /\.(1024|2048|4096|8192)$/i.test(n))]) {
    try {
      const f = readdirSync(join(dir, sub)).find((x) => /\.(png|jpg|webp)$/i.test(x))
      if (f) return `${sub}/${f}`
    } catch { /* no such sub */ }
  }
  return null
}

function listModels(dir) {
  const models = []
  const stack = [dir]
  while (stack.length) {
    const walk = stack.pop()
    let entries
    try { entries = readdirSync(walk, { withFileTypes: true }) } catch { continue }
    const files = []
    for (const e of entries) {
      const full = join(walk, e.name)
      if (e.isDirectory()) { if (e.name !== '.git') stack.push(full); continue }
      if (/\.model(3)?\.json$/i.test(e.name)) files.push(e.name)
    }
    if (!files.length) continue
    const relDir = walk === dir ? '' : walk.slice(dir.length + 1).replaceAll('\\', '/')

    let motionsCount = 0
    let expressionsCount = 0
    let physics = false
    for (const sub of ['', 'motions', 'expressions']) {
      let list = []
      try { list = readdirSync(sub ? join(walk, sub) : walk) } catch { continue }
      if (sub === 'motions') motionsCount = list.filter((f) => /\.motion3?\.json$/i.test(f)).length
      else if (sub === 'expressions') expressionsCount = list.filter((f) => /\.exp3?\.json$/i.test(f)).length
      else physics = list.some((f) => /\.(physics3|physics|phys3)\.json$/i.test(f))
    }

    const thumb = firstTexture(walk)
    const game = relDir.split('/')[0] || '未分组'

    for (const f of files) {
      let text = ''
      try { text = readFileSync(join(walk, f), 'utf8') } catch { continue }
      const { ver } = sniffVer(text)
      if (ver === 'other') continue // 跳过解析失败/非 Live2D 配置
      const rel = relDir ? `${relDir}/${f}` : f
      const stem = f.replace(/\.model(3)?\.json$/i, '')
      const kind = EFFECT_RE.test(rel) || EFFECT_RE.test(stem) ? 'effect' : 'character'
      models.push({
        id: game,
        variant: rel,
        name: nameMap[rel] ?? nameMap[stem] ?? stem,
        entry: rel,
        texture: thumb ? `${relDir ? relDir + '/' : ''}${thumb}` : null,
        motions: motionsCount,
        expressions: expressionsCount,
        physics,
        ver,
        kind,
      })
    }
  }
  return models
}

const models = listModels(root)
models.sort((a, b) =>
  (a.id === b.id
    ? a.variant.localeCompare(b.variant, undefined, { numeric: true })
    : a.id.localeCompare(b.id, undefined, { numeric: true })))

writeFileSync(outFile, JSON.stringify({ root: 'models', count: models.length, models }, null, 2))
console.log(`wrote ${outFile} (${models.length} models): ` +
  `c2=${models.filter((m) => m.ver === 'cubism2').length} c3=${models.filter((m) => m.ver === 'cubism3').length} ` +
  `character=${models.filter((m) => m.kind === 'character').length} effect=${models.filter((m) => m.kind === 'effect').length} games=${new Set(models.map((m) => m.id)).size}`)
