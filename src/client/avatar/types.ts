export type AvatarState =
  | 'idle'
  | 'waiting'
  | 'thinking'
  | 'tool'
  | 'speaking'
  | 'done'
  | 'failed'

export type AvatarEmotion = 'neutral' | 'angry' | 'down' | 'fun' | 'sad' | 'surprise'
export type AvatarMotion = 'none' | 'fast' | 'normal' | 'slow' | 'idle-1' | 'idle-2' | 'idle-3'

export interface AvatarDirective {
  key: string
  emotion: AvatarEmotion
  motion: AvatarMotion
}

export interface AvatarProfile {
  id: string
  displayName: string
  expressions: Partial<Record<AvatarState, string>>
  motions?: Partial<Record<AvatarState, string[]>>
  emotionExpressions?: Partial<Record<AvatarEmotion, string>>
  emotionMotions?: Partial<Record<AvatarEmotion, string[]>>
  idleMotions?: string[]
  interactiveMotions?: string[]
}

export interface AvatarParameter {
  id: string
  value: number
  min: number
  max: number
  default: number
}

export interface AvatarEngine {
  load(modelUrl: string): Promise<void>
  setState(state: AvatarState): void
  setDirective(directive: AvatarDirective | null): void
  setScale(scale: number): void
  setPosition(x: number, y: number): void
  getExpressions(): string[]
  setExpression(id: string): void
  getMotions(): string[]
  playMotion(file: string): void
  setParameters(values: Record<string, number>): void
  setLipSync(value: number): void
  resetParameters(): void
  getParameters(): AvatarParameter[]
  resize(): void
  destroy(): void
}
