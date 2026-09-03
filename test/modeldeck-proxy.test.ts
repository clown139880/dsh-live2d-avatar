import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { handleModelDeckProxy } from '../src/host/modeldeck-proxy.ts'
import { DEFAULT_CONFIG, type HeroineConfig } from '../src/shared/config.ts'

const servers: Server[] = []

async function listen(server: Server): Promise<string> {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server did not bind a TCP port')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  server.close()
  await once(server, 'close')
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close))
  delete process.env.AVATAR_TEST_API_KEY
})

describe('ModelDeck proxy', () => {
  it('accepts privacy-safe client timing diagnostics', async () => {
    const messages: string[] = []
    const logger = {
      info(message: string, ...args: unknown[]) { messages.push([message, ...args].join(' ')) },
      warn(message: string, ...args: unknown[]) { messages.push([message, ...args].join(' ')) },
    }
    const config = { ...DEFAULT_CONFIG }
    const proxyUrl = await listen(createServer((req, res) => handleModelDeckProxy(req, res, config, logger)))
    const response = await fetch(`${proxyUrl}/avatar/api/client-log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'recording-finished', fields: { duration_ms: 1200, bytes: 4096 } }),
    })

    expect(response.status).toBe(204)
    expect(messages.join('\n')).toContain('recording-finished')
    expect(messages.join('\n')).toContain('duration_ms')
  })

  it('forwards ASR content and adds a host-only bearer token', async () => {
    let received = { url: '', type: '', authorization: '', body: '' }
    const upstreamUrl = await listen(createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      received = {
        url: req.url ?? '',
        type: req.headers['content-type'] ?? '',
        authorization: req.headers.authorization ?? '',
        body: Buffer.concat(chunks).toString(),
      }
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end('{"text":"测试"}')
    }))

    process.env.AVATAR_TEST_API_KEY = 'secret-from-host'
    const config: HeroineConfig = {
      ...DEFAULT_CONFIG,
      asrEnabled: true,
      asrBaseUrl: upstreamUrl,
      modelDeckApiKeyEnv: 'AVATAR_TEST_API_KEY',
    }
    const proxyUrl = await listen(createServer((req, res) => handleModelDeckProxy(req, res, config)))
    const response = await fetch(`${proxyUrl}/avatar/api/asr`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
      body: '--test\r\nhello\r\n--test--',
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ text: '测试' })
    expect(received).toEqual({
      url: '/v1/audio/transcriptions',
      type: 'multipart/form-data; boundary=test',
      authorization: 'Bearer secret-from-host',
      body: '--test\r\nhello\r\n--test--',
    })
  })

  it('rejects a disabled feature before contacting ModelDeck', async () => {
    const config = { ...DEFAULT_CONFIG, ttsEnabled: false }
    const proxyUrl = await listen(createServer((req, res) => handleModelDeckProxy(req, res, config)))
    const response = await fetch(`${proxyUrl}/avatar/api/tts`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'feature_disabled' } })
  })

  it('forwards TTS chunks without buffering the whole response', async () => {
    const upstreamUrl = await listen(createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.write(Buffer.from([1, 2]))
      setTimeout(() => res.end(Buffer.from([3, 4])), 120)
    }))
    const config = { ...DEFAULT_CONFIG, ttsEnabled: true, ttsBaseUrl: upstreamUrl }
    const proxyUrl = await listen(createServer((req, res) => handleModelDeckProxy(req, res, config)))
    const response = await fetch(`${proxyUrl}/avatar/api/tts`, { method: 'POST', body: '{}' })
    const reader = response.body!.getReader()
    const first = await reader.read()

    expect(first.done).toBe(false)
    expect([...first.value!]).toEqual([1, 2])
    const rest = await reader.read()
    expect([...rest.value!]).toEqual([3, 4])
  })

  it('returns an actionable error when the ModelDeck gateway is unreachable', async () => {
    const config = { ...DEFAULT_CONFIG, asrEnabled: true, asrBaseUrl: 'http://127.0.0.1:1' }
    const proxyUrl = await listen(createServer((req, res) => handleModelDeckProxy(req, res, config)))
    const response = await fetch(`${proxyUrl}/avatar/api/asr`, { method: 'POST', body: 'test' })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'modeldeck_unavailable',
        message: expect.stringContaining('WSL'),
      },
    })
  })

  it('rejects unsafe base URLs before sending a host request or bearer token', async () => {
    process.env.AVATAR_TEST_API_KEY = 'must-not-leak'
    const config = {
      ...DEFAULT_CONFIG,
      asrEnabled: true,
      asrBaseUrl: 'http://user:password@127.0.0.1:4000',
      modelDeckApiKeyEnv: 'AVATAR_TEST_API_KEY',
    }
    const proxyUrl = await listen(createServer((req, res) => handleModelDeckProxy(req, res, config)))
    const response = await fetch(`${proxyUrl}/avatar/api/asr`, { method: 'POST', body: 'test' })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_base_url' } })
  })
})
