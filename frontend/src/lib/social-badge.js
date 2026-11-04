import { socialMe } from './api.js'

const TTL_MS = 60000
let cache = { uid: '', count: 0, at: 0 }
let inFlight = null
const listeners = new Set()

const incoming = me => (me?.pending || []).filter(row => row.direction === 'incoming').length
  + (Number(me?.planShares) || 0)
const notify = () => { for (const listener of listeners) listener() }

export function getSocialPending(uid) {
  return uid && cache.uid === uid ? cache.count : 0
}

export function subscribeSocialPending(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function noteSocialPending(uid, me, { now = Date.now() } = {}) {
  if (!uid) return 0
  const count = incoming(me)
  const same = cache.uid === uid && cache.count === count
  cache = { uid, count, at: now }
  if (!same) notify()
  return count
}

export async function refreshSocialPending(uid, { force = false, now = Date.now() } = {}) {
  if (!uid) return 0
  if (!force && cache.uid === uid && now - cache.at < TTL_MS) return cache.count
  if (inFlight?.uid === uid) return getSocialPending(uid)
  const job = socialMe()
    .then(me => noteSocialPending(uid, me, { now }))
    .catch(() => getSocialPending(uid))
  inFlight = { uid, job }
  job.finally(() => { if (inFlight?.job === job) inFlight = null })
  return job
}

export function _resetSocialPending() {
  cache = { uid: '', count: 0, at: 0 }
  inFlight = null
  notify()
}
