import { describe, expect, it } from 'vitest'
import { avatarStateFromSession, latestAssistantText } from '../src/client/stage/session-projection.ts'

describe('session projection', () => {
  it('prefers streaming assistant text', () => {
    expect(latestAssistantText({
      partial: { blocks: [{ kind: 'text', text: '正在回复' }] },
      nodes: [{ kind: 'assistant', blocks: [{ kind: 'text', text: '旧回复' }] }],
    })).toBe('正在回复')
  })

  it('maps DSH work state in priority order', () => {
    expect(avatarStateFromSession({ running: true, runningCalls: [{ name: 'web' }] })).toBe('tool')
    expect(avatarStateFromSession({ running: true, partial: { blocks: [{ kind: 'text', text: '流式回复' }] } })).toBe('speaking')
    expect(avatarStateFromSession({ running: true, runningCalls: [] })).toBe('thinking')
    expect(avatarStateFromSession({ pending: [{}] })).toBe('waiting')
    expect(avatarStateFromSession({ lastAgentError: 'failed' })).toBe('failed')
  })

  it('stays thinking while an old completed reply is still visible', () => {
    expect(avatarStateFromSession({
      running: true,
      nodes: [{ kind: 'assistant', blocks: [{ kind: 'text', text: '旧回复' }] }],
    })).toBe('thinking')
  })

  it('uses the latest finalized assistant message', () => {
    const snapshot = {
      nodes: [
        { kind: 'assistant', blocks: [{ kind: 'text', text: 'first' }] },
        { kind: 'user', content: [{ type: 'text', text: 'next' }] },
        { kind: 'assistant', blocks: [{ kind: 'text', text: 'second' }] },
      ],
    }
    expect(latestAssistantText(snapshot)).toBe('second')
    expect(avatarStateFromSession(snapshot)).toBe('done')
  })
})
