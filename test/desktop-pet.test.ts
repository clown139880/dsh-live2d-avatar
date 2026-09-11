import { describe, expect, it } from 'vitest'
import { presentationFromPayload, petUrl, windowBoundsFromPayload } from '../src/host/desktop-pet.ts'
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

describe('desktop pet window bounds', () => {
  it('uses the saved screen position and clamped width from the payload', () => {
    expect(windowBoundsFromPayload({ width: 260, x: 412, y: 88 })).toEqual({
      width: 260,
      height: Math.round(260 * 250 / 180),
      x: 412,
      y: 88,
    })
  })

  it('clamps width into the window range and omits a missing position', () => {
    expect(windowBoundsFromPayload({ width: 5000 })).toEqual({
      width: 480,
      height: Math.round(480 * 250 / 180),
      x: undefined,
      y: undefined,
    })
  })

  it('defaults to a 300px-wide window and ignores non-finite position', () => {
    expect(windowBoundsFromPayload({ width: Number.NaN, x: Number.NaN, y: 'high' })).toEqual({
      width: 300,
      height: Math.round(300 * 250 / 180),
      x: undefined,
      y: undefined,
    })
  })
})
