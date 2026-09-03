import { init } from 'l2d'
import type { AvatarDirective, AvatarEngine, AvatarParameter, AvatarProfile, AvatarState } from './types.ts'

interface AvatarTransform {
  scale?: number
  x?: number
  y?: number
}

function identifier(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string') return id
  }
  return String(value ?? '')
}

export class L2dAvatarEngine implements AvatarEngine {
  private runtime: any = null
  private loaded = false
  private state: AvatarState = 'idle'
  private scale: number
  private x: number
  private y: number
  private forcedParameters: Record<string, number> = {}
  private motionCursor: Partial<Record<AvatarState, number>> = {}
  private directive: AvatarDirective | null = null
  private appliedDirectiveKey: string | null = null
  private interactionCursor = 0
  private idleCursor = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly profile: AvatarProfile,
    private readonly onStatus: (status: 'loading' | 'ready' | 'error', detail?: string) => void,
    transform: AvatarTransform = {},
  ) {
    this.scale = transform.scale ?? 1
    this.x = transform.x ?? 0
    this.y = transform.y ?? 0
  }

  async load(modelUrl: string): Promise<void> {
    this.destroy()
    this.onStatus('loading')
    const runtime = init(this.canvas)
    if (runtime === null) {
      this.onStatus('error', '当前浏览器无法初始化 Live2D/WebGL')
      return
    }
    this.runtime = runtime
    runtime.on('tap', () => this.playInteractiveMotion())
    runtime.on('loaded', () => {
      this.loaded = true
      this.applyState()
      this.onStatus('ready')
    })
    try {
      await runtime.load({ path: modelUrl, scale: this.scale, position: [this.x, this.y], volume: 0, logLevel: 'warn' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.onStatus('error', message)
      throw error
    }
  }

  setState(state: AvatarState): void {
    this.state = state
    this.applyState()
  }

  setDirective(directive: AvatarDirective | null): void {
    this.directive = directive
    if (this.loaded && (this.state === 'speaking' || this.state === 'done')) this.applyDirective()
  }

  setScale(scale: number): void {
    this.scale = scale
    this.runtime?.setScale?.(scale)
  }

  setPosition(x: number, y: number): void {
    this.x = x
    this.y = y
    this.runtime?.setPosition?.(x, y)
  }

  getExpressions(): string[] {
    if (!this.loaded) return []
    const expressions = this.runtime?.getExpressions?.() as unknown[] | undefined
    return (expressions ?? []).map(identifier).filter(Boolean)
  }

  setExpression(id: string): void {
    if (this.loaded) this.runtime?.setExpression?.(id)
  }

  getMotions(): string[] {
    if (!this.loaded) return []
    const groups = this.runtime?.getMotions?.() as Record<string, string[]> | undefined
    return groups ? [...new Set(Object.values(groups).flat())] : []
  }

  playMotion(file: string): void {
    this.play(file, 3)
  }

  setParameters(values: Record<string, number>): void {
    this.forcedParameters = { ...this.forcedParameters, ...values }
    this.runtime?.setParams?.(this.forcedParameters)
  }

  setLipSync(value: number): void {
    if (!this.loaded) return
    this.runtime?.setParams?.(value <= 0
      ? this.forcedParameters
      : {
          ...this.forcedParameters,
          // Cubism 2 and Cubism 3+ use different canonical parameter IDs.
          PARAM_MOUTH_OPEN_Y: Math.min(1, value),
          ParamMouthOpenY: Math.min(1, value),
        })
  }

  resetParameters(): void {
    this.forcedParameters = {}
    this.runtime?.setParams?.({})
  }

  getParameters(): AvatarParameter[] {
    if (!this.loaded) return []
    const parameters = this.runtime?.getParams?.() as Array<Omit<AvatarParameter, 'id'> & { id: unknown }> | undefined
    return (parameters ?? []).map((parameter) => ({ ...parameter, id: identifier(parameter.id) })).filter((parameter) => parameter.id)
  }

  resize(): void {
    this.runtime?.resize?.()
  }

  destroy(): void {
    this.clearIdleTimer()
    this.loaded = false
    if (this.runtime !== null) {
      try { this.runtime.destroy() } catch { /* already disposed */ }
    }
    this.runtime = null
    this.appliedDirectiveKey = null
  }

  private applyState(): void {
    if (!this.loaded || this.runtime === null) return
    this.clearIdleTimer()
    if (this.state === 'speaking' || this.state === 'done') {
      this.applyDirective()
    } else {
      this.appliedDirectiveKey = null
      const expression = this.profile.expressions[this.state]
      if (expression) this.runtime.setExpression?.(expression)
    }
    const motions = this.profile.motions?.[this.state] ?? []
    if (motions.length) {
      const cursor = this.motionCursor[this.state] ?? 0
      this.play(motions[cursor % motions.length]!, 3)
      this.motionCursor[this.state] = cursor + 1
    }
    if (this.state === 'idle' || this.state === 'done') this.scheduleIdleMotion(this.state === 'done' ? 5200 : 10600)
  }

  private applyDirective(): void {
    if (!this.loaded || this.runtime === null) return
    const emotion = this.directive?.emotion ?? 'neutral'
    const expression = this.profile.emotionExpressions?.[emotion] ?? this.profile.expressions[this.state]
    if (expression) this.runtime.setExpression?.(expression)
    const directiveKey = this.directive?.key ?? 'neutral'
    if (this.appliedDirectiveKey === directiveKey) return
    const motion = this.directive?.motion ?? 'none'
    if (motion.startsWith('idle-')) {
      const idleIndex = Number(motion.at(-1)) - 1
      const idleMotion = this.profile.idleMotions?.[idleIndex]
      if (idleMotion) this.play(idleMotion, 3)
    } else {
      const motions = this.profile.emotionMotions?.[emotion] ?? []
      const motionIndex = motion === 'fast' ? 0
        : motion === 'normal' ? 1
          : motion === 'slow' ? 2 : -1
      if (motionIndex >= 0 && motions[motionIndex]) {
        this.play(motions[motionIndex]!, 3)
      }
    }
    this.appliedDirectiveKey = directiveKey
  }

  private play(file: string, priority: number): void {
    if (this.loaded) this.runtime?.playMotionByFile?.(file, priority)
  }

  private playInteractiveMotion(): void {
    const motions = this.profile.interactiveMotions ?? []
    if (!this.loaded || !motions.length) return
    const file = motions[this.interactionCursor % motions.length]!
    this.interactionCursor += 1
    this.play(file, 4)
  }

  private scheduleIdleMotion(delay: number): void {
    const motions = this.profile.idleMotions ?? []
    if (!motions.length) return
    this.idleTimer = setTimeout(() => {
      if (!this.loaded || (this.state !== 'idle' && this.state !== 'done')) return
      this.play(motions[this.idleCursor % motions.length]!, 1)
      this.idleCursor += 1
      this.scheduleIdleMotion(10600)
    }, delay)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}
