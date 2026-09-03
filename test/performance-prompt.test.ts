import { describe, expect, it } from 'vitest'
import { performancePromptEnabled, sessionIdFromScope } from '../src/host/performance-prompt.ts'

describe('performance prompt consent', () => {
  it('is disabled by default and can be enabled for one conversation only', () => {
    const overrides = new Map<string, boolean>([['session-a', true]])
    expect(performancePromptEnabled({ id: 'session-a' }, false, overrides)).toBe(true)
    expect(performancePromptEnabled({ id: 'session-b' }, false, overrides)).toBe(false)
    expect(performancePromptEnabled(undefined, false, overrides)).toBe(false)
  })

  it('allows a conversation to override an enabled global default', () => {
    const overrides = new Map<string, boolean>([['session-a', false]])
    expect(performancePromptEnabled({ id: 'session-a' }, true, overrides)).toBe(false)
    expect(performancePromptEnabled({ id: 'session-b' }, true, overrides)).toBe(true)
  })

  it('extracts only a non-empty string agent id from the prompt scope', () => {
    expect(sessionIdFromScope({ id: 'session-a' })).toBe('session-a')
    expect(sessionIdFromScope({ id: 1 })).toBeUndefined()
    expect(sessionIdFromScope({})).toBeUndefined()
  })
})
