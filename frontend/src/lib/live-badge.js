// Which friends are training live right now, shared by the tab bar's red dot and the Activity
// screen's live strip. The server keeps the rows in memory (GET /api/social/live); this store
// only caches the last answer for a short while so the tab bar does not fetch on every render.
import { socialLive } from './api.js'

export const LIVE_BADGE_MS = 15000
const TTL_MS = 10000

const EMPTY = []
let cache = { uid: '', rows: [], at: 0 }
let inFlight = null
const listeners = new Set()

const signature = rows => rows.map(row => `${row?.friend?.id || ''}:${row?.updatedAt || ''}`).join('|')
const notify = () => { for (const listener of listeners) listener() }

const cleanRows = rows => (Array.isArray(rows) ? rows : [])
  .filter(row => row && row.friend && row.friend.id)
  .map(row => ({ ...row }))

/** The last live rows seen for `uid`, as the Activity screen renders them. */
export function getLiveRows(uid) {
  return uid && cache.uid === String(uid) ? cache.rows : EMPTY
}

export const isLiveNow = uid => getLiveRows(uid).length > 0

export function subscribeLive(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Remember a fresh answer, from the poll, the Activity screen or a manual refresh. */
export function noteLiveRows(uid, rows, { now = Date.now() } = {}) {
  if (!uid) return 0
  const next = cleanRows(rows)
  const same = cache.uid === String(uid) && signature(cache.rows) === signature(next)
  cache = { uid: String(uid), rows: next, at: now }
  if (!same) notify()
  return next.length
}

/**
 * Ask the server once. A second call for the same profile while one is in flight joins it, and
 * a fresh cache skips the request unless `force` says otherwise.
 */
export function refreshLiveBadge(uid, { force = false, now = Date.now() } = {}) {
  if (!uid) return Promise.resolve(0)
  const key = String(uid)
  if (!force && cache.uid === key && now - cache.at < TTL_MS) return Promise.resolve(cache.rows.length)
  if (inFlight?.uid === key) return inFlight.job
  const job = socialLive()
    .then(next => noteLiveRows(key, next?.live, { now: Date.now() }))
    .catch(() => getLiveRows(key).length)
  inFlight = { uid: key, job }
  job.finally(() => { if (inFlight?.job === job) inFlight = null })
  return job
}

/** Forget the dot, on sign-out or when the tab bar goes away. */
export function clearLiveBadge(uid = '') {
  if (uid && cache.uid !== String(uid)) return
  if (!cache.uid && !cache.rows.length) return
  cache = { uid: '', rows: [], at: 0 }
  notify()
}

export function _resetLiveBadge() {
  cache = { uid: '', rows: [], at: 0 }
  inFlight = null
  notify()
}
