#!/usr/bin/env node
// 修复“属性/元素之间漏逗号”的坏 JSON（逐字节保留原文，只插入逗号）。
//   node tools/model-browser/repair-json.mjs [--dry] [路径过滤]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const dry = process.argv.includes('--dry')
const filterArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
const root = process.env.MODEL_BROWSER_ROOT ?? join(here, '../../live2d-extracted/PC Live2D Files New/Live2D')

// 字节级修复：latin1 映射保持每字节一一对应，写回时原样恢复
function repairJson(latin1) {
  let out = ''
  const stack = [] // {mode:'obj'|'arr', needComma}
  let i = 0
  const n = latin1.length
  const peek = (k) => (i + k < n ? latin1[i + k] : '')
  while (i < n) {
    const ch = latin1[i]
    const top = stack[stack.length - 1]
    if (ch === '"') {
      if (top && top.needComma) { out += ','; /* 插逗号 */ }
      out += ch; i++
      while (i < n) {
        const c = latin1[i]; 
        if (c === '\\') {
          const nx = i + 1 < n ? latin1[i + 1] : ''
          if (nx !== '' && '"\\/bfnrtu'.includes(nx)) { out += '\\' + nx; i += 2; continue }
          // 乱码字节里混入的反斜杠不是合法转义 -> 输出字面反斜杠（\\）
          out += '\\\\'
          i += 1
          continue
        }
        out += c; i++
        if (c === '"') break
      }
      if (top) top.needComma = true
      continue
    }
    if (ch === '{' || ch === '[') {
      if (top && top.needComma) out += ','
      out += ch; i++
      stack.push({ mode: ch === '{' ? 'obj' : 'arr', needComma: false })
      continue
    }
    if (ch === '}' || ch === ']') {
      // 去掉紧邻的尾逗号（`,]` / `,}` → `]` / `}`）
      let j = out.length - 1
      while (j >= 0 && /\s/.test(out[j])) j--
      if (j >= 0 && out[j] === ',') out = out.slice(0, j)
      stack.pop()
      out += ch; i++
      if (stack.length) stack[stack.length - 1].needComma = true
      continue
    }
    if (ch === ',') { out += ch; i++; if (stack.length) stack[stack.length - 1].needComma = false; continue }
    if (ch === ':') { out += ch; i++; if (stack.length) stack[stack.length - 1].needComma = false; continue }
    if (/\s/.test(ch)) { out += ch; i++; continue }
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(latin1.slice(i))
    const kw = /^(?:true|false|null)/.exec(latin1.slice(i))
    const tok = (m ? m[0] : null) ?? (kw ? kw[0] : null)
    if (tok !== null) {
      if (top && top.mode === 'arr' && top.needComma) out += ','
      out += tok; i += tok.length
      if (top) top.needComma = true
      continue
    }
    out += ch; i++ // 未知字符原样保留
  }
  return out
}

function walk(dir, files = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== '.git') walk(full, files) }
    else if (/\.model(3)?\.json$/i.test(e.name)) files.push(full)
  }
  return files
}

const all = walk(root)
const targets = filterArg ? all.filter((f) => relative(root, f).replaceAll('\\', '/').includes(filterArg)) : all
let fixedN = 0, stillBroken = 0, skippedOk = 0
const report = []
for (const f of targets) {
  const buf = readFileSync(f)
  const latin1 = buf.toString('latin1')
  let origParseOk = true
  try { JSON.parse(latin1) } catch { origParseOk = false }
  if (origParseOk) { skippedOk++; continue }
  const repaired = repairJson(latin1)
  try {
    JSON.parse(repaired) // 必须能解析
    if (!dry) writeFileSync(f, Buffer.from(repaired, 'latin1'))
    fixedN++
    report.push(`[FIXED] ${relative(root, f)}`)
  } catch (e) {
    stillBroken++
    report.push(`[STILL-BROKEN] ${relative(root, f)} -> ${e.message.slice(0, 90)}`)
  }
}
console.log(JSON.stringify({ dry, scanned: targets.length, fixed: fixedN, stillBroken, skippedOk: skippedOk }, null, 2))
for (const r of report) console.log(r)
