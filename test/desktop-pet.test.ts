import { describe, expect, it } from 'vitest'
import { presentationFromPayload, petUrl } from '../src/host/desktop-pet.ts'
import { DEFAULT_CONFIG } from '../src/shared/config.ts'

describe('desktop pet presentation', () => {
  it('uses the current client presentation instead of a stale host snapshot', () => {
    const presentation = presentationFromPayload({
      modelEntry: 'megumi/katou_01.model.json',
      characterName: 'Megumi',
      showPetNameplate: true,
      modelScale: 1.2,
      modelX: 0.15,
      modelY: -0.1,
    }, DEFAULT_CONFIG)

    expect(presentation).toEqual({
      modelEntry: 'megumi/katou_01.model.json',
      characterName: 'Megumi',
      showPetNameplate: true,
      modelScale: 1.2,
      modelX: 0.15,
      modelY: -0.1,
    })
    expect(petUrl('http://127.0.0.1:1234', presentation)).toContain(
      'model=megumi%2Fkatou_01.model.json',
    )
  })

  it('falls back and clamps malformed presentation values', () => {
    expect(presentationFromPayload({
      modelEntry: '   ',
      characterName: '',
      modelScale: 99,
      modelX: Number.NaN,
      modelY: -99,
    }, DEFAULT_CONFIG)).toMatchObject({
      modelEntry: DEFAULT_CONFIG.modelEntry,
      characterName: DEFAULT_CONFIG.characterName,
      modelScale: 5,
      modelX: DEFAULT_CONFIG.modelX,
      modelY: -3,
    })
  })
})
