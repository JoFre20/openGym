#!/usr/bin/env node
// Send one APNs test notification with the same code the server uses, without starting the API.
// Useful while checking an Apple key/token before the app's Settings screen has a token.
//
//   APNS_KEY_FILE=/path/AuthKey_ABC123.p8 \
//   APNS_KEY_ID=ABC123DEFG APNS_TEAM_ID=TEAM123456 \
//   APNS_BUNDLE_ID=hb.opengym.app \
//   node api/scripts/send-apns-test.mjs <device-token> [sandbox|production]
//
// The token is the APNs token the app stores in data/db.json under nativeSubs[].token after it
// registers. A debug build uses the sandbox environment; TestFlight and the App Store use
// production. Without the third argument the server-side APNS_ENV is used, or both are tried.
import { nativeTokenProblem, readNativePushConfig, sendNativeNotifications } from '../push-native.js';
import { testPush } from '../push-messages.js';

const token = String(process.argv[2] || '').trim();
const requested = String(process.argv[3] || '').trim();
const environment = ['sandbox', 'production'].includes(requested) ? requested : undefined;
const problem = nativeTokenProblem('ios', token);
if (problem) {
  console.error('usage: node api/scripts/send-apns-test.mjs <device-token> [sandbox|production]');
  process.exit(2);
}
const config = readNativePushConfig();
if (!config.apns) {
  console.error('APNs is not configured: set APNS_KEY_FILE, APNS_KEY_ID, APNS_TEAM_ID and APNS_BUNDLE_ID.');
  process.exit(2);
}
if (environment) config.apns.environment = environment;

const row = { platform: 'ios', token, ...(environment ? { environment } : {}) };
const result = await sendNativeNotifications([row], testPush('en'), config, { cache: {} });
const answer = result.results[0] || {};
if (answer.ok) {
  console.log(`sent via APNs (${answer.environment || config.apns.environment || 'discovered'})`);
  process.exit(0);
}
console.error('APNs refused the notification:', answer.reason || answer.error || answer.status || 'unknown');
if (answer.prune) console.error('The token is no longer valid for this APNs environment.');
process.exit(1);
