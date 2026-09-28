import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CONFIG, MODEL_URL_PREFIX, SETTINGS_NAMESPACE, type HeroineConfig } from './shared/config.ts'
import { registerModelDeckProxy } from './host/modeldeck-proxy.ts'
import { registerDesktopPet } from './host/desktop-pet.ts'
import { registerPerformancePrompt } from './host/performance-prompt.ts'

export const name = 'dsh-live2d-avatar'
export const inject = ['webServer', 'systemPrompt']

export interface Config extends HeroineConfig {}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(DEFAULT_CONFIG.enabled),
  modelRoot: Schema.string().default(DEFAULT_CONFIG.modelRoot),
  modelEntry: Schema.string().default(DEFAULT_CONFIG.modelEntry),
  modelScale: Schema.number().min(0.1).max(5).default(DEFAULT_CONFIG.modelScale),
  modelX: Schema.number().min(-3).max(3).default(DEFAULT_CONFIG.modelX),
  modelY: Schema.number().min(-3).max(3).default(DEFAULT_CONFIG.modelY),
  characterName: Schema.string().default(DEFAULT_CONFIG.characterName),
  showPetNameplate: Schema.boolean().default(DEFAULT_CONFIG.showPetNameplate),
  defaultMode: Schema.union(['dialogue', 'voice', 'pet']).default(DEFAULT_CONFIG.defaultMode),
  background: Schema.string().default(DEFAULT_CONFIG.background),
  showSubtitleInVoiceMode: Schema.boolean().default(DEFAULT_CONFIG.showSubtitleInVoiceMode),
  llmControlEnabled: Schema.boolean().default(DEFAULT_CONFIG.llmControlEnabled),
  asrEnabled: Schema.boolean().default(DEFAULT_CONFIG.asrEnabled),
  asrBaseUrl: Schema.string().default(DEFAULT_CONFIG.asrBaseUrl),
  asrModel: Schema.string().default(DEFAULT_CONFIG.asrModel),
  voiceInputMode: Schema.union(['push-to-talk', 'vad']).default(DEFAULT_CONFIG.voiceInputMode),
  vadThreshold: Schema.number().min(0.005).max(0.5).default(DEFAULT_CONFIG.vadThreshold),
  vadSilenceMs: Schema.number().min(300).max(5000).default(DEFAULT_CONFIG.vadSilenceMs),
  fastFirstResponse: Schema.boolean().default(DEFAULT_CONFIG.fastFirstResponse),
  modelDeckApiKeyEnv: Schema.string().default(DEFAULT_CONFIG.modelDeckApiKeyEnv),
  ttsEnabled: Schema.boolean().default(DEFAULT_CONFIG.ttsEnabled),
  ttsBaseUrl: Schema.string().default(DEFAULT_CONFIG.ttsBaseUrl),
  ttsModel: Schema.string().default(DEFAULT_CONFIG.ttsModel),
  ttsVoice: Schema.string().default(DEFAULT_CONFIG.ttsVoice),
  ttsLanguage: Schema.union(['zh', 'en', 'ja', 'ko', 'yue']).default(DEFAULT_CONFIG.ttsLanguage),
  ttsSpeed: Schema.number().min(0.5).max(2).default(DEFAULT_CONFIG.ttsSpeed),
})

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.moc': 'application/octet-stream',
  '.moc3': 'application/octet-stream',
  '.mtn': 'application/octet-stream',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.html': 'text/html; charset=utf-8',
}

const PET_PAGE = readFileSync(resolve(packageRoot(), 'assets', 'pet-page.html'), 'utf8')

function packageRoot(): string {
  return fileURLToPath(new URL('../', import.meta.url))
}

/**
 * Ship the desktop-pet setup/troubleshooting method as a runtime skill so a DSH
 * agent can load it and help a user configure the companion window. Plugins are
 * not crawled by the filesystem skill provider, so we register the skill here.
 */
function registerCompanionSkill(ctx: Context): void {
  try {
    const skills = (ctx as unknown as { skills?: { register?: (skill: Record<string, unknown>) => void } }).skills
    if (typeof skills?.register !== 'function') return
    const skillPath = resolve(packageRoot(), 'skills', 'live2d-desktop-pet', 'SKILL.md')
    const raw = readFileSync(skillPath, 'utf8')
    const body = raw.replace(/^---[\s\S]*?---\r?\n?/, '').trim()
    skills.register({
      name: 'live2d-desktop-pet',
      description: '帮助 dsh-live2d-avatar 用户启用并排查独立桌宠窗口。',
      whenToUse: '用户提到桌宠模式、桌面桌宠、没有独立窗口、页面内浮层提示或桌宠故障时。',
      body,
      content: body,
      invocation: { modelInvocable: true, userInvocable: true },
    })
    ctx.logger.info('registered skill live2d-desktop-pet')
  } catch (error) {
    ctx.logger.warn(`[dsh-live2d-avatar] companion skill not registered: ${error}`)
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.logger.info('Avatar host loaded')
  registerCompanionSkill(ctx)
  // `configSource` must be a stable closure so functions that receive it by
  // value (e.g. registerModelDeckProxy) keep observing settings updates. The
  // settings service becomes available asynchronously; reassigning a bare
  // `let` here would otherwise leave every captured reference on the original
  // (default) config, so the proxy would never see the user's base URL.
  const configRef: { current: () => Config } = { current: () => config }
  const configSource = (): Config => configRef.current()
  installSettingsSection(
    ctx,
    settingsNamespace(SETTINGS_NAMESPACE),
    Config,
    config,
    {
      setSource: (source) => { configRef.current = source },
      onChange: () => {},
    },
  )

  registerPerformancePrompt(ctx, configSource)

  const packagedModelsRoot = resolve(packageRoot(), 'assets', 'models')
  const packagedVadRoot = resolve(packageRoot(), 'assets', 'vad')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/avatar/pet',
    handler: (req, res): void => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const body = Buffer.from(PET_PAGE)
      res.writeHead(200, {
        'content-type': MIME['.html'],
        'content-length': String(body.byteLength),
        'cache-control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  }), 'dsh-live2d-avatar: desktop pet page')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/avatar/pet-window.js',
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const body = await readFile(resolve(packageRoot(), 'lib', 'pet-window.js'))
        res.writeHead(200, {
          'content-type': MIME['.js'],
          'content-length': String(body.byteLength),
          'cache-control': 'no-cache',
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    },
  }), 'dsh-live2d-avatar: desktop pet runtime')

  const vadUrlPrefix = '/avatar/vad'
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: vadUrlPrefix,
    handler: async (req, res): Promise<void> => {
      const pathname = new URL(req.url ?? '', 'http://local').pathname
      const relative = pathname.slice(vadUrlPrefix.length).replace(/^\/+/, '')
      const target = resolve(packagedVadRoot, relative)
      if ((req.method !== 'GET' && req.method !== 'HEAD') || (target !== packagedVadRoot && !target.startsWith(packagedVadRoot + sep))) {
        res.writeHead(req.method === 'GET' || req.method === 'HEAD' ? 403 : 405)
        res.end()
        return
      }
      try {
        const body = await readFile(target)
        res.writeHead(200, {
          'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
          'content-length': String(body.byteLength),
          'cache-control': 'public, max-age=86400',
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    },
  }), 'dsh-live2d-avatar: browser VAD assets')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: MODEL_URL_PREFIX,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }

      const pathname = new URL(req.url ?? '', 'http://local').pathname
      let relative = pathname.startsWith(MODEL_URL_PREFIX)
        ? pathname.slice(MODEL_URL_PREFIX.length)
        : pathname
      try { relative = decodeURIComponent(relative) } catch { /* malformed path */ }
      relative = relative.replace(/^\/+/, '')
      const configuredRoot = configSource().modelRoot.trim()
      const modelsRoot = configuredRoot ? resolve(configuredRoot) : packagedModelsRoot
      const target = resolve(modelsRoot, relative)
      if (target !== modelsRoot && !target.startsWith(modelsRoot + sep)) {
        res.writeHead(403)
        res.end()
        return
      }

      try {
        const body = await readFile(target)
        res.writeHead(200, {
          'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
          'content-length': String(body.byteLength),
          'cache-control': 'no-cache',
        })
        if (req.method === 'HEAD') res.end()
        else res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    },
  }), 'dsh-live2d-avatar: model assets')

  registerModelDeckProxy(ctx, configSource)
  registerDesktopPet(ctx, configSource)
}
