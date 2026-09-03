import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { HeroineConfig } from '../../shared/config.ts'
import { DEFAULT_CONFIG } from '../../shared/config.ts'
import { HeroineSelect } from '../components/HeroineSelect.tsx'

type Field = {
  key: keyof HeroineConfig
  label: string
  type: 'text' | 'number' | 'checkbox' | 'select'
  options?: Array<{ value: string; label: string }>
  hint?: string
}

interface ModelDeckVoice {
  id: string
  name?: string
  model?: string
  default_speed?: number
}

const AVATAR_FIELDS: Field[] = [
  { key: 'enabled', label: '启用形象舞台', type: 'checkbox' },
  { key: 'modelRoot', label: '模型根目录', type: 'text', hint: '留空时使用插件内 assets/models；也可填写 host 可访问的绝对目录。' },
  { key: 'modelEntry', label: 'Live2D 模型入口', type: 'text', hint: '相对于模型根目录的 .model.json 或 .model3.json。自有模型的纹理、动作和表情文件请保持原目录结构。' },
  { key: 'modelScale', label: '角色缩放', type: 'number', hint: '范围 0.1–5；舞台工具栏也可临时缩放。' },
  { key: 'modelX', label: '角色水平偏移', type: 'number', hint: '范围 -3–3；0 为居中，正数向右。' },
  { key: 'modelY', label: '角色垂直偏移', type: 'number', hint: '范围 -3–3；0 为模型默认位置。' },
  { key: 'characterName', label: '角色名称', type: 'text' },
  { key: 'showPetNameplate', label: '显示桌宠名牌', type: 'checkbox', hint: '在桌宠脚边显示角色名称；默认关闭。' },
  { key: 'background', label: '舞台背景', type: 'text', hint: '支持 CSS 颜色或变量；默认跟随 DSH 当前主题。' },
  { key: 'llmControlEnabled', label: '所有对话默认启用表情控制', type: 'checkbox', hint: '高级全局设置：向所有 DSH 对话的 system prompt 添加 Live2D 控制协议。默认关闭；每个对话可在舞台内单独决定。' },
]

const ASR_FIELDS: Field[] = [
  { key: 'asrBaseUrl', label: 'ASR API 地址', type: 'text', hint: '仅支持可信的 http(s) ModelDeck 地址。录音会发送到这里；默认留空。' },
  { key: 'asrModel', label: 'ASR 模型', type: 'text' },
  { key: 'vadThreshold', label: 'VAD 默认起音阈值', type: 'number', hint: '建议 0.02–0.08；语音面板可结合实时音量条为当前客户端覆盖此值。' },
  { key: 'vadSilenceMs', label: 'VAD 停顿时长（毫秒）', type: 'number', hint: '持续静音达到该时长后自动提交。' },
]

const TTS_FIELDS: Field[] = [
  { key: 'ttsBaseUrl', label: 'TTS API 地址', type: 'text', hint: '仅支持可信的 http(s) ModelDeck 地址。回复文本会发送到这里；默认留空。' },
  { key: 'ttsModel', label: 'TTS 模型', type: 'text' },
  { key: 'ttsVoice', label: 'TTS 语音角色', type: 'select', hint: '从 ModelDeck 实时读取；角色可能带有推荐的默认语速。' },
  { key: 'ttsLanguage', label: 'TTS 语言', type: 'select', options: [{ value: 'zh', label: '中文' }, { value: 'ja', label: '日语' }, { value: 'en', label: '英语' }, { value: 'yue', label: '粤语' }, { value: 'ko', label: '韩语' }], hint: '明确传给 TTS 驱动，不使用 auto；混合语言时请选择文本中的主要语言。' },
  { key: 'ttsSpeed', label: 'TTS 语速', type: 'number', hint: '范围 0.5–2.0；1.0 为正常速度。' },
  { key: 'fastFirstResponse', label: '首句逗号预生成', type: 'checkbox', hint: '首段超过 10 个字符时可在逗号处提前生成，降低首句等待。' },
]

const CREDENTIAL_FIELDS: Field[] = [
  { key: 'modelDeckApiKeyEnv', label: 'API Key 环境变量', type: 'text', hint: '只填写 host 环境变量名，不要在这里填写密钥。' },
]

const ALL_KEYS: Array<keyof HeroineConfig> = [
  ...[...AVATAR_FIELDS, ...ASR_FIELDS, ...TTS_FIELDS, ...CREDENTIAL_FIELDS].map((field) => field.key),
  'asrEnabled',
  'ttsEnabled',
]

export function HeroineSettings({ scope }: { scope: SettingsScope<HeroineConfig> }) {
  const snapshot = useSyncExternalStore(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const server = snapshot.status === 'ready' && snapshot.value
    ? { ...DEFAULT_CONFIG, ...snapshot.value }
    : { ...DEFAULT_CONFIG }
  const [draft, setDraft] = useState<HeroineConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [voices, setVoices] = useState<ModelDeckVoice[]>([])
  const [voicesStatus, setVoicesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [voicesMessage, setVoicesMessage] = useState('')
  const shown = draft ?? server

  useEffect(() => setDraft(null), [snapshot])

  const update = useCallback((key: keyof HeroineConfig, value: HeroineConfig[keyof HeroineConfig]) => {
    setMessage('')
    setDraft((current) => ({ ...(current ?? server), [key]: value }))
  }, [server])

  const loadVoices = useCallback(async (): Promise<void> => {
    setVoicesStatus('loading')
    setVoicesMessage('')
    try {
      const response = await fetch('/avatar/api/voices', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as { data?: ModelDeckVoice[] }
      const available = Array.isArray(payload.data) ? payload.data.filter((voice) => voice?.id) : []
      setVoices(available)
      setVoicesStatus('ready')
      setVoicesMessage(available.length ? `已加载 ${available.length} 个语音角色` : 'ModelDeck 没有返回语音角色')
    } catch (error) {
      setVoicesStatus('error')
      setVoicesMessage(`角色加载失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  useEffect(() => {
    if (server.ttsEnabled) void loadVoices()
  }, [loadVoices, server.ttsBaseUrl, server.ttsEnabled])

  const voiceOptions = voices
    .filter((voice) => !voice.model || voice.model === shown.ttsModel)
    .map((voice) => ({
      value: voice.id,
      label: `${voice.name ?? voice.id}${voice.name ? `（${voice.id}）` : ''}${voice.default_speed && voice.default_speed !== 1 ? ` · 建议 ${voice.default_speed}×` : ''}`,
    }))
  if (shown.ttsVoice && !voiceOptions.some((option) => option.value === shown.ttsVoice)) {
    voiceOptions.unshift({ value: shown.ttsVoice, label: `${shown.ttsVoice}（当前配置）` })
  }

  const save = async (): Promise<void> => {
    const target = draft ?? server
    const changed = ALL_KEYS.filter((key) => !Object.is(server[key], target[key]))
    if (!changed.length) {
      setMessage('没有需要保存的更改。')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      for (const key of changed) await scope.set(key, target[key])
      setDraft(null)
      setMessage('已保存，角色舞台会自动更新。')
    } catch (error) {
      setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const renderFields = (fields: Field[]) => fields.map((field) => (
    <label key={field.key} className="heroine-settings-row">
      <span>
        <strong>{field.label}</strong>
        {field.hint && <small>{field.hint}</small>}
      </span>
      {field.type === 'checkbox' ? (
        <input type="checkbox" checked={Boolean(shown[field.key])} disabled={busy} onChange={(event) => update(field.key, event.target.checked)} />
      ) : field.type === 'select' ? (
        <HeroineSelect
          value={String(shown[field.key])}
          options={(field.key === 'ttsVoice' ? voiceOptions : field.options) ?? []}
          disabled={busy || (field.key === 'ttsVoice' && voicesStatus === 'loading')}
          onChange={(value) => update(field.key, value)}
        />
      ) : field.type === 'number' ? (
        <input className="heroine-settings-control" type="number" min={field.key === 'ttsSpeed' ? 0.5 : undefined} max={field.key === 'ttsSpeed' ? 2 : undefined} step={field.key === 'ttsSpeed' ? 0.05 : 'any'} value={Number(shown[field.key])} disabled={busy} onChange={(event) => update(field.key, Number(event.target.value))} />
      ) : (
        <input className="heroine-settings-control" value={String(shown[field.key])} disabled={busy} onChange={(event) => update(field.key, event.target.value)} />
      )}
    </label>
  ))

  return (
    <div className="heroine-settings-root" style={{ maxWidth: 760, padding: '8px 4px 28px' }}>
      <h2 style={{ margin: '0 0 8px' }}>形象</h2>
      <p style={{ margin: '0 0 22px', color: 'var(--dsw-alias-label-tertiary)' }}>
        配置内置示例或你自己的 Live2D。ModelDeck ASR/TTS 是默认关闭的实验性集成；API 密钥只从 host 环境变量读取，不进入浏览器设置。
      </p>
      {snapshot.status === 'unavailable' && <p>当前配置服务不可用，舞台使用部署默认值。</p>}
      <section className="heroine-settings-section">
        <h3>角色与舞台</h3>
        <div className="heroine-settings-fields">{renderFields(AVATAR_FIELDS)}</div>
      </section>
      <section className="heroine-settings-section">
        <div className="heroine-settings-feature-head">
          <span><strong>语音识别（ASR）</strong><small>实验性功能；开启后录音会发送到配置的服务。</small></span>
          <input aria-label="启用实验性 ASR" type="checkbox" checked={shown.asrEnabled} disabled={busy} onChange={(event) => update('asrEnabled', event.target.checked)} />
        </div>
        {shown.asrEnabled && <div className="heroine-settings-nested">{renderFields(ASR_FIELDS)}</div>}
      </section>
      <section className="heroine-settings-section">
        <div className="heroine-settings-feature-head">
          <span><strong>语音合成（TTS）</strong><small>实验性功能；开启后回复文本会发送到配置的服务。</small></span>
          <input aria-label="启用实验性 TTS" type="checkbox" checked={shown.ttsEnabled} disabled={busy} onChange={(event) => update('ttsEnabled', event.target.checked)} />
        </div>
        {shown.ttsEnabled && <div className="heroine-settings-nested">
          {renderFields(TTS_FIELDS)}
          <div className="heroine-settings-voices-status" data-error={voicesStatus === 'error' ? '' : undefined}>
            <span>{voicesStatus === 'loading' ? '正在从 ModelDeck 加载语音角色…' : voicesMessage}</span>
            <button type="button" disabled={voicesStatus === 'loading'} onClick={() => void loadVoices()}>刷新角色</button>
          </div>
        </div>}
      </section>
      {(shown.asrEnabled || shown.ttsEnabled) && <section className="heroine-settings-section">
        <h3>服务凭据</h3>
        <div className="heroine-settings-fields">{renderFields(CREDENTIAL_FIELDS)}</div>
      </section>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
        <button disabled={busy} onClick={() => void save()} style={{ padding: '8px 16px' }}>保存</button>
        <span style={{ fontSize: 13 }}>{message}</span>
      </div>
    </div>
  )
}
