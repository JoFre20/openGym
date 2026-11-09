import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const USERS = [
  { id: 'u1', name: 'Ada', created: '2026-01-01T00:00:00.000Z', admin: true },
  { id: 'u2', name: 'Ben', created: '2026-01-01T00:00:00.000Z' },
  { id: 'u3', name: 'Cy', created: '2026-01-01T00:00:00.000Z' },
];
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const cookie = uid => ({ Cookie: `gymsid=${mintSession(uid)}` });

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-live-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
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
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

const readSocial = h => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'social.json'), 'utf8'));

async function befriend(h, a, b) {
  const other = await call(h, b, '/api/social/me');
  await call(h, a, '/api/social/friends/request', { method: 'POST', body: { friendCode: other.body.friendCode } });
  const pending = await call(h, b, '/api/social/me');
  const incoming = pending.body.pending.find(row => row.direction === 'incoming');
  const accepted = await call(h, b, '/api/social/friends/respond', {
    method: 'POST', body: { requestId: incoming.id, action: 'accept' },
  });
  assert.equal(accepted.status, 200, h.log);
}

const heartbeat = (h, body = {}) => call(h, 'u2', '/api/activity', {
  method: 'POST',
  body: {
    active: true, workoutId: 'w1', name: 'Push Day', exerciseId: '0025', exName: 'Bench Press',
    exIdx: 2, exTotal: 5, setsDone: 7, setsTotal: 16, startedAt: Date.now(), etaSec: 1500,
    ...body,
  },
});

test('a friend sees a live row only while the athlete shares it, and the start is announced once', async t => {
  const h = await startServer(t);
  await befriend(h, 'u1', 'u2');
  const close = await call(h, 'u2', '/api/social/friends/close', {
    method: 'POST', body: { friendId: 'u1', close: true },
  });
  assert.equal(close.status, 200);
  assert.deepEqual(close.body.closeFriends, ['u1']);
  const meAfterClose = await call(h, 'u2', '/api/social/me');
  assert.equal(meAfterClose.body.friends.find(row => row.id === 'u1').close, true);
  const settings = await call(h, 'u2', '/api/social/settings', {
    method: 'PUT',
    body: { shareLive: true, notifyFriends: true, startTone: 'drill', friendStartAlerts: true },
  });
  assert.equal(settings.status, 200);
  assert.deepEqual(settings.body.settings, {
    shareWorkouts: true, shareWeight: 'none', shareLive: true, notifyFriends: true,
    startTone: 'drill', friendStartAlerts: true,
  });

  const before = Date.now();
  const startedAt = before;
  const beat = await heartbeat(h, { startedAt });
  assert.equal(beat.status, 200);
  assert.equal(beat.body.shared, true);

  const live = await call(h, 'u1', '/api/social/live');
  assert.equal(live.status, 200);
  assert.equal(live.body.live.length, 1);
  const row = live.body.live[0];
  assert.equal(row.friend.id, 'u2');
  assert.equal(row.friend.name, 'Ben');
  assert.equal(row.workoutId, 'w1');
  assert.equal(row.name, 'Push Day');
  assert.equal(row.exerciseId, '0025');
  assert.equal(row.exName, 'Bench Press');
  assert.equal(row.exIdx, 2);
  assert.equal(row.exTotal, 5);
  assert.equal(row.setsDone, 7);
  assert.equal(row.setsTotal, 16);
  assert.equal(row.startedAt, startedAt);
  assert.ok(row.etaAt >= before + 1500 * 1000 - 1000, 'the ETA is stored from the server now');
  assert.ok(row.leftSec > 1490 && row.leftSec <= 1500, 'the row carries seconds left');

  // Not close any more: the friend still sees the live row, but not the sensitive details.
  await call(h, 'u2', '/api/social/friends/close', {
    method: 'POST', body: { friendId: 'u1', close: false },
  });
  await heartbeat(h, { startedAt });
  const limited = (await call(h, 'u1', '/api/social/live')).body.live[0];
  assert.equal(limited.limited, true);
  assert.equal(limited.name, 'Push Day');
  assert.equal(limited.startedAt, startedAt);
  for (const field of ['exerciseId', 'exName', 'exIdx', 'exTotal', 'setsDone', 'setsTotal', 'etaAt', 'leftSec']) {
    assert.equal(field in limited, false, field + ' is close-friend only');
  }
  await call(h, 'u2', '/api/social/friends/close', {
    method: 'POST', body: { friendId: 'u1', close: true },
  });

  const social = readSocial(h);
  assert.equal(social.profiles.u2.lastStartNotify.id, 'w1');
  const firstNotifyAt = social.profiles.u2.lastStartNotify.at;

  // A second heartbeat is not a second start.
  await heartbeat(h, { startedAt });
  assert.equal(readSocial(h).profiles.u2.lastStartNotify.at, firstNotifyAt);

  // A stranger never sees the row.
  assert.deepEqual((await call(h, 'u3', '/api/social/live')).body.live, []);

  await call(h, 'u2', '/api/social/settings', { method: 'PUT', body: { shareLive: false } });
  assert.deepEqual((await call(h, 'u1', '/api/social/live')).body.live, []);

  await call(h, 'u2', '/api/social/settings', { method: 'PUT', body: { shareLive: true } });
  await heartbeat(h, { startedAt });
  assert.equal((await call(h, 'u1', '/api/social/live')).body.live.length, 1);
  await call(h, 'u2', '/api/activity', { method: 'POST', body: { active: false, reason: 'navigated' } });
  assert.deepEqual((await call(h, 'u1', '/api/social/live')).body.live, []);
});

test('an old or missing start is not announced, and an oversized ETA is dropped', async t => {
  const h = await startServer(t);
  await befriend(h, 'u1', 'u2');
  await call(h, 'u2', '/api/social/friends/close', {
    method: 'POST', body: { friendId: 'u1', close: true },
  });
  await call(h, 'u2', '/api/social/settings', {
    method: 'PUT', body: { shareLive: true, notifyFriends: true },
  });

  await heartbeat(h, { workoutId: 'old', startedAt: Date.now() - 3 * 60 * 1000, etaSec: 999999 });
  assert.equal(readSocial(h).profiles.u2.lastStartNotify, undefined);
  const row = (await call(h, 'u1', '/api/social/live')).body.live[0];
  assert.equal(row.etaAt, null);
  assert.equal(row.leftSec, null);

  const badTone = await call(h, 'u2', '/api/social/settings', { method: 'PUT', body: { startTone: 'loud' } });
  assert.equal(badTone.status, 400);
  assert.equal(badTone.body.code, 'invalid-start-tone');
  const badBool = await call(h, 'u2', '/api/social/settings', { method: 'PUT', body: { shareLive: 'yes' } });
  assert.equal(badBool.status, 400);
  assert.equal(badBool.body.code, 'invalid-share-live');
});

test('the close-friend list accepts only accepted friends and a boolean choice', async t => {
  const h = await startServer(t);
  await befriend(h, 'u1', 'u2');
  const missing = await call(h, 'u1', '/api/social/friends/close', { method: 'POST', body: {} });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'friend-required');
  const bad = await call(h, 'u1', '/api/social/friends/close', {
    method: 'POST', body: { friendId: 'u2', close: 'yes' },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'invalid-close');
  const stranger = await call(h, 'u1', '/api/social/friends/close', {
    method: 'POST', body: { friendId: 'u3', close: true },
  });
  assert.equal(stranger.status, 404);
  assert.equal(stranger.body.code, 'friend-not-found');
  const added = await call(h, 'u1', '/api/social/friends/close', {
    method: 'POST', body: { friendId: 'u2', close: true },
  });
  assert.deepEqual(added.body.closeFriends, ['u2']);
  const removed = await call(h, 'u1', '/api/social/friends/close', {
    method: 'POST', body: { friendId: 'u2', close: false },
  });
  assert.deepEqual(removed.body.closeFriends, []);
});

test('the live route asks for a session and leaves the admin presence shape alone', async t => {
  const h = await startServer(t);
  assert.equal((await call(h, null, '/api/social/live')).status, 401);
  await heartbeat(h, { workoutId: 'w9', startedAt: Date.now() });
  const users = await call(h, 'u1', '/api/admin/users');
  assert.equal(users.status, 200);
  const live = users.body.users.find(u => u.id === 'u2').live;
  assert.deepEqual(Object.keys(live).sort(), [
    'exIdx', 'exTotal', 'name', 'setsDone', 'setsTotal', 'startedAt', 'updatedAt',
  ]);
});
