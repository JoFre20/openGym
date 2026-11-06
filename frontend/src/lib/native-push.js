// Native server push for the paired Capacitor app (APNs on iOS, FCM on Android). The local
// notifications in mobile.js stay the reminder/nudge/rest transport; this module is only for the
// server's social and Coach events. Everything is dynamically imported behind MOBILE, so the web
// bundle never carries the plugin.
import { api } from './api.js'
import { MOBILE } from './mobile.js'
import { platformNow } from './platform-now.js'
import { deviceId } from './push.js'

const ENABLED_KEY = 'og_native_push'
const TOKEN_KEY = 'og_native_push_token'
const CHANNEL_ID = 'opengym'

let listeners = null
let openHandler = null
let currentPlatform = null
let pendingRoute = null

const readStored = key => {
  try { return localStorage.getItem(key) } catch { return null }
}
const writeStored = (key, value) => {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key) } catch { /* storage unavailable */ }
}

export function nativePushEnabled() {
  return MOBILE && readStored(ENABLED_KEY) === '1'
}

export function setNativePushEnabled(on) {
  if (!MOBILE) return
  writeStored(ENABLED_KEY, on ? '1' : '')
}

function storedToken() {
  try {
    const value = JSON.parse(readStored(TOKEN_KEY) || 'null')
    return value && typeof value.token === 'string' && (value.platform === 'ios' || value.platform === 'android')
      ? value
      : null
  } catch { return null }
}

function rememberToken(platform, token) {
  if (platform && token) writeStored(TOKEN_KEY, JSON.stringify({ platform, token }))
}

function forgetToken() {
  writeStored(TOKEN_KEY, '')
}

/** The server's `/api/config` says whether this instance can send to this phone's OS. */
export function nativePushSupported(config) {
  if (!MOBILE) return false
  const platform = platformNow()
  // The F-Droid build leaves the push plugin out entirely, so the server being configured is
  // not enough: the native bridge has to have the plugin too.
  return !!platform && pluginInstalled() && config?.native_push?.[platform] === true
}

/** `#/social` from a notification payload, or null when it is not an in-app route. */
export function nativeRoutePath(value) {
  if (typeof value !== 'string') return null
  const path = value.startsWith('#') ? value.slice(1) : value
  return path.startsWith('/') ? path : null
}

async function plugin() {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  return PushNotifications
}

const pluginInstalled = () => {
  const bridge = globalThis.Capacitor
  if (!bridge) return false
  if (typeof bridge.isPluginAvailable === 'function') return bridge.isPluginAvailable('PushNotifications') === true
  // Older bridges expose the registered plugins on the bridge instead.
  return !!bridge.Plugins?.PushNotifications
}

async function ensureListeners() {
  if (!MOBILE || listeners) return listeners
  // F-Droid leaves the native plugin out, and the browser (and the tests) have no bridge plugin
  // at all. Asking is cheaper than a failed dynamic import on every boot.
  if (!pluginInstalled()) return null
  listeners = (async () => {
    try {
      const PushNotifications = await plugin()
      await PushNotifications.addListener('registration', token => {
        if (!currentPlatform || !token?.value || !nativePushEnabled()) return
        rememberToken(currentPlatform, token.value)
        api('/api/push/native', {
          method: 'POST',
          body: JSON.stringify({ platform: currentPlatform, token: token.value, deviceId: deviceId() }),
        }).catch(() => {})
      })
      await PushNotifications.addListener('registrationError', error => {
        // The Settings screen surfaces a failed enable; this is for the log only.
        console.error('native push registration failed', error?.error || error)
      })
      await PushNotifications.addListener('pushNotificationActionPerformed', event => {
        const url = nativeRoutePath(event?.notification?.data?.url)
        if (!url) return
        if (openHandler) openHandler(url)
        else pendingRoute = url
      })
    } catch (e) {
      listeners = null
      throw e
    }
    return true
  })()
  return listeners
}

/** Bind the tap route once, early enough to catch a notification that launched the app. */
export function bindNativePushEvents(onOpen) {
  if (!MOBILE) return Promise.resolve()
  openHandler = typeof onOpen === 'function' ? onOpen : null
  return ensureListeners().then(() => {
    if (pendingRoute && openHandler) {
      const route = pendingRoute
      pendingRoute = null
      openHandler(route)
    }
  }).catch(() => {})
}

/**
 * Make sure this phone is registered for server events, if the user enabled it and the server
 * supports its platform. Called on boot, when pairing completes and when Settings opens. The
 * stored token is re-sent first, which heals a row the server lost without a new APNs/FCM prompt.
 */
export async function syncNativePushSubscription({ config, interactive = false } = {}) {
  if (!MOBILE || !nativePushEnabled()) return false
  const platform = platformNow()
  if (!platform || !nativePushSupported(config)) return false
  currentPlatform = platform
  await ensureListeners()
  const PushNotifications = await plugin()

  let permission = await PushNotifications.checkPermissions()
  if (permission.receive !== 'granted' && interactive) {
    permission = await PushNotifications.requestPermissions()
  }
  if (permission.receive !== 'granted') return false

  if (platform === 'android') {
    await PushNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'openGym',
      description: 'Friend requests, reactions, shared plans and Coach suggestions',
      importance: 4,
      visibility: 1,
      vibration: true,
    }).catch(() => {})
  }

  const stored = storedToken()
  if (stored?.platform === platform) {
    try {
      await api('/api/push/native', {
        method: 'POST',
        body: JSON.stringify({ platform, token: stored.token, deviceId: deviceId() }),
      })
    } catch { /* register() below gets a fresh token and tries again */ }
  }
  await PushNotifications.register()
  return true
}

/** Stop server notifications on this phone and remove the row. The enabled choice is kept. */
export async function unregisterNativePush() {
  if (!MOBILE) return
  const stored = storedToken()
  if (stored?.token) {
    await api('/api/push/native/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ token: stored.token }),
    }).catch(() => {})
  }
  if (pluginInstalled()) {
    try {
      const PushNotifications = await plugin()
      await PushNotifications.unregister()
    } catch { /* no plugin, already gone, or an old native shell */ }
  }
  forgetToken()
}

/** Settings switch off: do not register again on the next boot either. */
export async function disableNativePush() {
  setNativePushEnabled(false)
  await unregisterNativePush()
}

/** Settings switch on: keep the choice and register now. A refusal is not remembered. */
export async function enableNativePush(config) {
  setNativePushEnabled(true)
  try {
    const ok = await syncNativePushSubscription({ config, interactive: true })
    if (!ok) setNativePushEnabled(false)
    return ok
  } catch (e) {
    setNativePushEnabled(false)
    throw e
  }
}

export function sendNativeTestPush() {
  return api('/api/push/test', { method: 'POST', body: '{}' })
}
