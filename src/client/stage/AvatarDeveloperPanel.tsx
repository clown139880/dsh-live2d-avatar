import { useMemo, useState } from 'react'
import type { AvatarDirective, AvatarEmotion, AvatarMotion, AvatarParameter } from '../avatar/types.ts'

interface DeveloperPanelProps {
  modeLabel: string
  directive: AvatarDirective | null
  expressions: string[]
  motions: string[]
  parameters: AvatarParameter[]
  scale: number
  x: number
  y: number
  onScale: (value: number) => void
  onPosition: (x: number, y: number) => void
  onExpression: (id: string) => void
  onMotion: (file: string) => void
  onThinkingPreset: (expression: string, motion: string) => void
  onParameter: (id: string, value: number) => void
  onArmPose: (pose: 'A' | 'B' | 'C') => void
  onResetTransform: () => void
  onResetParameters: () => void
}

function shortName(path: string): string {
  return path.split('/').at(-1)?.replace(/\.mtn$/i, '') ?? path
}

const EXPRESSION_LABELS: Record<string, string> = {
  F_ANGRY: '生气', F_DOWN: '低落', F_FUN: '开心', F_NOMAL: '平静', F_SAD: '伤心', F_SURPRISE: '惊讶',
}

const EMOTION_LABELS: Record<AvatarEmotion, string> = {
  neutral: '平静', angry: '生气', down: '低落', fun: '开心', sad: '伤心', surprise: '惊讶',
}

const MOTION_LABELS: Record<AvatarMotion, string> = {
  none: '仅表情', fast: '快速情绪动作', normal: '标准情绪动作', slow: '慢速情绪动作',
  'idle-1': '待机动作 1', 'idle-2': '待机动作 2', 'idle-3': '待机动作 3',
}

const MOTION_META: Record<string, { label: string; seconds: number }> = {
  I_ANGRY_S: { label: '生气 · 快', seconds: 3.17 }, I_ANGRY: { label: '生气 · 标准', seconds: 3.5 }, I_ANGRY_W: { label: '生气 · 慢', seconds: 3.87 },
  I_FUN_S: { label: '开心 · 快', seconds: 3.43 }, I_FUN: { label: '开心 · 标准', seconds: 3.8 }, I_FUN_W: { label: '开心 · 慢', seconds: 4.2 },
  I_SAD_S: { label: '伤心 · 快', seconds: 2.93 }, I_SAD: { label: '伤心 · 标准', seconds: 3.27 }, I_SAD_W: { label: '伤心 · 慢', seconds: 3.6 },
  I_SURPRISE_S: { label: '惊讶 · 快', seconds: 2.7 }, I_SURPRISE: { label: '惊讶 · 标准', seconds: 2.97 }, I_SURPRISE_W: { label: '惊讶 · 慢', seconds: 3.27 },
  IDLING_01: { label: '待机 1', seconds: 10.6 }, IDLING_02: { label: '待机 2', seconds: 10.6 }, IDLING_03: { label: '待机 3', seconds: 10.6 },
  REPEAT_01: { label: '计时占位', seconds: 2.97 },
}

const THINKING_PRESETS = [
  { id: 'a', label: 'A 平静低头', expression: 'F_NOMAL', motion: 'mtn/IDLING_02.mtn', note: '不皱眉，持续低头和向下看' },
  { id: 'b', label: 'B 平静侧思', expression: 'F_NOMAL', motion: 'mtn/IDLING_03.mtn', note: '不皱眉，轻微侧头' },
  { id: 'c', label: 'C 平静环顾', expression: 'F_NOMAL', motion: 'mtn/IDLING_01.mtn', note: '不皱眉，动作幅度较大' },
  { id: 'd', label: 'D 低头沉思', expression: 'F_DOWN', motion: 'mtn/IDLING_02.mtn', note: '当前方案，眉毛下压' },
  { id: 'e', label: 'E 低落侧思', expression: 'F_DOWN', motion: 'mtn/IDLING_03.mtn', note: '皱眉较轻，侧头' },
  { id: 'f', label: 'F 低落环顾', expression: 'F_DOWN', motion: 'mtn/IDLING_01.mtn', note: '低落表情，动作幅度较大' },
] as const

export function AvatarDeveloperPanel(props: DeveloperPanelProps) {
  const [selectedId, setSelectedId] = useState('')
  const [thinkingPreset, setThinkingPreset] = useState('')
  const selected = useMemo(
    () => props.parameters.find((parameter) => parameter.id === selectedId) ?? props.parameters[0],
    [props.parameters, selectedId],
  )

  return (
    <aside className="heroine-dev-panel" aria-label="Live2D 角色调试台">
      <header><strong>角色调试台 · {props.modeLabel}</strong><span>{props.motions.length} 动作 · {props.expressions.length} 表情 · {props.parameters.length} 参数</span></header>
      <p className="heroine-dev-tip">LLM 指令：<strong>{props.directive ? `${EMOTION_LABELS[props.directive.emotion]} · ${MOTION_LABELS[props.directive.motion]}` : '无（保持平静）'}</strong> · 每个动作会使用素材内置的成套手臂姿势。</p>
      <section><h4>思考动作候选 <span className="heroine-dev-note">连续点击对比，D 是当前方案</span></h4><div className="heroine-dev-buttons heroine-thinking-presets">{THINKING_PRESETS.map((preset) => <button key={preset.id} aria-pressed={thinkingPreset === preset.id} title={preset.note} onClick={() => { setThinkingPreset(preset.id); props.onThinkingPreset(preset.expression, preset.motion) }}>{preset.label}</button>)}</div></section>
      <section>
        <label>缩放 <output>{props.scale.toFixed(2)}×</output><input aria-label="角色缩放" type="range" min="0.5" max="3.5" step="0.05" value={props.scale} onChange={(event) => props.onScale(Number(event.target.value))} /></label>
        <label>横向 <output>{props.x.toFixed(2)}</output><input aria-label="角色横向位置" type="range" min="-2" max="2" step="0.05" value={props.x} onChange={(event) => props.onPosition(Number(event.target.value), props.y)} /></label>
        <label>纵向 <output>{props.y.toFixed(2)}</output><input aria-label="角色纵向位置" type="range" min="-2" max="2" step="0.05" value={props.y} onChange={(event) => props.onPosition(props.x, Number(event.target.value))} /></label>
        <button className="heroine-dev-reset" onClick={props.onResetTransform}>恢复推荐构图</button>
      </section>
      <section><h4>表情</h4><div className="heroine-dev-buttons">{props.expressions.map((id) => <button key={id} title={id} onClick={() => props.onExpression(id)}>{EXPRESSION_LABELS[id] ?? id.replace(/^F_/, '')}</button>)}</div></section>
      <section><h4>被埋藏的动作 <span className="heroine-dev-note">S/W 为快/慢变体</span></h4><div className="heroine-dev-buttons heroine-dev-motion-list">{props.motions.map((file) => {
        const name = shortName(file)
        const meta = MOTION_META[name]
        return <button key={file} title={`${file}${meta ? ` · ${meta.seconds.toFixed(2)} 秒` : ''}`} onClick={() => props.onMotion(file)}><span>{meta?.label ?? name}</span>{meta && <small>{meta.seconds.toFixed(2)}s</small>}</button>
      })}</div></section>
      <section><h4>隐藏手臂姿势</h4><div className="heroine-dev-buttons"><button onClick={() => props.onArmPose('A')}>姿势 A</button><button onClick={() => props.onArmPose('B')}>姿势 B</button><button onClick={() => props.onArmPose('C')}>姿势 C</button></div></section>
      {selected && <section><h4>原始参数</h4><select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{props.parameters.map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.id}</option>)}</select><label><output>{selected.value.toFixed(3)}</output><input type="range" min={selected.min} max={selected.max} step={(selected.max - selected.min) / 200 || 0.01} value={selected.value} onChange={(event) => props.onParameter(selected.id, Number(event.target.value))} /></label><button className="heroine-dev-reset" onClick={props.onResetParameters}>清除全部参数覆盖</button></section>}
    </aside>
  )
}
