import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptedFriendIds, dropPlanSharesBetween, dropPlanSharesForUser, emptySocial, ensureProfile, feedItems,
  feedWorkoutId, findPlanShare, findWorkout, formatFriendCode, friendCodeFromBytes, friendCodeValid,
  friendshipBetween, generateFriendCode, normalizeFriendCode, normalizeSocial, pendingFriendships,
  planShareProblem, planShareSummary, PLAN_SHARE_MAX_BYTES, profileByCode, reactionSummary,
  receivedPlanShares, sentPlanShares, squadStats, topSetsOf, trimPlanShares, weekKeyOf,
  weightProgressOf, workoutDurationSec, workoutVolumeOf
} from '../social.js';

const DAY = 86400000;
const today = new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.parse(today + 'T12:00:00Z') - n * DAY).toISOString().slice(0, 10);

test('friend codes are six readable characters, formatted and case-insensitive', () => {
  assert.equal(formatFriendCode('a7x92b'), 'A7X-92B');
  assert.equal(normalizeFriendCode(' a7x-92b '), 'A7X92B');
  assert.equal(friendCodeValid('A7X-92B'), true);
  assert.equal(friendCodeValid('A7X-92O'), false);
  assert.equal(friendCodeValid('A7X-92'), false);
  assert.equal(friendCodeFromBytes([0, 1, 2, 3, 4, 5]), 'ABCDEF');
  const code = generateFriendCode(new Set());
  assert.match(code, /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
});

test('every profile gets one stable code and the privacy defaults', () => {
  const social = emptySocial();
  const first = ensureProfile(social, 'u1', { now: 10 });
  assert.equal(first.changed, true);
  assert.deepEqual(first.profile, {
    friendCode: first.profile.friendCode,
    shareWorkouts: true,
    shareWeight: 'none',
    createdAt: 10,
    updatedAt: 10
  });
  const again = ensureProfile(social, 'u1', { now: 20 });
  assert.equal(again.changed, false);
  assert.equal(again.profile.friendCode, first.profile.friendCode);
  assert.equal(again.profile.createdAt, 10);
  const second = ensureProfile(social, 'u2');
  assert.notEqual(second.profile.friendCode, first.profile.friendCode);
  assert.deepEqual(profileByCode(social, first.profile.friendCode.toLowerCase()), { uid: 'u1', profile: first.profile });
});

test('friendships are found in either direction', () => {
  const social = emptySocial();
  ensureProfile(social, 'a');
  ensureProfile(social, 'b');
  const pending = { id: 'f1', from: 'a', to: 'b', status: 'pending', createdAt: 1 };
  social.friendships.push(pending);
  assert.equal(friendshipBetween(social, 'b', 'a'), pending);
  assert.deepEqual(pendingFriendships(social, 'b'), [pending]);
  pending.status = 'accepted';
  pending.acceptedAt = 2;
  assert.deepEqual(acceptedFriendIds(social, 'a'), ['b']);
  assert.deepEqual(acceptedFriendIds(social, 'b'), ['a']);
});

test('weeks start on Monday by default and on Sunday when asked', () => {
  assert.equal(weekKeyOf('2026-11-02'), '2026-11-02');
  assert.equal(weekKeyOf('2026-11-08'), '2026-11-02');
  assert.equal(weekKeyOf('2026-11-08', 0), '2026-11-08');
});

test('weight progress follows the privacy mode and the 30-day window', () => {
  const state = { unit: 'kg', bodyweight: [{ d: daysAgo(20), w: 80 }, { d: daysAgo(2), w: 78.5 }] };
  assert.equal(weightProgressOf(state, 'none'), null);
  assert.deepEqual(weightProgressOf(state, 'absolute', { today }), {
    mode: 'absolute', unit: 'kg', current: 78.5, delta: -1.5, since: daysAgo(20), trend: 'down'
  });
  assert.deepEqual(weightProgressOf(state, 'delta', { today }), {
    mode: 'delta', unit: 'kg', delta: -1.5, since: daysAgo(20), trend: 'down'
  });
  const old = { unit: 'lb', bodyweight: [{ d: daysAgo(80), w: 200 }, { d: daysAgo(60), w: 190 }] };
  assert.deepEqual(weightProgressOf(old, 'absolute', { today }), { mode: 'absolute', unit: 'lb', current: 190 });
  assert.equal(weightProgressOf(old, 'delta', { today }), null);
});

test('workout summary reads volume, duration, top sets and PR ids', () => {
  const workout = {
    id: 'w1', d: today, start: 1000, end: 181000, vol: 900, prs: ['a', 'a', 'b'],
    entries: [
      { id: 'a', sets: [
        { w: 100, r: 5, done: true },
        { w: 90, r: 8, done: true },
        { w: 200, r: 10, done: false }
      ] },
      { id: 'b', sets: [{ w: 80, r: 5, done: true, phase: 'warmup' }, { w: 70, r: 6, done: true }] }
    ]
  };
  assert.equal(workoutVolumeOf(workout), 900);
  assert.equal(workoutDurationSec(workout), 180);
  assert.deepEqual(topSetsOf(workout), [
    { exerciseId: 'a', weight: 100, reps: 5 },
    { exerciseId: 'b', weight: 70, reps: 6 }
  ]);
  assert.equal(findWorkout({ workouts: [workout] }, 'u1', feedWorkoutId('u1', workout)), workout);
  assert.equal(findWorkout({ workouts: [workout] }, 'u2', feedWorkoutId('u1', workout)), null);
});

test('the feed carries the name of a friend custom exercise in its top sets', () => {
  const social = emptySocial();
  ensureProfile(social, 'u1');
  const users = { u1: { id: 'u1', name: 'One' } };
  const states = {
    u1: {
      unit: 'kg',
      customEx: [{ id: 'c1', n: 'My sled push' }],
      workouts: [{ id: 'w1', d: today, start: 1, end: 2, entries: [{ id: 'c1', sets: [{ w: 40, r: 8, done: true }] }] }]
    }
  };
  const rows = feedItems(social, ['u1'], id => users[id], id => states[id], 'u2', { today });
  assert.deepEqual(rows[0].topSets, [{ exerciseId: 'c1', weight: 40, reps: 8, name: 'My sled push' }]);
});

test('the feed omits friends who turned workout sharing off and counts reactions', () => {
  const social = emptySocial();
  ensureProfile(social, 'u1');
  ensureProfile(social, 'u2').profile.shareWorkouts = false;
  const users = { u1: { id: 'u1', name: 'One' }, u2: { id: 'u2', name: 'Two' } };
  const state = { unit: 'kg', workouts: [{ id: 'w1', d: today, start: 1, end: 2, vol: 10, prs: [] }] };
  const states = { u1: state, u2: state };
  const rows = feedItems(social, ['u1', 'u2'], id => users[id], id => states[id], 'u2', { today });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].friend.id, 'u1');
  const workoutId = rows[0].workoutId;
  social.reactions.push({ workoutId, ownerId: 'u1', userId: 'u2', emoji: '🔥' });
  assert.deepEqual(reactionSummary(social, workoutId, 'u2')['🔥'], { count: 1, mine: true });
  assert.deepEqual(reactionSummary(social, workoutId, 'u1')['🔥'], { count: 1, mine: false });
  assert.equal(squadStats(social, ['u1', 'u2'], id => users[id], id => states[id], { today })[1].workoutsThisWeek, null);
});

const planBundle = (patch = {}) => ({
  opengym_plan: 1,
  exported: today,
  name: '  Ada’s plan  ',
  unit: 'kg',
  week: { 1: ['r1'], 2: [], 3: ['r2'] },
  routines: [
    { id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5 }] },
    { id: 'r2', name: 'Pull', ex: [{ id: '0026', sets: 3, reps: 8 }, { id: '0027', sets: 2, reps: 10 }] }
  ],
  customEx: [],
  ...patch
});

test('plan snapshots are validated before they enter social.json', () => {
  assert.equal(planShareProblem(planBundle()), null);
  assert.equal(planShareProblem(planBundle({ routines: [] })), 'plan-empty');
  assert.equal(planShareProblem(planBundle({ routines: [{ id: 'r1', name: 'Empty', ex: [] }] })), 'plan-empty');
  assert.equal(planShareProblem(planBundle({ routines: [{ id: 'r1', name: 'Broken' }] })), 'plan-invalid');
  assert.equal(planShareProblem(planBundle({ opengym_plan: 0 })), 'plan-invalid');
  assert.equal(planShareProblem(planBundle({ unit: 'stone' })), 'plan-invalid');
  assert.equal(planShareProblem(planBundle({ customEx: 'nope' })), 'plan-invalid');
  assert.equal(planShareProblem(planBundle({ week: [] })), 'plan-invalid');
  assert.equal(planShareProblem(planBundle({ name: 'x'.repeat(PLAN_SHARE_MAX_BYTES + 100) })), 'plan-too-large');
  assert.equal(planShareProblem(null), 'plan-invalid');
  assert.equal(planShareProblem('not a plan'), 'plan-invalid');
});

test('a plan summary is read from the snapshot, never from separate metadata', () => {
  assert.deepEqual(planShareSummary(planBundle()), {
    name: 'Ada’s plan',
    unit: 'kg',
    routineCount: 2,
    exerciseCount: 3,
    scheduledDays: 2
  });
  assert.deepEqual(planShareSummary(planBundle({ name: '', unit: 'lb' })), {
    name: '', unit: 'lb', routineCount: 2, exerciseCount: 3, scheduledDays: 2
  });
});

test('plan shares are listed newest first, trimmed per recipient and dropped with a friendship', () => {
  const social = emptySocial();
  assert.deepEqual(social.planShares, []);
  social.planShares = [
    { id: 'p1', from: 'u2', to: 'u1', plan: planBundle(), createdAt: 10 },
    { id: 'p2', from: 'u3', to: 'u1', plan: planBundle(), createdAt: 20 },
    { id: 'p3', from: 'u1', to: 'u2', plan: planBundle(), createdAt: 30 }
  ];
  assert.deepEqual(receivedPlanShares(social, 'u1').map(share => share.id), ['p2', 'p1']);
  assert.deepEqual(sentPlanShares(social, 'u1').map(share => share.id), ['p3']);
  assert.equal(findPlanShare(social, 'p2').id, 'p2');
  assert.equal(findPlanShare(social, 'missing'), null);
  assert.equal(trimPlanShares(social, 'u1', 1), 1);
  assert.deepEqual(receivedPlanShares(social, 'u1').map(share => share.id), ['p2']);
  social.planShares.push({ id: 'p4', from: 'u1', to: 'u2', plan: planBundle(), createdAt: 40 });
  assert.equal(dropPlanSharesBetween(social, 'u2', 'u1'), 2);
  assert.deepEqual(social.planShares.map(share => share.id), ['p2']);
  assert.equal(dropPlanSharesForUser(social, 'u1'), 1);
  assert.deepEqual(social.planShares, []);
});

test('normalizing social keeps whole plan shares and ignores damaged rows', () => {
  const raw = {
    profiles: {}, friendships: [], reactions: [],
    planShares: [
      { id: 'p1', from: 'u1', to: 'u2', plan: planBundle(), createdAt: 1 },
      { id: 'p2', from: 'u1', to: 'u2', plan: null, createdAt: 2 },
      { id: 'p3', from: 'u1', to: 'u2', createdAt: 3 },
      { from: 'u1', to: 'u2', plan: planBundle() },
      'nope'
    ]
  };
  assert.deepEqual(normalizeSocial(raw).planShares.map(share => share.id), ['p1']);
});
