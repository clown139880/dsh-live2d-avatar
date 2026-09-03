import { useEffect, useMemo, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { HeroineConfig } from '../../shared/config.ts'
import { resolveModelUrl } from '../../shared/config.ts'
import { L2dAvatarEngine } from '../avatar/l2d-engine.ts'
import { profileForModel } from '../avatar/profiles.ts'
import { avatarStateFromSession, latestAssistantText } from './session-projection.ts'
import { projectLive2dDirectives } from './directive-projection.ts'
import { useVoiceConversation } from '../voice/useVoiceConversation.ts'
import { HeroineSelect } from '../components/HeroineSelect.tsx'
import { setPetEnabled, usePetEnabled } from '../pet/visibility.ts'
import { IconPanelLeftOutline16, IconPersonalizationOutline16, IconPlusOutline16, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'

type ViewProps = PropsRuntime<'conversation.view'> & {
  config: HeroineConfig
  cancelTurn(): Promise<void>
  promptConsent: {
    get(sessionId: string): Promise<any>
    set(sessionId: string, enabled: boolean): Promise<any>
  }
}

const STATUS_TEXT = {
  idle: '待机',
  waiting: '等待你的回应',
  thinking: '正在思考',
  tool: '正在处理任务',
  speaking: '正在说话',
  done: '回复完成',
  failed: '发生错误',
} as const

const PROMPT_CONSENT_KEY = 'dsh-live2d-avatar:performance-prompt:'

export function HeroineStage(props: ViewProps) {
  const petEnabled = usePetEnabled()
  if (props.config.enabled && petEnabled) {
    return (
      <section className="heroine-stage heroine-pet-mode" style={{ '--heroine-bg': props.config.background } as React.CSSProperties}>
        <div className="heroine-pet-mode-card">
          <span>桌宠模式</span>
          <strong>{props.config.characterName} 已经离开舞台</strong>
          <p>桌宠正在独立显示。普通 Web 中她会在当前页面活动；Desktop 中她会留在桌面上。</p>
          <button onClick={() => setPetEnabled(false)}>返回舞台</button>
        </div>
      </section>
    )
  }
  return <HeroineStageSurface {...props} />
}

function HeroineStageSurface(props: ViewProps) {
  const { config, useSession, inputActions, cancelTurn } = props
  const snapshot = useSession((value) => value)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<L2dAvatarEngine | null>(null)
  const [voiceInputMode, setVoiceInputMode] = useState(config.voiceInputMode)
  const [showSubtitles, setShowSubtitles] = useState(config.showSubtitleInVoiceMode)
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [modelError, setModelError] = useState('')
  const [modelScale, setModelScale] = useState(config.modelScale)
  const [promptEnabled, setPromptEnabled] = useState(false)
  const [promptGlobal, setPromptGlobal] = useState(false)
  const [promptConsentOpen, setPromptConsentOpen] = useState(false)
  const [promptBusy, setPromptBusy] = useState(false)
  const [promptError, setPromptError] = useState('')

  const avatarState = avatarStateFromSession(snapshot)
  const assistantText = latestAssistantText(snapshot)
  const directiveProjection = projectLive2dDirectives(assistantText)
  const line = directiveProjection.cleanText || (snapshot.blank ? '想聊点什么？' : '我在这里。')
  const dialogueLoading = avatarState === 'thinking' || avatarState === 'tool'
  const dialogueLoadingText = avatarState === 'tool' ? '正在处理任务' : '正在思考'
  const modelUrl = useMemo(() => resolveModelUrl(config.modelEntry), [config.modelEntry])
  const profile = useMemo(() => profileForModel(config.modelEntry), [config.modelEntry])
  const voiceConfig = useMemo(() => ({ ...config, voiceInputMode }), [config, voiceInputMode])
  const voice = useVoiceConversation({
    active: true,
    assistantText: directiveProjection.segments.map((segment) => segment.text).join(''),
    segments: directiveProjection.segments,
    avatarState,
    config: voiceConfig,
    inputActions,
    cancelTurn,
    onDirective: (directive) => engineRef.current?.setDirective(directive),
    onLipSync: (value) => engineRef.current?.setLipSync(value),
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !config.enabled) return
    let engine: L2dAvatarEngine
    engine = new L2dAvatarEngine(canvas, profile, (status, detail) => {
      setModelStatus(status)
      setModelError(detail ?? '')
    }, { scale: modelScale, x: config.modelX, y: config.modelY })
    engineRef.current = engine
    void engine.load(modelUrl).catch(() => {})
    const resize = () => engine.resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      engine.destroy()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [config.enabled, modelUrl, profile])

  useEffect(() => {
    setModelScale(config.modelScale)
    engineRef.current?.setScale(config.modelScale)
    engineRef.current?.setPosition(config.modelX, config.modelY)
  }, [config.modelScale, config.modelX, config.modelY])

  useEffect(() => {
    const sessionId = String(props.sessionId)
    const storageKey = `${PROMPT_CONSENT_KEY}${sessionId}`
    let cancelled = false
    const sync = async (): Promise<void> => {
      try {
        const stored = localStorage.getItem(storageKey)
        const result = stored === null
          ? await props.promptConsent.get(sessionId)
          : await props.promptConsent.set(sessionId, stored === 'true')
        if (cancelled || !result.ok) return
        setPromptEnabled(result.value?.enabled === true)
        setPromptGlobal(result.value?.globalDefault === true)
      } catch { /* prompt control is optional if the host is still restarting */ }
    }
    void sync()
    return () => { cancelled = true }
  }, [config.llmControlEnabled, props.sessionId, props.promptConsent])

  const setSessionPrompt = async (enabled: boolean): Promise<void> => {
    setPromptBusy(true)
    setPromptError('')
    try {
      const sessionId = String(props.sessionId)
      const result = await props.promptConsent.set(sessionId, enabled)
      if (!result.ok) throw new Error(result.error?.message ?? '设置失败')
      localStorage.setItem(`${PROMPT_CONSENT_KEY}${sessionId}`, String(enabled))
      setPromptEnabled(enabled)
      setPromptGlobal(result.value?.globalDefault === true)
      setPromptConsentOpen(false)
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : String(error))
    } finally {
      setPromptBusy(false)
    }
  }

  const adjustModelScale = (delta: number): void => {
    const next = Math.max(0.1, Math.min(5, Number((modelScale + delta).toFixed(2))))
    setModelScale(next)
    engineRef.current?.setScale(next)
  }

  useEffect(() => {
    // Thinking has a dedicated authored performance. Tool/waiting transitions
    // keep that pose until the LLM emits its first performance directive.
    if (avatarState === 'tool' || avatarState === 'waiting') return
    engineRef.current?.setState(avatarState)
  }, [avatarState, modelStatus])

  useEffect(() => {
    if (avatarState === 'thinking' || avatarState === 'tool' || avatarState === 'waiting') return
    if (config.ttsEnabled) return
    const directive = avatarState === 'speaking' || avatarState === 'done' ? directiveProjection.activeDirective : null
    engineRef.current?.setDirective(directive)
  }, [avatarState, config.ttsEnabled, directiveProjection.activeDirective?.key, modelStatus])

  if (!config.enabled) {
    return <div className="heroine-stage"><div className="heroine-error">形象舞台已在设置中关闭。</div></div>
  }

  return (
    <section className="heroine-stage" data-mode="dialogue" data-conversation-composer-overlay="" style={{ '--heroine-bg': config.background } as React.CSSProperties}>
      <div className="heroine-canvas-wrap"><canvas ref={canvasRef} className="heroine-canvas" title={`点击 ${config.characterName} 可以触发动作`} /></div>

      <div className="heroine-status">
        {modelStatus === 'loading' ? '加载角色中' : STATUS_TEXT[avatarState]}
      </div>

      <div className="heroine-toolbar" role="toolbar" aria-label="舞台工具">
        <button className="heroine-tool-button" aria-pressed={showSubtitles} title={showSubtitles ? '隐藏字幕' : '显示字幕'} onClick={() => setShowSubtitles((value) => !value)}><IconPanelLeftOutline16 aria-hidden="true" />字幕</button>
        <button className="heroine-tool-button" aria-pressed="false" title="切换到桌宠模式" onClick={() => setPetEnabled(true)}><IconPersonalizationOutline16 aria-hidden="true" />桌宠</button>
        <div className="heroine-scale-control" role="group" aria-label="角色缩放">
          <button title="缩小角色" aria-label="缩小角色" onClick={() => adjustModelScale(-0.05)}><span aria-hidden="true">−</span></button>
          <output title={`当前缩放 ${Math.round(modelScale * 100)}%`}>{Math.round(modelScale * 100)}%</output>
          <button title="放大角色" aria-label="放大角色" onClick={() => adjustModelScale(0.05)}><IconPlusOutline16 aria-hidden="true" /></button>
        </div>
        <button className="heroine-tool-button" aria-pressed={promptEnabled} title="控制当前对话是否添加 Live2D system prompt" onClick={() => promptEnabled ? void setSessionPrompt(false) : setPromptConsentOpen(true)}>
          <IconSparkle16 aria-hidden="true" /><span>表情控制</span><span className="heroine-tool-state">{promptEnabled ? '开' : '关'}</span>
        </button>
      </div>

      {promptConsentOpen && <div className="heroine-prompt-consent" role="dialog" aria-modal="true" aria-label="启用表情控制提示词">
        <strong>为当前对话启用表情控制？</strong>
        <p>插件会向当前对话的 system prompt 添加一段 Live2D 控制协议，使模型输出隐藏的表情与动作标记。这会改变回复格式，但不会改变角色人设、工具权限或记忆。</p>
        <small>控制标记会在舞台和语音中隐藏，但仍可能出现在原始消息记录、导出或其他对话视图中。</small>
        {promptGlobal && <small>全局默认当前已开启；这里的选择会覆盖当前对话。</small>}
        {promptError && <small className="heroine-voice-error">设置失败：{promptError}</small>}
        <div><button disabled={promptBusy} onClick={() => void setSessionPrompt(true)}>仅为当前对话启用</button><button disabled={promptBusy} onClick={() => setPromptConsentOpen(false)}>取消</button></div>
      </div>}

      {modelStatus === 'error' && <div className="heroine-error">Live2D 加载失败：{modelError || modelUrl}</div>}

      <div className="heroine-lower-dock">
        {showSubtitles && <div className="heroine-dialogue">
          <div className="heroine-name">{config.characterName}</div>
          <div className="heroine-line">
            {dialogueLoading ? <><span>{dialogueLoadingText}</span><span className="heroine-thinking-dots" aria-hidden="true"><i /><i /><i /></span></> : line}
          </div>
        </div>}
        {(config.asrEnabled || config.ttsEnabled) && <div className="heroine-voice-hud">
            <button
              className="heroine-input-mode-button"
              aria-pressed={voiceInputMode === 'vad'}
              title="切换语音输入方式"
              onClick={() => setVoiceInputMode((value) => value === 'vad' ? 'push-to-talk' : 'vad')}
            >
              {voiceInputMode === 'vad' ? '连续聆听' : '按键录音'}
            </button>
            <button
              className="heroine-mic-button"
              data-recording={voice.phase === 'recording' ? '' : undefined}
              disabled={!config.asrEnabled || (voice.phase === 'transcribing' && !voice.continuous)}
              onClick={voiceInputMode === 'vad' ? voice.toggleContinuous : voice.toggleRecording}
            >
              <span aria-hidden="true">{voice.phase === 'recording' || voice.continuous ? '■' : '●'}</span>
              {voiceInputMode === 'vad'
                ? voice.continuous && (voice.phase === 'playing' || voice.phase === 'synthesizing') ? '打断并说话'
                  : voice.continuous ? '关闭连续对话' : '开启连续对话'
                : voice.phase === 'recording' ? '停止并识别' : voice.phase === 'transcribing' ? '识别中' : '开始说话'}
            </button>
            {(voice.phase === 'playing' || voice.phase === 'synthesizing') && <button className="heroine-voice-stop" onClick={voice.stopPlayback}>停止播放</button>}
            <span className={voice.phase === 'error' ? 'heroine-voice-error' : ''}>{voice.message || (!config.asrEnabled ? '请在设置中启用 ASR' : !config.ttsEnabled ? 'TTS 未启用' : '点击麦克风开始语音对话')}</span>
            <details className="heroine-audio-settings">
              <summary title="麦克风与噪声门限">音频</summary>
              <div className="heroine-audio-settings-panel">
                <label>
                  <span>输入设备</span>
                  <HeroineSelect
                    value={voice.audioInputId}
                    options={[
                      { value: '', label: '系统默认麦克风' },
                      ...voice.audioInputs.map((device) => ({ value: device.deviceId, label: device.label })),
                    ]}
                    disabled={voice.phase === 'recording'}
                    side="top"
                    fullWidth
                    className="heroine-audio-input-select"
                    onChange={voice.setAudioInputId}
                  />
                </label>
                <div className="heroine-audio-meter-row">
                  <span>输入音量</span>
                  <div className="heroine-audio-meter" style={{ '--heroine-input-level': `${Math.min(100, voice.inputLevel / 0.15 * 100)}%`, '--heroine-vad-level': `${Math.min(100, voice.vadThreshold / 0.15 * 100)}%` } as React.CSSProperties}><i /><b /></div>
                </div>
                <label>
                  <span>噪声门限</span>
                  <input type="range" min="0.005" max="0.15" step="0.005" value={voice.vadThreshold} onChange={(event) => voice.setVadThreshold(Number(event.target.value))} />
                  <output>{voice.vadThreshold.toFixed(3)}</output>
                </label>
                <small>连续对话时，音量超过竖线才算开始说话。请把竖线调到环境底噪稍上方。</small>
              </div>
            </details>
        </div>}
      </div>
    </section>
  )
}
