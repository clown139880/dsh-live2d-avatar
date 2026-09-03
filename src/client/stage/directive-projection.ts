import type { AvatarDirective, AvatarEmotion, AvatarMotion } from '../avatar/types.ts'

const DIRECTIVE_PATTERN = /<!--\s*live2d:(neutral|angry|down|fun|sad|surprise)(?::(none|fast|normal|slow|idle-[123]))?\s*-->/gi

function withoutStreamingCommentTail(text: string): string {
  const start = text.lastIndexOf('<')
  if (start < 0) return text
  const tail = text.slice(start)
  // A streamed directive arrives as "<", "<!", "<!-", "<!--..." before
  // becoming a complete comment. Hide it so "!" is never a TTS delimiter.
  if (tail === '<' || tail === '<!' || tail === '<!-' || (tail.startsWith('<!--') && !tail.includes('-->'))) {
    return text.slice(0, start)
  }
  return text
}

export interface DirectiveProjection {
  cleanText: string
  directives: AvatarDirective[]
  activeDirective: AvatarDirective | null
  segments: DirectiveSegment[]
}

export interface DirectiveSegment {
  text: string
  start: number
  end: number
  directive: AvatarDirective | null
}

export function projectLive2dDirectives(text: string): DirectiveProjection {
  text = withoutStreamingCommentTail(text)
  const directives: AvatarDirective[] = []
  const segments: DirectiveSegment[] = []
  let cleanText = ''
  let sourceOffset = 0
  let activeDirective: AvatarDirective | null = null
  let match: RegExpExecArray | null
  DIRECTIVE_PATTERN.lastIndex = 0
  while ((match = DIRECTIVE_PATTERN.exec(text)) !== null) {
    const visible = text.slice(sourceOffset, match.index)
    if (visible) {
      const start = cleanText.length
      cleanText += visible
      segments.push({ text: visible, start, end: cleanText.length, directive: activeDirective })
    }
    activeDirective = {
      key: `${match.index}:${directives.length}`,
      emotion: match[1]!.toLowerCase() as AvatarEmotion,
      motion: (match[2]?.toLowerCase() ?? 'none') as AvatarMotion,
    }
    directives.push(activeDirective)
    sourceOffset = match.index + match[0].length
  }
  const tail = text.slice(sourceOffset)
  if (tail) {
    const start = cleanText.length
    cleanText += tail
    segments.push({ text: tail, start, end: cleanText.length, directive: activeDirective })
  }
  return {
    cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim(),
    directives,
    activeDirective: directives.at(-1) ?? null,
    segments,
  }
}
