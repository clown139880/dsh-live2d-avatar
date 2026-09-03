import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HeroineConfig } from '../shared/config.ts'

export const VOICE_API_PREFIX = '/avatar/api'
const MAX_REQUEST_BYTES = 128 * 1024 * 1024

type ProxyTarget = 'health' | 'capabilities' | 'voices' | 'asr' | 'tts'

interface VoiceLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

const TARGETS: Record<string, ProxyTarget> = {
  [`${VOICE_API_PREFIX}/health`]: 'health',
  [`${VOICE_API_PREFIX}/capabilities`]: 'capabilities',
  [`${VOICE_API_PREFIX}/voices`]: 'voices',
  [`${VOICE_API_PREFIX}/asr`]: 'asr',
  [`${VOICE_API_PREFIX}/tts`]: 'tts',
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(data.byteLength),
    'cache-control': 'no-store',
  })
  res.end(data)
}

function trimBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function validatedBaseUrl(value: string): string {
  const raw = trimBaseUrl(value)
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('only http(s) URLs are supported')
  if (url.username || url.password) throw new TypeError('credentials must not be embedded in the URL')
  return raw
}

function configuredBaseUrl(target: ProxyTarget, config: HeroineConfig): string {
  if (target === 'asr') return config.asrBaseUrl
  if (target === 'tts' || target === 'voices') return config.ttsBaseUrl || config.asrBaseUrl
  if (target === 'capabilities') return config.asrBaseUrl || config.ttsBaseUrl
  return config.asrEnabled ? config.asrBaseUrl : config.ttsBaseUrl
}

function targetUrl(target: ProxyTarget, config: HeroineConfig): string {
  const base = validatedBaseUrl(configuredBaseUrl(target, config))
  if (target === 'asr') return `${base}/v1/audio/transcriptions`
  if (target === 'tts') return `${base}/v1/audio/speech`
  if (target === 'capabilities') return `${base}/v1/audio/capabilities`
  if (target === 'voices') return `${base}/v1/audio/voices`
  return `${base}/health`
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    total += chunk.byteLength
    if (total > MAX_REQUEST_BYTES) throw new RangeError('request body exceeds 128 MiB')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, total)
}

function copyResponseHeaders(upstream: Response, res: ServerResponse): void {
  for (const name of ['content-type', 'content-length', 'content-disposition', 'x-request-id', 'x-model-warm', 'x-voice-model', 'x-voice-emotion', 'x-asr-model', 'retry-after']) {
    const value = upstream.headers.get(name)
    if (value) res.setHeader(name, value)
  }
  res.setHeader('cache-control', 'no-store')
}

function unavailableMessage(error: unknown): string {
  const detail = error instanceof Error && error.message && error.message !== 'fetch failed'
    ? `：${error.message}`
    : ''
  return `ModelDeck 网关不可达，请在 WSL 中确认 modeldeck gateway 已启动${detail}`
}

function requestIdOf(req: IncomingMessage): string {
  const value = req.headers['x-request-id']
  return typeof value === 'string' && value ? value : 'none'
}

async function handleClientLog(req: IncomingMessage, res: ServerResponse, logger?: VoiceLogger): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    json(res, 405, { error: { code: 'method_not_allowed', message: 'Use POST.' } })
    return
  }
  try {
    const body = await readBody(req)
    const payload = JSON.parse(body.toString('utf8')) as { event?: unknown; fields?: unknown }
    const event = typeof payload.event === 'string' ? payload.event.slice(0, 80) : 'unknown'
    const fields = payload.fields && typeof payload.fields === 'object' ? payload.fields : {}
    logger?.info('[voice] client event=%s data=%s', event, JSON.stringify(fields).slice(0, 2000))
    res.writeHead(204, { 'cache-control': 'no-store' })
    res.end()
  } catch (error) {
    logger?.warn('[voice] invalid client diagnostic error=%s', error instanceof Error ? error.message : String(error))
    json(res, 400, { error: { code: 'invalid_log', message: 'Invalid diagnostic event.' } })
  }
}

export async function handleModelDeckProxy(
  req: IncomingMessage,
  res: ServerResponse,
  config: HeroineConfig,
  logger?: VoiceLogger,
): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://local').pathname
  if (pathname === `${VOICE_API_PREFIX}/client-log`) {
    await handleClientLog(req, res, logger)
    return
  }
  const target = TARGETS[pathname]
  if (!target) {
    json(res, 404, { error: { code: 'not_found', message: 'Unknown Avatar voice endpoint.' } })
    return
  }

  const expectedMethod = target === 'health' || target === 'capabilities' || target === 'voices' ? 'GET' : 'POST'
  if (req.method !== expectedMethod) {
    res.setHeader('allow', expectedMethod)
    json(res, 405, { error: { code: 'method_not_allowed', message: `Use ${expectedMethod}.` } })
    return
  }
  if ((target === 'asr' && !config.asrEnabled) || (target === 'tts' && !config.ttsEnabled)) {
    json(res, 503, { error: { code: 'feature_disabled', message: `${target.toUpperCase()} is disabled.` } })
    return
  }

  const baseUrl = configuredBaseUrl(target, config)
  if (!trimBaseUrl(baseUrl)) {
    json(res, 503, { error: { code: 'not_configured', message: 'ModelDeck base URL is not configured.' } })
    return
  }
  let upstreamUrl: string
  try {
    upstreamUrl = targetUrl(target, config)
  } catch (error) {
    json(res, 503, {
      error: {
        code: 'invalid_base_url',
        message: `ModelDeck base URL is invalid: ${error instanceof Error ? error.message : String(error)}`,
      },
    })
    return
  }

  const controller = new AbortController()
  req.once('aborted', () => controller.abort())
  const headers = new Headers({ accept: req.headers.accept ?? '*/*' })
  headers.set('x-title', 'dsh-live2d-avatar')
  const requestId = req.headers['x-request-id']
  if (typeof requestId === 'string') headers.set('x-request-id', requestId)
  const contentType = req.headers['content-type']
  if (contentType) headers.set('content-type', contentType)
  const keyName = config.modelDeckApiKeyEnv.trim()
  const apiKey = keyName ? process.env[keyName] : undefined
  if (apiKey) headers.set('authorization', `Bearer ${apiKey}`)

  try {
    const body = expectedMethod === 'POST' ? new Uint8Array(await readBody(req)) : undefined
    const startedAt = performance.now()
    const id = requestIdOf(req)
    logger?.info(
      '[voice] proxy begin target=%s request_id=%s mime=%s bytes=%d',
      target,
      id,
      contentType ?? 'none',
      body?.byteLength ?? 0,
    )
    const upstream = await fetch(upstreamUrl, {
      method: expectedMethod,
      headers,
      body,
      signal: controller.signal,
    })
    if (target === 'tts' && upstream.ok && upstream.body) {
      copyResponseHeaders(upstream, res)
      res.removeHeader('content-length')
      res.statusCode = upstream.status
      const reader = upstream.body.getReader()
      let total = 0
      let firstChunkAt = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value?.byteLength) continue
        if (!firstChunkAt) {
          firstChunkAt = performance.now()
          logger?.info('[voice] proxy first-chunk target=tts request_id=%s duration_ms=%d bytes=%d', id, Math.round(firstChunkAt - startedAt), value.byteLength)
        }
        total += value.byteLength
        if (!res.write(Buffer.from(value))) await new Promise<void>((resolve) => res.once('drain', resolve))
      }
      const durationMs = Math.round(performance.now() - startedAt)
      logger?.info('[voice] proxy end target=tts request_id=%s status=%d duration_ms=%d response_bytes=%d streamed=true', id, upstream.status, durationMs, total)
      res.end()
      return
    }
    const data = Buffer.from(await upstream.arrayBuffer())
    const durationMs = Math.round(performance.now() - startedAt)
    const log = upstream.ok ? logger?.info.bind(logger) : logger?.warn.bind(logger)
    log?.(
      '[voice] proxy end target=%s request_id=%s status=%d duration_ms=%d response_bytes=%d',
      target,
      id,
      upstream.status,
      durationMs,
      data.byteLength,
    )
    copyResponseHeaders(upstream, res)
    res.statusCode = upstream.status
    if (!res.hasHeader('content-length')) res.setHeader('content-length', String(data.byteLength))
    res.end(data)
  } catch (error) {
    logger?.warn(
      '[voice] proxy failed target=%s request_id=%s error=%s',
      target,
      requestIdOf(req),
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    )
    if (res.headersSent) {
      res.destroy()
      return
    }
    const tooLarge = error instanceof RangeError
    json(res, tooLarge ? 413 : 502, {
      error: {
        code: tooLarge ? 'request_too_large' : 'modeldeck_unavailable',
        message: tooLarge ? 'request body exceeds 128 MiB' : unavailableMessage(error),
      },
    })
  }
}

export function registerModelDeckProxy(ctx: Context, configSource: () => HeroineConfig): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: VOICE_API_PREFIX,
    handler: (req, res) => handleModelDeckProxy(req, res, configSource(), ctx.logger),
  }), 'dsh-live2d-avatar: ModelDeck voice proxy')
}
