#!/usr/bin/env node
// 端到端自检：健康检查 / 清洗效果 / 删除接口（临时目录）
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const BASE = 'http://127.0.0.1:8590'
const enc = (s) => s.split('/').map(encodeURIComponent).join('/')

async function fetchJson(url, opts) {
  const r = await fetch(url, opts)
  return { status: r.status, headers: r.headers, text: await r.text() }
}

const report = {}

// 1) health
report.health = await fetchJson(`${BASE}/healthz`)
// 2) manifest
const man = await fetchJson(`${BASE}/manifest.json`)
report.manifest = { status: man.status, count: JSON.parse(man.text).count }
// 3) チャロ（缺失动作应被清洗）
const charoEntry = '[200502][らぷらす] プリンセスハーレム [RJ280657]/チャロ/チャロ.model3.json'
const charo = await fetchJson(`${BASE}/models/${enc(charoEntry)}`)
report.charo = { status: charo.status, pruned: charo.headers.get('x-l2d-pruned') }
try {
  const j = JSON.parse(charo.text)
  const groups = j.FileReferences?.Motions ? Object.keys(j.FileReferences.Motions) : []
  const totalMotions = groups.reduce((n, g) => n + (j.FileReferences.Motions[g]?.length ?? 0), 0)
  report.charo.groups = groups
  report.charo.totalMotions = totalMotions
} catch { report.charo.body = charo.text.slice(0, 200) }
// 4) a2（健康模型，不应清洗）
const a2 = await fetchJson(`${BASE}/models/${enc('[200228] [North Box] モノノ系彼女/a2/a2.model3.json')}`)
report.a2 = { status: a2.status, pruned: a2.headers.get('x-l2d-pruned') }
// 5) 删除接口：临时目录
const tmpEntry = '__del_test__/x.model3.json'
const root = process.env.MODEL_BROWSER_ROOT ?? process.cwd()
const created = join(root, '__del_test__')
if (!existsSync(created)) mkdirSync(created)
writeFileSync(join(created, 'x.model3.json'), '{"Version":3,"FileReferences":{"Moc":"x.moc3","Textures":[]}}', 'utf8')
writeFileSync(join(created, 'x.moc3'), 'dummy', 'utf8')
report.tmpExistsBefore = existsSync(created)
const del = await fetchJson(`${BASE}/api/manage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'deleteModel', entry: tmpEntry }),
})
report.deleteResp = { status: del.status, body: del.text }
report.tmpExistsAfter = existsSync(created)

console.log(JSON.stringify(report, null, 2))
