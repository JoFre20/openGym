// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  socialMe: vi.fn(),
  socialFeed: vi.fn(),
  socialPlans: vi.fn(),
  getSharedPlan: vi.fn(),
  removeSharedPlan: vi.fn(),
  saveSocialSettings: vi.fn(),
  sendFriendRequest: vi.fn(),
  respondToFriendRequest: vi.fn(),
  reactToWorkout: vi.fn(),
}))

vi.mock('../lib/api.js', async importOriginal => ({
  ...(await importOriginal()),
  socialMe: mocks.socialMe,
  socialFeed: mocks.socialFeed,
  socialPlans: mocks.socialPlans,
  getSharedPlan: mocks.getSharedPlan,
  removeSharedPlan: mocks.removeSharedPlan,
  saveSocialSettings: mocks.saveSocialSettings,
  sendFriendRequest: mocks.sendFriendRequest,
  respondToFriendRequest: mocks.respondToFriendRequest,
  reactToWorkout: mocks.reactToWorkout,
}))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Social, { SOCIAL_REFRESH_MS } from './Social.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))

const AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const ME = {
  friendCode: 'A7X-92B',
  settings: { shareWorkouts: true, shareWeight: 'delta' },
  friends: [
    { friendshipId: 'f1', id: 'u2', name: 'Ben', avatar: AVATAR, since: 1 },
    { friendshipId: 'f2', id: 'u3', name: 'Cara', since: 1 },
  ],
  pending: [{ id: 'r1', direction: 'incoming', userId: 'u3', name: 'Cara', createdAt: 2 }],
}

const FEED = {
  weekStart: '2026-11-02',
  squadStats: [
    { id: 'u2', name: 'Ben', avatar: AVATAR, workoutsThisWeek: 3, weight: { mode: 'absolute', unit: 'kg', current: 80, delta: -1.5, since: '2026-10-01', trend: 'down' } },
    { id: 'u3', name: 'Cara', workoutsThisWeek: null, weight: null },
  ],
  feed: [{
    workoutId: 'u2:w1',
    friend: { id: 'u2', name: 'Ben' },
    date: '2026-11-01',
    name: 'Push Day',
    start: 1,
    end: 2,
    durationSec: 3600,
    volume: 8400,
    unit: 'kg',
    prs: ['0025'],
    prCount: 1,
    topSets: [{ exerciseId: '0025', weight: 80, reps: 5 }],
    reactions: {
      '🔥': { count: 1, mine: false },
      '💪': { count: 0, mine: false },
      '👑': { count: 0, mine: false },
    },
  }],
}

const mounted = []
function render(el, entries = ['/']) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(<MemoryRouter initialEntries={entries}>{el}</MemoryRouter>))
  return host
}
function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="location">{loc.pathname + loc.search}</span>
}
const topSheet = () => {
  const sheet = useUI.getState().sheets.at(-1)
  return sheet ? render(sheet.render(() => useUI.getState().closeSheet(sheet.id))) : null
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const click = (host, text) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  if (!button) throw new Error('no button: ' + text)
  act(() => button.click())
  return button
}
const buttonByLabel = (host, label) => host.querySelector(`button[aria-label="${label}"]`)
const setValue = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

function seed(user = { id: 'u1', name: 'Ada' }) {
  useStore.setState({ S: Object.assign(clone(DEF), { unit: 'kg' }), user, ready: true })
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null, timer: null, work: null })
  seed()
  mocks.socialMe.mockReset().mockResolvedValue(ME)
  mocks.socialFeed.mockReset().mockResolvedValue(FEED)
  mocks.socialPlans.mockReset().mockResolvedValue({ received: [], sent: [] })
  mocks.getSharedPlan.mockReset()
  mocks.removeSharedPlan.mockReset()
  mocks.saveSocialSettings.mockReset()
  mocks.sendFriendRequest.mockReset()
  mocks.respondToFriendRequest.mockReset()
  mocks.reactToWorkout.mockReset()
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Friends & squad', () => {
  it('loads the squad, converts the weight to the profile unit and reacts in one tap', async () => {
    const host = render(<Social />)
    await flush()

    expect(mocks.socialMe).toHaveBeenCalledTimes(1)
    expect(mocks.socialFeed).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Ben')
    expect(host.textContent).toContain('Push Day')
    expect(host.textContent).toContain('Top sets')
    expect(host.textContent).toContain('80 kg')
    expect(host.textContent).toContain('1.5 kg')

    mocks.reactToWorkout.mockResolvedValue({
      ok: true,
      reactions: { '🔥': { count: 2, mine: true }, '💪': { count: 0, mine: false }, '👑': { count: 0, mine: false } },
    })
    act(() => buttonByLabel(host, 'React with 🔥').click())
    await flush()
    expect(mocks.reactToWorkout).toHaveBeenCalledWith('u2:w1', '🔥')
    expect(buttonByLabel(host, 'React with 🔥').classList.contains('on')).toBe(true)
    expect(buttonByLabel(host, 'React with 🔥').textContent).toContain('2')
  })

  it('shows a lock ring and one clear private label for a private friend', async () => {
    const host = render(<Social />)
    await flush()

    const cards = [...host.querySelectorAll('.social-friend')]
    const cara = cards.find(card => card.textContent.includes('Cara'))
    expect(cara.querySelector('.social-ring-num .icn')).not.toBeNull()
    expect(cara.querySelector('.social-ring-wrap').getAttribute('aria-label')).toBe('Workouts · Private')
    expect(cara.querySelector('.social-friend-meta')).toBeNull()
    expect(cara.querySelector('.social-weight-private').textContent).toBe('Weight · Private')
    expect(cara.textContent.match(/Private/g)).toHaveLength(1)

    const ben = cards.find(card => card.textContent.includes('Ben'))
    expect(ben.querySelector('.social-ring-num').textContent).toBe('3')
    expect(ben.querySelector('.social-ring-wrap').getAttribute('aria-label')).toBe('3 workouts')
    expect(ben.querySelector('.social-friend-meta').textContent).toBe('3 workouts')
  })

  it('shows uploaded profile pictures on the squad and activity cards', async () => {
    const host = render(<Social />)
    await flush()

    const ben = [...host.querySelectorAll('.social-friend')].find(card => card.textContent.includes('Ben'))
    expect(ben.querySelector('img').getAttribute('src')).toBe(AVATAR)
    expect(host.querySelector('.social-feed-card img').getAttribute('src')).toBe(AVATAR)
  })

  it('shows the active seasonal element next to the Friends title', async () => {
    useStore.setState({ S: { ...useStore.getState().S, seasonal: { halloween: 'on' } } })
    const host = render(<Social />)
    await flush()
    for (let i = 0; i < 20 && !host.querySelector('.social-season svg'); i++) {
      await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    }
    expect(host.querySelector('.social-season .hw-friends .hw-spidersvg')).not.toBeNull()
  })

  it('saves the privacy switches', async () => {
    mocks.saveSocialSettings.mockResolvedValue({ settings: { shareWorkouts: false, shareWeight: 'delta' } })
    const host = render(<Social />)
    await flush()

    act(() => host.querySelector('button[role="switch"][aria-label="Share workouts"]').click())
    await flush()
    expect(mocks.saveSocialSettings).toHaveBeenCalledWith({ shareWorkouts: false, shareWeight: 'delta' })
    expect(host.querySelector('button[aria-label="Share workouts"]').getAttribute('aria-checked')).toBe('false')
  })

  it('copies the code, sends a request and accepts an incoming one', async () => {
    let call = 0
    mocks.socialMe.mockImplementation(async () => {
      call += 1
      if (call === 1) return ME
      if (call === 2) return { ...ME, pending: [...ME.pending, { id: 'r2', direction: 'outgoing', userId: 'u4', name: 'Dana', createdAt: 3 }] }
      return { ...ME, pending: [], friends: [...ME.friends, { friendshipId: 'f3', id: 'u3', name: 'Cara' }] }
    })
    mocks.sendFriendRequest.mockResolvedValue({ request: { id: 'r2' } })
    mocks.respondToFriendRequest.mockResolvedValue({ ok: true })
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const host = render(<Social />)
    await flush()
    act(() => buttonByLabel(host, 'Add friend').click())
    const sheet = topSheet()

    expect(sheet.textContent).toContain('A7X-92B')
    act(() => sheet.querySelector('.social-code').click())
    await flush()
    expect(writeText).toHaveBeenCalledWith('A7X-92B')

    const input = sheet.querySelector('.social-code-field input')
    setValue(input, 'a7x92b')
    expect(input.value).toBe('A7X-92B')
    click(sheet, 'Send request')
    await flush()
    expect(mocks.sendFriendRequest).toHaveBeenCalledWith('A7X-92B')
    expect(sheet.textContent).toContain('Waiting for Dana')

    click(sheet, 'Accept')
    await flush()
    expect(mocks.respondToFriendRequest).toHaveBeenCalledWith('r1', 'accept')
    expect(useUI.getState().toastMsg).toBe('Friend added')
  })

  it('opens the add sheet with the code from a friend link and clears the link', async () => {
    const host = render(<><Social /><LocationProbe /></>, ['/social?friend=QRT-CYD'])
    await flush()

    const sheet = topSheet()
    expect(sheet.querySelector('.social-code-field input').value).toBe('QRT-CYD')
    expect(host.querySelector('[data-testid="location"]').textContent).toBe('/social')
  })

  it('shares a link to the friends sheet', async () => {
    useStore.setState({ sync: { ...useStore.getState().sync, server: 'https://gym.example' } })
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })

    const host = render(<Social />)
    await flush()
    act(() => buttonByLabel(host, 'Add friend').click())
    const sheet = topSheet()

    click(sheet, 'Share friend link')
    await flush()
    expect(writeText).toHaveBeenCalledWith('https://gym.example/#/social?friend=A7X-92B')
    expect(useUI.getState().toastMsg).toBe('Copied')
  })

  it('removes a friend from the card menu after confirming', async () => {
    mocks.respondToFriendRequest.mockResolvedValue({ ok: true })
    const host = render(<Social />)
    await flush()

    act(() => host.querySelector('.social-friend .social-more').click())
    let sheet = topSheet()
    const removeItem = [...sheet.querySelectorAll('.menu-item')].find(row => row.textContent.trim() === 'Remove friend')
    act(() => removeItem.click())
    sheet = topSheet()
    click(sheet, 'Remove')
    await flush()
    expect(mocks.respondToFriendRequest).toHaveBeenCalledWith('f1', 'remove')
    expect(useUI.getState().toastMsg).toBe('Friend removed')
  })

  it('refreshes quietly when the app returns after the refresh window', async () => {
    const host = render(<Social />)
    await flush()
    expect(mocks.socialFeed).toHaveBeenCalledTimes(1)

    act(() => window.dispatchEvent(new Event('focus')))
    await flush()
    expect(mocks.socialFeed).toHaveBeenCalledTimes(1)

    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + SOCIAL_REFRESH_MS + 1000)
    act(() => window.dispatchEvent(new Event('focus')))
    await flush()
    expect(mocks.socialFeed).toHaveBeenCalledTimes(2)
    now.mockRestore()
    expect(host.textContent).toContain('Push Day')
  })

  it('shows an account prompt to a guest and calls nothing', async () => {
    seed(null)
    const host = render(<Social />)
    await flush()
    expect(host.textContent).toContain('Friends need an account on this server')
    expect(mocks.socialMe).not.toHaveBeenCalled()
    expect(mocks.socialFeed).not.toHaveBeenCalled()
  })

  it('says when the squad cannot load, and retries', async () => {
    mocks.socialMe.mockRejectedValue(new Error('offline'))
    mocks.socialFeed.mockRejectedValue(new Error('offline'))
    const host = render(<Social />)
    await flush()
    expect(host.textContent).toContain('Couldn’t load your squad')
    expect(host.textContent).toContain('Try again')

    mocks.socialMe.mockResolvedValue(ME)
    mocks.socialFeed.mockResolvedValue(FEED)
    click(host, 'Try again')
    await flush()
    expect(host.textContent).toContain('Push Day')
  })

  it('keeps the squad and feed when the shared plan inbox cannot load', async () => {
    mocks.socialPlans.mockRejectedValue(Object.assign(new Error('not found'), {
      status: 404, data: { error: 'not found' },
    }))
    const host = render(<Social />)
    await flush()

    expect(host.textContent).toContain('Ben')
    expect(host.textContent).toContain('Push Day')
    expect(host.textContent).not.toContain('Couldn’t load your squad')
    expect(host.textContent).not.toContain('not found')
  })

  it('shows a shared plan, opens the import sheet and closes the share after adding it', async () => {
    const plan = {
      opengym_plan: 1, name: 'Ben’s plan', unit: 'kg', week: { 1: ['r1'] },
      routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 80 }] }],
      customEx: [],
    }
    mocks.socialMe.mockResolvedValue({ ...ME, planShares: 1 })
    mocks.socialPlans.mockResolvedValue({
      received: [{
        id: 'p1', from: { id: 'u2', name: 'Ben', avatar: AVATAR }, name: 'Ben’s plan', unit: 'kg',
        routineCount: 1, exerciseCount: 1, scheduledDays: 1, createdAt: Date.now(),
      }],
      sent: [],
    })
    mocks.getSharedPlan.mockResolvedValue({ plan })
    mocks.removeSharedPlan.mockResolvedValue({ ok: true })

    const host = render(<Social />)
    await flush()
    expect(host.textContent).toContain('Shared with you')
    expect(host.textContent).toContain('Ben’s plan')
    expect(host.querySelector('.social-plan-card img').getAttribute('src')).toBe(AVATAR)

    click(host, 'Open')
    await flush()
    const sheet = topSheet()
    expect(sheet.textContent).toContain('Import “Ben’s plan”')
    click(sheet, 'Add to my plan')
    await flush()
    await flush()

    expect(useStore.getState().S.routines.some(routine => routine.name === 'Push')).toBe(true)
    expect(mocks.removeSharedPlan).toHaveBeenCalledWith('p1')
  })

  it('removes a shared plan from its menu after confirming', async () => {
    mocks.socialPlans.mockResolvedValue({
      received: [{
        id: 'p1', from: { id: 'u2', name: 'Ben' }, name: 'Ben’s plan', unit: 'kg',
        routineCount: 1, exerciseCount: 1, scheduledDays: 0, createdAt: Date.now(),
      }],
      sent: [],
    })
    mocks.removeSharedPlan.mockResolvedValue({ ok: true })

    const host = render(<Social />)
    await flush()
    act(() => host.querySelector('.social-plan-card .social-more').click())
    let sheet = topSheet()
    const removeItem = [...sheet.querySelectorAll('.menu-item')].find(row => row.textContent.trim() === 'Remove shared plan')
    act(() => removeItem.click())
    sheet = topSheet()
    click(sheet, 'Remove')
    await flush()

    expect(mocks.removeSharedPlan).toHaveBeenCalledWith('p1')
    expect(host.textContent).not.toContain('Ben’s plan')
    expect(useUI.getState().toastMsg).toBe('Shared plan removed')
  })
})
