import type { AvatarState } from '../avatar/types.ts'

function textFromBlocks(blocks: readonly any[] | undefined): string {
  if (!blocks) return ''
  return blocks
    .filter((block) => block?.kind === 'text' || block?.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('')
    .trim()
}

export function streamingAssistantText(snapshot: any): string {
  return textFromBlocks(snapshot?.partial?.blocks)
}

export function latestAssistantText(snapshot: any): string {
  const partial = streamingAssistantText(snapshot)
  if (partial) return partial
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node?.kind === 'assistant') return textFromBlocks(node.blocks)
  }
  return ''
}

export function avatarStateFromSession(snapshot: any): AvatarState {
  if (snapshot?.lastAgentError || snapshot?.promptError) return 'failed'
  if (snapshot?.pending?.length) return 'waiting'
  if (snapshot?.runningCalls?.length) return 'tool'
  if (snapshot?.running && streamingAssistantText(snapshot)) return 'speaking'
  if (snapshot?.running) return 'thinking'
  if (latestAssistantText(snapshot)) return 'done'
  return 'idle'
}
