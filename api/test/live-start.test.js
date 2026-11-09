import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySocial, ensureProfile } from '../social.js';
import {
  friendStartRecipients, liveStartKey, startNotifyDue,
  START_NOTIFY_COOLDOWN_MS, START_NOTIFY_FRESH_MS, START_NOTIFY_SAME_MS,
} from '../live-start.js';

const profile = (patch = {}) => ({ shareLive: true, notifyFriends: true, startTone: 'motivational', ...patch });
const T0 = 1_800_000_000_000;

test('a start is announced only for a fresh workout the sender shares and allows', () => {
  const key = liveStartKey('w1', T0);
  assert.equal(startNotifyDue(profile(), { key, startedAt: T0, now: T0 + 1000 }), true);
  assert.equal(startNotifyDue(profile({ shareLive: false }), { key, startedAt: T0, now: T0 + 1000 }), false);
  assert.equal(startNotifyDue(profile({ notifyFriends: false }), { key, startedAt: T0, now: T0 + 1000 }), false);
  assert.equal(startNotifyDue(profile(), { key, startedAt: T0, now: T0 + START_NOTIFY_FRESH_MS + 1 }), false);
  assert.equal(startNotifyDue(profile(), { key, startedAt: T0 + 5000, now: T0 }), false);
});

test('the same workout never rings twice, and a new start waits out the cooldown', () => {
  const first = liveStartKey('w1', T0);
  const p = profile({ lastStartNotify: { id: first, at: T0 } });
  assert.equal(startNotifyDue(p, { key: first, startedAt: T0, now: T0 + 1000 }), false);
  assert.ok(START_NOTIFY_SAME_MS > START_NOTIFY_COOLDOWN_MS);
  const other = liveStartKey('w2', T0 + START_NOTIFY_COOLDOWN_MS - 1);
  assert.equal(startNotifyDue(p, { key: other, startedAt: T0 + START_NOTIFY_COOLDOWN_MS - 1, now: T0 + START_NOTIFY_COOLDOWN_MS - 1 }), false);
  const later = T0 + START_NOTIFY_COOLDOWN_MS;
  assert.equal(startNotifyDue(p, { key: other, startedAt: later, now: later }), true);
});

test('the key falls back to the start time when the workout has no id', () => {
  assert.equal(liveStartKey(null, T0), `start-${T0}`);
  assert.equal(liveStartKey('', 0), 'start-0');
});

test('recipients are accepted friends who opted in and can still receive a push', () => {
  const social = emptySocial();
  ensureProfile(social, 'me');
  ensureProfile(social, 'a');
  ensureProfile(social, 'b');
  ensureProfile(social, 'c');
  social.profiles.a.friendStartAlerts = true;
  social.profiles.b.friendStartAlerts = false;
  social.profiles.c.friendStartAlerts = true;
  social.profiles.me.closeFriends = ['a'];
  social.friendships.push(
    { id: 'f1', from: 'me', to: 'a', status: 'accepted' },
    { id: 'f2', from: 'b', to: 'me', status: 'accepted' },
    { id: 'f3', from: 'me', to: 'c', status: 'pending' },
    { id: 'f4', from: 'me', to: 'd', status: 'accepted' },
  );
  const withPush = new Set(['a', 'b', 'c', 'd']);
  assert.deepEqual(friendStartRecipients(social, 'me', id => withPush.has(id)), ['a']);
  // b is accepted and opted in, but not close: live stays visible, its details and push do not.
  social.profiles.b.friendStartAlerts = true;
  assert.deepEqual(friendStartRecipients(social, 'me', id => withPush.has(id)), ['a']);
  social.profiles.me.closeFriends = ['a', 'b'];
  assert.deepEqual(friendStartRecipients(social, 'me', id => withPush.has(id)), ['a', 'b']);
  assert.deepEqual(friendStartRecipients(social, 'me', () => false), []);
});
