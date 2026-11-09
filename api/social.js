import crypto from 'node:crypto';

export const SOCIAL_SHARE_WEIGHT = ['none', 'absolute', 'delta'];
export const SOCIAL_START_TONES = ['motivational', 'drill', 'mix'];
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
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
      const next = { ...profile };
      if (Array.isArray(profile.closeFriends)) {
        next.closeFriends = [...new Set(profile.closeFriends.filter(id => typeof id === 'string' && id))].slice(0, 500);
      }
      social.profiles[uid] = next;
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
  // Live sharing and its two notifications are opt-in on both sides: the sender decides whether
  // friends may follow the session, and each friend decides whether a start may ping them.
  if (typeof profile.shareLive !== 'boolean') { profile.shareLive = false; changed = true; }
  if (typeof profile.notifyFriends !== 'boolean') { profile.notifyFriends = false; changed = true; }
  if (!SOCIAL_START_TONES.includes(profile.startTone)) { profile.startTone = 'motivational'; changed = true; }
  if (typeof profile.friendStartAlerts !== 'boolean') { profile.friendStartAlerts = false; changed = true; }
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

/** The caller's own close-friend list, limited to friendships that still exist. */
export function closeFriendIds(social, uid) {
  const accepted = new Set(acceptedFriendIds(social, uid));
  const list = social?.profiles?.[uid]?.closeFriends;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(id => typeof id === 'string' && accepted.has(id)))];
}

/**
 * Mark one accepted friend as close, or take the mark away. The list belongs to `uid`: it says
 * whose sensitive live details `uid` may see, never the reverse. A friendship that is gone is
 * left out again by closeFriendIds, so a stale id can never grant anything.
 */
export function setCloseFriend(social, uid, friendId, close, { now = Date.now() } = {}) {
  const id = typeof friendId === 'string' ? friendId.trim() : '';
  if (!id || !acceptedFriendIds(social, uid).includes(id)) return null;
  const { profile } = ensureProfile(social, uid, { now });
  const next = new Set(closeFriendIds(social, uid));
  if (close) next.add(id); else next.delete(id);
  profile.closeFriends = [...next].sort().slice(0, 500);
  profile.updatedAt = now;
  return profile.closeFriends;
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

// Reached goals (frontend/src/lib/milestones.js). The server only reads the event list the app
// writes into each profile; it never invents one. Rows are validated here because this file also
// feeds every friend's state into another profile's screen.
const MILESTONE_KINDS = new Set(['weight_goal', 'challenge']);
const MILESTONE_ID = /^[a-z][a-z0-9:_-]{0,159}$/;
const MILESTONE_DAY = /^\d{4}-\d{2}-\d{2}$/;

function cleanMilestoneData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (Object.keys(out).length >= 20) break;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 120);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** The reached goals stored in one state file, safe and newest last. */
export function milestonesOf(state) {
  const by = new Map();
  for (const raw of Array.isArray(state?.milestones) ? state.milestones : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    if (!MILESTONE_ID.test(String(raw.id ?? '')) || !MILESTONE_KINDS.has(raw.kind)) continue;
    const at = Number(raw.at);
    if (!(at > 0) || !MILESTONE_DAY.test(String(raw.d || ''))) continue;
    const m = { id: String(raw.id), kind: raw.kind, at, d: String(raw.d), data: cleanMilestoneData(raw.data) };
    const cur = by.get(m.id);
    if (!cur || m.at >= cur.at) by.set(m.id, m);
  }
  return [...by.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-200);
}

export function feedMilestoneId(ownerId, milestoneId) {
  return `${ownerId}:m:${milestoneId}`;
}

export function splitFeedMilestoneId(value) {
  const text = String(value || '');
  const at = text.indexOf(':m:');
  return at > 0 ? [text.slice(0, at), text.slice(at + 3)] : null;
}

/** Whether a friend may see this goal at all. */
export function milestoneVisible(profile, milestone) {
  if (!milestone || !profile || profile.shareWorkouts === false) return false;
  if (milestone.kind === 'weight_goal') return profile.shareWeight === 'absolute' || profile.shareWeight === 'delta';
  return true;
}

/** The goal as the viewer may see it: a weight goal loses its absolute numbers in delta mode. */
export function milestoneForViewer(profile, milestone) {
  if (!milestoneVisible(profile, milestone)) return null;
  const data = milestone.data || {};
  if (milestone.kind !== 'weight_goal') {
    return { id: milestone.id, kind: milestone.kind, data };
  }
  const unit = data.unit === 'lb' ? 'lb' : 'kg';
  const w = num(data.w), from = num(data.from);
  const delta = w > 0 && from > 0 ? Math.round((w - from) * 10) / 10 : null;
  const mode = profile?.shareWeight === 'absolute' ? 'absolute' : 'delta';
  if (mode === 'delta') return { id: milestone.id, kind: milestone.kind, data: { mode, unit, delta } };
  return {
    id: milestone.id,
    kind: milestone.kind,
    data: { mode, unit, targetW: num(data.targetW), current: w, delta },
  };
}

/** The owner's own goal, with the full numbers their privacy setting hides from friends. */
function ownMilestone(milestone) {
  if (milestone.kind !== 'weight_goal') return { id: milestone.id, kind: milestone.kind, data: milestone.data };
  const w = num(milestone.data?.w), from = num(milestone.data?.from);
  return {
    id: milestone.id,
    kind: milestone.kind,
    data: {
      mode: 'absolute',
      unit: milestone.data?.unit === 'lb' ? 'lb' : 'kg',
      targetW: num(milestone.data?.targetW),
      current: w,
      delta: w > 0 && from > 0 ? Math.round((w - from) * 10) / 10 : null,
    },
  };
}

/** One friend's reached goals as feed rows, privacy applied. */
export function milestoneItems(social, ownerId, state, user, viewerId, { own = false, limit = 20 } = {}) {
  if (!state || !user) return [];
  const profile = social?.profiles?.[ownerId] || null;
  const rows = [];
  for (const milestone of milestonesOf(state)) {
    const data = own ? ownMilestone(milestone) : milestoneForViewer(profile, milestone);
    if (!data) continue;
    const itemId = feedMilestoneId(ownerId, milestone.id);
    rows.push({
      itemId,
      kind: 'milestone',
      friend: { id: ownerId, name: user.name || '' },
      date: milestone.d,
      at: milestone.at,
      milestone: data,
      reactions: reactionSummary(social, itemId, viewerId),
    });
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit));
}

export function findMilestone(state, ownerId, publicId) {
  const split = splitFeedMilestoneId(publicId);
  if (!split || split[0] !== ownerId) return null;
  return milestonesOf(state).find(m => m.id === split[1]) || null;
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

export function feedItems(social, friendIds, userById, stateById, viewerId, { today = null, limit = 30, skipShare = false } = {}) {
  const rows = [];
  for (const id of friendIds) {
    const profile = social?.profiles?.[id] || {};
    if (!skipShare && profile.shareWorkouts === false) continue;
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
        kind: 'workout',
        at: workoutAtOf(workout),
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
