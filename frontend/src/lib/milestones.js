// Reached goals, as the Activity feed shows them (the weight goal and the monthly challenges
// for now; exercise or strength goals can add a kind without changing the feed).
//
//   S.milestones = [
//     { id: 'weight:78:2026-11-09', kind: 'weight_goal', at: 1762675200000, d: '2026-11-09',
//       data: { targetW: 78, w: 77.8, from: 82, unit: 'kg' } },
//     { id: 'challenge:2026-11:workouts', kind: 'challenge', at: 1762675200000, d: '2026-11-09',
//       data: { month: '2026-11', challengeId: 'workouts', n: 14 } },
//   ]
//
// The ids are deterministic. Two devices that reach the same goal write the same id, and the
// sync merge keeps one row. Nothing is backfilled: a goal reached before this existed stays in
// the charts and the challenge shelf, not in the feed. The list is small and bounded; a goal
// reached is history, so it is never deleted one by one (Reset everything clears it).
import { isoOf } from './format.js'

export const MAX_MILESTONES = 200
export const MILESTONE_KINDS = ['weight_goal', 'challenge']
const KIND = new Set(MILESTONE_KINDS)
const ID = /^[a-z][a-z0-9:_-]{0,159}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

function cleanData(value) {
  if (!isMap(value)) return {}
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (Object.keys(out).length >= 20) break
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(k)) continue
    if (typeof v === 'string') out[k] = v.slice(0, 120)
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean') out[k] = v
  }
  return out
}

function cleanOne(m) {
  if (!isMap(m) || !ID.test(String(m.id ?? '')) || !KIND.has(m.kind)) return null
  const at = num(m.at)
  const d = String(m.d || '')
  if (!(at > 0) || !DAY.test(d)) return null
  return { id: String(m.id), kind: m.kind, at, d, data: cleanData(m.data) }
}

/** The stored list made safe, oldest first, at most MAX_MILESTONES. */
export function cleanMilestones(raw) {
  if (!Array.isArray(raw)) return []
  const by = new Map()
  for (const one of raw) {
    const m = cleanOne(one)
    if (!m) continue
    const cur = by.get(m.id)
    if (!cur || m.at >= cur.at) by.set(m.id, m)
  }
  return [...by.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-MAX_MILESTONES)
}

/** Both copies' reached goals, one per id, oldest first. */
export function mergeMilestones(a, b) {
  const out = [...cleanMilestones(a), ...cleanMilestones(b)]
  return cleanMilestones(out)
}

/** Add one goal to a draft S. A duplicate id is a no-op. Returns whether it wrote. */
export function addMilestone(s, milestone) {
  const m = cleanOne(milestone)
  if (!m) return false
  const before = cleanMilestones(s.milestones)
  if (before.some(x => x.id === m.id)) return false
  s.milestones = cleanMilestones([...before, m])
  return true
}

// The day's value, at noon local time: `t` on a weigh-in is when the entry was last edited, not
// when the scale showed the number, and a correction entered months later must not move the goal
// it reaches to that evening. The day is what the charts use too.
const weighAt = b => new Date(String(b?.d) + 'T12:00:00').getTime()

/**
 * The first weigh-in that reaches the current target after the target was set. The direction
 * comes from the last weigh-in at or before the target was saved (or the first one after it when
 * the target was set before any weigh-in), so losing and gaining both work. Null until a weigh-in
 * crosses the line, and for profiles whose target predates the `edited.targetW` stamp: no history
 * is invented.
 */
export function weightGoalMilestone(S) {
  const target = num(S?.targetW)
  const setAt = num(S?.edited?.targetW)
  if (!(target > 0) || !(setAt > 0)) return null
  const entries = (Array.isArray(S?.bodyweight) ? S.bodyweight : [])
    .filter(b => b && DAY.test(String(b.d || '')) && num(b.w) > 0)
    .map(b => ({ d: String(b.d), w: num(b.w), at: weighAt(b) }))
    .sort((a, b) => a.at - b.at)
  if (!entries.length) return null
  const before = entries.filter(e => e.at <= setAt)
  const after = entries.filter(e => e.at > setAt)
  const base = before.length ? before[before.length - 1] : after.shift()
  if (!base || !after.length) return null
  const gain = target > base.w
  if (target === base.w) return null
  const hit = after.find(e => (gain ? e.w >= target : e.w <= target))
  if (!hit) return null
  return {
    id: `weight:${target}:${hit.d}`,
    kind: 'weight_goal',
    at: hit.at,
    d: hit.d,
    data: { targetW: target, w: hit.w, from: base.w, unit: S?.unit === 'lb' ? 'lb' : 'kg' },
  }
}

/** Record the weight goal if this S has just reached it. Used after a weigh-in is saved. */
export function recordWeightGoal(s) {
  const m = weightGoalMilestone(s)
  return m ? addMilestone(s, m) : false
}

/** One month's challenge reached. `picked` is the stored pick ({ id, n, u? }). */
export function recordChallengeDone(s, key, picked, at = Date.now()) {
  const day = isoOf(new Date(at))
  let wrote = false
  for (const p of Array.isArray(picked) ? picked : []) {
    if (!p || typeof p.id !== 'string') continue
    const n = num(p.n)
    if (!(n > 0)) continue
    wrote = addMilestone(s, {
      id: `challenge:${key}:${p.id}`,
      kind: 'challenge',
      at,
      d: day,
      data: { month: key, challengeId: p.id, n, ...(p.u === 'kg' || p.u === 'lb' ? { u: p.u } : {}) },
    }) || wrote
  }
  return wrote
}

/** The events of a profile, safe to render. */
export const milestonesOf = S => cleanMilestones(S?.milestones)

/** A plain copy for callers that build a feed row. */
export const milestoneCopy = m => clone(cleanOne(m))
