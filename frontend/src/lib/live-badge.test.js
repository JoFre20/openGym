import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ socialLive: vi.fn() }))
vi.mock('./api.js', async importOriginal => ({
  ...(await importOriginal()),
  socialLive: mocks.socialLive,
}))

import {
  _resetLiveBadge, clearLiveBadge, getLiveRows, isLiveNow, noteLiveRows, refreshLiveBadge, subscribeLive,
} from './live-badge.js'

const row = id => ({ friend: { id, name: id }, workoutId: 'w', name: 'Push', updatedAt: 10 })

beforeEach(() => {
  _resetLiveBadge()
  mocks.socialLive.mockReset()
})
afterEach(() => {
  _resetLiveBadge()
  vi.restoreAllMocks()
})

describe('the live badge store', () => {
  it('keeps the rows for one profile and notifies subscribers on a change', () => {
    const seen = []
    const off = subscribeLive(() => seen.push(getLiveRows('u1').length))
    expect(isLiveNow('u1')).toBe(false)
    expect(noteLiveRows('u1', [row('u2')])).toBe(1)
    expect(getLiveRows('u1')).toHaveLength(1)
    expect(isLiveNow('u1')).toBe(true)
    expect(getLiveRows('u2')).toEqual([])
    expect(seen).toEqual([1])
    expect(noteLiveRows('u1', [row('u2')])).toBe(1)
    expect(seen).toEqual([1])              // the same rows: no second notification
    off()
  })

  it('drops malformed rows and clears on sign-out', () => {
    noteLiveRows('u1', [row('u2'), null, { friend: {} }])
    expect(getLiveRows('u1')).toHaveLength(1)
    clearLiveBadge('u1')
    expect(isLiveNow('u1')).toBe(false)
  })

  it('uses the server answer and joins a second request already in flight', async () => {
    mocks.socialLive.mockResolvedValue({ live: [row('u2'), row('u3')] })
    const [first, second] = await Promise.all([
      refreshLiveBadge('u1', { force: true }),
      refreshLiveBadge('u1', { force: true }),
    ])
    expect(first).toBe(2)
    expect(second).toBe(2)
    expect(mocks.socialLive).toHaveBeenCalledTimes(1)
    expect(getLiveRows('u1')).toHaveLength(2)
  })

  it('keeps the last rows when the server cannot answer', async () => {
    noteLiveRows('u1', [row('u2')], { now: 0 })
    mocks.socialLive.mockRejectedValue(new Error('offline'))
    expect(await refreshLiveBadge('u1', { force: true })).toBe(1)
    expect(isLiveNow('u1')).toBe(true)
  })

  it('does not fetch for no account or a fresh cache', async () => {
    expect(await refreshLiveBadge('')).toBe(0)
    expect(mocks.socialLive).not.toHaveBeenCalled()
    noteLiveRows('u1', [row('u2')], { now: 100 })
    expect(await refreshLiveBadge('u1', { now: 200 })).toBe(1)
    expect(mocks.socialLive).not.toHaveBeenCalled()
  })
})
