import { afterEach, describe, expect, it, vi } from 'vitest'
import { responseErrorMessage, sanitizeSpeechText, synthesizeSpeechStream, takeSentenceChunks, takeSentences, voiceEmotion } from '../src/client/voice/modeldeck-client.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'

afterEach(() => vi.unstubAllGlobals())

describe('ModelDeck client projection', () => {
  it('never sends Live2D protocol fragments to speech synthesis', () => {
    expect(sanitizeSpeechText('<!--live2d:fun:normal-->你好呀。')).toBe('你好呀。')
    expect(sanitizeSpeechText('--live2d:fun:normal-->你好呀。')).toBe('你好呀。')
    expect(sanitizeSpeechText('<!')).toBe('')
  })

  it('queues only complete sentences during streaming', () => {
    expect(takeSentences('第一句。第二句还没说完')).toEqual({ sentences: ['第一句。'], consumed: 4 })
    expect(takeSentences('第二句还没说完', true)).toEqual({ sentences: ['第二句还没说完'], consumed: 7 })
  })

  it('maps Live2D emotions to deployed Megumi voice styles', () => {
    expect(voiceEmotion('fun')).toBe('playful')
    expect(voiceEmotion('sad')).toBe('soft')
    expect(voiceEmotion('surprise')).toBe('neutral')
  })

  it('can pre-generate only a sufficiently long first comma phrase', () => {
    expect(takeSentenceChunks('这是一段足够长的开场白，可以先说', false, true)).toMatchObject({
      chunks: [{ text: '这是一段足够长的开场白，' }],
      consumed: 12,
    })
    expect(takeSentenceChunks('太短了，后面', false, true).chunks).toEqual([])
  })

  it('preserves useful ModelDeck and FastAPI error details', async () => {
    expect(await responseErrorMessage(new Response(JSON.stringify({ error: { message: '网关未启动' } }), { status: 502 }))).toBe('网关未启动')
    expect(await responseErrorMessage(new Response(JSON.stringify({ detail: '音频格式错误' }), { status: 500 }))).toBe('音频格式错误')
    expect(await responseErrorMessage(new Response('upstream reset', { status: 502 }))).toBe('upstream reset')
  })

  it('passes the selected TTS voice, language and speed to ModelDeck', async () => {
    let sent: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/tts')) {
        sent = JSON.parse(String(init.body)) as Record<string, unknown>
        return new Response(new Uint8Array([0, 0]), { status: 200 })
      }
      return new Response(null, { status: 204 })
    })
    await synthesizeSpeechStream('测试', 'neutral', {
      ...DEFAULT_CONFIG,
      ttsVoice: 'cc_latest',
      ttsLanguage: 'ja',
      ttsSpeed: 0.9,
    }, new AbortController().signal)
    expect(sent).toMatchObject({ voice: 'cc_latest', language: 'ja', speed: 0.9, stream: true, response_format: 'raw' })
  })
})
