// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  socialMe: vi.fn(),
  socialPlans: vi.fn(),
  sharePlanWithFriends: vi.fn(),
  removeSharedPlan: vi.fn(),
}))

vi.mock('../lib/api.js', async importOriginal => ({
  ...(await importOriginal()),
  socialMe: mocks.socialMe,
  socialPlans: mocks.socialPlans,
  sharePlanWithFriends: mocks.sharePlanWithFriends,
  removeSharedPlan: mocks.removeSharedPlan,
}))

import SharePlanSheet from './SharePlanSheet.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
let host, root, close

const ME = {
  friendCode: 'A7X-92B',
  settings: { shareWorkouts: true, shareWeight: 'none' },
  friends: [
    { friendshipId: 'f1', id: 'u2', name: 'Ben', since: 1 },
    { friendshipId: 'f2', id: 'u3', name: 'Cara', since: 2 },
  ],
  pending: [],
  planShares: 0,
}

const mount = () => act(async () => {
  root.render(<MemoryRouter><SharePlanSheet close={close} /></MemoryRouter>)
  await Promise.resolve()
  await Promise.resolve()
})
const click = (text) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  if (!button) throw new Error('no button: ' + text)
  act(() => button.click())
}

beforeEach(() => {
  const S = clone(DEF)
  S.unit = 'kg'
  S.routines = [{
    id: 'r1', name: 'Push', emoji: 'dumbbell',
    ex: [{ id: '0025', sets: 3, mode: 'reps', reps: 5, weight: 80 }],
  }]
  S.week = { 1: ['r1'] }
  useStore.setState({ S, user: { id: 'u1', name: 'Ada' }, ready: true })
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null, timer: null, work: null })
  close = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.socialMe.mockReset().mockResolvedValue(ME)
  mocks.socialPlans.mockReset().mockResolvedValue({ received: [], sent: [] })
  mocks.sharePlanWithFriends.mockReset().mockResolvedValue({ ok: true, shared: 1 })
  mocks.removeSharedPlan.mockReset().mockResolvedValue({ ok: true })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('SharePlanSheet', () => {
  it('selects friends and sends the plan bundle', async () => {
    await mount()
    expect(host.textContent).toContain('Ada’s plan')
    expect(host.textContent).toContain('1 routine')
    expect(host.textContent).toContain('1 exercise')
    expect(mocks.socialMe).toHaveBeenCalledTimes(1)
    expect(mocks.socialPlans).toHaveBeenCalledTimes(1)

    act(() => host.querySelectorAll('.share-plan-friend')[0].click())
    click('Share with 1 friend')
    await act(async () => { await Promise.resolve() })

    expect(mocks.sharePlanWithFriends).toHaveBeenCalledTimes(1)
    const [friendIds, plan] = mocks.sharePlanWithFriends.mock.calls[0]
    expect(friendIds).toEqual(['u2'])
    expect(plan.opengym_plan).toBe(1)
    expect(plan.name).toBe('Ada’s plan')
    expect(plan.unit).toBe('kg')
    expect(plan.week).toEqual({ 1: ['r1'] })
    expect(plan.routines[0].ex[0]).toMatchObject({ id: '0025', sets: 3, reps: 5, weight: 80 })
    expect(close).toHaveBeenCalled()
  })

  it('selects more than one friend', async () => {
    await mount()
    act(() => host.querySelectorAll('.share-plan-friend')[0].click())
    act(() => host.querySelectorAll('.share-plan-friend')[1].click())
    click('Share with 2 friends')
    await act(async () => { await Promise.resolve() })
    expect(mocks.sharePlanWithFriends.mock.calls[0][0]).toEqual(['u2', 'u3'])
  })

  it('shows an empty state when there is no friend yet', async () => {
    mocks.socialMe.mockResolvedValue({ ...ME, friends: [] })
    await mount()
    expect(host.textContent).toContain('No friends yet')
    expect(host.textContent).toContain('Add a friend with their code to start your squad.')
  })

  it('still lists friends when the sent list cannot load', async () => {
    mocks.socialPlans.mockRejectedValue(Object.assign(new Error('not found'), {
      status: 404, data: { error: 'not found' },
    }))
    await mount()
    expect(host.textContent).toContain('Ben')
    expect(host.textContent).toContain('Cara')
    expect(host.querySelectorAll('.share-plan-friend')).toHaveLength(2)
    expect(host.textContent).not.toContain('not found')
  })

  it('keeps Send disabled until a friend is chosen', async () => {
    await mount()
    const send = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Share')
    expect(send.disabled).toBe(true)
  })
})
