import { createElement, useSyncExternalStore } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_CONFIG, PERFORMANCE_PROMPT_CHANNEL, SETTINGS_NAMESPACE, type HeroineConfig } from '../shared/config.ts'
import { HeroineStage } from './stage/HeroineStage.tsx'
import { STAGE_CSS } from './stage/styles.ts'
import { HeroineSettings } from './settings/HeroineSettings.tsx'
import { AdaptiveHeroinePet } from './pet/AdaptiveHeroinePet.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

export const name = 'dsh-live2d-avatar-client'
export const inject = ['slots', 'settingsScope', 'connection', 'remote']

function useHeroineConfig(scope: SettingsScope<HeroineConfig>): HeroineConfig {
  const snapshot = useSyncExternalStore(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  return snapshot.status === 'ready' && snapshot.value
    ? { ...DEFAULT_CONFIG, ...snapshot.value }
    : { ...DEFAULT_CONFIG }
}

export function apply(ctx: ClientContext): void {
  const scope: SettingsScope<HeroineConfig> = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE })
  const connection = (ctx as unknown as { connection: {
    rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<any> }
  } }).connection
  const promptConsent = {
    get: (sessionId: string) => connection.rpc.call(PERFORMANCE_PROMPT_CHANNEL, 'get', { sessionId }),
    set: (sessionId: string, enabled: boolean) => connection.rpc.call(PERFORMANCE_PROMPT_CHANNEL, 'set', { sessionId, enabled }),
  }

  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-live2d-avatar'
  style.textContent = STAGE_CSS
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'dsh-live2d-avatar: styles')

  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: 'avatar', order: 90, label: () => '形象' },
    (props) => {
      const config = useHeroineConfig(scope)
      const cancelTurn = async (): Promise<void> => {
        const scoped = ctx.sessions.scope(props.sessionId)
        if (!scoped) throw new Error(`Avatar 无法解析会话 ${props.sessionId}`)
        await scoped.conversation.cancel()
      }
      return createElement(HeroineStage, { ...props, config, cancelTurn, promptConsent })
    },
  ))

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'live2d-avatar', order: 80, label: () => '形象' },
    () => createElement(HeroineSettings, { scope }),
  ))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'live2d-avatar-pet', order: 90 },
    () => {
      const config = useHeroineConfig(scope)
      return createElement(AdaptiveHeroinePet, { config, connection: connection as Parameters<typeof AdaptiveHeroinePet>[0]['connection'] })
    },
  ))
}
