import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { weekKeyOf } from '../social.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const TODAY = new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const daysAgo = n => new Date(Date.parse(TODAY + 'T12:00:00Z') - n * DAY).toISOString().slice(0, 10);

const USERS = [
  { id: 'u1', name: 'Ada', created: '2026-01-01T00:00:00.000Z' },
  { id: 'u2', name: 'Ben', created: '2026-01-01T00:00:00.000Z' },
  { id: 'u3', name: 'Cy', created: '2026-01-01T00:00:00.000Z' }
];

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = uid => ({ Cookie: `gymsid=${mintSession(uid)}` });

async function startServer(t, states = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  for (const [uid, state] of Object.entries(states)) {
    fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify(state));
  }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: '', dataDir, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  return h;
}

async function call(h, uid, endpoint, { method = 'GET', body } = {}) {
  const r = await fetch(`${h.api}${endpoint}`, {
    method,
    headers: { ...cookie(uid), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
}

const readSocial = h => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'social.json'), 'utf8'));

async function befriend(h, a, b) {
  const other = await call(h, b, '/api/social/me');
  const requested = await call(h, a, '/api/social/friends/request', {
    method: 'POST', body: { friendCode: other.body.friendCode }
  });
  assert.equal(requested.status, 200);
  const pending = await call(h, b, '/api/social/me');
  const incoming = pending.body.pending.find(row => row.direction === 'incoming');
  const accepted = await call(h, b, '/api/social/friends/respond', {
    method: 'POST', body: { requestId: incoming.id, action: 'accept' }
  });
  assert.equal(accepted.status, 200);
}

const SHARED_PLAN = {
  opengym_plan: 1,
  exported: TODAY,
  name: 'Ada’s plan',
  unit: 'kg',
  week: { 1: ['r1'], 3: ['r2'] },
  routines: [
    { id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 80 }] },
    { id: 'r2', name: 'Pull', ex: [{ id: '0026', sets: 3, reps: 8 }] }
  ],
  customEx: []
};

test('friends, privacy, squad stats, feed and reactions stay in social.json', async t => {
  const workout = {
    id: 'w1', d: TODAY, name: 'Push Day', start: Date.parse(TODAY + 'T08:00:00Z'), end: Date.parse(TODAY + 'T09:00:00Z'),
    vol: 8400, prs: ['0025'], entries: [{ id: '0025', sets: [{ w: 80, r: 5, done: true }] }]
  };
  const stateU2 = {
    unit: 'kg', weekStart: 1, workouts: [workout],
    bodyweight: [{ d: daysAgo(20), w: 80 }, { d: daysAgo(1), w: 78.5 }]
  };
  const h = await startServer(t, { u2: stateU2 });
  const beforeState = fs.readFileSync(path.join(h.dataDir, 'state-u2.json'), 'utf8');

  const first = await call(h, 'u1', '/api/social/me');
  assert.equal(first.status, 200);
  assert.match(first.body.friendCode, /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
  assert.deepEqual(first.body.settings, {
    shareWorkouts: true, shareWeight: 'none', shareLive: false, notifyFriends: false,
    startTone: 'motivational', friendStartAlerts: false
  });
  assert.deepEqual(first.body.friends, []);
  assert.deepEqual(first.body.pending, []);
  const second = await call(h, 'u2', '/api/social/me');
  assert.equal(second.status, 200);
  assert.notEqual(second.body.friendCode, first.body.friendCode);

  const requested = await call(h, 'u1', '/api/social/friends/request', {
    method: 'POST', body: { friendCode: second.body.friendCode.toLowerCase() }
  });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.request.direction, 'outgoing');
  assert.equal(requested.body.request.userId, 'u2');

  const duplicate = await call(h, 'u1', '/api/social/friends/request', {
    method: 'POST', body: { friendCode: second.body.friendCode }
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'already-requested');

  const pending = await call(h, 'u2', '/api/social/me');
  assert.equal(pending.body.pending.length, 1);
  assert.equal(pending.body.pending[0].direction, 'incoming');
  assert.equal(pending.body.pending[0].name, 'Ada');

  const accepted = await call(h, 'u2', '/api/social/friends/respond', {
    method: 'POST', body: { requestId: pending.body.pending[0].id, action: 'accept' }
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.friend.id, 'u1');

  const u1Friends = await call(h, 'u1', '/api/social/me');
  assert.equal(u1Friends.body.friends.length, 1);
  assert.equal(u1Friends.body.friends[0].id, 'u2');
  assert.equal(u1Friends.body.friends[0].name, 'Ben');

  const settings = await call(h, 'u2', '/api/social/settings', {
    method: 'PUT', body: { shareWorkouts: true, shareWeight: 'absolute' }
  });
  assert.equal(settings.status, 200);
  assert.deepEqual(settings.body.settings, {
    shareWorkouts: true, shareWeight: 'absolute', shareLive: false, notifyFriends: false,
    startTone: 'motivational', friendStartAlerts: false
  });
  const badSettings = await call(h, 'u2', '/api/social/settings', {
    method: 'PUT', body: { shareWeight: 'kg' }
  });
  assert.equal(badSettings.status, 400);
  assert.equal(badSettings.body.code, 'invalid-share-weight');

  const feed = await call(h, 'u1', '/api/social/feed');
  assert.equal(feed.status, 200);
  assert.equal(feed.body.weekStart, weekKeyOf(TODAY, 1));
  assert.equal(feed.body.squadStats.length, 1);
  assert.equal(feed.body.squadStats[0].id, 'u2');
  assert.equal(feed.body.squadStats[0].workoutsThisWeek, 1);
  assert.deepEqual(feed.body.squadStats[0].weight, {
    mode: 'absolute', unit: 'kg', current: 78.5, delta: -1.5, since: daysAgo(20), trend: 'down'
  });
  assert.equal(feed.body.feed.length, 1);
  const item = feed.body.feed[0];
  assert.equal(item.friend.name, 'Ben');
  assert.equal(item.volume, 8400);
  assert.equal(item.durationSec, 3600);
  assert.deepEqual(item.prs, ['0025']);
  assert.deepEqual(item.topSets, [{ exerciseId: '0025', weight: 80, reps: 5 }]);
  assert.deepEqual(item.reactions['🔥'], { count: 0, mine: false });
  assert.equal(fs.readFileSync(path.join(h.dataDir, 'state-u2.json'), 'utf8'), beforeState);

  const reacted = await call(h, 'u1', '/api/social/react', {
    method: 'POST', body: { workoutId: item.workoutId, emoji: '🔥' }
  });
  assert.equal(reacted.status, 200);
  assert.deepEqual(reacted.body.reactions['🔥'], { count: 1, mine: true });
  assert.equal(readSocial(h).reactions.length, 1);
  assert.equal(readSocial(h).reactions[0].ownerId, 'u2');

  const feedAgain = await call(h, 'u1', '/api/social/feed');
  assert.deepEqual(feedAgain.body.feed[0].reactions['🔥'], { count: 1, mine: true });

  const stranger = await call(h, 'u3', '/api/social/react', {
    method: 'POST', body: { workoutId: item.workoutId, emoji: '🔥' }
  });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.code, 'not-friends');

  const hidden = await call(h, 'u2', '/api/social/settings', {
    method: 'PUT', body: { shareWorkouts: false }
  });
  assert.equal(hidden.status, 200);
  const hiddenFeed = await call(h, 'u1', '/api/social/feed');
  assert.deepEqual(hiddenFeed.body.feed, []);
  assert.equal(hiddenFeed.body.squadStats[0].workoutsThisWeek, null);
  assert.equal(hiddenFeed.body.squadStats[0].weight.current, 78.5);

  await call(h, 'u2', '/api/social/settings', { method: 'PUT', body: { shareWorkouts: true } });
  const removed = await call(h, 'u1', '/api/social/friends/respond', {
    method: 'POST', body: { requestId: u1Friends.body.friends[0].friendshipId, action: 'remove' }
  });
  assert.equal(removed.status, 200);
  assert.equal(readSocial(h).friendships.length, 0);
  assert.equal(readSocial(h).reactions.length, 0);
  const afterRemove = await call(h, 'u1', '/api/social/feed');
  assert.deepEqual(afterRemove.body.feed, []);
  assert.deepEqual(afterRemove.body.squadStats, []);
});

test('friend request validation and authorization', async t => {
  const h = await startServer(t);
  const me = await call(h, 'u1', '/api/social/me');
  const other = await call(h, 'u2', '/api/social/me');

  const own = await call(h, 'u1', '/api/social/friends/request', {
    method: 'POST', body: { friendCode: me.body.friendCode }
  });
  assert.equal(own.status, 400);
  assert.equal(own.body.code, 'own-friend-code');

  const bad = await call(h, 'u1', '/api/social/friends/request', {
    method: 'POST', body: { friendCode: 'NOPE' }
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'invalid-friend-code');

  const unknown = await call(h, 'u1', '/api/social/friends/request', {
    method: 'POST', body: { friendCode: 'ZZZ-ZZZ' }
  });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'friend-code-not-found');

  await call(h, 'u1', '/api/social/friends/request', {
    method: 'POST', body: { friendCode: other.body.friendCode }
  });
  const pending = await call(h, 'u2', '/api/social/me');
  const senderTry = await call(h, 'u1', '/api/social/friends/respond', {
    method: 'POST', body: { requestId: pending.body.pending[0].id, action: 'accept' }
  });
  assert.equal(senderTry.status, 403);
  assert.equal(senderTry.body.code, 'not-recipient');

  const declined = await call(h, 'u2', '/api/social/friends/respond', {
    method: 'POST', body: { requestId: pending.body.pending[0].id, action: 'decline' }
  });
  assert.equal(declined.status, 200);
  assert.equal(readSocial(h).friendships.length, 0);

  await call(h, 'u1', '/api/social/friends/request', {
    method: 'POST', body: { friendCode: other.body.friendCode }
  });
  const again = await call(h, 'u2', '/api/social/me');
  const accepted = await call(h, 'u2', '/api/social/friends/respond', {
    method: 'POST', body: { requestId: again.body.pending[0].id, action: 'accept' }
  });
  assert.equal(accepted.status, 200);
  const lateDecline = await call(h, 'u2', '/api/social/friends/respond', {
    method: 'POST', body: { requestId: again.body.pending[0].id, action: 'decline' }
  });
  assert.equal(lateDecline.status, 409);
  assert.equal(lateDecline.body.code, 'not-pending');
});

test('a plan snapshot travels through the friends inbox and never touches a state file', async t => {
  const stateU2 = { unit: 'kg', weekStart: 1, workouts: [], bodyweight: [] };
  const h = await startServer(t, { u2: stateU2 });
  const beforeState = fs.readFileSync(path.join(h.dataDir, 'state-u2.json'), 'utf8');
  await befriend(h, 'u1', 'u2');

  const noFriends = await call(h, 'u1', '/api/social/plans/share', {
    method: 'POST', body: { friendIds: [], plan: SHARED_PLAN }
  });
  assert.equal(noFriends.status, 400);
  assert.equal(noFriends.body.code, 'invalid-friends');

  const stranger = await call(h, 'u3', '/api/social/plans/share', {
    method: 'POST', body: { friendIds: ['u2'], plan: SHARED_PLAN }
  });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.code, 'friend-not-found');

  const empty = await call(h, 'u1', '/api/social/plans/share', {
    method: 'POST', body: { friendIds: ['u2'], plan: { ...SHARED_PLAN, routines: [] } }
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.code, 'plan-empty');

  const tooLarge = await call(h, 'u1', '/api/social/plans/share', {
    method: 'POST', body: { friendIds: ['u2'], plan: { ...SHARED_PLAN, name: 'x'.repeat(300 * 1024) } }
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.code, 'plan-too-large');

  const meBefore = await call(h, 'u2', '/api/social/me');
  assert.equal(meBefore.body.planShares, 0);

  const shared = await call(h, 'u1', '/api/social/plans/share', {
    method: 'POST', body: { friendIds: ['u2'], plan: SHARED_PLAN }
  });
  assert.equal(shared.status, 200);
  assert.deepEqual(shared.body, { ok: true, shared: 1 });
  assert.equal(readSocial(h).planShares.length, 1);
  assert.equal(readSocial(h).planShares[0].from, 'u1');
  assert.equal(readSocial(h).planShares[0].to, 'u2');

  const meAfter = await call(h, 'u2', '/api/social/me');
  assert.equal(meAfter.body.planShares, 1);

  const inbox = await call(h, 'u2', '/api/social/plans');
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.received.length, 1);
  assert.equal(inbox.body.sent.length, 0);
  const row = inbox.body.received[0];
  assert.equal(row.from.id, 'u1');
  assert.equal(row.from.name, 'Ada');
  assert.equal(row.name, 'Ada’s plan');
  assert.equal(row.unit, 'kg');
  assert.equal(row.routineCount, 2);
  assert.equal(row.exerciseCount, 2);
  assert.equal(row.scheduledDays, 2);
  assert.ok(row.createdAt > 0);

  const outbox = await call(h, 'u1', '/api/social/plans');
  assert.equal(outbox.body.received.length, 0);
  assert.equal(outbox.body.sent.length, 1);
  assert.equal(outbox.body.sent[0].to.id, 'u2');
  assert.equal(outbox.body.sent[0].to.name, 'Ben');

  const opened = await call(h, 'u2', `/api/social/plans/plan?shareId=${row.id}`);
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.body.plan, SHARED_PLAN);
  assert.equal((await call(h, 'u1', `/api/social/plans/plan?shareId=${row.id}`)).status, 200, 'the sender may also read it');
  const outsider = await call(h, 'u3', `/api/social/plans/plan?shareId=${row.id}`);
  assert.equal(outsider.status, 404);
  assert.equal(outsider.body.code, 'share-not-found');

  const outsiderRemove = await call(h, 'u3', '/api/social/plans/remove', {
    method: 'POST', body: { shareId: row.id }
  });
  assert.equal(outsiderRemove.status, 404);

  const removed = await call(h, 'u2', '/api/social/plans/remove', {
    method: 'POST', body: { shareId: row.id }
  });
  assert.equal(removed.status, 200);
  assert.deepEqual((await call(h, 'u2', '/api/social/plans')).body.received, []);
  assert.deepEqual((await call(h, 'u1', '/api/social/plans')).body.sent, []);

  await call(h, 'u1', '/api/social/plans/share', {
    method: 'POST', body: { friendIds: ['u2'], plan: SHARED_PLAN }
  });
  assert.equal(readSocial(h).planShares.length, 1);
  const friends = await call(h, 'u1', '/api/social/me');
  const removedFriend = await call(h, 'u1', '/api/social/friends/respond', {
    method: 'POST', body: { requestId: friends.body.friends[0].friendshipId, action: 'remove' }
  });
  assert.equal(removedFriend.status, 200);
  assert.equal(readSocial(h).planShares.length, 0, 'ending a friendship removes unread snapshots both ways');
  assert.equal(fs.readFileSync(path.join(h.dataDir, 'state-u2.json'), 'utf8'), beforeState);
});
