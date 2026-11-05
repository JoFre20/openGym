import crypto from 'node:crypto';

export const SOCIAL_SHARE_WEIGHT = ['none', 'absolute', 'delta'];
export const SOCIAL_EMOJI = ['🔥', '💪', '👑'];
export const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// A shared plan is a snapshot of the sender's plan, never a link to their synced state. The
// limits keep one profile from turning social.json into a file store: 10 unread plans per
// recipient, 256 KiB per plan and 20 friends in one send cover every real training plan while
// leaving the rest of the social data cheap to rewrite.
export const PLAN_SHARE_MAX_BYTES = 256 * 1024;
export const PLAN_SHARE_MAX_PER_USER = 10;
export const PLAN_SHARE_MAX_FRIENDS = 20;
export const PLAN_SHARE_MAX_ROUTINES = 100;
export const PLAN_SHARE_MAX_EXERCISES = 2000;
export const PLAN_SHARE_MAX_CUSTOM = 500;
export const PLAN_SHARE_NAME_MAX = 120;

const DAY_MS = 86400000;
const WEIGHT_WINDOW_DAYS = 30;
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0];
const PLAN_UNITS = new Set(['kg', 'lb']);

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function emptySocial() {
  return { profiles: {}, friendships: [], reactions: [], planShares: [] };
}

export function normalizeSocial(raw) {
  const social = emptySocial();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return social;
  if (raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles)) {
    for (const [uid, profile] of Object.entries(raw.profiles)) {
      if (profile && typeof profile === 'object' && !Array.isArray(profile)) social.profiles[uid] = { ...profile };
    }
  }
  if (Array.isArray(raw.friendships)) {
    social.friendships = raw.friendships
      .filter(f => f && typeof f === 'object' && !Array.isArray(f))
      .map(f => ({ ...f }));
  }
  if (Array.isArray(raw.reactions)) {
    social.reactions = raw.reactions
      .filter(r => r && typeof r === 'object' && !Array.isArray(r))
      .map(r => ({ ...r }));
  }
  if (Array.isArray(raw.planShares)) {
    // A damaged entry must never make a recipient's inbox throw. Only whole rows with both
    // sides and a plan survive; parsePlan still validates the plan itself on the receiving end.
    social.planShares = raw.planShares
      .filter(s => s && typeof s === 'object' && !Array.isArray(s)
        && typeof s.id === 'string' && typeof s.from === 'string' && typeof s.to === 'string'
        && s.plan && typeof s.plan === 'object' && !Array.isArray(s.plan))
      .map(s => ({ ...s }));
  }
  return social;
}

/**
 * What is wrong with a plan bundle, or null when it can be stored. The sender's app already
 * exports the right shape (lib/plan-share.js), so this is a gate for a hand-made request, not a
 * second parser: the recipient still runs parsePlan before merging anything into their state.
 * The limits are checked here because social.json holds every snapshot until it is imported or
 * removed.
 */
export function planShareProblem(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return 'plan-invalid';
  if (!bundle.opengym_plan) return 'plan-invalid';
  if (bundle.name != null && typeof bundle.name !== 'string') return 'plan-invalid';
  if (bundle.unit != null && !PLAN_UNITS.has(bundle.unit)) return 'plan-invalid';
  if (!Array.isArray(bundle.routines) || bundle.routines.length > PLAN_SHARE_MAX_ROUTINES) return 'plan-invalid';
  let exercises = 0;
  for (const routine of bundle.routines) {
    if (!routine || typeof routine !== 'object' || Array.isArray(routine) || !Array.isArray(routine.ex)) {
      return 'plan-invalid';
    }
    exercises += routine.ex.length;
    if (exercises > PLAN_SHARE_MAX_EXERCISES) return 'plan-invalid';
  }
  if (!exercises) return 'plan-empty';
  if (bundle.customEx != null && (!Array.isArray(bundle.customEx) || bundle.customEx.length > PLAN_SHARE_MAX_CUSTOM)) {
    return 'plan-invalid';
  }
  if (bundle.week != null && (typeof bundle.week !== 'object' || Array.isArray(bundle.week))) return 'plan-invalid';
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(bundle)); }
  catch { return 'plan-invalid'; }
  if (bytes > PLAN_SHARE_MAX_BYTES) return 'plan-too-large';
  return null;
}

/** The card the recipient sees, derived from the snapshot so a sender cannot lie with metadata. */
export function planShareSummary(bundle) {
  const routines = Array.isArray(bundle?.routines) ? bundle.routines : [];
  const exerciseCount = routines.reduce((n, routine) => n + (Array.isArray(routine?.ex) ? routine.ex.length : 0), 0);
  const scheduledDays = WEEK_DAYS.filter(day => {
    const value = bundle?.week?.[day];
    return Array.isArray(value) ? value.length > 0 : !!value;
  }).length;
  return {
    name: typeof bundle?.name === 'string' ? bundle.name.trim().slice(0, PLAN_SHARE_NAME_MAX) : '',
    unit: bundle?.unit === 'lb' ? 'lb' : 'kg',
    routineCount: routines.length,
    exerciseCount,
    scheduledDays
  };
}

export function receivedPlanShares(social, uid) {
  return (Array.isArray(social?.planShares) ? social.planShares : [])
    .filter(share => share.to === uid)
    .sort((a, b) => num(b.createdAt) - num(a.createdAt));
}

export function sentPlanShares(social, uid) {
  return (Array.isArray(social?.planShares) ? social.planShares : [])
    .filter(share => share.from === uid)
    .sort((a, b) => num(b.createdAt) - num(a.createdAt));
}

export function findPlanShare(social, id) {
  return (Array.isArray(social?.planShares) ? social.planShares : [])
    .find(share => share.id === String(id || '')) || null;
}

/** Drop the oldest unread snapshots once a recipient has more than the limit. Returns how many. */
export function trimPlanShares(social, uid, max = PLAN_SHARE_MAX_PER_USER) {
  const received = receivedPlanShares(social, uid);
  if (received.length <= max) return 0;
  const drop = new Set(received.slice(max).map(share => share.id));
  const before = social.planShares.length;
  social.planShares = social.planShares.filter(share => !drop.has(share.id));
  return before - social.planShares.length;
}

/** Both directions of a friendship gone: nothing they sent each other should stay readable. */
export function dropPlanSharesBetween(social, a, b) {
  const before = social.planShares?.length || 0;
  social.planShares = (social.planShares || []).filter(share =>
    !((share.from === a && share.to === b) || (share.from === b && share.to === a)));
  return before - social.planShares.length;
}

export function dropPlanSharesForUser(social, uid) {
  const before = social.planShares?.length || 0;
  social.planShares = (social.planShares || []).filter(share => share.from !== uid && share.to !== uid);
  return before - social.planShares.length;
}

export function normalizeFriendCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function friendCodeValid(raw) {
  const code = normalizeFriendCode(raw);
  return code.length === 6 && [...code].every(ch => FRIEND_CODE_ALPHABET.includes(ch));
}

export function formatFriendCode(raw) {
  const code = normalizeFriendCode(raw);
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

export function friendCodeFromBytes(bytes) {
  return Array.from({ length: 6 }, (_, i) => FRIEND_CODE_ALPHABET[bytes[i] % FRIEND_CODE_ALPHABET.length]).join('');
}

export function usedFriendCodes(social, exceptUid = null) {
  const used = new Set();
  for (const [uid, profile] of Object.entries(social?.profiles || {})) {
    if (uid === exceptUid || !friendCodeValid(profile?.friendCode)) continue;
    used.add(normalizeFriendCode(profile.friendCode));
  }
  return used;
}

export function generateFriendCode(used = new Set(), random = size => crypto.randomBytes(size)) {
  for (let i = 0; i < 100; i++) {
    const code = friendCodeFromBytes(random(6));
    if (!used.has(code)) return formatFriendCode(code);
  }
  throw new Error('could not create a unique friend code');
}

export function ensureProfile(social, uid, { now = Date.now(), friendCode = null, random } = {}) {
  social.profiles ||= {};
  let profile = social.profiles[uid];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    profile = social.profiles[uid] = {};
  }
  const used = usedFriendCodes(social, uid);
  let changed = false;
  if (friendCodeValid(friendCode) && !used.has(normalizeFriendCode(friendCode))) {
    const formatted = formatFriendCode(friendCode);
    if (profile.friendCode !== formatted) { profile.friendCode = formatted; changed = true; }
  } else if (!friendCodeValid(profile.friendCode) || used.has(normalizeFriendCode(profile.friendCode))) {
    profile.friendCode = generateFriendCode(used, random);
    changed = true;
  } else {
    const formatted = formatFriendCode(profile.friendCode);
    if (profile.friendCode !== formatted) { profile.friendCode = formatted; changed = true; }
  }
  if (typeof profile.shareWorkouts !== 'boolean') { profile.shareWorkouts = true; changed = true; }
  if (!SOCIAL_SHARE_WEIGHT.includes(profile.shareWeight)) { profile.shareWeight = 'none'; changed = true; }
  if (!Number.isFinite(profile.createdAt)) { profile.createdAt = now; changed = true; }
  if (!Number.isFinite(profile.updatedAt)) { profile.updatedAt = profile.createdAt; changed = true; }
  return { profile, changed };
}

export function profileByCode(social, raw) {
  const code = normalizeFriendCode(raw);
  if (!friendCodeValid(code)) return null;
  for (const [uid, profile] of Object.entries(social?.profiles || {})) {
    if (normalizeFriendCode(profile?.friendCode) === code) return { uid, profile };
  }
  return null;
}

export function friendshipBetween(social, a, b) {
  return (social?.friendships || []).find(f =>
    (f.from === a && f.to === b) || (f.from === b && f.to === a)) || null;
}

export function acceptedFriendIds(social, uid) {
  return (social?.friendships || [])
    .filter(f => f.status === 'accepted' && (f.from === uid || f.to === uid))
    .map(f => (f.from === uid ? f.to : f.from));
}

export function pendingFriendships(social, uid) {
  return (social?.friendships || []).filter(f => f.status === 'pending' && (f.from === uid || f.to === uid));
}

export function weekKeyOf(iso, weekStart = 1) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
  const day = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(day.getTime())) return '';
  const start = weekStart === 0 ? 0 : 1;
  const offset = (day.getUTCDay() - start + 7) % 7;
  return new Date(day.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

export function weekStartISO(now = new Date(), weekStart = 1) {
  return weekKeyOf(now.toISOString().slice(0, 10), weekStart);
}

export function workoutKey(workout) {
  if (workout?.id != null && String(workout.id)) return String(workout.id);
  return `${workout?.d || ''}|${workout?.start ?? ''}`;
}

export function feedWorkoutId(ownerId, workout) {
  return `${ownerId}:${workoutKey(workout)}`;
}

export function splitFeedWorkoutId(value) {
  const text = String(value || '');
  const at = text.indexOf(':');
  return at > 0 ? [text.slice(0, at), text.slice(at + 1)] : null;
}

export function workoutsOf(state) {
  return (Array.isArray(state?.workouts) ? state.workouts : [])
    .filter(w => w && typeof w === 'object' && !Array.isArray(w));
}

export function findWorkout(state, ownerId, publicId) {
  const value = String(publicId || '');
  const prefix = `${ownerId}:`;
  const raw = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return workoutsOf(state).find(w => workoutKey(w) === raw) || null;
}

export function workoutDayOf(workout) {
  const day = String(workout?.d || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const start = Number(workout?.start);
  return Number.isFinite(start) ? new Date(start).toISOString().slice(0, 10) : '';
}

const workoutAtOf = workout => {
  const end = Number(workout?.end);
  if (Number.isFinite(end) && end > 0) return end;
  const start = Number(workout?.start);
  if (Number.isFinite(start) && start > 0) return start;
  const day = workoutDayOf(workout);
  return day ? Date.parse(day + 'T12:00:00Z') || 0 : 0;
};

export function workoutDurationSec(workout) {
  const start = Number(workout?.start);
  const end = Number(workout?.end);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.round((end - start) / 1000)
    : 0;
}

const isWarmup = set => set?.phase === 'warmup' || set?.warmup === true;
const isSideSet = set => !!(set?.sides && typeof set.sides === 'object' && set.sides.L && set.sides.R);

function completedVolume(set) {
  if (isSideSet(set)) return completedVolume(set.sides.L) + completedVolume(set.sides.R);
  if (!set?.done || isWarmup(set)) return 0;
  let volume = num(set.w) * num(set.r);
  if (Array.isArray(set.drops)) {
    for (const drop of set.drops) volume += num(drop?.w) * num(drop?.r);
  }
  return volume;
}

export function workoutVolumeOf(workout) {
  const cached = Number(workout?.vol);
  if (Number.isFinite(cached) && cached >= 0) return Math.round(cached);
  let volume = 0;
  for (const entry of Array.isArray(workout?.entries) ? workout.entries : []) {
    for (const set of Array.isArray(entry?.sets) ? entry.sets : []) volume += completedVolume(set);
  }
  return Math.round(volume);
}

export function topSetsOf(workout, limit = 3) {
  const best = new Map();
  for (const entry of Array.isArray(workout?.entries) ? workout.entries : []) {
    if (!entry || typeof entry !== 'object') continue;
    for (const set of Array.isArray(entry.sets) ? entry.sets : []) {
      if (!set || isWarmup(set)) continue;
      const sides = isSideSet(set) ? [set.sides.L, set.sides.R] : [set];
      for (const side of sides) {
        if (!side?.done) continue;
        const weight = num(side.w);
        const reps = num(side.r);
        if (!(weight > 0) || !(reps > 0)) continue;
        const id = entry.id != null ? String(entry.id) : '';
        const row = { exerciseId: id, weight, reps };
        const prev = best.get(id);
        if (!prev || row.weight > prev.weight || (row.weight === prev.weight && row.reps > prev.reps)) best.set(id, row);
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => b.weight - a.weight || b.reps - a.reps)
    .slice(0, Math.max(0, limit));
}

export function prIdsOf(workout) {
  return [...new Set((Array.isArray(workout?.prs) ? workout.prs : []).filter(id => typeof id === 'string' && id))];
}

export function weightProgressOf(state, mode, { today = null } = {}) {
  if (!SOCIAL_SHARE_WEIGHT.includes(mode) || mode === 'none') return null;
  const entries = (Array.isArray(state?.bodyweight) ? state.bodyweight : [])
    .filter(b => b && /^\d{4}-\d{2}-\d{2}$/.test(String(b.d || '')) && num(b.w) > 0)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  if (!entries.length) return null;
  const endDay = today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : entries[entries.length - 1].d;
  const usable = entries.filter(b => b.d <= endDay);
  if (!usable.length) return null;
  const latest = usable[usable.length - 1];
  const from = new Date(Date.parse(endDay + 'T12:00:00Z') - WEIGHT_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const recent = usable.filter(b => b.d >= from);
  const first = recent[0] || null;
  const delta = first && first.d !== latest.d ? latest.w - first.w : null;
  const round = value => Math.round(value * 10) / 10;
  const out = { mode, unit: state?.unit === 'lb' ? 'lb' : 'kg' };
  if (mode === 'absolute') out.current = round(latest.w);
  if (delta != null) {
    out.delta = round(delta);
    out.since = first.d;
    out.trend = delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';
  } else if (mode === 'delta') {
    return null;
  }
  return out;
}

export function squadStats(social, friendIds, userById, stateById, { today = null } = {}) {
  return friendIds.map(id => {
    const state = stateById(id) || null;
    const profile = social?.profiles?.[id] || {};
    const weekStart = state?.weekStart === 0 ? 0 : 1;
    const week = today ? weekKeyOf(today, weekStart) : '';
    const workoutsThisWeek = !state || profile.shareWorkouts === false
      ? null
      : workoutsOf(state).filter(w => week && weekKeyOf(workoutDayOf(w), weekStart) === week).length;
    return {
      id,
      name: userById(id)?.name || '',
      ...(profile.avatar ? { avatar: profile.avatar } : {}),
      workoutsThisWeek,
      weight: weightProgressOf(state, profile.shareWeight || 'none', { today })
    };
  });
}

export function reactionSummary(social, workoutId, viewerId) {
  const out = Object.fromEntries(SOCIAL_EMOJI.map(emoji => [emoji, { count: 0, mine: false }]));
  for (const reaction of social?.reactions || []) {
    if (reaction?.workoutId !== workoutId || !SOCIAL_EMOJI.includes(reaction.emoji)) continue;
    out[reaction.emoji].count += 1;
    if (viewerId && reaction.userId === viewerId) out[reaction.emoji].mine = true;
  }
  return out;
}

export function feedItems(social, friendIds, userById, stateById, viewerId, { today = null, limit = 30 } = {}) {
  const rows = [];
  for (const id of friendIds) {
    const profile = social?.profiles?.[id] || {};
    if (profile.shareWorkouts === false) continue;
    const state = stateById(id);
    if (!state) continue;
    const friend = userById(id);
    if (!friend) continue;
    const customNames = new Map((Array.isArray(state.customEx) ? state.customEx : [])
      .map(ex => [String(ex?.id ?? ''), typeof ex?.n === 'string' ? ex.n : ''])
      .filter(([id, name]) => id && name));
    for (const workout of workoutsOf(state)) {
      const publicId = feedWorkoutId(id, workout);
      const prs = prIdsOf(workout);
      rows.push({
        workoutId: publicId,
        friend: { id, name: friend.name },
        date: workoutDayOf(workout),
        name: typeof workout.name === 'string' ? workout.name : '',
        start: Number(workout.start) || 0,
        end: Number(workout.end) || 0,
        durationSec: workoutDurationSec(workout),
        volume: workoutVolumeOf(workout),
        unit: state.unit === 'lb' ? 'lb' : 'kg',
        prs,
        prCount: prs.length,
        topSets: topSetsOf(workout).map(set => ({
          ...set,
          ...(customNames.get(set.exerciseId) ? { name: customNames.get(set.exerciseId) } : {}),
        })),
        reactions: reactionSummary(social, publicId, viewerId),
      });
    }
  }
  rows.sort((a, b) => workoutAtOf({ end: b.end, start: b.start, d: b.date }) - workoutAtOf({ end: a.end, start: a.start, d: a.date }));
  return rows.slice(0, Math.max(0, limit));
}
