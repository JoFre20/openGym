// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  socialMe: vi.fn(),
  socialFeed: vi.fn(),
  socialLive: vi.fn(),
  socialPlans: vi.fn(),
  getSharedPlan: vi.fn(),
  removeSharedPlan: vi.fn(),
  reactToWorkout: vi.fn(),
}))

vi.mock('../lib/api.js', async importOriginal => ({
  ...(await importOriginal()),
  socialMe: mocks.socialMe,
  socialFeed: mocks.socialFeed,
  socialLive: mocks.socialLive,
  socialPlans: mocks.socialPlans,
  getSharedPlan: mocks.getSharedPlan,
  removeSharedPlan: mocks.removeSharedPlan,
  reactToWorkout: mocks.reactToWorkout,
}))

import { bindUI } from '../components/ui.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { _resetLiveBadge } from '../lib/live-badge.js'
import { markActivitySeen } from '../lib/activity-seen.js'
import Activity from './Activity.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
bindUI(useUI)
const clone = v => JSON.parse(JSON.stringify(v))
const AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const ME = {
  friendCode: 'A7X-92B', hasPush: true,
  settings: { shareWorkouts: true, shareWeight: 'delta', shareLive: false, notifyFriends: false, startTone: 'motivational', friendStartAlerts: false },
  friends: [{ friendshipId: 'f1', id: 'u2', name: 'Ben', avatar: AVATAR, since: 1 }],
  pending: [{ id: 'r1', direction: 'incoming', userId: 'u2', name: 'Ben', createdAt: 2 }],
  planShares: 0,
}

const FEED = {
  weekStart: '2026-11-02',
  squadStats: [],
  feed: [{
    workoutId: 'u2:w1', kind: 'workout', at: new Date('2026-11-09T18:00:00').getTime(),
    friend: { id: 'u2', name: 'Ben' }, date: '2026-11-09', name: 'Push Day',
    start: 1, end: 2, durationSec: 3600, volume: 8400, unit: 'kg',
    prs: ['0025'], prCount: 1, topSets: [{ exerciseId: '0025', weight: 80, reps: 5 }],
    reactions: { '🔥': { count: 1, mine: false }, '💪': { count: 0, mine: false }, '👑': { count: 0, mine: false } },
  }],
  own: [{
    workoutId: 'u1:w2', kind: 'workout', at: new Date('2026-11-08T17:00:00').getTime(),
    friend: { id: 'u1', name: 'Jonas' }, date: '2026-11-08', name: 'Pull Day',
    start: 1, end: 2, durationSec: 3000, volume: 7000, unit: 'kg',
    prs: [], prCount: 0, topSets: [{ exerciseId: '0025', weight: 80, reps: 5 }], reactions: {},
  }, {
    itemId: 'u1:m:weight:78:2026-11-08', kind: 'milestone', at: new Date('2026-11-08T08:00:00').getTime(),
    friend: { id: 'u1', name: 'Jonas' }, date: '2026-11-08',
    milestone: { id: 'weight:78:2026-11-08', kind: 'weight_goal', data: { mode: 'absolute', unit: 'kg', targetW: 78, current: 77.8, delta: -4.2 } },
    reactions: { '🔥': { count: 2, mine: false } },
  }],
  milestones: [{
    itemId: 'u2:m:weight:80:2026-11-07', kind: 'milestone', at: new Date('2026-11-07T08:00:00').getTime(),
    friend: { id: 'u2', name: 'Ben' }, date: '2026-11-07',
    milestone: { id: 'weight:80:2026-11-07', kind: 'weight_goal', data: { mode: 'delta', unit: 'kg', delta: -1.5 } },
    reactions: {},
  }],
}

const mounted = []
function render(el, entries = ['/social']) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(<MemoryRouter initialEntries={entries}>{el}</MemoryRouter>))
  return host
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const labels = host => [...host.querySelectorAll('.act-filter')].map(b => b.textContent.trim())
const clickLabel = (host, text) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  if (!button) throw new Error('no button: ' + text)
  act(() => button.click())
  return button
}
function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="location">{loc.pathname}</span>
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null, timer: null, work: null })
  _resetLiveBadge()
  useStore.setState({
    S: { ...clone(DEF), unit: 'kg', workouts: [], milestones: [] },
    user: { id: 'u1', name: 'Jonas' }, ready: true,
  })
  mocks.socialMe.mockReset().mockResolvedValue(ME)
  mocks.socialFeed.mockReset().mockResolvedValue(FEED)
  mocks.socialLive.mockReset().mockResolvedValue({ now: Date.now(), live: [] })
  mocks.socialPlans.mockReset().mockResolvedValue({ received: [], sent: [] })
  mocks.getSharedPlan.mockReset()
  mocks.removeSharedPlan.mockReset()
  mocks.reactToWorkout.mockReset()
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) })
  vi.restoreAllMocks()
})

describe('Activity', () => {
  it('shows own workouts, friends and reached goals in one feed', async () => {
    const host = render(<Activity />)
    await flush()
    expect(mocks.socialFeed).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Pull Day')
    expect(host.textContent).toContain('Push Day')
    expect(host.textContent).toContain('Weight goal')
    expect(host.textContent).toMatch(/77[.,]8 kg/)
    expect(labels(host)).toEqual(['All', 'Friends', 'Me', 'Goals'])
  })

  it('shows only what is new since the last visit', async () => {
    markActivitySeen('u1', new Date('2026-11-07T12:00:00').getTime())
    const host = render(<Activity />)
    await flush()
    expect(labels(host)).toEqual(['All3', 'Friends1', 'Me2', 'Goals1'])
  })

  it('clears the unread numbers when the screen is left', async () => {
    markActivitySeen('u1', new Date('2026-11-07T12:00:00').getTime())
    const first = render(<Activity />)
    await flush()
    expect(labels(first)).toContain('All3')

    const mountedFirst = mounted.pop()
    act(() => { mountedFirst.root.unmount(); mountedFirst.host.remove() })

    const again = render(<Activity />)
    await flush()
    expect(labels(again)).toEqual(['All', 'Friends', 'Me', 'Goals'])
  })

  it('keeps live rows above the filters', async () => {
    mocks.socialLive.mockResolvedValue({
      now: Date.now(),
      live: [{
        friend: { id: 'u2', name: 'Ben' }, workoutId: 'w1', name: 'Push Day',
        exerciseId: '0025', exName: 'Bench Press', exIdx: 2, exTotal: 5,
        setsDone: 3, setsTotal: 12, startedAt: Date.now() - 60000, updatedAt: Date.now(),
        etaAt: Date.now() + 900000, leftSec: 900,
      }],
    })
    const host = render(<Activity />)
    await flush()
    await flush()
    expect(host.textContent).toContain('Live now')
    const order = [...host.querySelectorAll('.social-live, .act-filters')].map(el => el.className)
    expect(order[0]).toContain('social-live')
    expect(order[1]).toContain('act-filters')
  })

  it('shows a limited live card without the close-friend details', async () => {
    mocks.socialLive.mockResolvedValue({
      now: Date.now(),
      live: [{
        friend: { id: 'u2', name: 'Ben' }, workoutId: 'w1', name: 'Push Day',
        startedAt: Date.now() - 60000, updatedAt: Date.now(), limited: true,
      }],
    })
    const host = render(<Activity />)
    await flush()
    await flush()
    const card = host.querySelector('.social-live-card')
    expect(card.textContent).toContain('Only close friends see the details')
    expect(card.textContent).not.toContain('sets')
    expect(card.textContent).not.toContain('Done around')
  })

  it('offers exercise stats on own workouts, and on a friend only when close', async () => {
    const host = render(<Activity />)
    await flush()
    const cards = () => [...host.querySelectorAll('.social-feed-card')]
    const own = cards().find(card => card.textContent.includes('Pull Day'))
    const friend = cards().find(card => card.textContent.includes('Push Day'))
    expect(own.querySelector('button.act-ex-open')).not.toBeNull()
    expect(friend.querySelector('button.act-ex-open')).toBeNull()

    mocks.socialMe.mockResolvedValue({ ...ME, friends: [{ ...ME.friends[0], close: true }] })
    const closeHost = render(<Activity />)
    await flush()
    const closeFriend = [...closeHost.querySelectorAll('.social-feed-card')].find(card => card.textContent.includes('Push Day'))
    expect(closeFriend.querySelector('button.act-ex-open')).not.toBeNull()
  })

  it('reacts to a friend card and updates its count', async () => {
    mocks.reactToWorkout.mockResolvedValue({
      ok: true, reactions: { '🔥': { count: 2, mine: true }, '💪': { count: 0, mine: false }, '👑': { count: 0, mine: false } },
    })
    const host = render(<Activity />)
    await flush()
    const fire = host.querySelector('button[aria-label="React with 🔥"]')
    act(() => fire.click())
    await flush()
    expect(mocks.reactToWorkout).toHaveBeenCalledWith('u2:w1', '🔥')
    expect(host.querySelector('button[aria-label="React with 🔥"]').textContent).toContain('2')
  })

  it('filters to goals and to the caller', async () => {
    const host = render(<Activity />)
    await flush()
    clickLabel(host, 'Goals')
    expect(host.textContent).toContain('Weight goal')
    expect(host.textContent).not.toContain('Pull Day')
    clickLabel(host, 'Me')
    expect(host.textContent).toContain('Pull Day')
    expect(host.textContent).not.toContain('Push Day')
  })

  it('keeps the local feed when the server is unavailable or there is no account', async () => {
    useStore.setState({
      S: {
        ...clone(DEF), unit: 'kg', workouts: [{
          id: 'w1', d: '2026-11-09', start: 1, end: 2,
          entries: [{ id: '0025', sets: [{ w: 80, r: 5, done: true }] }],
        }],
      },
      user: null,
    })
    mocks.socialMe.mockResolvedValue(null)
    const host = render(<Activity />)
    await flush()
    expect(host.textContent).toContain('Workout')
    expect(host.textContent).toContain('Friends need an account on this server')
  })

  it('opens the Crew screen from the header', async () => {
    const host = render(<><Activity /><LocationProbe /></>)
    await flush()
    act(() => host.querySelector('button[aria-label="Crew"]').click())
    expect(host.querySelector('[data-testid="location"]').textContent).toBe('/crew')
  })

  it('shows shared plans and a friend request in For you', async () => {
    mocks.socialPlans.mockResolvedValue({
      received: [{
        id: 'p1', from: { id: 'u2', name: 'Ben', avatar: AVATAR }, name: 'Push Pull',
        routineCount: 2, exerciseCount: 6, scheduledDays: 3,
      }],
      sent: [],
    })
    const host = render(<Activity />)
    await flush()
    expect(host.textContent).toContain('For you')
    expect(host.textContent).toContain('Push Pull')
    expect(host.textContent).toContain('Friends')
    expect(host.textContent).toContain('Requests')
  })
})
