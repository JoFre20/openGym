// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ socialWorkout: vi.fn(), shareWorkoutSheet: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({
  ...(await importOriginal()),
  socialWorkout: mocks.socialWorkout,
}))
vi.mock('../sheets.jsx', async importOriginal => ({
  ...(await importOriginal()),
  shareWorkoutSheet: mocks.shareWorkoutSheet,
}))

import { ActivityWorkoutSheet } from './ActivityWorkoutSheet.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ITEM = { id: 'u2:w1', owner: { id: 'u2', name: 'Ben' }, workout: { name: 'Push A', unit: 'kg' }, date: '2026-11-09' }
const DETAIL = {
  workoutId: 'w1', name: 'Push A', date: '2026-11-09', unit: 'kg', durationSec: 3600, volume: 1340, prs: ['0025'], prCount: 1,
  entries: [
    { id: '0025', name: 'Bench Press', exercise: { n: 'Bench Press', muscleWeights: { chest: 1 } }, sets: [{ w: 80, r: 8, done: true }, { w: 70, r: 10, done: true }] },
  ],
}
let host, root

beforeEach(() => {
  useStore.setState({ S: { ...DEF, unit: 'kg', body: 'male' }, user: { id: 'u1', name: 'Jonas' } })
  mocks.socialWorkout.mockReset().mockResolvedValue({ workout: DETAIL })
  mocks.shareWorkoutSheet.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('the Activity workout detail', () => {
  it('renders the finish-summary layout for a friend workout', async () => {
    const close = vi.fn()
    act(() => root.render(<ActivityWorkoutSheet item={ITEM} close={close} />))
    await flush()
    expect(host.textContent).toContain('Workout complete!')
    expect(host.textContent).toContain('Duration')
    expect(host.textContent).toContain('Volume')
    expect(host.textContent).toContain('Sets')
    expect(host.textContent).toContain('PRs')
    expect(host.textContent).toContain('What Ben trained')
    expect(host.textContent).toContain('Ben')
    expect(host.textContent).not.toContain('Share')
    expect(host.textContent).not.toContain('Nice!')
    expect(host.querySelector('.act-workout-hero .icn')).toBeNull()
    act(() => host.querySelector('button[aria-label="Close"]').click())
    expect(close).toHaveBeenCalled()
  })

  it('uses the local detail and offers share/media on the owner’s own workout', async () => {
    const own = { ...ITEM, owner: { id: 'u1', name: 'Jonas', me: true } }
    const local = { id: 'w1', d: '2026-11-09', name: 'Push A', start: 1, end: 2, entries: [] }
    act(() => root.render(<ActivityWorkoutSheet item={own} detail={DETAIL} localWorkout={local} close={() => {}} />))
    await flush()
    expect(host.textContent).toContain('You')
    expect(host.textContent).toContain('What you trained')
    expect(host.textContent).toContain('Share')
  })
})
