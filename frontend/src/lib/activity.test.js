import { describe, expect, it } from 'vitest'
import {
  activityCounts, filterActivity, mergeActivity, normaliseActivity, ownActivity, sortActivity, topSetsOf,
} from './activity.js'

const at = (d, h = 12) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime()
const workout = (id, d, h, over = {}) => ({
  id, d, start: at(d, h), end: at(d, h) + 3600000, prs: ['0025'], vol: 8400,
  entries: [{ id: '0025', sets: [{ w: 80, r: 5, done: true }, { w: 60, r: 8, done: true }] }],
  ...over,
})

const S = {
  unit: 'kg', customEx: [], workouts: [workout('w1', '2026-11-09', 17), workout('w2', '2026-11-07', 18)],
  milestones: [
    { id: 'weight:78:2026-11-08', kind: 'weight_goal', at: at('2026-11-08'), d: '2026-11-08', data: { targetW: 78, w: 77.8 } },
  ],
}
const user = { id: 'u1', name: 'Jonas' }

describe('the local activity feed', () => {
  it('shows own workouts and reached goals newest first', () => {
    const rows = ownActivity(S, user)
    expect(rows.map(row => row.kind)).toEqual(['workout', 'milestone', 'workout'])
    expect(rows[0].workout).toMatchObject({ name: '', durationSec: 3600, volume: 8400, prCount: 1, unit: 'kg' })
    expect(rows[0].owner).toMatchObject({ id: 'u1', name: 'Jonas', me: true })
    expect(rows[0].workout.topSets).toEqual([{ exerciseId: '0025', weight: 80, reps: 5 }])
    expect(rows[1].milestone.kind).toBe('weight_goal')
    expect(rows[1].milestone.data).toMatchObject({ mode: 'absolute', current: 77.8, targetW: 78 })
  })

  it('reads top sets from completed work sets only', () => {
    expect(topSetsOf({
      entries: [{ id: 'a', sets: [
        { w: 100, r: 5, done: true }, { w: 90, r: 8, done: true },
        { w: 200, r: 10 }, { w: 300, r: 2, done: true, phase: 'warmup' },
      ] }],
    })).toEqual([{ exerciseId: 'a', weight: 100, reps: 5 }])
  })
})

describe('merging server and local rows', () => {
  const friendFeed = [{
    workoutId: 'u2:w1', friend: { id: 'u2', name: 'Ben' }, date: '2026-11-09', name: 'Push A',
    start: at('2026-11-09', 18), end: at('2026-11-09', 19), durationSec: 3600, volume: 9000, unit: 'kg',
    prs: [], prCount: 0, topSets: [], reactions: { '🔥': { count: 1, mine: false } },
  }]
  const friendGoals = [{
    itemId: 'u2:m:weight:80:2026-11-08', kind: 'milestone', friend: { id: 'u2', name: 'Ben' },
    date: '2026-11-08', at: at('2026-11-08'), milestone: { id: 'weight:80:2026-11-08', kind: 'weight_goal', data: { targetW: 80 } }, reactions: {},
  }]

  it('puts friends and goals in one timeline with the owner marked', () => {
    const own = ownActivity(S, user)
    const rows = mergeActivity(own, friendFeed, friendGoals, user)
    expect(rows).toHaveLength(5)
    expect(rows[0].owner).toMatchObject({ id: 'u2', name: 'Ben', me: false })
    expect(rows.find(row => row.kind === 'milestone' && !row.owner.me).milestone.kind).toBe('weight_goal')
  })

  it('normalises an already normalised row and an unknown row without throwing', () => {
    const own = ownActivity(S, user)[0]
    expect(normaliseActivity(own, user).id).toBe(own.id)
    expect(normaliseActivity(null)).toBeNull()
    expect(normaliseActivity({})).toBeNull()
  })
})

describe('filters and counts', () => {
  const rows = mergeActivity(ownActivity(S, user), [{
    workoutId: 'u2:w1', friend: { id: 'u2', name: 'Ben' }, date: '2026-11-09', at: at('2026-11-09'),
    start: at('2026-11-09'), end: at('2026-11-09') + 1, volume: 1, unit: 'kg', topSets: [],
  }], [], user)
  it('splits all, friends, me and goals', () => {
    expect(filterActivity(rows, 'me').every(row => row.owner.me)).toBe(true)
    expect(filterActivity(rows, 'friends').every(row => !row.owner.me)).toBe(true)
    expect(filterActivity(rows, 'goals').every(row => row.kind === 'milestone')).toBe(true)
    expect(filterActivity(rows, 'all')).toHaveLength(rows.length)
    expect(activityCounts(rows)).toEqual({ all: 4, friends: 1, me: 3, goals: 1 })
  })

  it('keeps the newest when the same id arrives twice and sorts by time', () => {
    const a = { id: 'x', kind: 'workout', at: 2, owner: { me: true }, workout: {} }
    const b = { id: 'x', kind: 'workout', at: 3, owner: { me: true }, workout: {} }
    expect(sortActivity([a, b])).toHaveLength(1)
    expect(sortActivity([a, b])[0].at).toBe(3)
  })
})
