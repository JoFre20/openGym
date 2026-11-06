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
const IOS_TOKEN = 'a'.repeat(64);
const USERS = [
  { id: 'u1', name: 'Ada', created: '2026-01-01T00:00:00.000Z' },
  { id: 'u2', name: 'Ben', created: '2026-01-01T00:00:00.000Z' },
];
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const cookie = uid => ({ Cookie: `gymsid=${mintSession(uid)}` });

async function startServer(t, { apns = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-native-push-'));
  const keyFile = path.join(dataDir, 'apns-key.p8');
  fs.writeFileSync(keyFile, 'not a real key');
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  const env = { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' };
  if (apns) {
    Object.assign(env, {
      APNS_KEY_FILE: keyFile,
      APNS_KEY_ID: 'KEY123',
      APNS_TEAM_ID: 'TEAM123',
      APNS_BUNDLE_ID: 'hb.opengym.app',
    });
  } else {
    delete env.APNS_KEY_FILE;
    delete env.APNS_KEY_ID;
    delete env.APNS_TEAM_ID;
    delete env.APNS_BUNDLE_ID;
  }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'], env,
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

const readDb = h => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));

test('an iOS token registers, moves with its device id, and can be removed', async t => {
  const h = await startServer(t);
  const config = await fetch(`${h.api}/api/config`).then(r => r.json());
  assert.deepEqual(config.native_push, { ios: true, android: false });

  const registered = await call(h, 'u1', '/api/push/native', {
    method: 'POST', body: { platform: 'ios', token: IOS_TOKEN, deviceId: 'device-1' },
  });
  assert.equal(registered.status, 200, h.log);
  assert.equal(readDb(h).nativeSubs.length, 1);
  assert.equal(readDb(h).nativeSubs[0].userId, 'u1');
  assert.equal(readDb(h).nativeSubs[0].platform, 'ios');

  const status = await call(h, 'u1', `/api/push/native/status?token=${IOS_TOKEN}`);
  assert.deepEqual(status.body, { subscribed: true, platform: 'ios', environment: null });
  assert.equal((await call(h, 'u1', '/api/social/me')).body.hasPush, true);

  const bad = await call(h, 'u1', '/api/push/native', {
    method: 'POST', body: { platform: 'ios', token: 'not-hex', deviceId: 'device-1' },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'invalid-token');

  const wrongPlatform = await call(h, 'u1', '/api/push/native', {
    method: 'POST', body: { platform: 'android', token: IOS_TOKEN, deviceId: 'device-1' },
  });
  assert.equal(wrongPlatform.status, 409);
  assert.equal(wrongPlatform.body.code, 'native-push-off');

  const stolen = await call(h, 'u2', '/api/push/native', {
    method: 'POST', body: { platform: 'ios', token: IOS_TOKEN, deviceId: 'device-2' },
  });
  assert.equal(stolen.status, 409);
  assert.equal(stolen.body.code, 'token-busy');

  const moved = await call(h, 'u2', '/api/push/native', {
    method: 'POST', body: { platform: 'ios', token: IOS_TOKEN, deviceId: 'device-1' },
  });
  assert.equal(moved.status, 200);
  assert.equal(readDb(h).nativeSubs[0].userId, 'u2');

  const removed = await call(h, 'u2', '/api/push/native/unsubscribe', {
    method: 'POST', body: { token: IOS_TOKEN },
  });
  assert.equal(removed.status, 200);
  assert.equal(readDb(h).nativeSubs.length, 0);
  assert.deepEqual((await call(h, 'u2', `/api/push/native/status?token=${IOS_TOKEN}`)).body, { subscribed: false });
});

test('without credentials the platform is off and registration is refused', async t => {
  const h = await startServer(t, { apns: false });
  const config = await fetch(`${h.api}/api/config`).then(r => r.json());
  assert.equal(config.native_push, undefined);
  const refused = await call(h, 'u1', '/api/push/native', {
    method: 'POST', body: { platform: 'ios', token: IOS_TOKEN, deviceId: 'device-1' },
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'native-push-off');
});

test('signing out everywhere drops the account native tokens', async t => {
  const h = await startServer(t);
  await call(h, 'u1', '/api/push/native', {
    method: 'POST', body: { platform: 'ios', token: IOS_TOKEN, deviceId: 'device-1' },
  });
  assert.equal(readDb(h).nativeSubs.length, 1);
  const out = await call(h, 'u1', '/api/logout/all', { method: 'POST', body: {} });
  assert.equal(out.status, 200);
  assert.equal(readDb(h).nativeSubs.length, 0);
});
