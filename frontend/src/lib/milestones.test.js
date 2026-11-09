import { describe, expect, it } from 'vitest'
import {
  MAX_MILESTONES, addMilestone, cleanMilestones, mergeMilestones, milestonesOf,
  recordChallengeDone, recordWeightGoal, weightGoalMilestone,
} from './milestones.js'

const day = (d, w, t = new Date(d + 'T08:00:00').getTime()) => ({ d, w, t })
const goal = (setAt, target = 78) => ({ targetW: target, unit: 'kg', edited: { targetW: setAt }, bodyweight: [] })

describe('milestone records', () => {
  it('keeps valid rows, one per id, oldest first and capped', () => {
    const rows = [
      { id: 'weight:78:2026-11-09', kind: 'weight_goal', at: 3, d: '2026-11-09', data: { targetW: 78 } },
      { id: 'weight:78:2026-11-09', kind: 'weight_goal', at: 4, d: '2026-11-09', data: { targetW: 78, w: 77.8 } },
      { id: 'bad', kind: 'nope', at: 1, d: '2026-11-09' },
      { id: 'challenge:2026-11:workouts', kind: 'challenge', at: 2, d: '2026-11-08', data: { n: 14 } },
      null,
    ]
    const clean = cleanMilestones(rows)
    expect(clean.map(m => m.id)).toEqual(['challenge:2026-11:workouts', 'weight:78:2026-11-09'])
    expect(clean[1].data).toEqual({ targetW: 78, w: 77.8 })
    const many = Array.from({ length: MAX_MILESTONES + 5 }, (_, i) => (
      { id: `challenge:2026-11:c${i}`, kind: 'challenge', at: i + 1, d: '2026-11-09', data: {} }
    ))
    expect(cleanMilestones(many)).toHaveLength(MAX_MILESTONES)
  })

  it('merges both devices without losing either goal', () => {
    const a = [{ id: 'challenge:2026-11:workouts', kind: 'challenge', at: 2, d: '2026-11-09', data: {} }]
    const b = [{ id: 'weight:78:2026-11-09', kind: 'weight_goal', at: 3, d: '2026-11-09', data: {} }]
    expect(mergeMilestones(a, b).map(m => m.id)).toEqual(['challenge:2026-11:workouts', 'weight:78:2026-11-09'])
  })

  it('writes a goal once', () => {
    const S = { milestones: [] }
    expect(addMilestone(S, { id: 'challenge:2026-11:workouts', kind: 'challenge', at: 2, d: '2026-11-09' })).toBe(true)
    expect(addMilestone(S, { id: 'challenge:2026-11:workouts', kind: 'challenge', at: 2, d: '2026-11-09' })).toBe(false)
    expect(milestonesOf(S)).toHaveLength(1)
  })
})

describe('the weight goal', () => {
  it('records the first weigh-in on the losing side after the target was set', () => {
    const setAt = new Date('2026-11-01T09:00:00').getTime()
    const S = { ...goal(setAt), bodyweight: [day('2026-10-30', 82), day('2026-11-02', 81), day('2026-11-09', 77.8), day('2026-11-10', 77.2)] }
    expect(weightGoalMilestone(S)).toMatchObject({
      id: 'weight:78:2026-11-09', kind: 'weight_goal', d: '2026-11-09',
      data: { targetW: 78, w: 77.8, from: 82, unit: 'kg' },
    })
    expect(recordWeightGoal(S)).toBe(true)
    expect(S.milestones).toHaveLength(1)
    expect(recordWeightGoal(S)).toBe(false)
  })

  it('works for a gain and does not invent history without a target stamp', () => {
    const setAt = new Date('2026-11-01T09:00:00').getTime()
    const S = { ...goal(setAt, 83), bodyweight: [day('2026-10-31', 81), day('2026-11-05', 82.4), day('2026-11-08', 83.1)] }
    expect(weightGoalMilestone(S).id).toBe('weight:83:2026-11-08')
    expect(weightGoalMilestone({ targetW: 78, bodyweight: [day('2026-11-09', 77)] })).toBeNull()
  })

  it('does not fire from a weigh-in made before the target was saved', () => {
    const setAt = new Date('2026-11-09T12:00:00').getTime()
    const S = { ...goal(setAt), bodyweight: [day('2026-11-01', 82), day('2026-11-08', 77)] }
    expect(weightGoalMilestone(S)).toBeNull()
  })
})

describe('a challenge reached', () => {
  it('writes one event per pick and does not duplicate it', () => {
    const S = { milestones: [] }
    const picked = [{ id: 'workouts', n: 14 }, { id: 'volume', n: 50000, u: 'kg' }]
    expect(recordChallengeDone(S, '2026-11', picked, new Date('2026-11-20T18:00:00').getTime())).toBe(true)
    expect(new Set(S.milestones.map(m => m.id))).toEqual(new Set(['challenge:2026-11:workouts', 'challenge:2026-11:volume']))
    expect(recordChallengeDone(S, '2026-11', picked, Date.now())).toBe(false)
  })
})
