// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const listeners = {}
  return {
    api: vi.fn(async () => ({})),
    listeners,
    plugin: {
      checkPermissions: vi.fn(async () => ({ receive: 'granted' })),
      requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
      createChannel: vi.fn(async () => {}),
      register: vi.fn(async () => {}),
      unregister: vi.fn(async () => {}),
      addListener: vi.fn(async (event, fn) => {
        listeners[event] = fn
        return { remove: vi.fn() }
      }),
    },
  }
})

vi.mock('./api.js', () => ({ api: mocks.api }))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: mocks.plugin }))

let native
const CONFIG = { native_push: { ios: true, android: true } }

beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('VITE_MOBILE', '1')
  localStorage.clear()
  for (const key of Object.keys(mocks.listeners)) delete mocks.listeners[key]
  for (const fn of Object.values(mocks.plugin)) if (fn?.mockReset) fn.mockReset()
  mocks.plugin.checkPermissions.mockResolvedValue({ receive: 'granted' })
  mocks.plugin.requestPermissions.mockResolvedValue({ receive: 'granted' })
  mocks.plugin.addListener.mockImplementation(async (event, fn) => {
    mocks.listeners[event] = fn
    return { remove: vi.fn() }
  })
  mocks.api.mockReset().mockResolvedValue({})
  globalThis.Capacitor = {
    getPlatform: () => 'ios',
    isPluginAvailable: () => true,
  }
  localStorage.setItem('gym_device', 'device-12345678')
  native = await import('./native-push.js')
})

afterEach(() => {
  vi.unstubAllEnvs()
  delete globalThis.Capacitor
})

describe('native push', () => {
  it('offers the switch only when the phone, plugin and server all support it', () => {
    expect(native.nativePushEnabled()).toBe(false)
    expect(native.nativePushSupported(CONFIG)).toBe(true)
    expect(native.nativePushSupported({})).toBe(false)
    globalThis.Capacitor.isPluginAvailable = () => false
    expect(native.nativePushSupported(CONFIG)).toBe(false)
  })

  it('syncs a stored token, asks for permission and registers', async () => {
    native.setNativePushEnabled(true)
    localStorage.setItem('og_native_push_token', JSON.stringify({ platform: 'ios', token: 'stored-token' }))
    expect(await native.syncNativePushSubscription({ config: CONFIG })).toBe(true)
    expect(mocks.plugin.checkPermissions).toHaveBeenCalledTimes(1)
    expect(mocks.plugin.register).toHaveBeenCalledTimes(1)
    expect(mocks.api).toHaveBeenCalledWith('/api/push/native', {
      method: 'POST',
      body: JSON.stringify({ platform: 'ios', token: 'stored-token', deviceId: 'device-12345678' }),
    })

    // A token refresh arrives later: the listener files it under the current account too.
    await mocks.listeners.registration({ value: 'fresh-token' })
    await Promise.resolve()
    expect(mocks.api).toHaveBeenLastCalledWith('/api/push/native', {
      method: 'POST',
      body: JSON.stringify({ platform: 'ios', token: 'fresh-token', deviceId: 'device-12345678' }),
    })
    expect(JSON.parse(localStorage.getItem('og_native_push_token'))).toEqual({ platform: 'ios', token: 'fresh-token' })
  })

  it('creates the Android channel before registering', async () => {
    globalThis.Capacitor.getPlatform = () => 'android'
    native.setNativePushEnabled(true)
    expect(await native.syncNativePushSubscription({ config: CONFIG })).toBe(true)
    expect(mocks.plugin.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'opengym', importance: 4 }))
  })

  it('does not remember a switch the phone refused permission for', async () => {
    mocks.plugin.checkPermissions.mockResolvedValue({ receive: 'denied' })
    mocks.plugin.requestPermissions.mockResolvedValue({ receive: 'denied' })
    expect(await native.enableNativePush(CONFIG)).toBe(false)
    expect(native.nativePushEnabled()).toBe(false)
    expect(mocks.plugin.register).not.toHaveBeenCalled()
  })

  it('turns the switch off by removing the token and unregistering', async () => {
    native.setNativePushEnabled(true)
    localStorage.setItem('og_native_push_token', JSON.stringify({ platform: 'ios', token: 'stored-token' }))
    await native.disableNativePush()
    expect(native.nativePushEnabled()).toBe(false)
    expect(mocks.api).toHaveBeenCalledWith('/api/push/native/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ token: 'stored-token' }),
    })
    expect(mocks.plugin.unregister).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('og_native_push_token')).toBeNull()
  })

  it('routes a notification tap, including one that launched the app', async () => {
    const opens = []
    await native.bindNativePushEvents(path => opens.push(path))
    mocks.listeners.pushNotificationActionPerformed({ notification: { data: { url: '#/social' } } })
    expect(opens).toEqual(['/social'])

    // A tap that arrives before App has bound its handler waits for it.
    vi.resetModules()
    native = await import('./native-push.js')
    await native.bindNativePushEvents(null)
    mocks.listeners.pushNotificationActionPerformed({ notification: { data: { url: '#/coach' } } })
    await native.bindNativePushEvents(path => opens.push(path))
    expect(opens.at(-1)).toBe('/coach')
  })
})
