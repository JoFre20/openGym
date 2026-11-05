// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = { user: null, toast: vi.fn(), api: vi.fn(), makeAvatarDataUrl: vi.fn() }
  state.patchUser = vi.fn(patch => { state.user = { ...state.user, ...patch } })
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector({ user: mocks.user, patchUser: mocks.patchUser }) : null
  useStore.getState = () => ({ user: mocks.user, patchUser: mocks.patchUser })
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: mocks.toast })
  const useUI = selector => selector ? selector(snapshot()) : snapshot()
  useUI.getState = snapshot
  return { useUI }
})
vi.mock('../lib/api.js', () => ({ api: mocks.api }))
vi.mock('../lib/avatar.js', async importOriginal => ({
  ...(await importOriginal()),
  makeAvatarDataUrl: mocks.makeAvatarDataUrl,
}))

import ProfilePicture from './ProfilePicture.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

let host, root
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const mount = () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<ProfilePicture />))
}

beforeEach(() => {
  mocks.user = { id: 'u1', name: 'Ada', avatar: null }
  mocks.toast.mockReset()
  mocks.api.mockReset().mockResolvedValue({ ok: true })
  mocks.makeAvatarDataUrl.mockReset().mockResolvedValue(AVATAR)
  mocks.patchUser.mockClear()
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

describe('ProfilePicture', () => {
  it('uploads a picked picture and updates the account at once', async () => {
    mount()
    expect(host.textContent).toContain('Add')
    const input = host.querySelector('input[type="file"]')
    const file = new File(['picked'], 'me.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
    await flush()

    expect(mocks.makeAvatarDataUrl).toHaveBeenCalledWith(file)
    expect(mocks.api).toHaveBeenCalledWith('/api/account/avatar', {
      method: 'PUT', body: JSON.stringify({ avatar: AVATAR }),
    })
    expect(mocks.patchUser).toHaveBeenCalledWith({ avatar: AVATAR })
    expect(mocks.toast).toHaveBeenCalledWith('Profile picture updated')
  })

  it('removes a picture without touching the rest of the account', async () => {
    mocks.user = { id: 'u1', name: 'Ada', avatar: AVATAR }
    mount()
    expect(host.querySelector('.pp-row').textContent).toContain('Change')
    const remove = [...host.querySelectorAll('.lrow')].find(node => node.textContent.trim() === 'Remove')
    act(() => remove.click())
    await flush()

    expect(mocks.api).toHaveBeenCalledWith('/api/account/avatar', { method: 'DELETE' })
    expect(mocks.patchUser).toHaveBeenCalledWith({ avatar: null })
    expect(mocks.toast).toHaveBeenCalledWith('Profile picture removed')
  })
})
