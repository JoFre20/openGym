// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getSharedPlan, reactToWorkout, removeSharedPlan, respondToFriendRequest, saveSocialSettings,
  sendFriendRequest, sharePlanWithFriends, socialError, socialFeed, socialLive, socialMe, socialPlans, socialWorkout
} from './api.js'
import de from '../locales/de.js'
import { _setLangState } from './i18n-core.js'

const answer = body => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' }
})))

afterEach(() => {
  vi.unstubAllGlobals()
  _setLangState('en', {}, null, null)
})

describe('social API', () => {
  it('reads the caller and the feed', async () => {
    answer({ friendCode: 'A7X-92B' })
    expect(await socialMe()).toEqual({ friendCode: 'A7X-92B' })
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/social\/me$/)
    expect(fetch.mock.calls[0][1].method || 'GET').toBe('GET')

    answer({ weekStart: '2026-11-02', squadStats: [], feed: [] })
    expect(await socialFeed()).toEqual({ weekStart: '2026-11-02', squadStats: [], feed: [] })
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/social\/feed$/)

    answer({ now: 1, live: [] })
    expect(await socialLive()).toEqual({ now: 1, live: [] })
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/social\/live$/)

    answer({ workout: { workoutId: 'w1' } })
    expect(await socialWorkout('u2:w/1')).toEqual({ workout: { workoutId: 'w1' } })
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/social\/workout\?workoutId=u2%3Aw%2F1$/)
  })

  it('writes settings, requests and reactions with JSON bodies', async () => {
    answer({ settings: { shareWorkouts: false, shareWeight: 'delta' } })
    await saveSocialSettings({ shareWorkouts: false, shareWeight: 'delta' })
    expect(fetch.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ shareWorkouts: false, shareWeight: 'delta' })

    answer({ request: { id: 'f1' } })
    await sendFriendRequest('a7x-92b')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ friendCode: 'a7x-92b' })

    answer({ ok: true })
    await respondToFriendRequest('f1', 'accept')
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/social\/friends\/respond$/)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ requestId: 'f1', action: 'accept' })

    answer({ ok: true, reactions: {} })
    await reactToWorkout('u2:w1', '🔥')
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/social\/react$/)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ workoutId: 'u2:w1', emoji: '🔥' })
  })

  it('reads the plan inbox, sends a snapshot and opens or removes one', async () => {
    const plans = { received: [], sent: [] }
    answer(plans)
    expect(await socialPlans()).toEqual(plans)
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/social\/plans$/)

    answer({ ok: true, shared: 2 })
    const plan = { opengym_plan: 1, routines: [] }
    expect(await sharePlanWithFriends(['u2', 'u3'], plan)).toEqual({ ok: true, shared: 2 })
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/social\/plans\/share$/)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ friendIds: ['u2', 'u3'], plan })

    answer({ plan })
    expect(await getSharedPlan('p/1')).toEqual({ plan })
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/social\/plans\/plan\?shareId=p%2F1$/)

    answer({ ok: true })
    expect(await removeSharedPlan('p1')).toEqual({ ok: true })
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/social\/plans\/remove$/)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ shareId: 'p1' })
  })
})

describe('socialError', () => {
  const refused = (code, message = 'server message') => Object.assign(new Error(message), { status: 400, data: { error: message, code } })

  it('words the codes in the UI language', () => {
    _setLangState('de', de, null, null)
    expect(socialError(refused('invalid-friend-code'))).toBe(de['That doesn’t look like a friend code.'])
    expect(socialError(refused('friend-code-not-found'))).toBe(de['No profile has that friend code.'])
    expect(socialError(refused('already-friends'))).toBe(de['You are already friends.'])
    expect(socialError(refused('friend-not-found'))).toBe(de['That friend is no longer in your squad.'])
    expect(socialError(refused('plan-too-large'))).toBe(de['This plan is too big to share.'])
    expect(socialError(refused('share-not-found'))).toBe(de['That shared plan is no longer available.'])
    expect(socialError(refused('not-close'))).toBe(de['Only close friends see the details'])
    expect(socialError(refused('locked'))).toBe(de['Too many requests. Try again later.'])
  })

  it('falls back to the server line, then to a generic one', () => {
    expect(socialError(refused('unknown-code', 'the server said this'))).toBe('the server said this')
    expect(socialError(new Error('Failed to fetch'))).toBe('Something went wrong')
    expect(socialError({})).toBe('Something went wrong')
  })
})
