import type { Context } from '@deepseek-ai/cordis'
import type { HeroineConfig } from '../shared/config.ts'

const CHANNEL = '/avatar-desktop-pet'
const PET_PATH = '/avatar/pet'

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

interface NativeWindow {
  isDestroyed(): boolean
  loadURL(url: string): Promise<void>
  show(): void
  focus(): void
  isMinimized(): boolean
  restore(): void
  close(): void
  webContents: {
    getURL(): string
    setWindowOpenHandler(handler: () => { action: 'deny' }): void
    on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): void
  }
}

interface ElectronApi {
  BrowserWindow: {
    new(options: Record<string, unknown>): NativeWindow
    getFocusedWindow(): NativeWindow | null
    getAllWindows(): NativeWindow[]
  }
}

type PetPresentation = Pick<HeroineConfig,
  'modelEntry' | 'characterName' | 'showPetNameplate' | 'modelScale' | 'modelX' | 'modelY'
>

function failure(code: string, error?: unknown): RpcResult {
  const detail = error instanceof Error ? error.message : error === undefined ? code : String(error)
  return { ok: false, error: { code, message: detail, details: {} } }
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

/** Optional TokensCowork adapter. All Electron access stays behind runtime detection. */
export function registerDesktopPet(ctx: Context, configSource: () => HeroineConfig): void {
  ctx.inject(['connection'], (scoped) => {
    const connection = (scoped as unknown as { connection: HostConnection }).connection
    let electronPromise: Promise<ElectronApi> | undefined
    let petWindow: NativeWindow | undefined
    let clientWindow: NativeWindow | undefined

    const electron = async (): Promise<ElectronApi> => {
      if (electronPromise === undefined) {
        const moduleName = 'electron'
        electronPromise = import(moduleName).then((value) => value as unknown as ElectronApi)
      }
      return electronPromise
    }

    const close = (): void => {
      const current = petWindow
      petWindow = undefined
      if (current !== undefined && !current.isDestroyed()) current.close()
    }

    const dispatch = async (endpoint: string, payload: unknown): Promise<RpcResult> => {
      if (endpoint === 'focus-client') {
        close()
        if (clientWindow !== undefined && !clientWindow.isDestroyed()) {
          if (clientWindow.isMinimized()) clientWindow.restore()
          clientWindow.show()
          clientWindow.focus()
        }
        return { ok: true, value: { available: true, visible: false } }
      }
      if (endpoint === 'hide') {
        close()
        return { ok: true, value: { available: true, visible: false } }
      }

      let api: ElectronApi
      try {
        api = await electron()
      } catch {
        // This is the normal path under `dsh web`: lack of Electron is not an error.
        return { ok: true, value: { available: false, visible: false } }
      }

      if (endpoint === 'probe') {
        return { ok: true, value: { available: true, visible: petWindow !== undefined && !petWindow.isDestroyed() } }
      }
      if (endpoint !== 'show') return failure('unknown-endpoint')

      try {
        const parent = api.BrowserWindow.getFocusedWindow()
          ?? api.BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
        const origin = parent === undefined || parent === null ? undefined : loopbackOrigin(parent.webContents.getURL())
        if (origin === undefined) return failure('desktop-origin-unavailable')
        if (parent !== petWindow) clientWindow = parent

        const requestedWidth = Number((payload as { width?: unknown } | null)?.width)
        const width = Number.isFinite(requestedWidth) ? Math.max(180, Math.min(480, Math.round(requestedWidth))) : 300
        const height = Math.round(width * 250 / 180)
        const url = petUrl(origin, presentationFromPayload(payload, configSource()))

        if (petWindow !== undefined && !petWindow.isDestroyed()) {
          if (petWindow.webContents.getURL() !== url) await petWindow.loadURL(url)
          petWindow.show()
          petWindow.focus()
          return { ok: true, value: { available: true, visible: true } }
        }

        const created = new api.BrowserWindow({
          width,
          height,
          minWidth: 180,
          minHeight: Math.round(180 * 250 / 180),
          maxWidth: 480,
          maxHeight: Math.round(480 * 250 / 180),
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
        created.webContents.on('will-navigate', (event, target) => {
          try {
            const destination = new URL(target)
            if (destination.origin !== origin || destination.pathname !== PET_PATH) event.preventDefault()
          } catch {
            event.preventDefault()
          }
        })
        created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        petWindow = created
        await created.loadURL(url)
        return { ok: true, value: { available: true, visible: true } }
      } catch (error) {
        close()
        return failure('desktop-pet-failed', error)
      }
    }

    scoped.effect(
      () => connection.rpc.handle(CHANNEL, dispatch, { authority: 'loopback' }),
      'dsh-live2d-avatar: optional desktop pet rpc',
    )
    scoped.effect(() => close, 'dsh-live2d-avatar: optional desktop pet window')
  })
}
