import { describe, expect, it } from 'vitest'
import { projectLive2dDirectives } from '../src/client/stage/directive-projection.ts'

describe('LLM Live2D directives', () => {
  it('extracts ordered hidden directives and removes them from dialogue', () => {
    const result = projectLive2dDirectives('<!--live2d:surprise:fast-->真的吗？\n<!--live2d:fun:slow-->太好了。')
    expect(result.cleanText).toBe('真的吗？\n太好了。')
    expect(result.directives.map(({ emotion, motion }) => [emotion, motion])).toEqual([
      ['surprise', 'fast'], ['fun', 'slow'],
    ])
    expect(result.activeDirective?.emotion).toBe('fun')
    expect(result.segments.map(({ text, directive }) => [text, directive?.emotion ?? null])).toEqual([
      ['真的吗？\n', 'surprise'], ['太好了。', 'fun'],
    ])
  })

  it('defaults an expression-only directive to no body motion', () => {
    expect(projectLive2dDirectives('<!-- live2d:down -->让我想想。').activeDirective).toMatchObject({ emotion: 'down', motion: 'none' })
  })

  it('exposes all three bundled idle performances', () => {
    expect(projectLive2dDirectives('<!--live2d:neutral:idle-3-->我在听。').activeDirective)
      .toMatchObject({ emotion: 'neutral', motion: 'idle-3' })
  })

  it('leaves ordinary text neutral and unchanged', () => {
    expect(projectLive2dDirectives('普通技术回答。')).toMatchObject({ cleanText: '普通技术回答。', directives: [], activeDirective: null })
  })

  it.each(['<', '<!', '<!-', '<!--', '<!--live2d:fun:nor'])('hides a streamed directive tail: %s', (partial) => {
    expect(projectLive2dDirectives(partial)).toMatchObject({ cleanText: '', segments: [] })
  })

  it('keeps stable text while hiding the next incomplete directive', () => {
    expect(projectLive2dDirectives('第一句。<!--live2d:sad')).toMatchObject({ cleanText: '第一句。' })
  })
})
