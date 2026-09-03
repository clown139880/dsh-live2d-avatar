import type { AvatarProfile } from './types.ts'

export const MEGUMI_PROFILE: AvatarProfile = {
  id: 'megumi',
  displayName: 'Megumi',
  expressions: {
    idle: 'F_NOMAL',
    waiting: 'F_NOMAL',
    thinking: 'F_DOWN',
    tool: 'F_NOMAL',
    speaking: 'F_NOMAL',
    done: 'F_NOMAL',
    failed: 'F_SAD',
  },
  motions: {
    idle: ['mtn/IDLING_01.mtn', 'mtn/IDLING_02.mtn', 'mtn/IDLING_03.mtn'],
    waiting: ['mtn/IDLING_01.mtn'],
    thinking: ['mtn/IDLING_02.mtn'],
    tool: ['mtn/IDLING_03.mtn'],
    failed: ['mtn/I_SAD_S.mtn', 'mtn/I_SAD.mtn', 'mtn/I_SAD_W.mtn'],
  },
  emotionExpressions: {
    neutral: 'F_NOMAL', angry: 'F_ANGRY', down: 'F_DOWN', fun: 'F_FUN', sad: 'F_SAD', surprise: 'F_SURPRISE',
  },
  emotionMotions: {
    angry: ['mtn/I_ANGRY_S.mtn', 'mtn/I_ANGRY.mtn', 'mtn/I_ANGRY_W.mtn'],
    fun: ['mtn/I_FUN_S.mtn', 'mtn/I_FUN.mtn', 'mtn/I_FUN_W.mtn'],
    sad: ['mtn/I_SAD_S.mtn', 'mtn/I_SAD.mtn', 'mtn/I_SAD_W.mtn'],
    surprise: ['mtn/I_SURPRISE_S.mtn', 'mtn/I_SURPRISE.mtn', 'mtn/I_SURPRISE_W.mtn'],
  },
  idleMotions: ['mtn/IDLING_01.mtn', 'mtn/IDLING_02.mtn', 'mtn/IDLING_03.mtn'],
  interactiveMotions: [
    'mtn/I_ANGRY_S.mtn', 'mtn/I_ANGRY.mtn', 'mtn/I_ANGRY_W.mtn',
    'mtn/I_FUN_S.mtn', 'mtn/I_FUN.mtn', 'mtn/I_FUN_W.mtn',
    'mtn/I_SAD_S.mtn', 'mtn/I_SAD.mtn', 'mtn/I_SAD_W.mtn',
    'mtn/I_SURPRISE_S.mtn', 'mtn/I_SURPRISE.mtn', 'mtn/I_SURPRISE_W.mtn',
  ],
}
