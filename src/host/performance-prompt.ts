import type { Context } from '@deepseek-ai/cordis'
import type { HeroineConfig } from '../shared/config.ts'
import { PERFORMANCE_PROMPT_CHANNEL } from '../shared/config.ts'

export const LIVE2D_PERFORMANCE_PROMPT = `## Live2D performance control
Your response is performed by a Live2D character. You control its expression and complete body performance explicitly by inserting hidden directives immediately before the words they apply to.

Directive syntax: <!--live2d:EXPRESSION:MOTION-->

Available expressions: neutral, down, angry, fun, sad, surprise.
Available motions: none, fast, normal, slow, idle-1, idle-2, idle-3.

Choose directives from the meaning, tone, and intended performance of your own response. Begin every user-facing response with an appropriate directive. Insert another directive only when the emotional delivery genuinely changes. Prefer neutral over an unjustified emotion. Do not describe, quote, escape, or place directives inside code fences. The directives are control data and are invisible in the character stage.

Examples:
<!--live2d:neutral:none-->我先检查一下具体情况。
<!--live2d:surprise:fast-->居然还有这种情况？<!--live2d:fun:normal-->不过已经解决了。
<!--live2d:sad:slow-->很遗憾，这次没能成功。`

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

interface PromptAssemblyContext { scope?: object }
interface SystemPromptService {
  section(input: { name: string; order: number; text: string | ((context: PromptAssemblyContext) => string) }): () => void
}

export function sessionIdFromScope(scope: object | undefined): string | undefined {
  if (!scope || !('id' in scope)) return undefined
  const id = (scope as { id?: unknown }).id
  return typeof id === 'string' && id ? id : undefined
}

export function performancePromptEnabled(
  scope: object | undefined,
  globalDefault: boolean,
  overrides: ReadonlyMap<string, boolean>,
): boolean {
  const sessionId = sessionIdFromScope(scope)
  if (sessionId !== undefined && overrides.has(sessionId)) return overrides.get(sessionId) === true
  return globalDefault
}

function requestedSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const id = (payload as { sessionId?: unknown }).sessionId
  return typeof id === 'string' && id.length > 0 && id.length <= 512 ? id : undefined
}

export function registerPerformancePrompt(ctx: Context, configSource: () => HeroineConfig): void {
  const overrides = new Map<string, boolean>()
  const enabledFor = (sessionId: string | undefined): boolean => {
    const scope = sessionId === undefined ? undefined : { id: sessionId }
    return performancePromptEnabled(scope, configSource().llmControlEnabled, overrides)
  }

  const systemPrompt = ctx.get('systemPrompt') as SystemPromptService
  ctx.effect(() => systemPrompt.section({
    name: 'heroine:live2d-control',
    order: 80,
    text: ({ scope }) => performancePromptEnabled(scope, configSource().llmControlEnabled, overrides) ? LIVE2D_PERFORMANCE_PROMPT : '',
  }), 'dsh-live2d-avatar: consent-aware performance prompt')

  ctx.inject(['connection'], (scoped) => {
    const connection = (scoped as unknown as { connection: HostConnection }).connection
    const dispatch = async (endpoint: string, payload: unknown): Promise<RpcResult> => {
      const sessionId = requestedSessionId(payload)
      if (sessionId === undefined) {
        return { ok: false, error: { code: 'invalid-session', message: 'A valid sessionId is required.', details: {} } }
      }
      if (endpoint === 'get') {
        return { ok: true, value: {
          enabled: enabledFor(sessionId),
          overridden: overrides.has(sessionId),
          globalDefault: configSource().llmControlEnabled,
        } }
      }
      if (endpoint === 'set') {
        const enabled = (payload as { enabled?: unknown }).enabled
        if (typeof enabled !== 'boolean') {
          return { ok: false, error: { code: 'invalid-enabled', message: 'enabled must be a boolean.', details: {} } }
        }
        overrides.set(sessionId, enabled)
        return { ok: true, value: { enabled, overridden: true, globalDefault: configSource().llmControlEnabled } }
      }
      if (endpoint === 'reset') {
        overrides.delete(sessionId)
        return { ok: true, value: {
          enabled: enabledFor(sessionId),
          overridden: false,
          globalDefault: configSource().llmControlEnabled,
        } }
      }
      return { ok: false, error: { code: 'unknown-endpoint', message: 'Unknown performance prompt endpoint.', details: {} } }
    }

    scoped.effect(
      () => connection.rpc.handle(PERFORMANCE_PROMPT_CHANNEL, dispatch, { authority: 'loopback' }),
      'dsh-live2d-avatar: performance prompt consent RPC',
    )
  })
}
