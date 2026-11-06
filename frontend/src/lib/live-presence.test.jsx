// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ api: vi.fn(), beacon: vi.fn() }))
vi.mock('./api.js', () => ({ api: mocks.api, beacon: mocks.beacon }))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { pauseLiveSharing, useLivePresence } from './live-presence.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const T0 = Date.now()
const workout = () => ({
  id: 'w1', name: 'Push Day', d: '2026-11-02', start: T0, cur: 0, routineIds: ['r1'],
  entries: [{ id: '0025', sets: [{ w: 80, r: 5, done: true }, { w: 80, r: 5, done: false }] }],
})
function Probe() { useLivePresence(); return null }
const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(<Probe />))
  return { root, host }
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const activeCalls = () => mocks.api.mock.calls.filter(([, opts]) => opts?.body && JSON.parse(opts.body).active === true)
const leftCalls = () => mocks.api.mock.calls.filter(([, opts]) => opts?.body && JSON.parse(opts.body).active === false)

beforeEach(() => {
  mocks.api.mockReset().mockResolvedValue({ ok: true, shared: true })
  mocks.beacon.mockReset()
  useStore.setState({
    user: { id: 'u1', name: 'Ada' },
    ready: true,
    S: { ...DEF, restSec: 90, active: workout() },
  })
  useUI.setState({ liveShared: false, livePausedWorkoutId: null })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) })
  vi.useRealTimers()
})

describe('useLivePresence', () => {
  it('sends the running workout from any screen and marks the athlete as sharing', async () => {
    render()
    await flush()
    const calls = activeCalls()
    expect(calls.length).toBe(1)
    const body = JSON.parse(calls[0][1].body)
    expect(body).toMatchObject({
      active: true, workoutId: 'w1', name: 'Push Day', exerciseId: '0025', startedAt: T0,
    })
    expect(body.etaSec).toBeGreaterThan(0)
    expect(useUI.getState().liveShared).toBe(true)
  })

  it('takes the row down when the workout is finished or discarded', async () => {
    render()
    await flush()
    mocks.api.mockClear()
    act(() => useStore.setState({ S: { ...useStore.getState().S, active: null } }))
    await flush()
    expect(leftCalls()).toHaveLength(1)
    expect(JSON.parse(leftCalls()[0][1].body)).toEqual({ active: false, reason: 'navigated' })
    expect(useUI.getState().liveShared).toBe(false)
  })

  it('a hidden page marks the row and a visible one heartbeats at once', async () => {
    render()
    await flush()
    let visibility = 'hidden'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(mocks.beacon).toHaveBeenCalledWith('/api/activity', { active: false, reason: 'hidden' })

    visibility = 'visible'
    mocks.api.mockClear()
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await flush()
    expect(activeCalls()).toHaveLength(1)
  })

  it('a closing tab sends the closed signal through the beacon', async () => {
    render()
    await flush()
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(mocks.beacon).toHaveBeenCalledWith('/api/activity', { active: false, reason: 'closed' })
  })

  it('the workout chip pauses this session without changing the saved setting', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    render()
    await flush()
    act(() => pauseLiveSharing())
    expect(useUI.getState().livePausedWorkoutId).toBe('w1')
    expect(JSON.parse(leftCalls().at(-1)[1].body)).toEqual({ active: false, reason: 'navigated' })
    mocks.api.mockClear()
    await act(async () => { vi.advanceTimersByTime(20000) })
    expect(activeCalls()).toHaveLength(0)
    expect(leftCalls().length).toBe(1)
  })

  it('a guest sends nothing', async () => {
    useStore.setState({ user: null })
    render()
    await flush()
    expect(mocks.api).not.toHaveBeenCalled()
    expect(mocks.beacon).not.toHaveBeenCalled()
  })
})
