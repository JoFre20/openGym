// Live workout start notifications. Kept out of server.js so the two decisions that must be
// right (is this a fresh start worth announcing, and who wants it) can be tested without a
// running server or a push service.
import { acceptedFriendIds } from './social.js';

export const START_NOTIFY_FRESH_MS = 2 * 60 * 1000;
export const START_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;
export const START_NOTIFY_SAME_MS = 12 * 60 * 60 * 1000;

/** One stable key for a running workout, from its id or its start time. */
export function liveStartKey(workoutId, startedAt) {
  return String(workoutId || `start-${Number(startedAt) || 0}`).slice(0, 160);
}

/**
 * Whether the heartbeat that just arrived should announce a start. The profile must share the
 * live workout and allow the announcement; the start must be fresh (a page reload or a resumed
 * session is not a start); and the last announcement must be outside both the one-workout
 * window and the sender's cooldown.
 */
export function startNotifyDue(profile, { key, startedAt, now = Date.now() } = {}) {
  if (!profile || profile.shareLive !== true || profile.notifyFriends !== true) return false;
  const start = Number(startedAt);
  if (!Number.isFinite(start) || start <= 0 || now < start || now - start > START_NOTIFY_FRESH_MS) return false;
  const last = profile.lastStartNotify;
  const at = Number(last?.at);
  if (Number.isFinite(at)) {
    if (last.id === key && now - at < START_NOTIFY_SAME_MS) return false;
    if (now - at < START_NOTIFY_COOLDOWN_MS) return false;
  }
  return true;
}

/** Accepted friends who asked for start alerts and can still receive a push. */
export function friendStartRecipients(social, senderId, hasPush = () => true) {
  return acceptedFriendIds(social, senderId).filter(id => {
    const profile = social?.profiles?.[id];
    return profile?.friendStartAlerts === true && (typeof hasPush !== 'function' || hasPush(id));
  });
}
