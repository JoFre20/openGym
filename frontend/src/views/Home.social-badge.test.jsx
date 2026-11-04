// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const socialMe = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), socialMe }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

import { DEF, useStore } from '../store/useStore.js'
import { _resetSocialPending } from '../lib/social-badge.js'
import Home from './Home.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
let host, root

beforeEach(() => {
  _resetSocialPending()
  socialMe.mockReset()
  useStore.setState({ S: clone(DEF), user: { id: 'u1', name: 'Ada' }, ready: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(async () => {
  root.render(<Home />)
  await Promise.resolve()
  await Promise.resolve()
})
const badge = () => host.querySelector('.icon-badge')

describe('Home social badge', () => {
  it('shows the number of incoming friend requests on the Friends button', async () => {
    socialMe.mockResolvedValue({ pending: [{ id: 'r1', direction: 'incoming' }, { id: 'r2', direction: 'outgoing' }] })
    await mount()
    expect(badge().textContent).toBe('1')
    const friends = host.querySelector('button[aria-label="Friends (1)"]')
    expect(friends).toBeTruthy()
    expect(friends.classList.contains('hdr-pill')).toBe(true)
    expect(friends.textContent).toContain('Friends')
    expect(friends.querySelector('svg')?.getAttribute('data-icon')).toBe('people')
  })

  it('counts shared plans beside incoming requests', async () => {
    socialMe.mockResolvedValue({ pending: [{ id: 'r1', direction: 'incoming' }], planShares: 2 })
    await mount()
    expect(badge().textContent).toBe('3')
    expect(host.querySelector('button[aria-label="Friends (3)"]')).toBeTruthy()
  })

  it('shows nothing when there is no request', async () => {
    socialMe.mockResolvedValue({ pending: [], planShares: 0 })
    await mount()
    expect(badge()).toBeNull()
  })

  it('does not ask the server for a guest', async () => {
    useStore.setState({ user: null })
    await mount()
    expect(socialMe).not.toHaveBeenCalled()
    expect(badge()).toBeNull()
  })
})
