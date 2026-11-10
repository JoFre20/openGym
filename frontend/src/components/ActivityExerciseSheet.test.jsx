// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ socialWorkout: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({
  ...(await importOriginal()),
  socialWorkout: mocks.socialWorkout,
}))

import { ActivityExerciseSheet } from './ActivityExerciseSheet.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ITEM = {
  id: 'u2:w1',
  owner: { id: 'u2', name: 'Ben' },
  workout: { name: 'Push A', unit: 'kg' },
  date: '2026-11-09',
}

const DETAIL = {
  workout: {
    workoutId: 'w1', name: 'Push A', date: '2026-11-09', unit: 'kg', durationSec: 3000, volume: 1340,
    prs: [], prCount: 0,
    entries: [{
      id: '0025', name: 'Bench Press',
      exercise: { n: 'Bench Press', muscleWeights: { chest: 1, triceps: 0.5 } },
      sets: [{ w: 80, r: 8, done: true }, { w: 70, r: 10, done: true }],
    }],
  },
}

let host, root
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  mocks.socialWorkout.mockReset().mockResolvedValue(DETAIL)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('the exercise stats sheet', () => {
  it('shows the exercise, its sets and the muscle groups in the workout', async () => {
    const close = vi.fn()
    act(() => root.render(<ActivityExerciseSheet item={ITEM} exerciseId="0025" close={close} />))
    await flush()
    expect(mocks.socialWorkout).toHaveBeenCalledWith('u2:w1')
    expect(host.textContent).toContain('Exercise stats')
    expect(host.textContent).toContain('Bench Press')
    expect(host.textContent).toContain('Chest')
    expect(host.textContent).toContain('Triceps')
    expect(host.textContent).toContain('Chest')
    expect(host.textContent).toContain('Muscle groups in this workout')
    expect(host.textContent).toContain('80 kg × 8')
    expect(host.textContent).toContain('70 kg × 10')
    expect(host.textContent).toMatch(/1[.,]340 kg/)
    expect(host.textContent).toContain('2')
    expect(host.textContent).toContain('18')
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Done').click())
    expect(close).toHaveBeenCalled()
  })

  it('says when the workout has no set for that exercise', async () => {
    act(() => root.render(<ActivityExerciseSheet item={ITEM} exerciseId="nope" close={() => {}} />))
    await flush()
    expect(host.textContent).toContain('No sets in this workout.')
  })
})
