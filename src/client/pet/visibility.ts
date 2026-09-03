import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'dsh-live2d-avatar:pet-visible'
const listeners = new Set<() => void>()
let enabled = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true'

function emit(): void {
  for (const listener of listeners) listener()
}

function visible(): boolean {
  return enabled
}

export function setPetVisible(next: boolean): void {
  setPetEnabled(next)
}

export function setPetEnabled(next: boolean): void {
  if (enabled === next) return
  enabled = next
  try { localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* storage may be unavailable */ }
  emit()
}

export function usePetEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => enabled,
  )
}

export function activateHeroineStage(): void {
  setPetEnabled(false)
  queueMicrotask(() => {
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((candidate) => candidate.textContent?.trim() === '形象')
    tab?.click()
  })
}

export function usePetVisible(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    visible,
  )
}
