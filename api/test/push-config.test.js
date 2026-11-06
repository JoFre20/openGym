/* The dashboard-owned push credentials: the environment still works, the dashboard copy wins,
 * removals fall back, and no secret is ever written in the clear. */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import webpush from 'web-push';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-push-config-'));
fs.writeFileSync(path.join(DATA, 'secret'), crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
process.env.DATA_DIR = DATA;
const cfg = await import('../push-config.js');

const ecPem = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' });
const fcmJson = () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    project_id: 'demo-project',
    client_email: 'pusher@demo.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    token_uri: 'https://oauth2.googleapis.com/token',
  });
};
const apns = extra => ({ key: ecPem(), keyId: 'ABC123DEFG', teamId: 'TEAM123456', bundleId: 'com.example.app', ...extra });
const clean = () => {
  try { fs.unlinkSync(path.join(DATA, 'push.json')); } catch { /* absent */ }
  try { fs.unlinkSync(path.join(DATA, 'vapid.json')); } catch { /* absent */ }
  cfg.resetForTest();
};
const readFile = () => fs.readFileSync(path.join(DATA, 'push.json'), 'utf8');

beforeEach(() => {
  clean();
  delete process.env.APNS_KEY_FILE;
  delete process.env.APNS_KEY_ID;
  delete process.env.APNS_TEAM_ID;
  delete process.env.APNS_BUNDLE_ID;
  delete process.env.APNS_ENV;
  delete process.env.FCM_SERVICE_ACCOUNT_FILE;
  delete process.env.FCM_PROJECT_ID;
  delete process.env.FCM_CLIENT_EMAIL;
  delete process.env.FCM_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});
after(() => fs.rmSync(DATA, { recursive: true, force: true }));

test('Web Push starts generated, native transports start off', () => {
  const s = cfg.status();
  assert.equal(s.web.configured, true);
  assert.ok(fs.existsSync(path.join(DATA, 'vapid.json')));
  assert.equal(s.apns.configured, false);
  assert.equal(s.fcm.configured, false);
  assert.deepEqual(s.native, { ios: false, android: false });
});

test('APNs credentials are sealed on disk and can be removed again', () => {
  const body = apns();
  assert.deepEqual(cfg.saveApns(body), { ok: true });
  const stored = readFile();
  assert.equal(stored.includes('BEGIN PRIVATE KEY'), false, 'the .p8 is not stored in the clear');
  assert.equal(fs.statSync(path.join(DATA, 'push.json')).mode & 0o777, 0o600);
  const s = cfg.status();
  assert.equal(s.apns.configured, true);
  assert.equal(s.apns.source, 'dashboard');
  assert.equal(s.apns.keyId, 'ABC123DEFG');
  assert.deepEqual(s.native, { ios: true, android: false });
  assert.deepEqual(cfg.remove('apns'), { ok: true });
  assert.equal(cfg.status().apns.configured, false);
});

test('APNs metadata can be changed without pasting the .p8 again', () => {
  cfg.saveApns(apns());
  assert.deepEqual(cfg.saveApns({ key: '', keyId: 'XYZ1234567', teamId: 'TEAM123456', bundleId: 'com.example.next' }), { ok: true });
  const s = cfg.status();
  assert.equal(s.apns.keyId, 'XYZ1234567');
  assert.equal(s.apns.bundleId, 'com.example.next');
  assert.equal(s.apns.configured, true);
});

test('FCM credentials are sealed on disk and can be removed again', () => {
  assert.deepEqual(cfg.saveFcm({ serviceAccount: fcmJson() }), { ok: true });
  const stored = readFile();
  assert.equal(stored.includes('BEGIN PRIVATE KEY'), false, 'the service-account key is not stored in the clear');
  const s = cfg.status();
  assert.equal(s.fcm.configured, true);
  assert.equal(s.fcm.source, 'dashboard');
  assert.equal(s.fcm.projectId, 'demo-project');
  assert.deepEqual(s.native, { ios: false, android: true });
  assert.deepEqual(cfg.remove('fcm'), { ok: true });
  assert.equal(cfg.status().fcm.configured, false);
});

test('the environment remains a fallback, and the dashboard overrides it per platform', () => {
  const keyFile = path.join(DATA, 'apns.p8');
  const accountFile = path.join(DATA, 'firebase.json');
  fs.writeFileSync(keyFile, ecPem(), { mode: 0o600 });
  fs.writeFileSync(accountFile, fcmJson(), { mode: 0o600 });
  Object.assign(process.env, {
    APNS_KEY_FILE: keyFile, APNS_KEY_ID: 'ENV1234567', APNS_TEAM_ID: 'ENVTEAM123',
    APNS_BUNDLE_ID: 'com.env.app', FCM_SERVICE_ACCOUNT_FILE: accountFile,
  });
  cfg.resetForTest();
  let s = cfg.status();
  assert.equal(s.apns.source, 'environment');
  assert.equal(s.fcm.source, 'environment');
  assert.deepEqual(s.native, { ios: true, android: true });

  cfg.saveApns(apns());
  s = cfg.status();
  assert.equal(s.apns.source, 'dashboard');
  assert.equal(s.apns.keyId, 'ABC123DEFG');
  cfg.remove('apns');
  assert.equal(cfg.status().apns.source, 'environment');
});

test('an unreadable stored value is reported, not mistaken for an empty one', () => {
  cfg.saveApns(apns());
  const doc = JSON.parse(readFile());
  doc.apns.key = 'v1.bad.bad.bad';
  fs.writeFileSync(path.join(DATA, 'push.json'), JSON.stringify(doc));
  cfg.resetForTest();
  const s = cfg.status();
  assert.equal(s.apns.configured, false);
  assert.equal(s.apns.unreadable, true);
  assert.equal(s.apns.source, 'unreadable');
});

test('APNs input is validated before anything is written', () => {
  assert.match(cfg.saveApns({ ...apns(), key: 'not a pem' }).error, /p8|PEM/);
  assert.match(cfg.saveApns({ ...apns(), keyId: 'short' }).error, /key id/);
  assert.match(cfg.saveApns({ ...apns(), bundleId: '' }).error, /bundle id/);
  assert.equal(fs.existsSync(path.join(DATA, 'push.json')), false);
});

test('FCM input is validated before anything is written', () => {
  assert.match(cfg.saveFcm({ serviceAccount: '{}' }).error, /project_id/);
  assert.match(cfg.saveFcm({ serviceAccount: 'not json' }).error, /valid JSON/);
  assert.equal(fs.existsSync(path.join(DATA, 'push.json')), false);
});

test('a VAPID pair from another server can be installed and removed', () => {
  const pair = webpush.generateVAPIDKeys();
  assert.equal(cfg.saveVapid(pair).ok, true);
  const current = cfg.vapid();
  assert.equal(current.publicKey, pair.publicKey);
  assert.equal(current.source, 'dashboard');
  assert.equal(cfg.status().web.source, 'dashboard');
  assert.deepEqual(cfg.remove('vapid'), { ok: true });
  assert.notEqual(cfg.vapid().publicKey, pair.publicKey);
});

test('VAPID can keep its generated pair, change the contact, or rotate', () => {
  const before = cfg.vapid();
  assert.deepEqual(cfg.saveVapid({ subject: 'mailto:owner@example.com' }), { ok: true, publicKey: before.publicKey });
  const withSubject = cfg.vapid();
  assert.equal(withSubject.subject, 'mailto:owner@example.com');
  assert.equal(withSubject.publicKey, before.publicKey);

  const rotated = cfg.saveVapid({ rotate: true });
  assert.equal(rotated.ok, true);
  const after = cfg.vapid();
  assert.notEqual(after.publicKey, before.publicKey);
  assert.equal(after.subject, 'mailto:owner@example.com');

  assert.deepEqual(cfg.remove('vapid'), { ok: true });
  const fallback = cfg.vapid();
  assert.equal(fallback.subject, 'mailto:admin@localhost');
  assert.equal(fallback.publicKey, before.publicKey);
});
