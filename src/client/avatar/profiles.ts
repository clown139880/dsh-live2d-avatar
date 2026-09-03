import type { AvatarProfile } from './types.ts'
import { MEGUMI_PROFILE } from './megumi.ts'

export const HARU_PROFILE: AvatarProfile = {
  id: 'haru',
  displayName: 'Haru',
  expressions: {
    idle: 'F01', waiting: 'F01', thinking: 'F08', tool: 'F01',
    speaking: 'F01', done: 'F05', failed: 'F04',
  },
  motions: {
    idle: ['motions/haru_g_idle.motion3.json'],
    waiting: ['motions/haru_g_m15.motion3.json'],
  },
  emotionExpressions: {
    neutral: 'F01', angry: 'F03', down: 'F08', fun: 'F05', sad: 'F04', surprise: 'F06',
  },
  idleMotions: ['motions/haru_g_idle.motion3.json', 'motions/haru_g_m15.motion3.json'],
  interactiveMotions: [
    'motions/haru_g_m26.motion3.json',
    'motions/haru_g_m06.motion3.json',
    'motions/haru_g_m20.motion3.json',
    'motions/haru_g_m09.motion3.json',
  ],
}

export const GENERIC_PROFILE: AvatarProfile = {
  id: 'generic',
  displayName: 'Custom Live2D',
  expressions: {},
}

/** Known bundled models get richer mappings; arbitrary user models stay safely generic. */
export function profileForModel(modelEntry: string): AvatarProfile {
  const normalized = modelEntry.replaceAll('\\', '/').toLowerCase()
  if (normalized.includes('/megumi/') || normalized.startsWith('megumi/')) return MEGUMI_PROFILE
  if (normalized.includes('/haru/') || normalized.startsWith('haru/')) return HARU_PROFILE
  return GENERIC_PROFILE
}
