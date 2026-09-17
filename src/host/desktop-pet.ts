import type { Context } from '@deepseek-ai/cordis'
import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, appendFileSync, constants as fsConstants, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HeroineConfig } from '../shared/config.ts'

const CHANNEL = '/avatar-desktop-pet'
const PET_PATH = '/avatar/pet'
const COMPANION_BASENAME = 'companion.mjs'
const ELECTRON_ENV = 'DSH_LIVE2D_AVATAR_ELECTRON'
const READY_MARKER = '__DSH_PET_READY__'
const FAIL_MARKER = '__DSH_PET_FAIL__'
const COMPANION_READY_TIMEOUT_MS = 8000
const HOST_LOG = join(process.env.APPDATA ?? tmpdir(), 'dsh-live2d-avatar-pet', 'host-companion.log')

function hostLog(message: string): void {
  try {
    mkdirSync(dirname(HOST_LOG), { recursive: true })
    appendFileSync(HOST_LOG, `[${new Date().toISOString()}] ${message}\n`)
  } catch { /* non-fatal */ }
}

type RpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: Record<string, never> } }

interface HostConnection {
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown) => Promise<RpcResult>,
      options: { authority: 'trusted-host' | 'loopback' },
    ): () => Promise<void>
  }
}

type PetPresentation = Pick<HeroineConfig,
  'modelEntry' | 'characterName' | 'showPetNameplate' | 'modelScale' | 'modelX' | 'modelY'
>

function failure(code: string, error?: unknown): RpcResult {
  const detail = error instanceof Error ? error.message : error === undefined ? code : String(error)
  return { ok: false, error: { code, message: detail, details: {} } }
}

function ok(value: unknown): RpcResult {
  return { ok: true, value }
}

function loopbackOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

function exists(path: string): boolean {
  try {
    accessSync(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Package root of the built artifact (lib/index.mjs sits one level below it). */
function packageRoot(): string {
  return fileURLToPath(new URL('../', import.meta.url))
}

/** The built standalone companion main that Electron will run. */
function companionScriptPath(): string {
  // After bundling this file lives in lib/index.mjs; the companion sits next to it.
  return join(dirname(fileURLToPath(import.meta.url)), COMPANION_BASENAME)
}

function isElectronProcess(): boolean {
  return typeof process.versions.electron === 'string' && process.versions.electron.length > 0
}

function platformBinaryName(): string {
  return process.platform === 'win32' ? 'electron.exe' : 'electron'
}

/**
 * True when running inside a packaged DSH Desktop (a commercial app exe with an
 * `app.asar` bundle). In that case `process.execPath` is the app binary, not a
 * generic Electron CLI, so it must never be used to launch the companion.
 */
function isPackagedDesktopApp(): boolean {
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath
  if (!resources) return false
  return exists(join(resources, 'app.asar'))
}

/** Best-effort discovery of a generic Electron binary to run the companion. */
export function resolveCompanionExecutable(explicitPath?: string): string | undefined {
  // 0. A user-configured Electron path takes precedence (settings field).
  if (explicitPath) {
    hostLog(`resolveCompanionExecutable: explicit path "${explicitPath}" exists=${exists(explicitPath)}`)
    if (exists(explicitPath)) return explicitPath
  }

  const override = process.env[ELECTRON_ENV]
  if (override) {
    hostLog(`resolveCompanionExecutable: env ${ELECTRON_ENV}=${override} exists=${exists(override)}`)
    if (exists(override)) return override
  }

  const binary = platformBinaryName()

  // 1. A companion-supplied vendor Electron (gitignored; user drops it here).
  const root = packageRoot()
  const vendorCandidates = [
    join(root, 'vendor', `${process.platform}-${process.arch}`, binary),
    join(root, 'vendor', binary),
  ]
  for (const candidate of vendorCandidates) {
    if (exists(candidate)) { hostLog(`resolveCompanionExecutable: vendor ${candidate}`); return candidate }
  }

  // 2. A dev/unpacked Electron where process.execPath is the generic CLI.
  // Only treat it as usable when the running binary is literally a generic
  // Electron (`electron.exe` / `Electron`), never a packaged app exe. The host
  // runs in a utilityProcess where `process.resourcesPath` is undefined, so
  // `isPackagedDesktopApp()` misjudges the packaged app as "unpacked"; if we
  // let it pick `TokensCowork.exe` it would spawn the whole app (single-instance
  // lock) instead of a fresh window, which is exactly the last failure.
  const execBase = basename(process.execPath).toLowerCase()
  if (!isPackagedDesktopApp() && isElectronProcess() && execBase === binary.toLowerCase()) {
    if (exists(process.execPath)) { hostLog(`resolveCompanionExecutable: process.execPath ${process.execPath}`); return process.execPath }
  }

  // 3. A generic Electron next to the running DSH Desktop dev repo.
  const nearby = nearbyElectron(binary)
  if (nearby) { hostLog(`resolveCompanionExecutable: nearby ${nearby}`); return nearby }

  // 3b. Electron shipped with a DSH profile (the user's own environment often
  // has one even if the running DSH is packaged, where process.execPath is the
  // app exe and cannot be reused as a generic CLI). Scan the DSH home.
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const profileCandidates = [
    join(dshHome, 'profiles', 'node_modules', 'electron', 'dist', binary),
    join(dshHome, 'profiles', 'desktop', 'node_modules', 'electron', 'dist', binary),
  ]
  for (const candidate of profileCandidates) {
    if (exists(candidate)) { hostLog(`resolveCompanionExecutable: dsh profile ${candidate}`); return candidate }
  }

  // 4. A system-installed Electron on PATH.
  const onPath = whichElectron(binary)
  if (onPath) { hostLog(`resolveCompanionExecutable: PATH ${onPath}`); return onPath }

  hostLog(`resolveCompanionExecutable: NOT FOUND (platform=${process.platform} arch=${process.arch} binary=${binary} dshHome=${dshHome})`)
  return undefined
}

/** Walk up from the running app's resources / cwd looking for a dev Electron. */
function nearbyElectron(binary: string): string | undefined {
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath
  const seeds = [resources, process.cwd()].filter((value): value is string => typeof value === 'string')
  for (const seed of seeds) {
    let dir = seed
    for (let depth = 0; depth < 5; depth += 1) {
      const candidate = join(dir, 'node_modules', 'electron', 'dist', binary)
      if (exists(candidate)) return candidate
      const parent = resolve(dir, '..')
      if (parent === dir) break
      dir = parent
    }
  }
  return undefined
}

function whichElectron(binary: string): string | undefined {
  const pathValue = process.env.PATH ?? ''
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue
    const candidate = resolve(entry, binary)
    if (exists(candidate)) return candidate
  }
  return undefined
}

export function petUrl(origin: string, config: PetPresentation): string {
  const url = new URL(PET_PATH, origin)
  url.searchParams.set('model', config.modelEntry)
  url.searchParams.set('name', config.characterName)
  url.searchParams.set('nameplate', config.showPetNameplate ? '1' : '0')
  url.searchParams.set('scale', String(config.modelScale))
  url.searchParams.set('x', String(config.modelX))
  url.searchParams.set('y', String(config.modelY))
  return url.href
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
}

export function presentationFromPayload(payload: unknown, fallback: HeroineConfig): PetPresentation {
  const input = payload !== null && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {}
  const modelEntry = typeof input.modelEntry === 'string' && input.modelEntry.trim()
    ? input.modelEntry.trim()
    : fallback.modelEntry
  const characterName = typeof input.characterName === 'string' && input.characterName.trim()
    ? input.characterName.trim().slice(0, 120)
    : fallback.characterName
  return {
    modelEntry,
    characterName,
    showPetNameplate: typeof input.showPetNameplate === 'boolean'
      ? input.showPetNameplate
      : fallback.showPetNameplate,
    modelScale: finiteNumber(input.modelScale, fallback.modelScale, 0.1, 5),
    modelX: finiteNumber(input.modelX, fallback.modelX, -3, 3),
    modelY: finiteNumber(input.modelY, fallback.modelY, -3, 3),
  }
}

export interface DesktopPetBounds {
  width: number
  height: number
  x?: number
  y?: number
}

/**
 * Derive the pet window bounds from the renderer's show payload. The renderer
 * persists the desktop pet's width and screen position in local storage and
 * sends them back on each launch, so after restarting the app the pet opens at
 * the same size and spot the user left it. Only finite values are honored.
 */
export function windowBoundsFromPayload(payload: unknown): DesktopPetBounds {
  const input = payload !== null && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {}
  const requestedWidth = Number(input.width)
  const width = Number.isFinite(requestedWidth) ? Math.max(180, Math.min(480, Math.round(requestedWidth))) : 300
  const height = Math.round(width * 250 / 180)
  const requestedX = Number(input.x)
  const requestedY = Number(input.y)
  return {
    width,
    height,
    x: Number.isFinite(requestedX) ? Math.round(requestedX) : undefined,
    y: Number.isFinite(requestedY) ? Math.round(requestedY) : undefined,
  }
}

export interface CompanionSpawnArgs {
  petUrl: string
  width: number
  height: number
  x?: number
  y?: number
  rendererHeaderName?: string
  rendererHeaderValue?: string
  carrierOrigin?: string
}

/** Build the argv (excluding the script path) passed to the companion Electron. */
export function companionArgv(args: CompanionSpawnArgs): string[] {
  const argv = [`--pet-url=${args.petUrl}`, `--width=${args.width}`, `--height=${args.height}`]
  if (args.x !== undefined) argv.push(`--x=${args.x}`)
  if (args.y !== undefined) argv.push(`--y=${args.y}`)
  if (args.rendererHeaderName !== undefined) argv.push(`--renderer-header-name=${args.rendererHeaderName}`)
  if (args.rendererHeaderValue !== undefined) argv.push(`--renderer-header-value=${args.rendererHeaderValue}`)
  if (args.carrierOrigin !== undefined) argv.push(`--carrier-origin=${args.carrierOrigin}`)
  return argv
}

interface DesktopBrowserAccessLike {
  rendererHeader?: { name: string; value: string }
}

interface DesktopScoped {
  get?: (key: string) => DesktopBrowserAccessLike | undefined
}

function originFromPayload(payload: unknown): string | undefined {
  const input = payload !== null && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {}
  return typeof input.origin === 'string' ? input.origin : undefined
}

/**
 * Wait for the companion Electron to confirm its window has actually loaded and
 * been shown (`__DSH_PET_READY__` on stdout). Resolves `false` if the process
 * exits first or the window does not become ready in time, so the host can fall
 * back to the page-internal pet instead of detaching it and showing nothing.
 */
function waitForCompanionReadiness(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ready: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout?.removeListener('data', onData)
      resolve(ready)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    const onData = (chunk: Buffer | string): void => {
      const text = String(chunk)
      if (text.includes(READY_MARKER)) finish(true)
      else if (text.includes(FAIL_MARKER)) finish(false)
    }
    child.stdout?.on('data', onData)
    child.once('exit', () => finish(false))
    child.once('error', () => finish(false))
  })
}

export function registerDesktopPet(ctx: Context, configSource: () => HeroineConfig): void {
  ctx.inject(['connection'], (scoped) => {
    const connection = (scoped as unknown as { connection: HostConnection }).connection
    const desktopScoped = scoped as unknown as DesktopScoped
    let petProcess: ChildProcess | undefined
    // Single-flight guard for `show`: a duplicate `show` RPC arriving while one
    // is still loading must not spawn a second companion (which kills the first).
    let showInFlight: Promise<RpcResult> | undefined

    const close = (): void => {
      const current = petProcess
      petProcess = undefined
      if (current !== undefined && current.exitCode === null) current.kill()
    }

    const runShow = async (payload: unknown): Promise<RpcResult> => {
      const config = configSource()

      // No Electron presence (plain `dsh web`) -> degrade to the page-internal pet.
      if (!isElectronProcess()) return ok({ available: false, visible: false })
      const executable = resolveCompanionExecutable(config.companionElectronPath)
      if (executable === undefined) {
        // Desktop, but no usable Electron binary. Tell the client so it can show
        // the doc/configuration hint instead of silently degrading.
        return ok({ available: false, visible: false, reason: 'electron-missing' })
      }

      try {
        const origin = originFromPayload(payload)
        if (origin === undefined) return failure('desktop-origin-unavailable')
        const parsedOrigin = loopbackOrigin(origin)
        if (parsedOrigin === undefined) return failure('desktop-origin-unavailable')

        const url = petUrl(parsedOrigin, {
          modelEntry: config.modelEntry,
          characterName: config.characterName,
          showPetNameplate: config.showPetNameplate,
          modelScale: config.modelScale,
          modelX: config.modelX,
          modelY: config.modelY,
        })
        const { width, height, x, y } = windowBoundsFromPayload(payload)
        const header = desktopScoped.get?.('desktopBrowserAccess')?.rendererHeader

        const spawned = spawn(executable, [
          companionScriptPath(),
          ...companionArgv({
            petUrl: url,
            width,
            height,
            ...(x !== undefined ? { x } : {}),
            ...(y !== undefined ? { y } : {}),
            rendererHeaderName: header?.name,
            rendererHeaderValue: header?.value,
            carrierOrigin: parsedOrigin,
          }),
        // Spawn with a sanitised env: the DSH harness may set
        // `ELECTRON_RUN_AS_NODE` (it launches its own node through Electron).
        // If that leaks into the companion, the companion Electron would run as
        // plain Node and never create a window, so strip it here.
        ], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: (() => {
            const env = { ...process.env }
            delete env.ELECTRON_RUN_AS_NODE
            return env
          })(),
        })

        const previous = petProcess
        petProcess = spawned
        hostLog(`spawning companion: ${executable} via ${companionScriptPath()}`)
        spawned.stderr?.on('data', (chunk) => hostLog(`[stderr] ${String(chunk).trimEnd()}`))
        spawned.once('error', (error) => {
          hostLog(`companion spawn error: ${error.message}`)
          if (petProcess === spawned) petProcess = undefined
        })
        spawned.once('exit', (code, signal) => {
          hostLog(`companion exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
          if (petProcess === spawned) petProcess = undefined
        })
        if (previous !== undefined && previous.exitCode === null) previous.kill()

        // Only report "available" after the window actually loads. If the
        // discovered Electron cannot run the companion (e.g. it is the hosting
        // app's own exe) the process exits before READY; we then kill it and let
        // the client keep the page-internal pet, so the pet never vanishes.
        const ready = await waitForCompanionReadiness(spawned, COMPANION_READY_TIMEOUT_MS)
        if (!ready) {
          close()
          return ok({ available: false, visible: false, reason: 'companion-not-ready' })
        }
        return ok({ available: true, visible: true })
      } catch (error) {
        close()
        return failure('desktop-pet-failed', error)
      }
    }

    const dispatch = async (endpoint: string, payload: unknown): Promise<RpcResult> => {
      if (endpoint === 'focus-client') {
        close()
        return ok({ available: true, visible: false })
      }
      if (endpoint === 'hide') {
        close()
        return ok({ available: true, visible: false })
      }
      if (endpoint === 'probe') {
        const config = configSource()
        return ok({
          available: resolveCompanionExecutable(config.companionElectronPath) !== undefined,
          visible: petProcess !== undefined && petProcess.exitCode === null,
        })
      }
      if (endpoint !== 'show') return failure('unknown-endpoint')

      // DSH's client re-runs its sync effect on mount and on config/visibility
      // changes, so two `show` RPCs can land back to back. Spawning a companion
      // per call and killing the still-loading one with `previous.kill()` meant
      // the very first click often opened nothing (the pet had to be toggled
      // off and on). Reuse the in-flight show until it settles instead.
      if (showInFlight) return showInFlight
      showInFlight = runShow(payload).finally(() => { showInFlight = undefined })
      return showInFlight
    }

    scoped.effect(
      () => connection.rpc.handle(CHANNEL, dispatch, { authority: 'loopback' }),
      'dsh-live2d-avatar: optional desktop pet rpc',
    )
    scoped.effect(() => close, 'dsh-live2d-avatar: optional desktop pet window')
  })
}
