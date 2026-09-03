import type { AvatarEmotion } from '../avatar/types.ts'
import type { HeroineConfig } from '../../shared/config.ts'

export interface TranscriptionResult {
  text: string
  language?: string
  duration?: number
  emotion?: string
  events?: string[]
}

export interface SentenceBatch {
  sentences: string[]
  consumed: number
}

export interface SentenceChunk {
  text: string
  start: number
  end: number
}

const RETRYABLE = new Set([429, 502, 503, 504])

function requestId(kind: 'asr' | 'tts'): string {
  const random = Math.random().toString(36).slice(2, 9)
  return `avatar-${kind}-${Date.now().toString(36)}-${random}`
}

type DiagnosticValue = string | number | boolean | null | undefined

export function voiceDiagnostic(event: string, fields: Record<string, DiagnosticValue> = {}): void {
  try {
    void fetch('/avatar/api/client-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ event, fields }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* diagnostics must never interrupt a conversation */ }
}

export async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: { message?: string }; detail?: string }
    if (payload.error?.message) return payload.error.message
    if (payload.detail) return payload.detail
  } catch { /* use status */ }
  try {
    const body = (await response.clone().text()).trim()
    if (body) return body
  } catch { /* use status */ }
  return `ModelDeck 请求失败：${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

async function fetchWithRetry(url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  let response: Response | null = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, init)
    if (response.ok || !RETRYABLE.has(response.status) || attempt === 2) return response
    const retryAfter = Number(response.headers.get('retry-after'))
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 450 * (2 ** attempt) + Math.random() * 180
    await abortableDelay(delay, init.signal)
  }
  return response!
}

export async function transcribeAudio(audio: Blob, config: HeroineConfig, signal: AbortSignal): Promise<TranscriptionResult> {
  const id = requestId('asr')
  const startedAt = performance.now()
  const form = new FormData()
  const extension = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('wav') ? 'wav' : 'webm'
  form.append('file', audio, `utterance.${extension}`)
  form.append('model', config.asrModel)
  form.append('language', 'auto')
  form.append('response_format', 'verbose_json')
  const response = await fetchWithRetry('/avatar/api/asr', {
    method: 'POST',
    headers: { 'x-request-id': id },
    body: form,
    signal,
  })
  voiceDiagnostic('asr-response', { request_id: id, status: response.status, duration_ms: Math.round(performance.now() - startedAt), bytes: audio.size, mime: audio.type })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  const payload = await response.json() as TranscriptionResult
  if (!payload.text?.trim()) throw new Error('没有识别到有效语音。')
  return payload
}

export async function checkVoiceService(signal: AbortSignal): Promise<void> {
  let response: Response
  try {
    response = await fetch('/avatar/api/health', { signal, cache: 'no-store' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('无法连接 Avatar 语音代理，请确认 Desktop host 正常运行。')
  }
  if (!response.ok) throw new Error(`语音服务不可用：${await responseErrorMessage(response)}`)
  const payload = await response.json() as { services?: { asr?: { status?: string } } }
  if (payload.services?.asr?.status !== 'ready') throw new Error('ModelDeck ASR 尚未就绪，请检查网关和 SenseVoice 服务。')
}

export function voiceEmotion(emotion: AvatarEmotion | null): 'neutral' | 'soft' | 'playful' {
  if (emotion === 'fun') return 'playful'
  if (emotion === 'sad' || emotion === 'down') return 'soft'
  return 'neutral'
}

export function sanitizeSpeechText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!--[\s\S]*$/g, ' ')
    .replace(/(?:<!--|--)?\s*live2d\s*:(?:neutral|angry|down|fun|sad|surprise)(?::(?:none|fast|normal|slow|idle-[123]))?\s*(?:-->)?/gi, ' ')
    .replace(/<!(?:-)?$|^-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function synthesizeSpeech(
  text: string,
  emotion: 'neutral' | 'soft' | 'playful',
  config: HeroineConfig,
  signal: AbortSignal,
): Promise<Blob> {
  text = sanitizeSpeechText(text)
  if (!text) throw new Error('语音片段只包含控制标记，已跳过。')
  const id = requestId('tts')
  const startedAt = performance.now()
  const response = await fetchWithRetry('/avatar/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': id },
    body: JSON.stringify({
      model: config.ttsModel,
      voice: config.ttsVoice,
      input: text,
      emotion,
      language: config.ttsLanguage,
      response_format: 'wav',
      speed: config.ttsSpeed,
      stream: false,
    }),
    signal,
  })
  voiceDiagnostic('tts-response', { request_id: id, status: response.status, duration_ms: Math.round(performance.now() - startedAt), characters: text.length, emotion })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  const audio = await response.blob()
  if (!audio.size) throw new Error('ModelDeck 返回了空音频。')
  return audio
}

export async function synthesizeSpeechStream(
  text: string,
  emotion: 'neutral' | 'soft' | 'playful',
  config: HeroineConfig,
  signal: AbortSignal,
): Promise<Response> {
  text = sanitizeSpeechText(text)
  if (!text) throw new Error('语音片段只包含控制标记，已跳过。')
  const id = requestId('tts')
  const startedAt = performance.now()
  const response = await fetchWithRetry('/avatar/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': id },
    body: JSON.stringify({
      model: config.ttsModel,
      voice: config.ttsVoice,
      input: text,
      emotion,
      language: config.ttsLanguage,
      response_format: 'raw',
      speed: config.ttsSpeed,
      stream: true,
    }),
    signal,
  })
  voiceDiagnostic('tts-stream-headers', { request_id: id, status: response.status, duration_ms: Math.round(performance.now() - startedAt), characters: text.length, emotion })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  if (!response.body) throw new Error('浏览器不支持流式音频响应。')
  return response
}

export function takeSentences(text: string, flush = false): SentenceBatch {
  const chunks = takeSentenceChunks(text, flush)
  return { sentences: chunks.chunks.map((chunk) => chunk.text), consumed: chunks.consumed }
}

export function takeSentenceChunks(text: string, flush = false, fastFirst = false): { chunks: SentenceChunk[]; consumed: number } {
  const chunks: SentenceChunk[] = []
  const boundary = /[。！？!?；;\n]+/g
  let consumed = 0
  let match: RegExpExecArray | null
  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[0].length
    const sentence = text.slice(consumed, end).trim()
    if (sentence) chunks.push({ text: sentence, start: consumed, end })
    consumed = end
  }
  if (!chunks.length && fastFirst) {
    const comma = text.search(/[，,]/)
    if (comma >= 10) {
      const end = comma + 1
      const sentence = text.slice(0, end).trim()
      if (sentence) chunks.push({ text: sentence, start: 0, end })
      consumed = end
    }
  }
  if (flush) {
    const tail = text.slice(consumed).trim()
    if (tail) chunks.push({ text: tail, start: consumed, end: text.length })
    consumed = text.length
  }
  return { chunks, consumed }
}
