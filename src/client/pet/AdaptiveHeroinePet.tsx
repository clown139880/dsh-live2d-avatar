import { useEffect, useRef, useState } from 'react'
import type { HeroineConfig } from '../../shared/config.ts'
import { HeroinePet } from './HeroinePet.tsx'
import { activateHeroineStage, setPetVisible, usePetVisible } from './visibility.ts'

interface ClientConnection {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown): Promise<{
      ok: boolean
      value?: { available?: boolean; visible?: boolean; enabled?: boolean; reason?: string; event?: string; eventSeq?: number }
      error?: { message: string }
    }>
  }
}

type Surface = 'detecting' | 'desktop' | 'web'
const CHANNEL = '/avatar-desktop-pet'
// Re-open the desktop pet while the host RPC is still starting up. A single loss
// here used to fall back to the page-internal pet, so on app launch the user had
// to re-click "桌宠". We settle on `web` only after these attempts or a
// definitive agent failure.
const MAX_SHOW_ATTEMPTS = 6

export function AdaptiveHeroinePet({ config, connection }: { config: HeroineConfig; connection: ClientConnection }) {
  const visible = usePetVisible()
  const [restored, setRestored] = useState(false)
  const [surface, setSurface] = useState<Surface>('detecting')
  const surfaceRef = useRef<Surface>('detecting')
  useEffect(() => {
    surfaceRef.current = surface
  }, [surface])

  useEffect(() => {
    let cancelled = false
    const restore = async (): Promise<void> => {
      for (let attempt = 0; attempt < MAX_SHOW_ATTEMPTS; attempt += 1) {
        try {
          const result = await connection.rpc.call(CHANNEL, 'probe', {})
          if (result.ok) {
            if (!cancelled) {
              if (typeof result.value?.enabled === 'boolean') setPetVisible(result.value.enabled)
              setRestored(true)
            }
            return
          }
        } catch { /* host may still be starting */ }
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
      }
      if (!cancelled) setRestored(true)
    }
    void restore()
    return () => { cancelled = true }
  }, [connection])

  useEffect(() => {
    let lastSeq = 0
    const timer = setInterval(() => {
      if (surfaceRef.current !== 'desktop') return
      void connection.rpc.call(CHANNEL, 'probe', {}).then((result) => {
        const value = result.value
        if (!result.ok || !value) return
        if (value.enabled === false && visible) setPetVisible(false)
        if (visible && value.visible === false && value.event !== 'closed' && value.event !== 'return-stage') setSurface('web')
        const seq = value.eventSeq ?? 0
        if (seq <= lastSeq) return
        lastSeq = seq
        if (value.event === 'closed') setPetVisible(false)
        if (value.event === 'return-stage') {
          activateHeroineStage()
          void connection.rpc.call(CHANNEL, 'focus-client', {}).catch(() => {})
        }
      }).catch(() => {})
    }, 500)
    return () => clearInterval(timer)
  }, [connection, visible])

  useEffect(() => {
    let cancelled = false
    const sync = async (): Promise<void> => {
      if (!restored) return
      if (!visible || !config.enabled) {
        await connection.rpc.call(CHANNEL, 'hide', {}).catch(() => {})
        return
      }
      for (let attempt = 0; attempt < MAX_SHOW_ATTEMPTS; attempt += 1) {
        if (cancelled) return
        try {
          const result = await connection.rpc.call(CHANNEL, 'show', {
            origin: window.location.origin,
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
          if (!cancelled) {
            setSurface(available ? 'desktop' : 'web')
          }
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
  }, [config.characterName, config.enabled, config.modelEntry, config.modelScale, config.modelX, config.modelY, config.showPetNameplate, connection, restored, visible])

  if (surface !== 'web') return null
  return (
    <HeroinePet config={config} />
  )
}
