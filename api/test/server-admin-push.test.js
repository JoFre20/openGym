/* Admin push credentials (dashboard): admin only, secrets stay out of every answer, the config
 * reaches /api/config without a restart, and the activity log names the change. */
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
const ADMIN = 'u_push_adm', USER = 'u_push_usr';
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json' });

const ecPem = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' });
const fcmJson = () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    project_id: 'demo-project',
    client_email: 'pusher@demo.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
};

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-admin-push-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Adminna', created: new Date().toISOString(), admin: true, owner: true },
      { id: USER, name: 'Mallory', created: new Date().toISOString() },
    ],
    creds: [], subs: [{ userId: USER, endpoint: 'https://push.example/user', keys: { p256dh: 'x', auth: 'y' } }], invites: [],
    nativeSubs: [{ userId: USER, platform: 'ios', token: 'a'.repeat(64) }],
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
  });
  const h = { api: '', log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.get = async (route, uid = ADMIN) => {
    const r = await fetch(`${h.api}${route}`, { headers: as(uid) });
    return { status: r.status, body: await r.json() };
  };
  h.post = async (route, body, uid = ADMIN) => {
    const r = await fetch(`${h.api}${route}`, { method: 'POST', headers: { ...as(uid), Origin: 'http://localhost:8080' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  h.publicConfig = async () => (await fetch(`${h.api}/api/config`)).json();
  h.pushFile = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'push.json'), 'utf8'));
  return h;
}

test('only an admin sees or changes push credentials', async t => {
  const h = await startServer(t);
  assert.equal((await h.get('/api/admin/push', USER)).status, 403);
  assert.equal((await h.post('/api/admin/push/apns', {}, USER)).status, 403);
  assert.equal((await h.get('/api/admin/push')).status, 200);
});

test('APNs and FCM are added without a restart, and no secret comes back', async t => {
  const h = await startServer(t);
  const before = await h.publicConfig();
  assert.equal(before.native_push, undefined);

  const apns = { key: ecPem(), keyId: 'ABC123DEFG', teamId: 'TEAM123456', bundleId: 'com.example.app', environment: 'production' };
  let r = await h.post('/api/admin/push/apns', apns);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const status = await h.get('/api/admin/push');
  assert.equal(status.body.apns.configured, true);
  assert.equal(status.body.apns.source, 'dashboard');
  assert.equal(status.body.apns.keyId, 'ABC123DEFG');
  assert.equal(status.body.devices.web, 1);
  assert.equal(status.body.devices.ios, 1);
  assert.equal(status.body.devices.android, 0);
  assert.equal(JSON.stringify(status.body).includes('BEGIN PRIVATE KEY'), false, 'the .p8 never comes back');
  assert.equal(JSON.stringify(status.body).includes(apns.key), false);
  assert.equal((await h.publicConfig()).native_push.ios, true);

  const fcm = { serviceAccount: fcmJson() };
  r = await h.post('/api/admin/push/fcm', fcm);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const status2 = await h.get('/api/admin/push');
  assert.equal(status2.body.fcm.configured, true);
  assert.equal(status2.body.fcm.projectId, 'demo-project');
  assert.equal(JSON.stringify(status2.body).includes('BEGIN PRIVATE KEY'), false, 'the service-account key never comes back');
  assert.equal((await h.publicConfig()).native_push.android, true);

  const stored = fs.readFileSync(path.join(h.dataDir, 'push.json'), 'utf8');
  assert.equal(stored.includes('BEGIN PRIVATE KEY'), false, 'push.json holds sealed values only');
  assert.equal(fs.statSync(path.join(h.dataDir, 'push.json')).mode & 0o777, 0o600);

  r = await h.post('/api/admin/push/apns/remove', {});
  assert.equal(r.status, 200);
  assert.equal((await h.get('/api/admin/push')).body.apns.configured, false);
  r = await h.post('/api/admin/push/fcm/remove', {});
  assert.equal(r.status, 200);
  assert.equal((await h.publicConfig()).native_push, undefined);

  const audit = await h.get('/api/admin/audit?limit=50&cat=admin');
  const events = audit.body.events.map(e => e.ev);
  assert.ok(events.includes('admin.push.apns.set'), JSON.stringify(events));
  assert.ok(events.includes('admin.push.fcm.set'), JSON.stringify(events));
  assert.ok(events.includes('admin.push.apns.remove'), JSON.stringify(events));
  assert.ok(events.includes('admin.push.fcm.remove'), JSON.stringify(events));
});

test('bad credentials are refused and write nothing', async t => {
  const h = await startServer(t);
  let r = await h.post('/api/admin/push/apns', { key: 'nope', keyId: 'ABC123DEFG', teamId: 'TEAM123456', bundleId: 'com.example.app' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /p8|PEM/);
  r = await h.post('/api/admin/push/fcm', { serviceAccount: '{}' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /project_id/);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'push.json')), false);
});

test('VAPID rotation changes the public key served to browsers', async t => {
  const h = await startServer(t);
  const before = (await h.get('/api/push/public-key', USER)).body.key;
  const r = await h.post('/api/admin/push/vapid', { rotate: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = (await h.get('/api/push/public-key', USER)).body.key;
  assert.notEqual(after, before);
  const status = await h.get('/api/admin/push');
  assert.equal(status.body.web.configured, true);
  const audit = await h.get('/api/admin/audit?limit=50&cat=admin');
  assert.ok(audit.body.events.some(e => e.ev === 'admin.push.vapid.rotate'), JSON.stringify(audit.body.events));
});
