import type { Context } from '@deepseek-ai/cordis'
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildMacAgentCommand } from '../companion/mac-agent.ts'
import { buildWinAgentScript, winAgentArgs } from '../companion/win-agent.ts'
import type { HeroineConfig } from '../shared/config.ts'

const CHANNEL = '/avatar-desktop-pet'
const READY_TIMEOUT_MS = 18000
const DATA_DIR = join(process.env.APPDATA ?? tmpdir(), 'dsh-live2d-avatar-pet')
const HOST_LOG = join(DATA_DIR, 'host-companion.log')
const BOUNDS_FILE = join(DATA_DIR, 'bounds.json')
const STATE_FILE = join(DATA_DIR, 'state.json')

function log(message: string): void {
  try { mkdirSync(DATA_DIR, { recursive: true }); appendFileSync(HOST_LOG, `[${new Date().toISOString()}] ${message}\n`) } catch { /* optional */ }
}

type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, never> } }
const ok = (value: unknown): RpcResult => ({ ok: true, value })
const failure = (code: string, error?: unknown): RpcResult => ({ ok: false, error: { code, message: String(error ?? code), details: {} } })
interface HostConnection { rpc: { handle(channel: string, handler: (endpoint: string, payload: unknown) => Promise<RpcResult>, options: { authority: 'loopback' }): () => Promise<void> } }
type PetPresentation = Pick<HeroineConfig, 'modelEntry' | 'characterName' | 'showPetNameplate' | 'modelScale' | 'modelX' | 'modelY'>
interface DesktopScoped { get?: (key: string) => { rendererHeader?: { name: string; value: string } } | undefined }

function packageRoot(): string { return fileURLToPath(new URL('../', import.meta.url)) }
function loopbackOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined
    return url.origin
  } catch { return undefined }
}
function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}
export function presentationFromPayload(payload: unknown, fallback: HeroineConfig): PetPresentation {
  const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  return {
    modelEntry: typeof input.modelEntry === 'string' && input.modelEntry.trim() ? input.modelEntry.trim() : fallback.modelEntry,
    characterName: typeof input.characterName === 'string' && input.characterName.trim() ? input.characterName.trim().slice(0, 120) : fallback.characterName,
    showPetNameplate: typeof input.showPetNameplate === 'boolean' ? input.showPetNameplate : fallback.showPetNameplate,
    modelScale: finiteNumber(input.modelScale, fallback.modelScale, .1, 5),
    modelX: finiteNumber(input.modelX, fallback.modelX, -3, 3),
    modelY: finiteNumber(input.modelY, fallback.modelY, -3, 3),
  }
}
export function petUrl(origin: string, config: PetPresentation): string {
  const url = new URL('/avatar/pet', origin)
  url.searchParams.set('model', config.modelEntry)
  url.searchParams.set('name', config.characterName)
  url.searchParams.set('nameplate', config.showPetNameplate ? '1' : '0')
  url.searchParams.set('scale', String(config.modelScale))
  url.searchParams.set('x', String(config.modelX))
  url.searchParams.set('y', String(config.modelY))
  return url.href
}
export interface DesktopPetBounds { width: number; height: number; x?: number; y?: number }
export function windowBoundsFromPayload(payload: unknown): DesktopPetBounds {
  const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const requestedWidth = Number(input.width)
  const width = Number.isFinite(requestedWidth) ? Math.max(180, Math.min(480, Math.round(requestedWidth))) : 300
  const x = Number(input.x), y = Number(input.y)
  return { width, height: Math.round(width * 250 / 180), x: Number.isFinite(x) ? Math.round(x) : undefined, y: Number.isFinite(y) ? Math.round(y) : undefined }
}
function savedBounds(): DesktopPetBounds {
  try { return windowBoundsFromPayload(JSON.parse(readFileSync(BOUNDS_FILE, 'utf8'))) } catch { return windowBoundsFromPayload({}) }
}
function saveBounds(raw: Record<string, unknown>): void {
  try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(BOUNDS_FILE, JSON.stringify(windowBoundsFromPayload(raw))) } catch (error) { log(`save bounds: ${error}`) }
}
function savedEnabled(): boolean | undefined {
  try {
    const value = (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { enabled?: unknown }).enabled
    return typeof value === 'boolean' ? value : undefined
  } catch { return undefined }
}
function saveEnabled(enabled: boolean): void {
  try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify({ enabled })) } catch (error) { log(`save state: ${error}`) }
}
function macFilePage(config: HeroineConfig, presentation: PetPresentation): string {
  const root = packageRoot()
  const base = join(tmpdir(), `dsh-live2d-avatar-pet-${process.pid}`)
  const pageDir = join(base, 'avatar', 'pet')
  mkdirSync(pageDir, { recursive: true })
  const configuredRoot = config.modelRoot.trim()
  const modelsRoot = configuredRoot ? resolve(configuredRoot) : join(root, 'assets', 'models')
  const entry = presentation.modelEntry.replace(/^\/+/, '')
  const modelDir = entry.split('/')[0] ?? ''
  if (!modelDir || modelDir === '.' || modelDir === '..') throw new Error('invalid model directory')
  const source = resolve(modelsRoot, modelDir)
  if (!source.startsWith(modelsRoot + '\\') && !source.startsWith(modelsRoot + '/')) throw new Error('model path outside root')
  cpSync(source, join(base, 'avatar', 'models', modelDir), { recursive: true, force: true })
  cpSync(join(root, 'lib', 'pet-window.js'), join(base, 'avatar', 'pet-window.js'))
  const html = readFileSync(join(root, 'assets', 'pet-page.html'), 'utf8')
    .replace('src="/avatar/pet-window.js"', 'src="../pet-window.js"')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  writeFileSync(join(pageDir, 'index.html'), html)
  const url = pathToFileURL(join(pageDir, 'index.html'))
  const params = new URL(petUrl('http://localhost', presentation)).searchParams
  url.search = params.toString()
  return url.href
}

export function registerDesktopPet(ctx: Context, configSource: () => HeroineConfig): void {
  ctx.inject(['connection'], (scoped) => {
    const connection = (scoped as unknown as { connection: HostConnection }).connection
    const desktopScoped = scoped as unknown as DesktopScoped
    let proc: ChildProcess | undefined
    let ready = false, visible = false
    let enabled = savedEnabled()
    let eventSeq = 0
    let lastEvent = ''
    let showResult: ((shown: boolean) => void) | undefined
    // Settings can arrive while the first window is still loading. Each show
    // must run with its own payload; sharing the first promise loses the user's
    // newly loaded model and leaves the default avatar on screen.
    let showQueue: Promise<unknown> = Promise.resolve()
    let showEpoch = 0
    const send = (command: Record<string, unknown>): void => { if (proc?.stdin?.writable) proc.stdin.write(`${JSON.stringify(command)}\n`) }
    const stop = (): void => {
      const old = proc; proc = undefined; ready = visible = false
      if (old?.exitCode === null) { old.stdin?.end(`${JSON.stringify({ cmd: 'quit' })}\n`); setTimeout(() => { if (old.exitCode === null) old.kill() }, 700) }
    }
    const start = async (): Promise<boolean> => {
      if (process.platform !== 'win32' && process.platform !== 'darwin') { log(`unsupported platform ${process.platform}`); return false }
      let command: { cmd: string; args: string[] }
      if (process.platform === 'win32') {
        const scriptPath = join(tmpdir(), `dsh-live2d-avatar-pet-${process.pid}.ps1`)
        writeFileSync(scriptPath, buildWinAgentScript(join(packageRoot(), 'assets', 'webview2')), 'ascii')
        command = { cmd: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: winAgentArgs(scriptPath) }
      } else command = buildMacAgentCommand()
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(command.cmd, command.args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true })
      proc = child
      let lineBuffer = '', stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        lineBuffer += chunk.toString('utf8')
        let newline: number
        while ((newline = lineBuffer.indexOf('\n')) >= 0) {
          const line = lineBuffer.slice(0, newline).trim(); lineBuffer = lineBuffer.slice(newline + 1)
          try {
            const event = JSON.parse(line) as Record<string, unknown>
            if (event.ev === 'ready') ready = true
            else if (event.ev === 'shown') { showResult?.(true); showResult = undefined }
            else if (event.ev === 'moved') saveBounds(event)
            else if (event.ev === 'closed' || event.ev === 'return-stage') { showEpoch += 1; visible = false; enabled = false; saveEnabled(false); lastEvent = String(event.ev); eventSeq += 1; stop() }
            else if (event.ev === 'error') { log(`agent error: ${event.message}`); showResult?.(false); showResult = undefined }
          } catch { log(`agent output: ${line.slice(0, 500)}`) }
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2000); log(`agent stderr: ${String(chunk).trim()}`) })
      child.on('exit', (code) => { showResult?.(false); showResult = undefined; if (proc === child) { proc = undefined; ready = visible = false }; log(`agent exited ${code}: ${stderr.slice(-500)}`) })
      child.on('error', (error) => log(`agent spawn: ${error.message}`))
      return new Promise<boolean>((resolveReady) => {
        const timer = setTimeout(() => finish(false), READY_TIMEOUT_MS)
        const finish = (success: boolean): void => { clearTimeout(timer); child.stdout?.off('data', check); resolveReady(success) }
        const check = (): void => { if (ready) finish(true) }
        child.stdout?.on('data', check)
        child.once('exit', () => finish(false))
        child.once('error', () => finish(false))
      }).then((success) => { if (!success) { log(`agent not ready: ${stderr.slice(-500)}`); stop() }; return success })
    }
    const runShow = async (payload: unknown, epoch: number): Promise<RpcResult> => {
      try {
        const config = configSource()
        const presentation = presentationFromPayload(payload, config)
        const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
        const origin = typeof input.origin === 'string' ? loopbackOrigin(input.origin) : undefined
        if (!origin) return failure('desktop-origin-unavailable')
        if (!ready && !(await start())) return ok({ available: false, visible: false, reason: 'agent-not-ready' })
        if (epoch !== showEpoch) return ok({ available: ready, visible: false })
        const bounds = savedBounds()
        log(`show model=${presentation.modelEntry} bounds=${JSON.stringify(bounds)}`)
        const url = process.platform === 'darwin' ? macFilePage(config, presentation) : petUrl(origin, presentation)
        const header = desktopScoped.get?.('desktopBrowserAccess')?.rendererHeader
        if (process.platform === 'win32' && (!header?.name || !header.value)) throw new Error('desktop renderer header unavailable')
        const shown = new Promise<boolean>((resolveShown) => {
          const timer = setTimeout(() => { showResult = undefined; resolveShown(false) }, READY_TIMEOUT_MS)
          showResult = (value) => { clearTimeout(timer); resolveShown(value) }
        })
        send({ cmd: 'show', url, bounds, carrierOrigin: origin, headerName: header?.name, headerValue: header?.value })
        if (!(await shown)) { log('agent failed to show pet window'); send({ cmd: 'hide' }); return ok({ available: false, visible: false, reason: 'agent-show-failed' }) }
        if (epoch !== showEpoch) { send({ cmd: 'hide' }); return ok({ available: ready, visible: false }) }
        visible = true
        lastEvent = ''
        return ok({ available: true, visible: true })
      } catch (error) { log(`show failed: ${error}`); stop(); return ok({ available: false, visible: false, reason: String(error) }) }
    }
    const dispatch = async (endpoint: string, payload: unknown): Promise<RpcResult> => {
      if (endpoint === 'probe') return ok({ available: process.platform === 'win32' || process.platform === 'darwin', visible: ready && visible, enabled, event: lastEvent, eventSeq })
      if (endpoint === 'hide' || endpoint === 'focus-client') { showEpoch += 1; const available = ready; stop(); enabled = false; saveEnabled(false); return ok({ available, visible: false }) }
      if (endpoint !== 'show') return failure('unknown-endpoint')
      enabled = true
      saveEnabled(true)
      const epoch = showEpoch
      const next = showQueue.then(() => epoch === showEpoch ? runShow(payload, epoch) : ok({ available: ready, visible: false }))
      showQueue = next.catch(() => {})
      return next
    }
    scoped.effect(() => connection.rpc.handle(CHANNEL, dispatch, { authority: 'loopback' }), 'dsh-live2d-avatar: desktop pet rpc')
    scoped.effect(() => stop, 'dsh-live2d-avatar: desktop pet agent')
  })
}
