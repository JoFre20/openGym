import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  apnsPayload, fcmMessage, nativeEnvironment, nativePushCapabilities, nativeTokenProblem,
  readNativePushConfig, sendNativeNotifications, signApnsJwt, signFcmJwt,
} from '../push-native.js';

const IOS_TOKEN = 'a'.repeat(64);
const ANDROID_TOKEN = 'fcm-token_1234567890:abcdefghijklmnop';
const NOW = 1_800_000_000_000;
const EC = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const RSA = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const APNS_KEY = EC.privateKey.export({ type: 'pkcs8', format: 'pem' });
const FCM_KEY = RSA.privateKey.export({ type: 'pkcs8', format: 'pem' });

test('native token validation is strict about the platform and the shape', () => {
  assert.equal(nativeTokenProblem('ios', IOS_TOKEN), null);
  assert.equal(nativeTokenProblem('ios', 'A'.repeat(64)), null);
  assert.equal(nativeTokenProblem('ios', 'not-hex'), 'token');
  assert.equal(nativeTokenProblem('ios', 'a'.repeat(31)), 'token');
  assert.equal(nativeTokenProblem('android', ANDROID_TOKEN), null);
  assert.equal(nativeTokenProblem('android', 'short'), 'token');
  assert.equal(nativeTokenProblem('android', 'has a space'), 'token');
  assert.equal(nativeTokenProblem('windows', ANDROID_TOKEN), 'platform');
  assert.equal(nativeTokenProblem('ios', null), 'token');
  assert.equal(nativeEnvironment('sandbox'), 'sandbox');
  assert.equal(nativeEnvironment('production'), 'production');
  assert.equal(nativeEnvironment('staging'), undefined);
});

test('the APNs and FCM payloads carry the title, body, route and tag', () => {
  const payload = { title: 'Ada is training', body: 'Your move.', tag: 'friend-start', url: '#/social' };
  assert.deepEqual(apnsPayload(payload), {
    aps: {
      alert: { title: 'Ada is training', body: 'Your move.' },
      sound: 'default',
      'thread-id': 'friend-start',
    },
    url: '#/social',
  });
  const fcm = fcmMessage(ANDROID_TOKEN, payload);
  assert.equal(fcm.message.token, ANDROID_TOKEN);
  assert.deepEqual(fcm.message.notification, { title: 'Ada is training', body: 'Your move.' });
  assert.deepEqual(fcm.message.data, { url: '#/social', tag: 'friend-start' });
  assert.equal(fcm.message.android.priority, 'high');
  assert.equal(fcm.message.android.notification.channel_id, 'opengym');
  assert.equal(fcm.message.android.notification.tag, 'friend-start');
});

test('both provider assertions are valid signatures', () => {
  const apns = { key: APNS_KEY, keyId: 'KEY123', teamId: 'TEAM123' };
  const apnsJwt = signApnsJwt(apns, NOW);
  const [ah, ap, as] = apnsJwt.split('.');
  assert.equal(crypto.verify('sha256', Buffer.from(`${ah}.${ap}`), {
    key: EC.publicKey, dsaEncoding: 'ieee-p1363',
  }, Buffer.from(as, 'base64url')), true);
  assert.deepEqual(JSON.parse(Buffer.from(ah, 'base64url')), { alg: 'ES256', kid: 'KEY123' });
  assert.deepEqual(JSON.parse(Buffer.from(ap, 'base64url')), { iss: 'TEAM123', iat: NOW / 1000 });

  const fcm = {
    clientEmail: 'service@example.test',
    privateKey: FCM_KEY,
    tokenUri: 'https://oauth2.example/token',
  };
  const fcmJwt = signFcmJwt(fcm, NOW);
  const [fh, fp, fsig] = fcmJwt.split('.');
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${fh}.${fp}`), RSA.publicKey, Buffer.from(fsig, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(fp, 'base64url'));
  assert.equal(claims.iss, 'service@example.test');
  assert.equal(claims.aud, 'https://oauth2.example/token');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
});

test('APNs sends an alert, falls back to the other environment, and prunes only dead tokens', async () => {
  const requests = [];
  const apns = { key: APNS_KEY, keyId: 'K', teamId: 'T', bundleId: 'hb.opengym.app' };
  const cache = {};
  const first = await sendNativeNotifications([{ platform: 'ios', token: IOS_TOKEN }], { title: 'T', body: 'B' }, { apns, fcm: null }, {
    now: NOW,
    cache,
    requestImpl: async req => {
      requests.push(req);
      return requests.length === 1 ? { status: 400, body: '{"reason":"BadDeviceToken"}' } : { status: 200, body: '' };
    },
  });
  assert.equal(first.results[0].ok, true);
  assert.equal(first.results[0].environment, 'sandbox');
  assert.equal(requests[0].host, 'https://api.push.apple.com');
  assert.equal(requests[1].host, 'https://api.sandbox.push.apple.com');
  assert.equal(requests[0].path, `/3/device/${IOS_TOKEN}`);
  assert.equal(requests[0].headers['apns-topic'], 'hb.opengym.app');
  assert.equal(requests[0].body.aps.alert.title, 'T');

  const dead = await sendNativeNotifications([{ platform: 'ios', token: IOS_TOKEN }], { title: 'T', body: 'B' }, { apns, fcm: null }, {
    now: NOW, cache: {}, requestImpl: async () => ({ status: 410, body: '' }),
  });
  assert.equal(dead.results[0].prune, true);
});

test('FCM gets an OAuth token, sends the message, and prunes an unregistered token', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('oauth2')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'oauth-token', expires_in: 3600 }) };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const fcm = { projectId: 'proj', clientEmail: 'service@example.test', privateKey: FCM_KEY, tokenUri: 'https://oauth2.example/token' };
  const result = await sendNativeNotifications([{ platform: 'android', token: ANDROID_TOKEN }], {
    title: 'T', body: 'B', tag: 'friend-start', url: '#/social',
  }, { apns: null, fcm }, { now: NOW, cache: {}, fetchImpl });
  assert.equal(result.results[0].ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://fcm.googleapis.com/v1/projects/proj/messages:send');
  assert.equal(calls[1].opts.headers.authorization, 'Bearer oauth-token');
  const message = JSON.parse(calls[1].opts.body);
  assert.equal(message.message.token, ANDROID_TOKEN);
  assert.equal(message.message.android.notification.channel_id, 'opengym');

  const dead = await sendNativeNotifications([{ platform: 'android', token: ANDROID_TOKEN }], { title: 'T', body: 'B' }, { apns: null, fcm }, {
    now: NOW, cache: {},
    fetchImpl: async (url) => url.includes('oauth2')
      ? { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'oauth-token', expires_in: 3600 }) }
      : { ok: false, status: 404, text: async () => '{"error":{"status":"NOT_FOUND"}}' },
  });
  assert.equal(dead.results[0].prune, true);
});

test('config reads capabilities from the files and leaves a platform off when it is incomplete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-push-'));
  const keyFile = path.join(dir, 'apns.p8');
  const fcmFile = path.join(dir, 'fcm.json');
  fs.writeFileSync(keyFile, '-----BEGIN PRIVATE KEY-----\nnot a real key\n-----END PRIVATE KEY-----\n');
  fs.writeFileSync(fcmFile, JSON.stringify({
    project_id: 'proj', client_email: 'service@example.test', private_key: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
  }));
  const config = readNativePushConfig({
    APNS_KEY_FILE: keyFile, APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_BUNDLE_ID: 'hb.opengym.app',
    FCM_SERVICE_ACCOUNT_FILE: fcmFile,
  });
  assert.deepEqual(nativePushCapabilities(config), { ios: true, android: true });
  assert.equal(config.apns.bundleId, 'hb.opengym.app');
  assert.equal(config.fcm.projectId, 'proj');
  assert.equal(config.fcm.privateKey, '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----');
  fs.rmSync(dir, { recursive: true, force: true });

  assert.deepEqual(nativePushCapabilities(readNativePushConfig({ APNS_KEY_FILE: keyFile })), { ios: false, android: false });
});
