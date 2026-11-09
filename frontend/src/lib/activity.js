// The Activity feed's items, assembled on the device when the server has nothing to say and
// normalised when it does. Pure and framework-free, like the rest of lib/.
//
// The server returns workouts and reached goals in the same shape for friends and for the
// caller; the screen only decides which of two sources to use. A signed-in profile takes the
// server's `own` rows because they carry the reactions friends sent; offline, a guest and an
// old server get the same rows built from the local state.
import { exerciseNameText, isoOf } from './format.js'
import { EXIDX } from './exercises.js'
import { workoutAt, workoutDay, workoutVolume } from './history.js'
import { isSideSet, isWarmupRow } from './workout-model.js'
import { milestonesOf } from './milestones.js'

const list = v => (Array.isArray(v) ? v : [])
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

/** Best completed work set per exercise, heaviest first, at most three. */
export function topSetsOf(workout, limit = 3) {
  const best = new Map()
  for (const entry of list(workout?.entries)) {
    if (!isMap(entry)) continue
    for (const set of list(entry.sets)) {
      if (!isMap(set) || isWarmupRow(set)) continue
      const id = entry.id != null ? String(entry.id) : ''
      const sides = isSideSet(set) ? [set.sides?.L, set.sides?.R] : [set]
      for (const side of sides) {
        if (!side?.done) continue
        const weight = num(side.w), reps = num(side.r)
        if (!(weight > 0) || !(reps > 0)) continue
        const prev = best.get(id)
        if (!prev || weight > prev.weight || (weight === prev.weight && reps > prev.reps)) {
          best.set(id, { exerciseId: id, weight, reps })
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight || b.reps - a.reps).slice(0, Math.max(0, limit))
}

const ownerOf = (friend, user, me = false) => ({
  id: String(friend?.id ?? user?.id ?? 'me'),
  name: String(friend?.name ?? user?.name ?? ''),
  ...(friend?.avatar ? { avatar: friend.avatar } : {}),
  me: me || String(friend?.id ?? '') === String(user?.id ?? '') && !!user?.id,
})

const workoutIdOf = (ownerId, workout) => `${ownerId}:${workout?.id != null ? workout.id : `${workout?.d || ''}|${workout?.start ?? ''}`}`

function localWorkoutItem(S, workout, user) {
  if (!isMap(workout)) return null
  const at = num(workout.end) || num(workout.start) || workoutAt(workout)
  if (!(at > 0)) return null
  const ownerId = String(user?.id ?? 'me')
  const prs = [...new Set(list(workout.prs).filter(id => typeof id === 'string' && id))]
  const topSets = topSetsOf(workout).map(set => {
    const custom = list(S?.customEx).find(ex => String(ex?.id) === set.exerciseId)
    return custom?.n ? { ...set, name: custom.n } : set
  })
  return {
    id: workoutIdOf(ownerId, workout),
    workoutId: workoutIdOf(ownerId, workout),
    kind: 'workout',
    at,
    date: workoutDay(workout) || isoOf(new Date(at)),
    owner: ownerOf(null, user, true),
    workout: {
      name: typeof workout.name === 'string' ? workout.name : '',
      durationSec: num(workout.end) > num(workout.start) ? Math.round((num(workout.end) - num(workout.start)) / 1000) : 0,
      volume: Number.isFinite(Number(workout.vol)) ? Math.round(Number(workout.vol)) : workoutVolume(workout),
      unit: S?.unit === 'lb' ? 'lb' : 'kg',
      prs,
      prCount: prs.length,
      topSets,
    },
    reactions: {},
  }
}

function localMilestoneItem(m, user) {
  const ownerId = String(user?.id ?? 'me')
  let data = clone(m.data)
  if (m.kind === 'weight_goal') {
    const w = num(data.w), from = num(data.from)
    data = {
      mode: 'absolute',
      unit: data.unit === 'lb' ? 'lb' : 'kg',
      targetW: num(data.targetW),
      current: w,
      delta: w > 0 && from > 0 ? Math.round((w - from) * 10) / 10 : null,
    }
  }
  return {
    id: `${ownerId}:m:${m.id}`,
    itemId: `${ownerId}:m:${m.id}`,
    kind: 'milestone',
    at: m.at,
    date: m.d,
    owner: ownerOf(null, user, true),
    milestone: { id: m.id, kind: m.kind, data },
    reactions: {},
  }
}

/** The caller's own feed from the local profile: workouts and reached goals, newest first. */
export function ownActivity(S, user, { limit = 60 } = {}) {
  const items = []
  for (const workout of list(S?.workouts)) {
    const item = localWorkoutItem(S, workout, user)
    if (item) items.push(item)
  }
  for (const m of milestonesOf(S)) items.push(localMilestoneItem(m, user))
  return sortActivity(items).slice(0, Math.max(0, limit))
}

const workoutFromRemote = (item, viewer) => {
  const owner = ownerOf(item.friend, viewer)
  const workout = isMap(item.workout) ? item.workout : item
  const at = num(item.at) || num(item.end) || num(item.start)
  return {
    id: String(item.workoutId || item.id || ''),
    workoutId: String(item.workoutId || item.id || ''),
    kind: 'workout',
    at,
    date: String(item.date || ''),
    owner,
    workout: {
      name: typeof workout.name === 'string' ? workout.name : '',
      durationSec: num(workout.durationSec),
      volume: num(workout.volume),
      unit: workout.unit === 'lb' ? 'lb' : 'kg',
      prs: list(workout.prs).filter(id => typeof id === 'string'),
      prCount: num(workout.prCount) || list(workout.prs).length,
      topSets: list(workout.topSets),
    },
    reactions: isMap(item.reactions) ? clone(item.reactions) : {},
  }
}

const milestoneFromRemote = (item, viewer) => {
  const owner = ownerOf(item.friend, viewer)
  const m = isMap(item.milestone) ? item.milestone : {}
  return {
    id: String(item.itemId || item.id || ''),
    itemId: String(item.itemId || item.id || ''),
    kind: 'milestone',
    at: num(item.at),
    date: String(item.date || ''),
    owner,
    milestone: { id: String(m.id || ''), kind: String(m.kind || ''), data: isMap(m.data) ? clone(m.data) : {} },
    reactions: isMap(item.reactions) ? clone(item.reactions) : {},
  }
}

/** Normalise any of the server's feed rows into the screen's one item shape. */
export function normaliseActivity(item, viewer = null) {
  if (!isMap(item)) return null
  if (item.owner && (isMap(item.workout) || isMap(item.milestone))) return item
  const kind = item.kind === 'milestone' || item.milestone || item.itemId ? 'milestone' : 'workout'
  const row = kind === 'milestone' ? milestoneFromRemote(item, viewer) : workoutFromRemote(item, viewer)
  if (!(row.at > 0) || !row.id) return null
  return row
}

/** The newest first; two rows with one id (a friend listed twice) count once. */
export function sortActivity(items) {
  const by = new Map()
  for (const raw of list(items)) {
    const item = raw?.owner && (raw.workout !== undefined || raw.milestone !== undefined)
      ? raw
      : normaliseActivity(raw)
    if (!item) continue
    const cur = by.get(item.id)
    if (!cur || item.at >= cur.at) by.set(item.id, item)
  }
  return [...by.values()].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
}

/** Own rows, friend workouts and friend goals in one chronological feed. */
export function mergeActivity(own = [], feed = [], milestones = [], viewer = null) {
  return sortActivity([
    ...list(own).map(row => normaliseActivity(row, viewer)),
    ...list(feed).map(row => normaliseActivity(row, viewer)),
    ...list(milestones).map(row => normaliseActivity(row, viewer)),
  ]).slice(0, 100)
}

export const ACTIVITY_FILTERS = ['all', 'friends', 'me', 'goals']

/** What each tab of the feed shows. Unknown filters read as `all`. */
export function filterActivity(items, filter = 'all') {
  const rows = list(items)
  if (filter === 'friends') return rows.filter(item => !item.owner?.me)
  if (filter === 'me') return rows.filter(item => !!item.owner?.me)
  if (filter === 'goals') return rows.filter(item => item.kind === 'milestone')
  return rows
}

/** One number per filter, for the little counts beside the chips. */
export function activityCounts(items) {
  const rows = list(items)
  return {
    all: rows.length,
    friends: rows.filter(item => !item.owner?.me).length,
    me: rows.filter(item => !!item.owner?.me).length,
    goals: rows.filter(item => item.kind === 'milestone').length,
  }
}

/** The label of a top set: the catalogue's name, or the friend's own name for a custom exercise. */
export function topSetName(set) {
  const known = set?.exerciseId ? EXIDX[set.exerciseId] : null
  return known ? exerciseNameText(known) : (set?.name || '')
}
