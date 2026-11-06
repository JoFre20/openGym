// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminPush from './AdminPush.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The push-credentials card: APNs/FCM secrets go in and never come back, Web Push can be
   re-pointed and rotated, and every write goes through the admin routes. */
const mocks = vi.hoisted(() => ({
  status: null,
  sheets: [],
  posts: [],
  confirm: vi.fn(),
  refreshConfig: vi.fn(),
  test: vi.fn(async () => {}),
}))
vi.mock('../lib/api.js', () => ({
  api: (path, init) => {
    if (init?.method === 'POST') {
      mocks.posts.push({ path, body: JSON.parse(init.body) })
      return Promise.resolve({ ok: true })
    }
    return Promise.resolve(structuredClone(mocks.status))
  },
}))
vi.mock('../lib/push.js', () => ({ sendTestPush: (...a) => mocks.test(...a) }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ refreshConfig: mocks.refreshConfig })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: () => {}, openSheet: render => mocks.sheets.push(render) })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../sheets.jsx', () => ({ confirmSheet: (...a) => mocks.confirm(...a) }))

const mounted = []
function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const set = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set
  act(() => {
    if (setter) setter.call(el, value); else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const base = () => ({
  web: {
    configured: true,
    publicKey: 'BPUBLIC_KEY_1234567890',
    subject: 'mailto:owner@example.com',
    source: 'generated',
    unreadable: false,
    updatedAt: null,
  },
  apns: { configured: false, source: 'none', unreadable: false, keyId: null, teamId: null, bundleId: null, environment: null, updatedAt: null },
  fcm: { configured: false, source: 'none', unreadable: false, projectId: null, clientEmail: null, updatedAt: null },
  native: { ios: false, android: false },
  devices: { web: 2, ios: 0, android: 0 },
})

beforeEach(() => {
  document.body.innerHTML = ''
  mocks.status = base()
  mocks.sheets.length = 0
  mocks.posts.length = 0
  mocks.confirm.mockClear()
  mocks.refreshConfig.mockClear()
  mocks.test.mockClear()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('AdminPush', () => {
  it('shows Web Push, both native transports and the device counts', async () => {
    const page = render(<AdminPush />)
    await settle()
    expect(page.textContent).toContain('Push notifications')
    expect(page.textContent).toContain('Web Push ready')
    expect(page.textContent).toContain('iPhone off')
    expect(page.textContent).toContain('Android off')
    expect(page.textContent).toContain('BPUBLIC_KEY_1234567890')
    expect(page.textContent).toContain('2')
    expect(mocks.refreshConfig).toHaveBeenCalled()
  })

  it('adds APNs credentials through the admin route', async () => {
    const page = render(<AdminPush />)
    await settle()
    act(() => button(page, 'Add credentials').click())
    expect(mocks.sheets.length).toBe(1)
    const sheet = render(mocks.sheets[0](() => {}))
    const areas = [...sheet.querySelectorAll('textarea')]
    const inputs = [...sheet.querySelectorAll('input')]
    set(areas[0], '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----')
    set(inputs.find(i => i.placeholder === 'ABC123DEFG'), 'ABC123DEFG')
    set(inputs.find(i => i.placeholder === 'TEAM123456'), 'TEAM123456')
    set(inputs.find(i => i.placeholder === 'com.example.app'), 'com.example.app')
    await act(async () => { button(sheet, 'Save credentials').click() })
    await settle()
    expect(mocks.posts).toEqual([{
      path: '/api/admin/push/apns',
      body: {
        key: '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----',
        keyId: 'ABC123DEFG', teamId: 'TEAM123456', bundleId: 'com.example.app', environment: '',
      },
    }])
  })

  it('removes dashboard APNs credentials after asking, but not environment ones', async () => {
    mocks.status.apns = { ...base().apns, configured: true, source: 'environment', keyId: 'ENV1234567' }
    let page = render(<AdminPush />)
    await settle()
    expect(button(page, 'Remove')).toBeUndefined()
    act(() => mounted[0].unmount())
    mounted.length = 0
    document.body.innerHTML = ''

    mocks.status.apns = { ...base().apns, configured: true, source: 'dashboard', keyId: 'ABC123DEFG' }
    page = render(<AdminPush />)
    await settle()
    act(() => button(page, 'Remove').click())
    const ask = mocks.confirm.mock.calls.at(-1)[0]
    expect(ask.title).toMatch(/iPhone push/)
    await act(async () => { await ask.onConfirm() })
    await settle()
    expect(mocks.posts).toEqual([{ path: '/api/admin/push/apns/remove', body: {} }])
  })

  it('rotates the Web Push keys only after the confirmation', async () => {
    const page = render(<AdminPush />)
    await settle()
    act(() => button(page, 'Rotate keys').click())
    expect(mocks.posts).toEqual([])
    const ask = mocks.confirm.mock.calls.at(-1)[0]
    expect(ask.title).toMatch(/Rotate/)
    await act(async () => { await ask.onConfirm() })
    await settle()
    expect(mocks.posts).toEqual([{ path: '/api/admin/push/vapid', body: { rotate: true } }])
  })

  it('saves a Firebase service account as JSON', async () => {
    const page = render(<AdminPush />)
    await settle()
    const add = [...page.querySelectorAll('button')].filter(b => b.textContent === 'Add credentials')
    act(() => add[1].click())
    const sheet = render(mocks.sheets[0](() => {}))
    const json = JSON.stringify({ project_id: 'demo-project', client_email: 'x@demo.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\\nKEY\\n-----END PRIVATE KEY-----' })
    set(sheet.querySelector('textarea'), json)
    await act(async () => { button(sheet, 'Save credentials').click() })
    await settle()
    expect(mocks.posts).toEqual([{ path: '/api/admin/push/fcm', body: { serviceAccount: json } }])
    expect(sheet.textContent).toContain('demo-project')
  })

  it('sends a test notification to the admin’s own devices', async () => {
    const page = render(<AdminPush />)
    await settle()
    await act(async () => { button(page, 'Send test notification').click() })
    expect(mocks.test).toHaveBeenCalledTimes(1)
  })
})
