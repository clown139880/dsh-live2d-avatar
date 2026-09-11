import { init } from '/l2d.js'

const canvasOrig = document.getElementById('orig')
const canvasDress = document.getElementById('dress')
const statusEl = document.getElementById('status')
const motionSel = document.getElementById('motion')

const MOTIONS = [
  'mtn/IDLING_01.mtn', 'mtn/IDLING_02.mtn', 'mtn/IDLING_03.mtn',
  'mtn/I_ANGRY.mtn', 'mtn/I_FUN.mtn', 'mtn/I_SAD.mtn', 'mtn/I_SURPRISE.mtn',
]

const runtimes = { orig: null, dress: null }

function setStatus(text) { statusEl.textContent = text }

async function loadOne(key, canvas, entry) {
  const rt = init(canvas)
  if (!rt) { throw new Error('WebGL init failed') }
  runtimes[key] = rt
  rt.on('loaded', () => setStatus(`${key} loaded`))
  await rt.load({ path: entry, scale: 0.9, position: [0, 0], volume: 0, logLevel: 'error' })
  return rt
}

for (const m of MOTIONS) {
  const opt = document.createElement('option')
  opt.value = m
  opt.textContent = m
  motionSel.appendChild(opt)
}

async function main() {
  try {
    setStatus('loading orig…')
    await loadOne('orig', canvasOrig, '/models/megumi/katou_01.model.json')
    setStatus('loading dress…')
    await loadOne('dress', canvasDress, '/models/megumi-dress/katou_01.model.json')
    setStatus('ready — both models loaded. 原版 vs 粉色裙装')
  } catch (e) {
    setStatus('ERROR: ' + (e?.message ?? e))
  }
}

motionSel.addEventListener('change', () => {
  if (!motionSel.value) return
  for (const k of ['orig', 'dress']) {
    try { runtimes[k]?.playMotionByFile?.(motionSel.value, 3) } catch { /* noop */ }
  }
})

document.getElementById('btn-surprise').addEventListener('click', () => {
  for (const k of ['orig', 'dress']) { try { runtimes[k]?.playMotionByFile?.('mtn/I_SURPRISE.mtn', 3) } catch { /* noop */ } }
})
document.getElementById('btn-fun').addEventListener('click', () => {
  for (const k of ['orig', 'dress']) { try { runtimes[k]?.playMotionByFile?.('mtn/I_FUN.mtn', 3) } catch { /* noop */ } }
})
document.getElementById('btn-sad').addEventListener('click', () => {
  for (const k of ['orig', 'dress']) { try { runtimes[k]?.playMotionByFile?.('mtn/I_SAD.mtn', 3) } catch { /* noop */ } }
})

window.addEventListener('beforeunload', () => {
  for (const k of ['orig', 'dress']) { try { runtimes[k]?.destroy?.() } catch { /* noop */ } }
})

void main()
