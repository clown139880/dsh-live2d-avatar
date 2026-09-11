import { useEffect, useRef, useState } from 'react'
import type { HeroineConfig } from '../../shared/config.ts'
import { HeroinePet } from './HeroinePet.tsx'
import { activateHeroineStage, setPetVisible, usePetVisible } from './visibility.ts'

interface ClientConnection {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown): Promise<{
      ok: boolean
      value?: { available?: boolean; visible?: boolean }
      error?: { message: string }
    }>
  }
}

type Surface = 'detecting' | 'desktop' | 'web'
const CHANNEL = '/avatar-desktop-pet'
const SIZE_KEY = 'dsh-live2d-avatar:desktop-pet-size'
const POSITION_KEY = 'dsh-live2d-avatar:desktop-pet-position'
// Re-open the desktop pet while the host RPC is still starting up. A single loss
// here used to fall back to the page-internal pet, so on app launch the user had
// to re-click "桌宠". We settle on `web` only after these attempts or a
// definitive "Electron unavailable".
const MAX_SHOW_ATTEMPTS = 6

function preferredBounds(): { width: number; x?: number; y?: number } {
  try {
    const width = Number(localStorage.getItem(SIZE_KEY))
    const position = JSON.parse(localStorage.getItem(POSITION_KEY) ?? '') as { x?: unknown; y?: unknown }
    return {
      width: Number.isFinite(width) ? width : 300,
      x: Number.isFinite(position.x) ? Number(position.x) : undefined,
      y: Number.isFinite(position.y) ? Number(position.y) : undefined,
    }
  } catch {
    return { width: 300 }
  }
}

export function AdaptiveHeroinePet({ config, connection }: { config: HeroineConfig; connection: ClientConnection }) {
  const visible = usePetVisible()
  const [surface, setSurface] = useState<Surface>('detecting')
  const surfaceRef = useRef<Surface>('detecting')
  useEffect(() => {
    surfaceRef.current = surface
  }, [surface])

  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('dsh-live2d-avatar:pet')
    channel?.addEventListener('message', (event) => {
      const type = (event.data as { type?: unknown } | null)?.type
      if (type === 'close') setPetVisible(false)
      if (type === 'return-stage') {
        activateHeroineStage()
        void connection.rpc.call(CHANNEL, 'focus-client', {}).catch(() => {})
      }
    })
    return () => channel?.close()
  }, [connection])

  useEffect(() => {
    let cancelled = false
    const sync = async (): Promise<void> => {
      if (!visible || !config.enabled) {
        if (surfaceRef.current === 'desktop') {
          await connection.rpc.call(CHANNEL, 'hide', {}).catch(() => {})
        }
        return
      }
      const { width, x, y } = preferredBounds()
      for (let attempt = 0; attempt < MAX_SHOW_ATTEMPTS; attempt += 1) {
        if (cancelled) return
        try {
          const result = await connection.rpc.call(CHANNEL, 'show', {
            width,
            x,
            y,
            modelEntry: config.modelEntry,
            characterName: config.characterName,
            showPetNameplate: config.showPetNameplate,
            modelScale: config.modelScale,
            modelX: config.modelX,
            modelY: config.modelY,
          })
          let available = result.ok && result.value?.available === true
          if (!available) {
            // A desktop pet window may already be open from an earlier `show`
            // (e.g. a re-`show` after a settings change). If it is still alive we
            // must NOT fall back to the in-window web pet, otherwise a duplicate
            // pet appears: one movable desktop window plus a second pet trapped
            // inside the page ("像web模式，不能移出窗口"). Keep the desktop surface.
            const probe = await connection.rpc.call(CHANNEL, 'probe', {})
            available = probe.ok
              && probe.value?.available === true
              && probe.value?.visible === true
          }
          if (!cancelled) setSurface(available ? 'desktop' : 'web')
          return
        } catch {
          if (attempt >= MAX_SHOW_ATTEMPTS - 1) {
            if (!cancelled) setSurface('web')
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
        }
      }
    }
    void sync()
    return () => {
      cancelled = true
    }
  }, [config.characterName, config.enabled, config.modelEntry, config.modelScale, config.modelX, config.modelY, config.showPetNameplate, connection, visible])

  if (surface !== 'web') return null
  return <HeroinePet config={config} />
}
