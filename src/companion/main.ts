/**
 * Standalone Electron main for the desktop Live2D pet.
 *
 * The DSH host runs inside a Desktop `utilityProcess`, where `BrowserWindow`
 * is unavailable. This file is therefore launched by the host as its own
 * Electron main process (separate from the hosting DSH app) and is the only
 * place that can create the transparent, always-on-top pet window.
 *
 * Launch contract (argv, produced by `companionArgv` in `src/host/desktop-pet.ts`):
 *   <electron> <this-file> --pet-url=<url> --width=<n> --height=<n>
 *     [--x=<n>] [--y=<n>]
 *     [--renderer-header-name=<n>] [--renderer-header-value=<v>] [--carrier-origin=<o>]
 *
 * The window loads `/avatar/pet` from the DSH web server (via `--pet-url`).
 * `--carrier-origin` plus the renderer header let this window declare itself
 * as renderer traffic so the Desktop WebServer fence does not 403 it.
 */
import { app, BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MIN_WIDTH = 180
const MAX_WIDTH = 480
const RATIO = 250 / 180
const PET_PATHNAME = '/avatar/pet'
const USER_DATA_SUBDIR = 'dsh-live2d-avatar-pet'
const READY_MARKER = '__DSH_PET_READY__'
const FAIL_MARKER = '__DSH_PET_FAIL__'

// Keep the companion's storage in the standard roaming app-data dir instead of
// TEMP. The DSH session scopes TEMP to a locked temp dir, and Chromium's network
// sandbox cannot grant access to a cache created there, which makes the window
// fail to come up. Roaming is writable and sandbox-friendly.
const APP_DATA_ROOT = join(app.getPath('appData'), USER_DATA_SUBDIR)
const LOG_PATH = join(APP_DATA_ROOT, 'companion.log')

function log(message: string): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`)
  } catch { /* non-fatal */ }
}

process.on('uncaughtException', (error) => log(`uncaughtException: ${error instanceof Error ? error.stack : String(error)}`))
process.on('unhandledRejection', (error) => log(`unhandledRejection: ${String(error)}`))

function emit(marker: string): void {
  process.stdout.write(`${marker}\n`)
}

interface Launch {
  petUrl: string
  width: number
  height: number
  x?: number
  y?: number
  rendererHeaderName?: string
  rendererHeaderValue?: string
  carrierOrigin?: string
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const argument = process.argv.find((value) => value.startsWith(prefix))
  return argument === undefined ? undefined : argument.slice(prefix.length)
}

function finiteNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = readArg(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

function parseLaunch(): Launch {
  return {
    petUrl: readArg('pet-url') ?? '',
    width: finiteNumber('width', 300, MIN_WIDTH, MAX_WIDTH),
    height: finiteNumber('height', Math.round(300 * RATIO), Math.round(MIN_WIDTH * RATIO), Math.round(MAX_WIDTH * RATIO)),
    x: readArg('x') === undefined ? undefined : Number(readArg('x')),
    y: readArg('y') === undefined ? undefined : Number(readArg('y')),
    rendererHeaderName: readArg('renderer-header-name'),
    rendererHeaderValue: readArg('renderer-header-value'),
    carrierOrigin: readArg('carrier-origin'),
  }
}

/** Pair an `http(s):` origin with its `ws(s):` counterpart for the carrier fence. */
function pairedWebSocketOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:') url.protocol = 'ws:'
    else if (url.protocol === 'https:') url.protocol = 'wss:'
    else return undefined
    return url.origin
  } catch {
    return undefined
  }
}

function createWindow(launch: Launch): void {
  const window = new BrowserWindow({
    width: launch.width,
    height: launch.height,
    ...(launch.x !== undefined && Number.isFinite(launch.x) ? { x: Math.round(launch.x) } : {}),
    ...(launch.y !== undefined && Number.isFinite(launch.y) ? { y: Math.round(launch.y) } : {}),
    minWidth: MIN_WIDTH,
    minHeight: Math.round(MIN_WIDTH * RATIO),
    maxWidth: MAX_WIDTH,
    maxHeight: Math.round(MAX_WIDTH * RATIO),
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    title: 'Avatar Pet',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    try {
      const destination = new URL(target)
      const origin = new URL(launch.petUrl).origin
      if (destination.origin !== origin || destination.pathname !== PET_PATHNAME) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })

  if (launch.rendererHeaderName && launch.rendererHeaderValue && launch.carrierOrigin) {
    const headerName = launch.rendererHeaderName
    const headerValue = launch.rendererHeaderValue
    const carrierOrigin = launch.carrierOrigin
    const wsOrigin = pairedWebSocketOrigin(carrierOrigin)
    const headerNameLower = headerName.toLowerCase()
    const session = window.webContents.session
    session.webRequest.onBeforeSendHeaders(
      { urls: ['<all_urls>'] },
      (details, callback) => {
        const requestHeaders: Record<string, string> = { ...(details.requestHeaders ?? {}) }
        for (const key of Object.keys(requestHeaders)) {
          if (key.toLowerCase() === headerNameLower) delete requestHeaders[key]
        }
        try {
          const origin = new URL(details.url ?? '').origin
          if (origin === carrierOrigin || origin === wsOrigin) requestHeaders[headerName] = headerValue
        } catch { /* ignore malformed URL */ }
        callback({ requestHeaders })
      },
    )
  }

  window.on('closed', () => app.quit())
  window.once('ready-to-show', () => window.show())
  log(`window created for ${launch.petUrl}`)
  // Signal the host only once the pet page has actually loaded and the window
  // is shown, so the host does not report "available" for a window that never
  // rendered (which would detach the in-page pet and leave nothing on screen).
  window.webContents.once('did-finish-load', () => {
    window.show()
    log('pet page loaded, emitting READY')
    emit(READY_MARKER)
  })
  window.webContents.once('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) {
      log(`main frame failed to load: code=${code} desc=${description} url=${url}`)
      emit(FAIL_MARKER)
    }
  })
  void window.webContents.loadURL(launch.petUrl).catch((error) => {
    log(`loadURL rejected: ${error instanceof Error ? error.message : String(error)}`)
    emit(FAIL_MARKER)
  })
}

// Keep storage in the standard roaming app-data dir (see APP_DATA_ROOT note).
try {
  app.setPath('userData', APP_DATA_ROOT)
} catch { /* keep Electron defaults */ }

app.whenReady().then(() => {
  const launch = parseLaunch()
  if (!launch.petUrl) {
    emit(FAIL_MARKER)
    app.quit()
    return
  }
  createWindow(launch)
})

app.on('window-all-closed', () => app.quit())
