// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const menuSheet = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet,
  planHasRoutines: st => (st.routines || []).some(routine => routine.ex && routine.ex.length),
  exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../components/SharePlanSheet.jsx', () => ({ default: () => null }))

import Plan from './Plan.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
let host, root

const seed = ({ user = { id: 'u1', name: 'Ada' }, routines } = {}) => {
  const S = clone(DEF)
  S.routines = routines ?? [{
    id: 'r1', name: 'Push', emoji: 'dumbbell',
    ex: [{ id: '0025', sets: 3, mode: 'reps', reps: 5 }],
  }]
  S.week = { 1: ['r1'] }
  useStore.setState({ S, user, ready: true })
}

const openMenu = () => {
  act(() => root.render(<Plan />))
  act(() => host.querySelector('button[aria-label="Plan options"]').click())
  return menuSheet.mock.calls.at(-1)[0]
}
const shareItem = items => items.find(item => item.label === 'Share with friends')

beforeEach(() => {
  localStorage.setItem('gym_plan_view', 'routines')
  menuSheet.mockReset()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null, timer: null, work: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  localStorage.removeItem('gym_plan_view')
})

describe('Plan menu: share with friends', () => {
  it('opens the share sheet for a signed-in profile with a plan', () => {
    seed()
    const item = shareItem(openMenu().items)
    expect(item).toBeTruthy()
    expect(item.disabled).toBe(false)
    expect(item.sub).toBe('Send this plan to your squad. They choose whether to add it.')
    act(() => item.onClick())
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('is disabled for a guest', () => {
    seed({ user: null })
    const item = shareItem(openMenu().items)
    expect(item.disabled).toBe(true)
    expect(item.sub).toBe('Sign in to share with friends.')
  })

  it('is disabled when the plan has no exercise', () => {
    seed({ routines: [{ id: 'r1', name: 'Empty', ex: [] }] })
    expect(shareItem(openMenu().items).disabled).toBe(true)
  })
})
