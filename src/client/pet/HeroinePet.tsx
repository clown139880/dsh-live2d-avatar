import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { HeroineConfig } from '../../shared/config.ts'
import { resolveModelUrl } from '../../shared/config.ts'
import { L2dAvatarEngine } from '../avatar/l2d-engine.ts'
import { profileForModel } from '../avatar/profiles.ts'
import { activateHeroineStage, setPetVisible, usePetVisible } from './visibility.ts'

type Position = { x: number; y: number }
const POSITION_KEY = 'dsh-live2d-avatar:pet-position'
const SIZE_KEY = 'dsh-live2d-avatar:pet-size'
const DEFAULT_WIDTH = 240
const MIN_WIDTH = 150
const MAX_WIDTH = 360
const SIZE_STEP = 30
const ASPECT_RATIO = 250 / 180

function initialPosition(): Position {
  try {
    const parsed = JSON.parse(localStorage.getItem(POSITION_KEY) ?? '') as Position
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) return parsed
  } catch { /* use the default corner */ }
  return { x: 24, y: 24 }
}

function initialWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIZE_KEY))
    if (Number.isFinite(stored)) return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, stored))
  } catch { /* use the larger default */ }
  return DEFAULT_WIDTH
}

export function HeroinePet({ config }: { config: HeroineConfig }) {
  const visible = usePetVisible()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Position } | null>(null)
  const [position, setPosition] = useState(initialPosition)
  const [width, setWidth] = useState(initialWidth)
  const height = Math.round(width * ASPECT_RATIO)

  useEffect(() => {
    if (!visible || !config.enabled || !canvasRef.current) return
    const engine = new L2dAvatarEngine(canvasRef.current, profileForModel(config.modelEntry), () => {}, {
      scale: config.modelScale,
      x: config.modelX,
      y: config.modelY,
    })
    void engine.load(resolveModelUrl(config.modelEntry)).catch(() => {})
    const resize = () => engine.resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      engine.destroy()
    }
  }, [config.enabled, config.modelEntry, config.modelScale, config.modelX, config.modelY, visible])

  if (!visible || !config.enabled) return null

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: position }
  }
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const x = Math.max(0, Math.min(window.innerWidth - width, drag.origin.x - (event.clientX - drag.startX)))
    const y = Math.max(0, Math.min(window.innerHeight - height, drag.origin.y - (event.clientY - drag.startY)))
    setPosition({ x, y })
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(position)) } catch { /* ignore */ }
  }

  const resize = (next: number): void => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next))
    setWidth(clamped)
    setPosition((current) => ({
      x: Math.max(0, Math.min(window.innerWidth - clamped, current.x)),
      y: Math.max(0, Math.min(window.innerHeight - Math.round(clamped * ASPECT_RATIO), current.y)),
    }))
    try { localStorage.setItem(SIZE_KEY, String(clamped)) } catch { /* ignore */ }
  }

  const style = {
    right: position.x,
    bottom: position.y,
    '--heroine-pet-width': `${width}px`,
    '--heroine-pet-height': `${height}px`,
  } as CSSProperties

  return (
    <aside className="heroine-pet" style={style} aria-label={`${config.characterName} 桌宠`} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div className="heroine-pet-controls" role="toolbar" aria-label="桌宠大小">
        <button aria-label="返回形象舞台" title="返回舞台" onClick={activateHeroineStage}>↩</button>
        <button aria-label="缩小桌宠" disabled={width <= MIN_WIDTH} onClick={() => resize(width - SIZE_STEP)}>−</button>
        <button aria-label="放大桌宠" disabled={width >= MAX_WIDTH} onClick={() => resize(width + SIZE_STEP)}>＋</button>
        <button aria-label="关闭桌宠" onClick={() => setPetVisible(false)}>×</button>
      </div>
      <canvas ref={canvasRef} className="heroine-pet-canvas" />
      {config.showPetNameplate && <div className="heroine-pet-name">{config.characterName}</div>}
    </aside>
  )
}
