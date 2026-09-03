import { describe, expect, it } from 'vitest'
import { profileForModel } from '../src/client/avatar/profiles.ts'

describe('avatar profile selection', () => {
  it('uses bundled mappings only for known models', () => {
    expect(profileForModel('haru/Haru.model3.json').id).toBe('haru')
    expect(profileForModel('megumi/katou_01.model.json').id).toBe('megumi')
    expect(profileForModel('my-avatar/model3.json').id).toBe('generic')
  })

  it('keeps arbitrary Windows model paths generic', () => {
    expect(profileForModel('custom\\avatar\\model.model3.json').id).toBe('generic')
  })
})
