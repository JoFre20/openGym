import { describe, expect, it } from 'vitest'
import { repMotionSupport, startPhoneMotion, startWatchMotion } from './motion-source.js'

describe('motion sources', () => {
  it('offers nothing in the web build', async () => {
    await expect(repMotionSupport()).resolves.toEqual({
      ready: true, iphone: false, watch: false, watchReason: 'unsupported',
    })
  })

  it('cannot start a native source in the web build', async () => {
    await expect(startPhoneMotion({ onSamples: () => {} })).rejects.toMatchObject({ code: 'unsupported' })
    await expect(startWatchMotion({ onSamples: () => {}, onState: () => {} })).rejects.toMatchObject({ code: 'unsupported' })
  })
})
