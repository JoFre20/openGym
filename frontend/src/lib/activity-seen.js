// What the Activity screen has already shown, per profile and device. The counters beside the
// filters are "new since your last visit", not the size of the whole feed. The mark is local:
// another device has its own reading pace, and it never belongs in the synced profile.
const KEY = 'gym_activity_seen_v1'

const slot = uid => `${KEY}:${uid == null || uid === '' ? 'guest' : String(uid)}`

/** The last visit's mark in ms, or null when this device has never opened Activity for `uid`. */
export function readActivitySeen(uid) {
  try {
    const raw = localStorage.getItem(slot(uid))
    if (!raw) return null
    const value = JSON.parse(raw)
    const at = Number(value?.at)
    return Number.isFinite(at) && at > 0 ? at : null
  } catch {
    return null
  }
}

/** Remember that the feed was viewed. The next visit starts its counters after this moment. */
export function markActivitySeen(uid, at = Date.now()) {
  try {
    localStorage.setItem(slot(uid), JSON.stringify({ at: Math.max(0, Number(at) || 0) }))
  } catch { /* private mode with storage blocked: the counters simply stay for this session */ }
}
