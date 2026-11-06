// Native push transport for the paired phone app: APNs on iOS, FCM on Android. The web app
// keeps web-push in server.js; this module is deliberately only about an APNs/FCM token.
//
// No new dependency is used for either service: APNs is HTTP/2 over node:http2 with an ES256
// provider token, and FCM HTTP v1 is a service-account JWT traded for an OAuth token with fetch.
// Credentials are read from files outside DATA_DIR and never written into db.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';

export const NATIVE_PUSH_PLATFORMS = ['ios', 'android'];
export const APNS_TOKEN_RE = /^[0-9a-fA-F]{32,200}$/;
export const FCM_TOKEN_RE = /^[A-Za-z0-9_\-:.]+$/;
export const APNS_MAX_TOKEN = 200;
export const FCM_MAX_TOKEN = 512;
const APNS_TOKEN_TTL_MS = 50 * 60 * 1000;
const FCM_TOKEN_SKEW_MS = 60 * 1000;
const PUSH_TIMEOUT_MS = 10000;
const MAX_NATIVE_CONCURRENCY = 6;
// APNs provider tokens last about an hour and FCM OAuth tokens likewise; one small cache per
// process keeps a busy instance from asking the token endpoints for every notification.
const defaultCache = {};

const readText = file => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};

export const nativeEnvironment = value => {
  const v = String(value || '').toLowerCase();
  return v === 'sandbox' || v === 'production' ? v : undefined;
};

const serviceAccount = raw => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const projectId = typeof raw.project_id === 'string' ? raw.project_id.trim() : '';
  const clientEmail = typeof raw.client_email === 'string' ? raw.client_email.trim() : '';
  const privateKey = typeof raw.private_key === 'string' ? raw.private_key : '';
  if (!projectId || !clientEmail || !privateKey) return null;
  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    tokenUri: typeof raw.token_uri === 'string' && raw.token_uri ? raw.token_uri : 'https://oauth2.googleapis.com/token',
  };
};

/**
 * Reads the APNs and FCM credential material once, at boot. Missing or incomplete credentials
 * disable that platform instead of failing the server: a self-hoster may use only one phone OS.
 */
export function readNativePushConfig(env = process.env) {
  const apnsKey = env.APNS_KEY_FILE ? readText(env.APNS_KEY_FILE) : null;
  const apns = apnsKey && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_BUNDLE_ID
    ? {
      key: apnsKey,
      keyId: String(env.APNS_KEY_ID),
      teamId: String(env.APNS_TEAM_ID),
      bundleId: String(env.APNS_BUNDLE_ID),
      environment: nativeEnvironment(env.APNS_ENV),
    }
    : null;

  let account = null;
  if (env.FCM_SERVICE_ACCOUNT_FILE) {
    const raw = readText(env.FCM_SERVICE_ACCOUNT_FILE);
    if (raw) {
      try { account = serviceAccount(JSON.parse(raw)); } catch { account = null; }
    }
  } else if (env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) {
    account = serviceAccount({
      project_id: env.FCM_PROJECT_ID,
      client_email: env.FCM_CLIENT_EMAIL,
      private_key: env.FCM_PRIVATE_KEY,
      token_uri: env.FCM_TOKEN_URI,
    });
  }
  const fcm = account ? { ...account, projectId: String(env.FCM_PROJECT_ID || account.projectId) } : null;
  return { apns, fcm };
}

export function nativePushCapabilities(config) {
  return { ios: !!config?.apns, android: !!config?.fcm };
}

/** What is wrong with a native device token, or null when it can be stored. */
export function nativeTokenProblem(platform, token) {
  if (!NATIVE_PUSH_PLATFORMS.includes(platform)) return 'platform';
  if (typeof token !== 'string') return 'token';
  const value = token.trim();
  if (!value) return 'token';
  if (platform === 'ios') {
    if (value.length > APNS_MAX_TOKEN || !APNS_TOKEN_RE.test(value)) return 'token';
  } else if (value.length < 20 || value.length > FCM_MAX_TOKEN || !FCM_TOKEN_RE.test(value)) {
    return 'token';
  }
  return null;
}

const clip = (value, max) => String(value == null ? '' : value).slice(0, max);
const titleOf = payload => clip(payload?.title || 'openGym', 160);
const bodyOf = payload => clip(payload?.body || '', 500);
const tagOf = payload => clip(payload?.tag || '', 64);
const urlOf = payload => (typeof payload?.url === 'string' ? clip(payload.url, 512) : '');

/** The APNs JSON body: alert text, a group tag, and the app-specific route for a tap. */
export function apnsPayload(payload) {
  const tag = tagOf(payload);
  return {
    aps: {
      alert: { title: titleOf(payload), body: bodyOf(payload) },
      sound: 'default',
      ...(tag ? { 'thread-id': tag } : {}),
    },
    ...(urlOf(payload) ? { url: urlOf(payload) } : {}),
  };
}

/** One FCM HTTP v1 message, including the Android channel and tap route. */
export function fcmMessage(token, payload) {
  const tag = tagOf(payload);
  const url = urlOf(payload);
  return {
    message: {
      token,
      notification: { title: titleOf(payload), body: bodyOf(payload) },
      data: {
        ...(url ? { url } : {}),
        ...(tag ? { tag } : {}),
      },
      android: {
        priority: 'high',
        notification: {
          channel_id: 'opengym',
          icon: 'ic_stat_opengym',
          ...(tag ? { tag } : {}),
        },
      },
    },
  };
}

const b64u = value => Buffer.from(value).toString('base64url');
const jsonB64u = value => b64u(JSON.stringify(value));

/** The APNs provider token (ES256, P-1363 signature). */
export function signApnsJwt(apns, now = Date.now()) {
  const header = jsonB64u({ alg: 'ES256', kid: apns.keyId });
  const claims = jsonB64u({ iss: apns.teamId, iat: Math.floor(now / 1000) });
  const input = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(input), {
    key: apns.key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${signature.toString('base64url')}`;
}

/** The FCM service-account assertion (RS256) traded for an OAuth access token. */
export function signFcmJwt(fcm, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = jsonB64u({ alg: 'RS256', typ: 'JWT' });
  const claims = jsonB64u({
    iss: fcm.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: fcm.tokenUri || 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  });
  const input = `${header}.${claims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), fcm.privateKey);
  return `${input}.${signature.toString('base64url')}`;
}

const jsonBody = text => {
  try { return JSON.parse(text); } catch { return null; }
};

/** APNs's reason string, from its JSON error body. */
export const apnsReason = body => {
  const parsed = jsonBody(body);
  return typeof parsed?.reason === 'string' ? parsed.reason : '';
};

/** FCM's machine-readable error code, from its JSON error body. */
export function fcmErrorCode(status, body) {
  const parsed = jsonBody(body);
  if (!parsed || typeof parsed !== 'object') return '';
  const direct = parsed.error?.details?.find?.(d => typeof d?.errorCode === 'string')?.errorCode;
  if (direct) return direct;
  if (typeof parsed.error?.status === 'string') return parsed.error.status;
  return status === 404 ? 'NOT_FOUND' : '';
}

export const apnsPrunable = reason =>
  reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic' || reason === 'Unregistered';

export const fcmPrunable = code =>
  code === 'UNREGISTERED' || code === 'NOT_FOUND' || code === 'registration-token-not-registered';

/** Whether an APNs failure means the token belongs to the other APNs environment. */
const apnsOtherEnvironment = reason =>
  reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic';

/**
 * One APNs HTTP/2 request. Kept as its own function so tests can replace it; the real caller
 * opens and closes a session per notification, which is fine at the volume of a personal server.
 */
export function apnsRequest({ host, path, headers, body, timeoutMs = PUSH_TIMEOUT_MS, connect = http2.connect }) {
  return new Promise(resolve => {
    let settled = false;
    let status = 0;
    let text = '';
    const done = value => { if (settled) return; settled = true; resolve(value); };
    let session;
    try {
      session = connect(host);
    } catch (e) {
      done({ status: 0, body: '', error: e.message });
      return;
    }
    const finish = value => {
      try { session.close(); } catch { /* already gone */ }
      done(value);
    };
    session.on('error', e => finish({ status: 0, body: '', error: e.message }));
    let req;
    try {
      req = session.request({
        ':method': 'POST',
        ':path': path,
        'content-type': 'application/json',
        ...headers,
      });
    } catch (e) {
      finish({ status: 0, body: '', error: e.message });
      return;
    }
    req.setEncoding('utf8');
    req.setTimeout(timeoutMs, () => {
      try { req.close(http2.constants.NGHTTP2_CANCEL); } catch { /* gone */ }
      finish({ status: 0, body: text, error: 'timeout' });
    });
    req.on('response', responseHeaders => { status = Number(responseHeaders[':status']) || 0; });
    req.on('data', chunk => { if (text.length < 4096) text += chunk; });
    req.on('end', () => finish({ status, body: text }));
    req.on('error', e => finish({ status, body: text, error: e.message }));
    req.end(JSON.stringify(body));
  });
}

const apnsHost = environment => environment === 'sandbox'
  ? 'https://api.sandbox.push.apple.com'
  : 'https://api.push.apple.com';

const apnsHeaders = (apns, token, jwt, tag, now) => ({
  authorization: `bearer ${jwt}`,
  'apns-topic': apns.bundleId,
  'apns-push-type': 'alert',
  'apns-priority': '10',
  'apns-expiration': String(Math.floor(now / 1000) + 24 * 60 * 60),
  ...(tag ? { 'apns-collapse-id': tag } : {}),
});

const cachedApnsJwt = (apns, cache, now) => {
  if (cache.apns && cache.apns.keyId === apns.keyId && cache.apns.at + APNS_TOKEN_TTL_MS > now) {
    return cache.apns.value;
  }
  const value = signApnsJwt(apns, now);
  cache.apns = { keyId: apns.keyId, at: now, value };
  return value;
};

const fcmAccessToken = async (fcm, { fetchImpl, now, cache }) => {
  if (cache.fcm && cache.fcm.account === fcm.clientEmail && cache.fcm.exp > now + FCM_TOKEN_SKEW_MS) {
    return cache.fcm.value;
  }
  const assertion = signFcmJwt(fcm, now);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const response = await fetchImpl(fcm.tokenUri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  const parsed = jsonBody(text);
  if (!response.ok || !parsed?.access_token) {
    throw new Error(`FCM OAuth ${response.status}: ${text.slice(0, 300)}`);
  }
  const expires = Number(parsed.expires_in) || 3600;
  cache.fcm = { account: fcm.clientEmail, value: parsed.access_token, exp: now + expires * 1000 };
  return parsed.access_token;
};

const sendApnsRow = async (row, payload, apns, { requestImpl, cache, now }) => {
  const environments = apns.environment
    ? [apns.environment]
    : row.environment
      ? [row.environment]
      : ['production', 'sandbox'];
  let last = { status: 0, reason: '', error: '' };
  for (let i = 0; i < environments.length; i++) {
    const environment = environments[i];
    let jwt = cachedApnsJwt(apns, cache, now);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await requestImpl({
        host: apnsHost(environment),
        path: `/3/device/${row.token}`,
        headers: apnsHeaders(apns, row.token, jwt, tagOf(payload), now),
        body: apnsPayload(payload),
      });
      const reason = apnsReason(result.body);
      last = { ...result, reason, environment };
      if (result.status === 200) return { ok: true, environment, status: 200 };
      // A provider token that just expired is worth one fresh-token retry.
      if (result.status === 403 && (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken') && attempt === 0) {
        cache.apns = null;
        jwt = cachedApnsJwt(apns, cache, now);
        continue;
      }
      // An environment mismatch is the one reason to try the other APNs host.
      if (i + 1 < environments.length && apnsOtherEnvironment(reason)) break;
      // 410 Gone is APNs saying the token is no longer registered, even if the body is empty.
      return {
        ok: false,
        prune: result.status === 410 || apnsPrunable(reason),
        reason, status: result.status, environment, error: result.error,
      };
    }
  }
  return {
    ok: false,
    prune: apnsPrunable(last.reason),
    reason: last.reason,
    status: last.status,
    environment: last.environment,
    error: last.error,
  };
};

const sendFcmRow = async (row, payload, fcm, { fetchImpl, cache, now }) => {
  let token = await fcmAccessToken(fcm, { fetchImpl, now, cache });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(fcm.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(fcmMessage(row.token, payload)),
      },
    );
    const text = await response.text();
    if (response.ok) return { ok: true, status: response.status };
    const code = fcmErrorCode(response.status, text);
    // An access token past its hour was cheap to refresh; an invalid argument was not.
    if (response.status === 401 && attempt === 0) {
      cache.fcm = null;
      token = await fcmAccessToken(fcm, { fetchImpl, now, cache });
      continue;
    }
    return { ok: false, prune: fcmPrunable(code), reason: code, status: response.status, body: text.slice(0, 300) };
  }
  return { ok: false, prune: false, reason: '', status: 0 };
};

/**
 * Sends one payload to a list of native rows. Returns one result per row:
 * { token, platform, ok, prune, environment?, reason?, status? }
 */
export async function sendNativeNotifications(rows, payload, config, {
  fetchImpl = globalThis.fetch,
  requestImpl = apnsRequest,
  now = Date.now(),
  cache = defaultCache,
  concurrency = MAX_NATIVE_CONCURRENCY,
} = {}) {
  const list = Array.isArray(rows) ? rows.filter(row => row && row.token) : [];
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const row = list[next++];
      try {
        const result = row.platform === 'ios'
          ? config?.apns
            ? await sendApnsRow(row, payload, config.apns, { requestImpl, cache, now })
            : { ok: false, prune: false, reason: 'apns-not-configured', status: 0 }
          : config?.fcm
            ? await sendFcmRow(row, payload, config.fcm, { fetchImpl, cache, now })
            : { ok: false, prune: false, reason: 'fcm-not-configured', status: 0 };
        results.push({ token: row.token, platform: row.platform, ...result });
      } catch (e) {
        results.push({ token: row.token, platform: row.platform, ok: false, prune: false, reason: 'send-error', error: e.message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return { results };
}
