// The athlete's side of friend live sharing: one pure snapshot and one pure ETA, so the
// heartbeat does not have to know how a workout is shaped. The server only stores the snapshot
// for a minute or so; nothing here is part of the synced profile.
import { exOr } from './exercises.js'
import { exerciseNameText } from './format.js'
import { setsDone, setsDoneActive, setUnitsTotal, supersetUnits } from './history.js'

const LIVE_MAX_SEC = 6 * 60 * 60
const MIN_PER_SET_SEC = 20
const MAX_PER_SET_SEC = 15 * 60
const DEFAULT_SET_WORK_SEC = 45

export const liveWorkoutKey = A => {
  if (!A) return ''
  return A.id ? String(A.id) : `${A.d || ''}|${A.start || ''}`
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const similar = (w, ids, name) => {
  if (!w || !Array.isArray(w.entries)) return false
  const wIds = [].concat(w.routineIds ?? (w.routineId ? [w.routineId] : [])).map(id => String(id))
  if (ids.size && wIds.some(id => ids.has(id))) return true
  return !!name && String(w.name || '').trim() === name
}

/**
 * Seconds per set a changed session should expect, from the most recent similar workouts in
 * history, or from the rest timer plus a typical set when there is no history yet. The median
 * keeps one unusually long session from moving the ETA on its own.
 */
export function priorPerSetSec(active, { history = [], defaultRestSec = 90 } = {}) {
  const ids = new Set([].concat(active?.routineIds ?? (active?.routineId ? [active.routineId] : []))
    .filter(Boolean).map(id => String(id)))
  const name = String(active?.name || '').trim()
  const values = []
  const workouts = Array.isArray(history) ? history : []
  for (let i = workouts.length - 1; i >= 0 && values.length < 8; i--) {
    const w = workouts[i]
    if (!similar(w, ids, name)) continue
    const start = Number(w.start)
    const end = Number(w.end)
    if (!(start > 0 && end > start)) continue
    let done = 0
    try { done = setsDone(w) } catch { continue }
    if (!(done > 0)) continue
    const per = (end - start) / 1000 / done
    if (per >= MIN_PER_SET_SEC && per <= MAX_PER_SET_SEC) values.push(per)
  }
  if (values.length) return median(values)
  const rest = Number(defaultRestSec)
  const restSec = Number.isFinite(rest) && rest >= 0 ? rest : 90
  return Math.max(DEFAULT_SET_WORK_SEC, restSec + DEFAULT_SET_WORK_SEC)
}

/**
 * How long the session has left, in seconds. Early sets lean on the history prior; after a few
 * sets the athlete's own pace takes over. A workout with no sets has no honest answer.
 */
export function estimateSecondsLeft(active, { now = Date.now(), history = [], defaultRestSec = 90 } = {}) {
  if (!active || !Array.isArray(active.entries)) return null
  const total = setUnitsTotal(active.entries)
  if (!total) return null
  let done
  try { done = Math.min(total, setsDoneActive(active)) } catch { return null }
  if (!Number.isFinite(done)) return null
  const remaining = total - done
  if (!remaining) return 0
  const start = Number(active.start)
  const elapsed = Number.isFinite(start) && start > 0 ? Math.max(0, now - start) / 1000 : 0
  const prior = priorPerSetSec(active, { history, defaultRestSec })
  const observed = done > 0 && elapsed > 0 ? elapsed / done : null
  const confidence = observed == null ? 0 : Math.min(1, done / 5)
  const perSet = observed == null ? prior : prior * (1 - confidence) + observed * confidence
  const bounded = Math.min(MAX_PER_SET_SEC, Math.max(MIN_PER_SET_SEC, perSet))
  return Math.round(Math.min(LIVE_MAX_SEC, Math.max(0, bounded * remaining)))
}

/**
 * The heartbeat body for the running workout, or null when the session must not be shared:
 * a past workout being logged, a saved workout being edited, the tour's practice session.
 */
export function buildLivePayload(state, { now = Date.now() } = {}) {
  const A = state?.active
  if (!A || A.backfill || A.editingWorkoutId || state?.tourSandbox) return null
  const entries = Array.isArray(A.entries) ? A.entries : []
  if (!entries.length) return null
  const units = supersetUnits(entries)
  const cur = Number.isInteger(A.cur) ? Math.min(Math.max(A.cur, 0), entries.length - 1) : 0
  const unit = units.find(u => u.includes(cur))
  const entry = entries[cur]
  let setsDoneCount
  try { setsDoneCount = setsDoneActive(A) } catch { return null }
  const etaSec = estimateSecondsLeft(A, {
    now,
    history: state?.workouts,
    defaultRestSec: state?.restSec,
  })
  return {
    active: true,
    workoutId: liveWorkoutKey(A),
    name: A.name || '',
    exerciseId: entry?.id != null ? String(entry.id) : '',
    exName: entry ? exerciseNameText(exOr(entry.id)) : '',
    exIdx: unit ? units.indexOf(unit) + 1 : 0,
    exTotal: units.length,
    setsDone: setsDoneCount,
    setsTotal: setUnitsTotal(entries),
    startedAt: Number(A.start) || now,
    ...(etaSec != null ? { etaSec } : {}),
  }
}
