/* Profile pictures: a small data URL in social.json, visible to the person, their friends and
   an admin. The bytes never enter the media store, so there is no folder or sweep to check —
   the social profile is the whole record. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { avatarProblem } from '../avatar.js';
import { jpeg } from './media-samples.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const USER = 'u_avatar_1';
const FRIEND = 'u_avatar_2';
const OTHER = 'u_avatar_3';
const AVATAR = 'data:image/jpeg;base64,' + jpeg(400).toString('base64');
const LARGE = 'data:image/jpeg;base64,' + jpeg(140 * 1024).toString('base64');

const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const cookie = uid => ({ Cookie: `gymsid=${mintSession(uid)}` });

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-avatar-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: USER, name: 'Ada', created: '2026-01-01T00:00:00.000Z', admin: true },
      { id: FRIEND, name: 'Ben', created: '2026-01-01T00:00:00.000Z' },
      { id: OTHER, name: 'Cy', created: '2026-01-01T00:00:00.000Z' }
    ], creds: [], subs: [], invites: []
  }));
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
const profileOf = (h, uid) => readSocial(h).profiles[uid] || {};

async function befriend(h, a, b) {
  const other = await call(h, b, '/api/social/me');
  const requested = await call(h, a, '/api/social/friends/request', {
    method: 'POST', body: { friendCode: other.body.friendCode }
  });
  assert.equal(requested.status, 200);
  const pending = await call(h, b, '/api/social/me');
  const incoming = pending.body.pending.find(row => row.direction === 'incoming');
  assert.equal((await call(h, b, '/api/social/friends/respond', {
    method: 'POST', body: { requestId: incoming.id, action: 'accept' }
  })).status, 200);
}

test('avatarProblem accepts only small JPEG, PNG or WebP data URLs', () => {
  assert.equal(avatarProblem(AVATAR), null);
  assert.equal(avatarProblem('not a data url'), 'avatar-invalid');
  assert.equal(avatarProblem('data:image/svg+xml;base64,PHN2Zz4='), 'avatar-invalid');
  assert.equal(avatarProblem('data:image/png;base64,' + Buffer.from('not a png').toString('base64')), 'avatar-invalid');
  assert.equal(avatarProblem(LARGE), 'avatar-too-large');
});

test('a profile picture reaches the owner, friends and the admin, and can be removed', async t => {
  const h = await startServer(t);
  assert.equal((await call(h, FRIEND, '/api/account/avatar', { method: 'PUT', body: { avatar: AVATAR } })).status, 200);
  assert.equal(profileOf(h, FRIEND).avatar, AVATAR);

  const me = await call(h, FRIEND, '/api/me');
  assert.equal(me.body.user.avatar, AVATAR);
  const socialMe = await call(h, FRIEND, '/api/social/me');
  assert.equal(socialMe.body.avatar, AVATAR);

  await befriend(h, USER, FRIEND);
  const ownerView = await call(h, USER, '/api/social/me');
  assert.equal(ownerView.body.friends.find(row => row.id === FRIEND).avatar, AVATAR);
  const feed = await call(h, USER, '/api/social/feed');
  assert.equal(feed.body.squadStats.find(row => row.id === FRIEND).avatar, AVATAR);

  await call(h, FRIEND, '/api/social/plans/share', {
    method: 'POST', body: {
      friendIds: [USER],
      plan: {
        opengym_plan: 1, name: 'Push', unit: 'kg', week: { 1: ['r1'] },
        routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5 }] }]
      }
    }
  });
  const inbox = await call(h, USER, '/api/social/plans');
  assert.equal(inbox.body.received[0].from.avatar, AVATAR);

  const detail = await call(h, USER, '/api/admin/user?id=' + FRIEND);
  assert.equal(detail.body.user.avatar, AVATAR);

  const removed = await call(h, FRIEND, '/api/account/avatar', { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { ok: true, avatar: null });
  assert.equal(profileOf(h, FRIEND).avatar, undefined);
  assert.equal((await call(h, FRIEND, '/api/social/me')).body.avatar, undefined);
});

test('invalid and oversized pictures are refused without touching the profile', async t => {
  const h = await startServer(t);
  const invalid = await call(h, FRIEND, '/api/account/avatar', {
    method: 'PUT', body: { avatar: 'data:image/svg+xml;base64,PHN2Zz4=' }
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'avatar-invalid');

  const large = await call(h, FRIEND, '/api/account/avatar', {
    method: 'PUT', body: { avatar: LARGE }
  });
  assert.equal(large.status, 413);
  assert.equal(large.body.code, 'avatar-too-large');

  const missing = await call(h, FRIEND, '/api/account/avatar', {
    method: 'PUT', body: { avatar: '' }
  });
  assert.equal(missing.status, 400);
  assert.equal(profileOf(h, FRIEND).avatar, undefined);
});

test('an admin can remove another profile picture, but not the account', async t => {
  const h = await startServer(t);
  await call(h, FRIEND, '/api/account/avatar', { method: 'PUT', body: { avatar: AVATAR } });

  const refused = await call(h, FRIEND, '/api/admin/user/avatar/delete', {
    method: 'POST', body: { id: USER }
  });
  assert.equal(refused.status, 403);

  const removed = await call(h, USER, '/api/admin/user/avatar/delete', {
    method: 'POST', body: { id: FRIEND }
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { ok: true, id: FRIEND, removed: true });
  assert.equal(profileOf(h, FRIEND).avatar, undefined);
  assert.equal((await call(h, FRIEND, '/api/me')).body.user.name, 'Ben');

  const again = await call(h, USER, '/api/admin/user/avatar/delete', {
    method: 'POST', body: { id: FRIEND }
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.removed, false);
});
