/**
 * Minimal `electron` ambient declarations for the standalone companion main.
 *
 * The companion is launched by the DSH host as a *separate* Electron process,
 * so these types exist only to type-check `src/companion/main.ts` without a
 * real `electron` package installed as a workspace dependency. At runtime the
 * file is executed by Electron, which provides the actual `electron` module.
 *
 * Because the host runs inside a DSH Desktop utility process (where
 * `BrowserWindow` is unavailable), the companion is the only way the Live2D
 * pet can render in its own transparent, always-on-top window.
 *
 * Only the surface actually used by `main.ts` is declared.
 */
declare module 'electron' {
  export interface WebRequestFilter {
    urls: string[]
  }
  export interface WebRequestDetails {
    requestHeaders?: Record<string, string>
    url?: string
  }
  export interface WebRequestCallback {
    (opts: { requestHeaders: Record<string, string> }): void
  }
  export interface Session {
    webRequest: {
      onBeforeSendHeaders(filter: WebRequestFilter, listener: (details: WebRequestDetails, callback: WebRequestCallback) => void): void
    }
  }
  export interface WebContents {
    getURL(): string
    loadURL(url: string): Promise<void>
    setWindowOpenHandler(handler: () => { action: 'deny' }): void
    on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): void
    once(event: 'did-finish-load', listener: () => void): void
    once(event: 'did-fail-load', listener: (event: { preventDefault(): void }, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void): void
    session: Session
  }
  export interface BrowserWindowInstance {
    webContents: WebContents
    show(): void
    focus(): void
    setBounds(bounds: { width: number; height: number; x?: number; y?: number }): void
    on(event: 'closed', listener: () => void): void
    once(event: 'ready-to-show', listener: () => void): void
    close(): void
    isDestroyed(): boolean
  }
  export const BrowserWindow: {
    new(options: Record<string, unknown>): BrowserWindowInstance
  }
  export const app: {
    setPath(name: string, path: string): void
    getPath(name: string): string
    whenReady(): Promise<void>
    quit(): void
    on(event: 'window-all-closed', listener: () => void): void
  }
}
