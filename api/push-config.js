/* Push credentials the admin can change from the dashboard.
 *
 * Web Push's VAPID keys are generated on first run and kept in ./data/vapid.json, as they always
 * were. The native transports (APNs for iPhone, FCM for Android) used to be environment-only:
 * mounting a .p8 or a Firebase service account and restarting the stack. This module adds a
 * dashboard-owned copy in ./data/push.json so an admin can add, replace or remove those
 * credentials without touching the container.
 *
 * The dashboard wins over the environment for the platform it configures. Removing its entry
 * falls back to the environment, so a deployment that already has a working mount keeps working.
 *
 * Secrets are never returned by the status call and never written in the clear:
 *
 *   key       the APNs .p8 contents, sealed
 *   account   the FCM service-account JSON, sealed
 *   privateKey the VAPID private key, sealed
 *
 * The sealing key is derived from ./data/secret with HKDF-SHA256, domain-separated from the
 * Coach's and the integrations' keys. Losing ./data/secret makes these unreadable; the card says
 * so and the admin enters them again, exactly like the Coach's credential state.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { atomicWrite } from './durable.js';
import { readNativePushConfig, serviceAccount } from './push-native.js';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'push.json');
const VAPID_FILE = path.join(DATA, 'vapid.json');
const SECRET_FILE = path.join(DATA, 'secret');

const MAX_PEM = 16 * 1024;
const MAX_ACCOUNT = 32 * 1024;
const MAX_SUBJECT = 200;
const VAPID_KEY_RE = /^[A-Za-z0-9_-]{20,200}$/;
const APNS_ID_RE = /^[A-Za-z0-9]{10}$/;
const BUNDLE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{1,154}[A-Za-z0-9]$/;
const PROJECT_RE = /^[A-Za-z0-9._-]{1,100}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const at = v => (Number.isFinite(v) ? v : null);

let doc = null;                 // the sanitised dashboard document, lazily read
let envNative = null;           // the environment fallback, read once
let keyCache = null;            // the derived sealing key
let legacyVapid = null;         // the generated ./data/vapid.json pair
let generatedNow = false;       // whether this process made the legacy pair

/* ---------- sealing ---------- */

function key() {
  if (keyCache) return keyCache;
  const secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  keyCache = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('opengym-push'), Buffer.from('credentials v1'), 32));
  return keyCache;
}
const seal = (plainText, aad) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(String(plainText), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
};
const unseal = (sealed, aad) => {
  if (typeof sealed !== 'string') return null;
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(String(aad)));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
};

/* ---------- the stored document ---------- */

function cleanDoc(raw) {
  const out = { v: 1 };
  if (plain(raw?.apns)) {
    const r = raw.apns;
    const key = str(r.key, MAX_PEM * 2);
    const keyId = str(r.keyId, 40);
    const teamId = str(r.teamId, 40);
    const bundleId = str(r.bundleId, 160);
    const environment = r.environment === 'sandbox' || r.environment === 'production' ? r.environment : '';
    if (key && keyId && teamId && bundleId) out.apns = { key, keyId, teamId, bundleId, environment, updatedAt: at(r.updatedAt) };
  }
  if (plain(raw?.fcm)) {
    const r = raw.fcm;
    const account = str(r.account, MAX_ACCOUNT * 2);
    const projectId = str(r.projectId, 100);
    const clientEmail = str(r.clientEmail, 200);
    if (account && projectId && clientEmail) out.fcm = { account, projectId, clientEmail, updatedAt: at(r.updatedAt) };
  }
  if (plain(raw?.vapid)) {
    const r = raw.vapid;
    const publicKey = str(r.publicKey, 200);
    const privateKey = str(r.privateKey, 200);
    const subject = str(r.subject, MAX_SUBJECT);
    if (subject || (publicKey && privateKey)) out.vapid = { publicKey, privateKey, subject, updatedAt: at(r.updatedAt) };
  }
  return out;
}

function loadDoc() {
  if (doc) return doc;
  try { doc = cleanDoc(JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch (e) {
    if (e.code !== 'ENOENT') console.error('push: cannot read push.json:', e.message);
    doc = { v: 1 };
  }
  return doc;
}

function saveDoc(next) {
  doc = cleanDoc(next);
  atomicWrite(FILE, JSON.stringify(doc, null, 2), 0o600);
  return doc;
}

function envConfig() {
  if (envNative) return envNative;
  envNative = readNativePushConfig();
  return envNative;
}

/* ---------- validation ---------- */

export const apnsProblem = input => {
  if (!plain(input)) return 'invalid credentials';
  if (!input.key && !(loadDoc().apns && loadDoc().apns.key)) return 'the APNs .p8 key is required';
  if (input.key) {
    const pem = str(input.key, MAX_PEM);
    if (!pem || !/BEGIN (?:EC )?PRIVATE KEY/.test(pem)) return 'paste the contents of the .p8 file';
    try {
      const parsed = crypto.createPrivateKey({ key: pem, format: 'pem' });
      if (parsed.asymmetricKeyType !== 'ec') return 'the APNs key must be an EC private key';
      const curve = parsed.asymmetricKeyDetails?.namedCurve;
      if (curve && curve !== 'prime256v1' && curve !== 'secp256r1') return 'the APNs key must use the P-256 curve';
    } catch { return 'that is not a usable PEM private key'; }
  }
  if (!APNS_ID_RE.test(str(input.keyId, 40))) return 'the APNs key id is 10 letters or digits';
  if (!APNS_ID_RE.test(str(input.teamId, 40))) return 'the Apple team id is 10 letters or digits';
  if (!BUNDLE_RE.test(str(input.bundleId, 160))) return 'enter the app bundle id, such as com.example.app';
  if (input.environment !== undefined && input.environment !== '' && input.environment !== 'sandbox' && input.environment !== 'production') {
    return 'the environment must be automatic, sandbox or production';
  }
  return null;
};

export const fcmProblem = input => {
  const raw = typeof input === 'string' ? input : input?.serviceAccount ?? input?.account ?? input;
  if (!raw) return 'the Firebase service-account JSON is required';
  if (typeof raw === 'string' && raw.length > MAX_ACCOUNT) return 'that service-account JSON is too large';
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return 'that is not valid JSON'; }
  }
  if (!plain(parsed)) return 'that is not a Firebase service account';
  try { if (JSON.stringify(parsed).length > MAX_ACCOUNT) return 'that service-account JSON is too large'; }
  catch { return 'that is not a Firebase service account'; }
  if (!PROJECT_RE.test(str(parsed.project_id, 100))) return 'the service account has no usable project_id';
  if (!EMAIL_RE.test(str(parsed.client_email, 200))) return 'the service account has no usable client_email';
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key.replace(/\\n/g, '\n') : '';
  if (!privateKey || !/BEGIN (?:RSA )?PRIVATE KEY/.test(privateKey)) return 'the service account has no usable private_key';
  try {
    const key = crypto.createPrivateKey({ key: privateKey, format: 'pem' });
    if (key.asymmetricKeyType !== 'rsa') return 'the service-account private key must be RSA';
  } catch { return 'the service-account private_key is not a usable PEM key'; }
  if (parsed.token_uri !== undefined) {
    const uri = str(parsed.token_uri, 300);
    if (!/^https?:\/\//i.test(uri)) return 'the token_uri must be an http(s) address';
  }
  return null;
};

const subjectProblem = subject => {
  if (!subject) return null;
  if (subject.length > MAX_SUBJECT) return 'the contact address is too long';
  if (!/^(mailto:|https?:\/\/)/i.test(subject)) return 'the contact address must start with mailto: or http(s)://';
  return null;
};

/* ---------- resolution ---------- */

function resolveApns() {
  const stored = loadDoc().apns;
  const env = envConfig().apns;
  if (stored?.key) {
    const pem = unseal(stored.key, 'apns:key');
    if (pem) {
      return {
        value: { key: pem, keyId: stored.keyId, teamId: stored.teamId, bundleId: stored.bundleId, environment: stored.environment || undefined },
        source: 'dashboard', meta: stored,
      };
    }
    return { value: env || null, source: env ? 'environment' : 'unreadable', unreadable: true, meta: stored };
  }
  return env
    ? { value: env, source: 'environment', meta: null }
    : { value: null, source: 'none', meta: null };
}

function resolveFcm() {
  const stored = loadDoc().fcm;
  const env = envConfig().fcm;
  if (stored?.account) {
    const raw = unseal(stored.account, 'fcm:account');
    let parsed = null;
    if (raw) { try { parsed = serviceAccount(JSON.parse(raw)); } catch { parsed = null; } }
    if (parsed) return { value: parsed, source: 'dashboard', meta: stored };
    return { value: env || null, source: env ? 'environment' : 'unreadable', unreadable: true, meta: stored };
  }
  return env
    ? { value: env, source: 'environment', meta: null }
    : { value: null, source: 'none', meta: null };
}

function defaultSubject() {
  return process.env.VAPID_SUBJECT || (/^https:/i.test(process.env.ORIGIN || '') ? process.env.ORIGIN : 'mailto:admin@localhost');
}

function generatedVapid() {
  if (legacyVapid) return legacyVapid;
  try {
    const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
    if (typeof parsed?.publicKey === 'string' && typeof parsed?.privateKey === 'string') {
      legacyVapid = { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
      return legacyVapid;
    }
  } catch { /* generated below */ }
  const pair = webpush.generateVAPIDKeys();
  atomicWrite(VAPID_FILE, JSON.stringify(pair), 0o600);
  generatedNow = true;
  legacyVapid = pair;
  return legacyVapid;
}

export function vapid() {
  const stored = loadDoc().vapid;
  const generated = generatedVapid();
  const subject = stored?.subject ? stored.subject : defaultSubject();
  if (stored?.publicKey && stored?.privateKey) {
    const privateKey = unseal(stored.privateKey, 'vapid:private');
    if (privateKey) {
      return { publicKey: stored.publicKey, privateKey, subject, source: 'dashboard', unreadable: false, updatedAt: stored.updatedAt };
    }
    return { ...generated, subject, source: generatedNow ? 'generated' : 'vapid.json', unreadable: true, updatedAt: stored.updatedAt };
  }
  return { ...generated, subject, source: generatedNow ? 'generated' : 'vapid.json', unreadable: false, updatedAt: stored?.updatedAt || null };
}

/** The live native config the sender should use. Never throws: a broken stored value falls back
 *  to the environment, and the admin card still shows which one is in use. */
export const native = () => ({ apns: resolveApns().value, fcm: resolveFcm().value });

export const capabilities = () => {
  const n = native();
  return { ios: !!n.apns, android: !!n.fcm };
};

/** Sanitised status for the admin card. No secret ever leaves this function. */
export function status() {
  const a = resolveApns();
  const f = resolveFcm();
  const v = vapid();
  return {
    web: {
      configured: !!v.publicKey,
      publicKey: v.publicKey,
      subject: v.subject,
      source: v.source,
      unreadable: !!v.unreadable,
      updatedAt: v.updatedAt || null,
    },
    apns: {
      configured: !!a.value,
      source: a.source,
      unreadable: !!a.unreadable,
      keyId: a.meta?.keyId || a.value?.keyId || null,
      teamId: a.meta?.teamId || a.value?.teamId || null,
      bundleId: a.meta?.bundleId || a.value?.bundleId || null,
      environment: a.meta?.environment || a.value?.environment || null,
      updatedAt: a.meta?.updatedAt || null,
    },
    fcm: {
      configured: !!f.value,
      source: f.source,
      unreadable: !!f.unreadable,
      projectId: f.meta?.projectId || f.value?.projectId || null,
      clientEmail: f.meta?.clientEmail || f.value?.clientEmail || null,
      updatedAt: f.meta?.updatedAt || null,
    },
    native: capabilities(),
  };
}

/** What the server applies at boot and after a VAPID change. */
export function applyVapid(impl = webpush) {
  const v = vapid();
  try {
    impl.setVapidDetails(v.subject, v.publicKey, v.privateKey);
    return v;
  } catch (e) {
    console.error('push: stored VAPID keys are unusable, using generated keys:', e.message);
    const fallback = generatedVapid();
    impl.setVapidDetails(defaultSubject(), fallback.publicKey, fallback.privateKey);
    return { ...fallback, subject: defaultSubject(), source: 'generated', unreadable: true, updatedAt: null };
  }
}

/* ---------- writes ---------- */

export function saveApns(input) {
  const problem = apnsProblem(input);
  if (problem) return { error: problem };
  const current = loadDoc();
  const key = input.key ? str(input.key, MAX_PEM) : unseal(current.apns.key, 'apns:key');
  if (!key) return { error: 'the stored APNs key cannot be read; paste it again' };
  saveDoc({
    ...current,
    apns: {
      key: seal(key, 'apns:key'),
      keyId: str(input.keyId, 40).toUpperCase(),
      teamId: str(input.teamId, 40).toUpperCase(),
      bundleId: str(input.bundleId, 160),
      environment: input.environment === 'sandbox' || input.environment === 'production' ? input.environment : '',
      updatedAt: Date.now(),
    },
  });
  return { ok: true };
}

export function saveFcm(input) {
  const problem = fcmProblem(input);
  if (problem) return { error: problem };
  const raw = typeof input === 'string' ? input : input?.serviceAccount ?? input?.account ?? input;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const account = serviceAccount(parsed);
  if (!account) return { error: 'that is not a usable Firebase service account' };
  const current = loadDoc();
  saveDoc({
    ...current,
    fcm: {
      account: seal(JSON.stringify({ ...parsed, private_key: account.privateKey }), 'fcm:account'),
      projectId: account.projectId,
      clientEmail: account.clientEmail,
      updatedAt: Date.now(),
    },
  });
  return { ok: true };
}

export function saveVapid(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const current = loadDoc();
  const before = vapid();
  let publicKey = typeof input.publicKey === 'string' ? input.publicKey.trim() : '';
  let privateKey = typeof input.privateKey === 'string' ? input.privateKey.trim() : '';
  if (input.rotate) {
    const pair = webpush.generateVAPIDKeys();
    publicKey = pair.publicKey;
    privateKey = pair.privateKey;
  } else if (!publicKey && !privateKey) {
    publicKey = before.publicKey;
    privateKey = before.privateKey;
  } else if (!publicKey || !privateKey) {
    return { error: 'both the public and private VAPID keys are required' };
  }
  if (!VAPID_KEY_RE.test(publicKey) || !VAPID_KEY_RE.test(privateKey)) return { error: 'that is not a usable VAPID key pair' };
  const subject = str(input.subject ?? current.vapid?.subject ?? before.subject, MAX_SUBJECT);
  const problem = subjectProblem(subject);
  if (problem) return { error: problem };
  // Validate through web-push before writing. If it refuses, put the old details back so a bad
  // attempt never leaves the running server signing with a half-applied key.
  try {
    webpush.setVapidDetails(subject || defaultSubject(), publicKey, privateKey);
  } catch {
    try { webpush.setVapidDetails(before.subject, before.publicKey, before.privateKey); } catch { /* old pair was already unusable */ }
    return { error: 'that VAPID key pair was refused by web-push' };
  }
  saveDoc({
    ...current,
    vapid: {
      ...(publicKey !== before.publicKey || privateKey !== before.privateKey || current.vapid?.publicKey
        ? { publicKey, privateKey: seal(privateKey, 'vapid:private') }
        : {}),
      subject,
      updatedAt: Date.now(),
    },
  });
  return { ok: true, publicKey };
}

export function remove(kind) {
  const current = loadDoc();
  if (kind !== 'apns' && kind !== 'fcm' && kind !== 'vapid') return { error: 'unknown credential' };
  if (kind === 'vapid') {
    // The generated pair stays as the fallback; only the dashboard's override and subject go.
    const next = { ...current };
    delete next.vapid;
    saveDoc(next);
    applyVapid();
    return { ok: true };
  }
  const next = { ...current };
  delete next[kind];
  saveDoc(next);
  return { ok: true };
}

/** Test seam: forget every cached value so a test can point DATA_DIR at a new directory. */
export function resetForTest() {
  doc = null;
  envNative = null;
  keyCache = null;
  legacyVapid = null;
  generatedNow = false;
}
