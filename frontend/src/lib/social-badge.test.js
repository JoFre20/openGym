import { beforeEach, describe, expect, it, vi } from 'vitest'

const socialMe = vi.hoisted(() => vi.fn())
vi.mock('./api.js', () => ({ socialMe }))

import {
  _resetSocialPending, getSocialPending, noteSocialPending, refreshSocialPending, subscribeSocialPending
} from './social-badge.js'

const me = (pending, planShares = 0) => ({
  friendCode: 'A7X-92B', settings: { shareWorkouts: true, shareWeight: 'none' }, friends: [], pending, planShares
})

beforeEach(() => { _resetSocialPending(); socialMe.mockReset() })

describe('social pending badge', () => {
  it('counts incoming requests and shared plans, and keeps them per user', () => {
    noteSocialPending('u1', me([
      { id: 'a', direction: 'incoming' },
      { id: 'b', direction: 'outgoing' },
      { id: 'c', direction: 'incoming' },
    ], 1))
    expect(getSocialPending('u1')).toBe(3)
    expect(getSocialPending('u2')).toBe(0)
  })

  it('notifies subscribers only when the count changes', () => {
    const seen = vi.fn()
    const off = subscribeSocialPending(seen)
    noteSocialPending('u1', me([{ id: 'a', direction: 'incoming' }]))
    noteSocialPending('u1', me([{ id: 'a', direction: 'incoming' }]))
    noteSocialPending('u1', me([]))
    expect(seen).toHaveBeenCalledTimes(2)
    off()
  })

  it('refreshes through socialMe, caches for a minute and can be forced', async () => {
    socialMe.mockResolvedValue(me([{ id: 'a', direction: 'incoming' }]))
    expect(await refreshSocialPending('u1', { now: 1000 })).toBe(1)
    expect(await refreshSocialPending('u1', { now: 2000 })).toBe(1)
    expect(socialMe).toHaveBeenCalledTimes(1)
    expect(await refreshSocialPending('u1', { now: 61000 })).toBe(1)
    expect(socialMe).toHaveBeenCalledTimes(2)
    await refreshSocialPending('u1', { now: 62000, force: true })
    expect(socialMe).toHaveBeenCalledTimes(3)
  })

  it('a failed refresh keeps the last count', async () => {
    noteSocialPending('u1', me([{ id: 'a', direction: 'incoming' }]), { now: 1000 })
    socialMe.mockRejectedValue(new Error('offline'))
    expect(await refreshSocialPending('u1', { now: 70000 })).toBe(1)
  })
})
