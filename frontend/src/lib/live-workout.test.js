import { describe, expect, it } from 'vitest'
import { buildLivePayload, estimateSecondsLeft, liveWorkoutKey, priorPerSetSec } from './live-workout.js'

const T0 = 1_800_000_000_000
const set = done => ({ w: 80, r: 5, done })
const entry = (id, sets) => ({ id, sets })
const active = (patch = {}) => ({
  id: 'w1', name: 'Push Day', start: T0, cur: 0, routineIds: ['r1'],
  entries: [
    entry('0025', [set(true), set(true), set(false), set(false)]),
    entry('0027', [set(false), set(false)]),
  ],
  ...patch,
})

describe('live workout ETA', () => {
  it('uses rest plus a typical set when there is no history', () => {
    expect(priorPerSetSec(active(), { defaultRestSec: 90 })).toBe(135)
    expect(priorPerSetSec(active(), { defaultRestSec: 0 })).toBe(45)
  })

  it('reads the median pace of the same routine, ignoring unrelated sessions', () => {
    const done16 = entry('0025', Array.from({ length: 16 }, () => set(true)))
    const history = [
      { id: 'old', name: 'Other', start: T0 - 9000000, end: T0 - 5400000, routineIds: ['z'], entries: [entry('0026', [set(true)])] },
      { id: 'a', name: 'Push Day', start: T0 - 7200000, end: T0 - 5400000, routineIds: ['r1'], entries: [done16] },
      { id: 'b', name: 'Push Day', start: T0 - 3600000, end: T0 - 1800000, routineIds: ['r1'], entries: [done16] },
    ]
    expect(priorPerSetSec(active(), { history, defaultRestSec: 90 })).toBe(112.5)
  })

  it('blends the prior with the athlete’s own pace as sets are logged', () => {
    // 2 of 6 sets in 10 min: observed 300 s/set, prior 225, confidence 2/5 -> 255, 4 left.
    const done16 = entry('0025', Array.from({ length: 16 }, () => set(true)))
    const history = [{ id: 'a', name: 'Push Day', start: T0 - 7200000, end: T0 - 3600000, routineIds: ['r1'], entries: [done16] }]
    expect(estimateSecondsLeft(active(), { now: T0 + 600000, history, defaultRestSec: 90 })).toBe(1020)
  })

  it('returns zero when everything is done, and null for a session with no sets', () => {
    const done = active({
      entries: [entry('0025', [set(true), set(true)])],
    })
    expect(estimateSecondsLeft(done, { now: T0 + 60000 })).toBe(0)
    expect(estimateSecondsLeft(active({ entries: [] }), { now: T0 })).toBeNull()
  })

  it('keeps a bad estimate inside a day and a minimum per set', () => {
    const huge = active({
      start: T0 - 20 * 60 * 60 * 1000,
      entries: [entry('0025', [
        ...Array.from({ length: 50 }, () => set(true)),
        ...Array.from({ length: 50 }, () => set(false)),
      ])],
    })
    expect(estimateSecondsLeft(huge, { now: T0 })).toBe(21600)
  })
})

describe('live workout payload', () => {
  it('names the workout and the current exercise, with the ETA in seconds', () => {
    const payload = buildLivePayload({ active: active({ cur: 1 }), workouts: [], restSec: 90 }, { now: T0 + 600000 })
    expect(payload).toMatchObject({
      active: true,
      workoutId: 'w1',
      name: 'Push Day',
      exerciseId: '0027',
      exIdx: 2,
      exTotal: 2,
      setsDone: 2,
      setsTotal: 6,
      startedAt: T0,
    })
    expect(payload.etaSec).toBeGreaterThan(0)
    expect(typeof payload.exName).toBe('string')
  })

  it('never shares a backfill, an edit, the tour or an empty session', () => {
    expect(buildLivePayload({ active: active({ backfill: { durationMin: 60 } }) }, { now: T0 })).toBeNull()
    expect(buildLivePayload({ active: active({ editingWorkoutId: 'saved' }) }, { now: T0 })).toBeNull()
    expect(buildLivePayload({ active: active(), tourSandbox: true }, { now: T0 })).toBeNull()
    expect(buildLivePayload({ active: active({ entries: [] }) }, { now: T0 })).toBeNull()
    expect(buildLivePayload({ active: null }, { now: T0 })).toBeNull()
  })

  it('keys a workout by id, or by its date and start when an old record has none', () => {
    expect(liveWorkoutKey({ id: 'w1' })).toBe('w1')
    expect(liveWorkoutKey({ id: null, d: '2026-11-02', start: T0 })).toBe(`2026-11-02|${T0}`)
    expect(liveWorkoutKey(null)).toBe('')
  })
})
