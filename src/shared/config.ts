export type StageMode = 'dialogue' | 'voice' | 'pet'
export type VoiceInputMode = 'push-to-talk' | 'vad'

export interface HeroineConfig {
  enabled: boolean
  modelRoot: string
  modelEntry: string
  modelScale: number
  modelX: number
  modelY: number
  characterName: string
  showPetNameplate: boolean
  defaultMode: StageMode
  background: string
  showSubtitleInVoiceMode: boolean
  llmControlEnabled: boolean
  asrEnabled: boolean
  asrBaseUrl: string
  asrModel: string
  voiceInputMode: VoiceInputMode
  vadThreshold: number
  vadSilenceMs: number
  fastFirstResponse: boolean
  modelDeckApiKeyEnv: string
  ttsEnabled: boolean
  ttsBaseUrl: string
  ttsModel: string
  ttsVoice: string
  ttsLanguage: 'zh' | 'en' | 'ja' | 'ko' | 'yue'
  ttsSpeed: number
}

export const DEFAULT_CONFIG: HeroineConfig = {
  enabled: true,
  modelRoot: '',
  modelEntry: 'haru/Haru.model3.json',
  modelScale: 1,
  modelX: 0,
  modelY: 0.1,
  characterName: 'Haru',
  showPetNameplate: false,
  defaultMode: 'dialogue',
  background: 'var(--dsw-alias-bg-base)',
  showSubtitleInVoiceMode: true,
  llmControlEnabled: false,
  asrEnabled: false,
  asrBaseUrl: '',
  asrModel: 'sensevoice-small',
  voiceInputMode: 'push-to-talk',
  vadThreshold: 0.035,
  vadSilenceMs: 900,
  fastFirstResponse: true,
  modelDeckApiKeyEnv: '',
  ttsEnabled: false,
  ttsBaseUrl: '',
  ttsModel: 'gpt-sovits-v2pro',
  ttsVoice: '',
  ttsLanguage: 'zh',
  ttsSpeed: 1,
}

export const SETTINGS_NAMESPACE = 'dsh-live2d-avatar'
export const MODEL_URL_PREFIX = '/avatar/models'
export const PERFORMANCE_PROMPT_CHANNEL = '/avatar-performance-prompt'

export function resolveModelUrl(modelEntry: string): string {
  const safe = modelEntry.replace(/^\/+/, '')
  return `${MODEL_URL_PREFIX}/${safe}`
}
