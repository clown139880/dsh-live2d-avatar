import { useEffect, useState } from 'react'
import type { HeroineConfig } from '../../shared/config.ts'
import { HeroinePet } from './HeroinePet.tsx'
import { activateHeroineStage, setPetVisible, usePetVisible } from './visibility.ts'

interface ClientConnection {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown): Promise<{
      ok: boolean
      value?: { available?: boolean }
      error?: { message: string }
    }>
  }
}

type Surface = 'detecting' | 'desktop' | 'web'
const CHANNEL = '/avatar-desktop-pet'
const SIZE_KEY = 'dsh-live2d-avatar:pet-size'

function preferredWidth(): number {
  try {
    const width = Number(localStorage.getItem(SIZE_KEY))
    return Number.isFinite(width) ? width : 300
  } catch {
    return 300
  }
}

export function AdaptiveHeroinePet({ config, connection }: { config: HeroineConfig; connection: ClientConnection }) {
  const visible = usePetVisible()
  const [surface, setSurface] = useState<Surface>('detecting')

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
        if (surface === 'desktop') await connection.rpc.call(CHANNEL, 'hide', {}).catch(() => {})
        return
      }
      try {
        const result = await connection.rpc.call(CHANNEL, 'show', {
          width: preferredWidth(),
          modelEntry: config.modelEntry,
          characterName: config.characterName,
          showPetNameplate: config.showPetNameplate,
          modelScale: config.modelScale,
          modelX: config.modelX,
          modelY: config.modelY,
        })
        const available = result.ok && result.value?.available === true
        if (!cancelled) setSurface(available ? 'desktop' : 'web')
      } catch {
        if (!cancelled) setSurface('web')
      }
    }
    void sync()
    return () => { cancelled = true }
  }, [config.characterName, config.enabled, config.modelEntry, config.modelScale, config.modelX, config.modelY, config.showPetNameplate, connection, visible])

  if (surface !== 'web') return null
  return <HeroinePet config={config} />
}
