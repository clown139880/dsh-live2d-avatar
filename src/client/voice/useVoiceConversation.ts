import { useCallback, useEffect, useRef, useState } from 'react'
import type { AvatarDirective, AvatarState } from '../avatar/types.ts'
import type { DirectiveSegment } from '../stage/directive-projection.ts'
import type { HeroineConfig } from '../../shared/config.ts'
import { checkVoiceService, sanitizeSpeechText, synthesizeSpeechStream, takeSentenceChunks, transcribeAudio, voiceDiagnostic, voiceEmotion } from './modeldeck-client.ts'
import { PcmStreamPlayer } from './pcm-stream-player.ts'
import { containsHumanSpeech, MicVAD, VAD_ASSET_PREFIX } from './silero-vad.ts'

interface InputActions {
  setDraft(text: string): void
  submit(): void
}

interface VoiceOptions {
  active: boolean
  assistantText: string
  segments: DirectiveSegment[]
  avatarState: AvatarState
  config: HeroineConfig
  inputActions: InputActions
  cancelTurn(): Promise<void>
  onDirective(directive: AvatarDirective | null): void
  onLipSync(value: number): void
}

export type VoicePhase = 'idle' | 'recording' | 'transcribing' | 'synthesizing' | 'playing' | 'error'

interface QueueItem {
  text: string
  emotion: 'neutral' | 'soft' | 'playful'
  directive: AvatarDirective | null
  prepared?: Promise<{ audio?: Uint8Array; error?: unknown }>
}

const VAD_MAX_RECORDING_MS = 30_000
const VAD_MIN_SPEECH_MS = 240
const BARGE_IN_WARMUP_MS = 450
const BARGE_IN_SPEECH_MS = 280
const AUDIO_INPUT_KEY = 'dsh-live2d-avatar:audio-input:v1'
const VAD_THRESHOLD_KEY = 'dsh-live2d-avatar:vad-threshold:v1'

export interface AudioInputChoice {
  deviceId: string
  label: string
}

function storedValue(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}

export function useVoiceConversation(options: VoiceOptions) {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [message, setMessage] = useState('')
  const [continuous, setContinuous] = useState(false)
  const [audioInputs, setAudioInputs] = useState<AudioInputChoice[]>([])
  const [audioInputId, setAudioInputIdState] = useState(() => storedValue(AUDIO_INPUT_KEY))
  const [inputLevel, setInputLevel] = useState(0)
  const [vadThreshold, setVadThresholdState] = useState(() => {
    const stored = Number(storedValue(VAD_THRESHOLD_KEY))
    return Number.isFinite(stored) && stored >= 0.005 && stored <= 0.5 ? stored : options.config.vadThreshold
  })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const discardRecordingRef = useRef(false)
  const requestRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef('')
  const audioContextRef = useRef<AudioContext | null>(null)
  const pcmPlayerRef = useRef<PcmStreamPlayer | null>(null)
  const ttsControllersRef = useRef(new Set<AbortController>())
  const canPrefetchRef = useRef(false)
  const lipFrameRef = useRef<number | null>(null)
  const vadCleanupRef = useRef<(() => void) | null>(null)
  const bargeCleanupRef = useRef<(() => void) | null>(null)
  const bargeEpochRef = useRef(0)
  const queueRef = useRef<QueueItem[]>([])
  const pumpingRef = useRef(false)
  const playbackEpochRef = useRef(0)
  const turnActiveRef = useRef(false)
  const spokenOffsetRef = useRef(0)
  const continuousRef = useRef(false)
  const startRecordingRef = useRef<(automatic?: boolean) => Promise<void>>(async () => {})
  const optionsRef = useRef(options)
  const turnStartedAtRef = useRef(0)
  const firstTextLoggedRef = useRef(false)
  const previousAssistantTextRef = useRef('')
  const recordingStartedAtRef = useRef(0)
  const automaticRecordingRef = useRef(false)
  optionsRef.current = options
  continuousRef.current = continuous

  const audioTrackConstraints = useCallback((): MediaTrackConstraints => ({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(audioInputId ? { deviceId: { exact: audioInputId } } : {}),
  }), [audioInputId])

  const stopBargeInMonitor = useCallback(() => {
    bargeEpochRef.current += 1
    bargeCleanupRef.current?.()
    bargeCleanupRef.current = null
  }, [])

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'audioinput')
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `麦克风 ${index + 1}` }))
    setAudioInputs(devices)
    if (audioInputId && !devices.some((device) => device.deviceId === audioInputId)) {
      setAudioInputIdState('')
      try { localStorage.removeItem(AUDIO_INPUT_KEY) } catch { /* ignore */ }
    }
  }, [audioInputId])

  const setAudioInputId = useCallback((deviceId: string) => {
    setAudioInputIdState(deviceId)
    try {
      if (deviceId) localStorage.setItem(AUDIO_INPUT_KEY, deviceId)
      else localStorage.removeItem(AUDIO_INPUT_KEY)
    } catch { /* ignore */ }
    voiceDiagnostic('microphone-selected', { device_id: deviceId || 'default' })
  }, [])

  const setVadThreshold = useCallback((value: number) => {
    const safe = Math.min(0.5, Math.max(0.005, value))
    setVadThresholdState(safe)
    try { localStorage.setItem(VAD_THRESHOLD_KEY, String(safe)) } catch { /* ignore */ }
  }, [])

  const releaseAudio = useCallback(() => {
    stopBargeInMonitor()
    if (lipFrameRef.current !== null) cancelAnimationFrame(lipFrameRef.current)
    lipFrameRef.current = null
    optionsRef.current.onLipSync(0)
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    audioRef.current = null
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = ''
    if (audioContextRef.current) void audioContextRef.current.close().catch(() => {})
    audioContextRef.current = null
    pcmPlayerRef.current?.stop()
    pcmPlayerRef.current = null
  }, [stopBargeInMonitor])

  const stopPlayback = useCallback(() => {
    playbackEpochRef.current += 1
    queueRef.current = []
    requestRef.current?.abort()
    requestRef.current = null
    for (const controller of ttsControllersRef.current) controller.abort()
    ttsControllersRef.current.clear()
    canPrefetchRef.current = false
    releaseAudio()
    pumpingRef.current = false
    setPhase((current) => current === 'recording' || current === 'transcribing' ? current : 'idle')
  }, [releaseAudio])

  const startBargeInMonitor = useCallback(async (playbackEpoch: number) => {
    if (!continuousRef.current || !optionsRef.current.active) return
    stopBargeInMonitor()
    const epoch = bargeEpochRef.current
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioTrackConstraints() })
      if (epoch !== bargeEpochRef.current || playbackEpoch !== playbackEpochRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      const startedAt = performance.now()
      let warmupSamples = 0
      let warmupSum = 0
      let speechStartedAt = 0
      let frameId = 0
      let cleaned = false
      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        cancelAnimationFrame(frameId)
        source.disconnect()
        stream?.getTracks().forEach((track) => track.stop())
        void context?.close().catch(() => {})
        setInputLevel(0)
      }
      bargeCleanupRef.current = cleanup
      const tick = () => {
        if (epoch !== bargeEpochRef.current || playbackEpoch !== playbackEpochRef.current) return
        analyser.getByteTimeDomainData(samples)
        let energy = 0
        for (const sample of samples) {
          const normalized = (sample - 128) / 128
          energy += normalized * normalized
        }
        const now = performance.now()
        const rms = Math.sqrt(energy / samples.length)
        setInputLevel(rms)
        if (now - startedAt < BARGE_IN_WARMUP_MS) {
          warmupSamples += 1
          warmupSum += rms
        } else {
          const echoFloor = warmupSamples ? warmupSum / warmupSamples : 0
          const triggerThreshold = Math.min(0.25, Math.max(vadThreshold, echoFloor * 2 + 0.008))
          if (rms >= triggerThreshold) {
            if (!speechStartedAt) speechStartedAt = now
            if (now - speechStartedAt >= BARGE_IN_SPEECH_MS) {
              voiceDiagnostic('barge-in-triggered', {
                level: Number(rms.toFixed(4)),
                threshold: Number(triggerThreshold.toFixed(4)),
                echo_floor: Number(echoFloor.toFixed(4)),
              })
              stopBargeInMonitor()
              stopPlayback()
              void optionsRef.current.cancelTurn().catch((error) => voiceDiagnostic('barge-in-cancel-error', { error: error instanceof Error ? error.message : String(error) }))
              void startRecordingRef.current(true)
              return
            }
          } else {
            speechStartedAt = 0
          }
        }
        frameId = requestAnimationFrame(tick)
      }
      frameId = requestAnimationFrame(tick)
      voiceDiagnostic('barge-in-listening', { warmup_ms: BARGE_IN_WARMUP_MS, minimum_speech_ms: BARGE_IN_SPEECH_MS })
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close().catch(() => {})
      voiceDiagnostic('barge-in-monitor-error', { error: error instanceof Error ? error.message : String(error) })
    }
  }, [audioTrackConstraints, stopBargeInMonitor, stopPlayback, vadThreshold])

  const scheduleContinuousListen = useCallback((delay = 500) => {
    if (!continuousRef.current || !optionsRef.current.active || recorderRef.current) return
    window.setTimeout(() => {
      if (continuousRef.current && optionsRef.current.active && !recorderRef.current) {
        void startRecordingRef.current(true)
      }
    }, delay)
  }, [])

  const prepareItem = useCallback((item: QueueItem) => {
    if (item.prepared) return item.prepared
    const controller = new AbortController()
    ttsControllersRef.current.add(controller)
    const speechText = sanitizeSpeechText(item.text)
    item.prepared = synthesizeSpeechStream(speechText, item.emotion, optionsRef.current.config, controller.signal)
      .then(async (response) => ({ audio: new Uint8Array(await response.arrayBuffer()) }))
      .catch((error: unknown) => ({ error }))
      .finally(() => ttsControllersRef.current.delete(controller))
    voiceDiagnostic('tts-prefetch-start', { characters: speechText.length })
    return item.prepared
  }, [])

  const prefetchNext = useCallback(() => {
    canPrefetchRef.current = true
    const next = queueRef.current[0]
    if (next && !next.prepared) void prepareItem(next)
  }, [prepareItem])

  const pump = useCallback(async () => {
    if (pumpingRef.current || !queueRef.current.length) return
    pumpingRef.current = true
    const epoch = playbackEpochRef.current
    try {
      while (queueRef.current.length && epoch === playbackEpochRef.current) {
        const item = queueRef.current.shift()!
        const speechText = sanitizeSpeechText(item.text)
        if (!speechText) {
          voiceDiagnostic('tts-control-fragment-skipped', { characters: item.text.length })
          continue
        }
        const controller = new AbortController()
        ttsControllersRef.current.add(controller)
        setPhase('synthesizing')
        setMessage(item.prepared ? '正在读取预生成语音' : '正在接收流式语音')
        let preparedAudio: Uint8Array | undefined
        let response: Response | undefined
        if (item.prepared) {
          const prepared = await item.prepared
          if (prepared.error) throw prepared.error
          preparedAudio = prepared.audio
        } else {
          response = await synthesizeSpeechStream(speechText, item.emotion, optionsRef.current.config, controller.signal)
        }
        if (epoch !== playbackEpochRef.current) break
        optionsRef.current.onDirective(item.directive)
        canPrefetchRef.current = false
        const player = new PcmStreamPlayer()
        pcmPlayerRef.current = player
        const playbackOptions = {
          signal: controller.signal,
          onLevel: (value: number) => optionsRef.current.onLipSync(value),
          onStarted: () => {
            setPhase('playing')
            setMessage('正在播放回复')
            voiceDiagnostic('tts-playback-start', { characters: speechText.length, prefetched: Boolean(preparedAudio) })
            void startBargeInMonitor(epoch)
          },
          onStreamEnd: prefetchNext,
        }
        if (preparedAudio) await player.playBuffer(preparedAudio, playbackOptions)
        else await player.play(response!.body!, playbackOptions)
        ttsControllersRef.current.delete(controller)
        releaseAudio()
      }
      if (epoch === playbackEpochRef.current) {
        setPhase('idle')
        setMessage('')
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (epoch === playbackEpochRef.current) {
        setPhase('error')
        setMessage(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (epoch === playbackEpochRef.current) {
        pumpingRef.current = false
        if (!queueRef.current.length && optionsRef.current.avatarState === 'done') scheduleContinuousListen()
      }
    }
  }, [prefetchNext, releaseAudio, scheduleContinuousListen, startBargeInMonitor])

  const enqueue = useCallback((items: QueueItem[]) => {
    if (!items.length) return
    queueRef.current.push(...items)
    if (canPrefetchRef.current) prefetchNext()
    void pump()
  }, [prefetchNext, pump])

  const finishRecording = useCallback(async (mimeType: string) => {
    vadCleanupRef.current?.()
    vadCleanupRef.current = null
    const blob = new Blob(recordingChunksRef.current, { type: mimeType || 'audio/webm' })
    voiceDiagnostic('recording-finished', {
      duration_ms: recordingStartedAtRef.current ? Math.round(performance.now() - recordingStartedAtRef.current) : 0,
      bytes: blob.size,
      mime: blob.type,
    })
    recordingChunksRef.current = []
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (discardRecordingRef.current) {
      discardRecordingRef.current = false
      setPhase('idle')
      setMessage('')
      scheduleContinuousListen()
      return
    }
    if (!blob.size) {
      setPhase('error')
      setMessage('没有录到声音。')
      scheduleContinuousListen()
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    setPhase('transcribing')
    setMessage(automaticRecordingRef.current ? '正在判断是否为人声' : '正在识别语音')
    try {
      if (automaticRecordingRef.current) {
        const vadStartedAt = performance.now()
        const speechCheck = await containsHumanSpeech(blob)
        voiceDiagnostic('silero-vad-result', {
          speech: speechCheck.speech,
          speech_ms: Math.round(speechCheck.speechMs),
          duration_ms: Math.round(performance.now() - vadStartedAt),
        })
        if (!speechCheck.speech) {
          setPhase('idle')
          setMessage('已忽略背景声')
          scheduleContinuousListen(350)
          return
        }
        setMessage('正在识别语音')
      }
      const result = await transcribeAudio(blob, optionsRef.current.config, controller.signal)
      turnStartedAtRef.current = performance.now()
      firstTextLoggedRef.current = false
      previousAssistantTextRef.current = optionsRef.current.assistantText
      optionsRef.current.inputActions.setDraft(result.text.trim())
      queueMicrotask(() => optionsRef.current.inputActions.submit())
      setPhase('idle')
      setMessage(`已识别：${result.text.trim()}`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      voiceDiagnostic('asr-error', { error: error instanceof Error ? error.message : String(error), mime: blob.type, bytes: blob.size })
      setPhase('error')
      setMessage(error instanceof Error ? error.message : String(error))
      scheduleContinuousListen(900)
    }
  }, [scheduleContinuousListen])

  const attachInputMonitor = useCallback((stream: MediaStream, recorder: MediaRecorder, autoStop: boolean) => {
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.25
    source.connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const startedAt = performance.now()
    let sileroReady = false
    let sileroFailed = false
    let sileroDestroyed = false
    let destroySilero: (() => Promise<void>) | null = null
    let fallbackSpeechStartedAt = 0
    let fallbackLastVoiceAt = 0
    let frameId = 0
    let lastMeterAt = 0
    let meterSamples = 0
    let levelSum = 0
    let peakLevel = 0
    let stopReason = 'manual'
    if (autoStop) {
      void (async () => {
        const vad = await MicVAD.new({
          model: 'legacy',
          baseAssetPath: VAD_ASSET_PREFIX,
          onnxWASMBasePath: VAD_ASSET_PREFIX,
          positiveSpeechThreshold: 0.68,
          negativeSpeechThreshold: 0.48,
          redemptionMs: optionsRef.current.config.vadSilenceMs,
          minSpeechMs: VAD_MIN_SPEECH_MS,
          preSpeechPadMs: 160,
          startOnLoad: true,
          getStream: async () => stream,
          pauseStream: async () => {},
          resumeStream: async () => stream,
          onSpeechStart: () => setMessage('听到你了，停顿后自动发送'),
          onSpeechEnd: (audio) => {
            if (recorder.state !== 'recording') return
            stopReason = 'silero-speech-end'
            voiceDiagnostic('silero-speech-end', { speech_ms: Math.round(audio.length / 16) })
            recorder.stop()
          },
          onVADMisfire: () => voiceDiagnostic('silero-vad-misfire'),
        })
        destroySilero = () => vad.destroy()
        if (sileroDestroyed || recorder.state !== 'recording') await vad.destroy()
        else {
          sileroReady = true
          voiceDiagnostic('silero-vad-ready')
        }
      })().catch((error) => {
        sileroFailed = true
        voiceDiagnostic('silero-vad-error', { error: error instanceof Error ? error.message : String(error), fallback: 'energy-vad' })
      })
    }
    const tick = () => {
      if (recorder.state !== 'recording') return
      analyser.getByteTimeDomainData(samples)
      let energy = 0
      for (const sample of samples) {
        const normalized = (sample - 128) / 128
        energy += normalized * normalized
      }
      const now = performance.now()
      const rms = Math.sqrt(energy / samples.length)
      meterSamples += 1
      levelSum += rms
      peakLevel = Math.max(peakLevel, rms)
      if (now - lastMeterAt >= 80) {
        setInputLevel(rms)
        lastMeterAt = now
      }
      if (autoStop && sileroFailed && rms >= vadThreshold) {
        if (!fallbackSpeechStartedAt) fallbackSpeechStartedAt = now
        fallbackLastVoiceAt = now
        setMessage('听到你了，停顿后自动发送')
      }
      const fallbackSpokeLongEnough = fallbackSpeechStartedAt
        && fallbackLastVoiceAt - fallbackSpeechStartedAt >= VAD_MIN_SPEECH_MS
      if (autoStop && sileroFailed && fallbackSpokeLongEnough
        && now - fallbackLastVoiceAt >= optionsRef.current.config.vadSilenceMs) {
        stopReason = 'energy-vad-fallback'
        recorder.stop()
        return
      }
      if (autoStop && now - startedAt >= VAD_MAX_RECORDING_MS) {
        stopReason = 'max-duration'
        if (!sileroReady) discardRecordingRef.current = true
        recorder.stop()
        return
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    vadCleanupRef.current = () => {
      cancelAnimationFrame(frameId)
      sileroDestroyed = true
      void destroySilero?.().catch(() => {})
      source.disconnect()
      void context.close().catch(() => {})
      setInputLevel(0)
      voiceDiagnostic('input-monitor-summary', {
        duration_ms: Math.round(performance.now() - startedAt),
        average_level: Number((meterSamples ? levelSum / meterSamples : 0).toFixed(4)),
        peak_level: Number(peakLevel.toFixed(4)),
        threshold: vadThreshold,
        stop_reason: stopReason,
      })
    }
  }, [vadThreshold])

  const startRecording = useCallback(async (automatic = false) => {
    if (recorderRef.current) return
    stopPlayback()
    if (!automatic && ['thinking', 'tool', 'speaking'].includes(optionsRef.current.avatarState)) {
      void optionsRef.current.cancelTurn().catch((error) => setMessage(`已停止语音，但取消回复失败：${error instanceof Error ? error.message : String(error)}`))
    }
    setMessage('')
    try {
      setPhase('transcribing')
      setMessage('正在检查语音服务')
      const healthController = new AbortController()
      requestRef.current = healthController
      await checkVoiceService(healthController.signal)
      const audioConstraints = audioTrackConstraints()
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      } catch (error) {
        if (!audioInputId || !(error instanceof DOMException) || !['NotFoundError', 'OverconstrainedError'].includes(error.name)) throw error
        setAudioInputId('')
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      }
      streamRef.current = stream
      await refreshAudioInputs()
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
        .find((type) => MediaRecorder.isTypeSupported(type))
      const track = stream.getAudioTracks()[0]
      voiceDiagnostic('recording-start', { device: track?.label || 'unknown', mime: preferred ?? 'browser-default', automatic })
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined)
      recorderRef.current = recorder
      recordingChunksRef.current = []
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data)
      })
      recorder.addEventListener('stop', () => {
        recorderRef.current = null
        void finishRecording(recorder.mimeType)
      }, { once: true })
      recorder.start(250)
      automaticRecordingRef.current = automatic
      recordingStartedAtRef.current = performance.now()
      setPhase('recording')
      attachInputMonitor(stream, recorder, optionsRef.current.config.voiceInputMode === 'vad')
      if (optionsRef.current.config.voiceInputMode === 'vad') {
        setMessage('正在聆听，请开始说话')
      } else {
        setMessage('正在聆听，点击停止')
      }
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setPhase('error')
      setMessage(error instanceof Error ? error.message : String(error))
      if (automatic) setContinuous(false)
    }
  }, [attachInputMonitor, audioInputId, audioTrackConstraints, finishRecording, refreshAudioInputs, setAudioInputId, stopPlayback])
  startRecordingRef.current = startRecording

  const toggleRecording = useCallback(() => {
    if (phase === 'recording') recorderRef.current?.stop()
    else if (phase !== 'transcribing') void startRecording()
  }, [phase, startRecording])

  const toggleContinuous = useCallback(() => {
    if (continuousRef.current) {
      if (phase === 'playing' || phase === 'synthesizing') {
        void startRecording()
        return
      }
      continuousRef.current = false
      setContinuous(false)
      discardRecordingRef.current = true
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      stopPlayback()
      setMessage('连续对话已关闭')
      return
    }
    continuousRef.current = true
    setContinuous(true)
    void startRecording()
  }, [phase, startRecording, stopPlayback])

  useEffect(() => {
    if (!options.active || !options.config.ttsEnabled) {
      turnActiveRef.current = false
      spokenOffsetRef.current = 0
      stopPlayback()
      if (options.active && options.avatarState === 'done') scheduleContinuousListen()
      return
    }
    if (options.avatarState === 'thinking') {
      turnActiveRef.current = true
      spokenOffsetRef.current = 0
      stopPlayback()
      return
    }
    if (options.avatarState === 'speaking' && !turnActiveRef.current) {
      turnActiveRef.current = true
      spokenOffsetRef.current = 0
    }
    if (!turnActiveRef.current || (options.avatarState !== 'speaking' && options.avatarState !== 'done')) return
    if (options.assistantText.length < spokenOffsetRef.current) spokenOffsetRef.current = 0
    const unread = options.assistantText.slice(spokenOffsetRef.current)
    const batch = takeSentenceChunks(unread, options.avatarState === 'done', options.config.fastFirstResponse && spokenOffsetRef.current === 0)
    const baseOffset = spokenOffsetRef.current
    const items = batch.chunks.map((chunk) => {
      const absoluteStart = baseOffset + chunk.start
      const directive = [...options.segments].reverse().find((segment) => segment.start <= absoluteStart)?.directive ?? null
      return { text: chunk.text, directive, emotion: voiceEmotion(directive?.emotion ?? null) }
    })
    spokenOffsetRef.current += batch.consumed
    enqueue(items)
    if (options.avatarState === 'done') {
      turnActiveRef.current = false
      if (!items.length && !pumpingRef.current) scheduleContinuousListen()
    }
  }, [enqueue, options.active, options.assistantText, options.avatarState, options.config.fastFirstResponse, options.config.ttsEnabled, options.segments, scheduleContinuousListen, stopPlayback])

  useEffect(() => {
    if (!options.active && continuousRef.current) {
      continuousRef.current = false
      setContinuous(false)
      discardRecordingRef.current = true
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }
  }, [options.active])

  useEffect(() => {
    if (!options.active) return
    void refreshAudioInputs().catch((error) => voiceDiagnostic('microphone-list-error', { error: error instanceof Error ? error.message : String(error) }))
    const listener = () => { void refreshAudioInputs() }
    navigator.mediaDevices?.addEventListener?.('devicechange', listener)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', listener)
  }, [options.active, refreshAudioInputs])

  useEffect(() => {
    if (!turnStartedAtRef.current || firstTextLoggedRef.current || !options.assistantText) return
    if (options.avatarState !== 'speaking' && options.assistantText === previousAssistantTextRef.current) return
    firstTextLoggedRef.current = true
    voiceDiagnostic('llm-first-text', { duration_ms: Math.round(performance.now() - turnStartedAtRef.current), characters_available: options.assistantText.length })
  }, [options.assistantText, options.avatarState])

  useEffect(() => () => {
    continuousRef.current = false
    discardRecordingRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    vadCleanupRef.current?.()
    stopBargeInMonitor()
    requestRef.current?.abort()
    releaseAudio()
  }, [releaseAudio, stopBargeInMonitor])

  return { phase, message, continuous, audioInputs, audioInputId, inputLevel, vadThreshold, setAudioInputId, setVadThreshold, toggleRecording, toggleContinuous, stopPlayback }
}
