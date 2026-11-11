// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RepTrackerSheet } from './RepTrackerSheet.jsx'
import { writeRepTemplate } from '../lib/rep-templates.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let tracker
const support = {
  ready: true, iphone: true, watch: false, watchReason: 'unreachable', refresh: vi.fn(),
}

vi.mock('../lib/use-rep-support.js', () => ({
  useRepMotionSupport: () => support,
}))

vi.mock('../lib/use-rep-tracker.js', () => ({
  useRepTracker: () => tracker,
}))

vi.mock('../lib/health-sync.js', async importOriginal => ({
  ...(await importOriginal()),
  loadHealth: vi.fn(async () => ({ on: false })),
}))

const TEMPLATE = {
  v: 1, exerciseId: '0025', source: 'iphone', createdAt: 1, reps: 3, detectedReps: 3,
  sampleCount: 300, durationMs: 1600, axis: [0, 0, 1], pMax: 4, pMin: -3.8,
  phaseOrder: 'positive_first', noiseFloor: 0.1, neutralThreshold: 0.4,
  minRepMs: 720, maxRepMs: 5000, alpha: 0.2, normalizedCurve: new Array(50).fill(0), peakToPeak: 7.8,
}

function fakeTracker(overrides = {}) {
  return {
    state: {
      phase: 'idle', kind: null, countdown: 3, reps: 0, currentValue: 0, wave: [], sampleRate: 0,
      lastRepDurationMs: null, autoRemaining: 6, calibration: null, error: null,
    },
    startCalibration: vi.fn(), startTracking: vi.fn(), finishTracking: vi.fn(),
    finishCalibration: vi.fn(), accept: vi.fn(), resume: vi.fn(), discard: vi.fn(),
    stop: vi.fn(), reset: vi.fn(async () => {}),
    ...overrides,
  }
}

function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<RepTrackerSheet exerciseId="0025" exerciseName="Bench Press" setLabel="Set 2" onDone={vi.fn()} close={vi.fn()} />))
  return { host, root }
}

let mounted
beforeEach(() => {
  localStorage.clear()
  support.watch = false
  support.watchReason = 'unreachable'
  tracker = fakeTracker()
  mounted = mount()
})
afterEach(() => {
  act(() => mounted.root.unmount())
  mounted.host.remove()
})

describe('RepTrackerSheet', () => {
  it('offers calibration when this exercise has no template', () => {
    expect(mounted.host.textContent).toContain('Calibrate this exercise')
    expect(mounted.host.textContent).toContain('Put the iPhone in a pocket')
    const button = [...mounted.host.querySelectorAll('button')].find(b => b.textContent?.includes('Record reference'))
    expect(button).toBeDefined()
    expect(button.disabled).toBe(false)
    act(() => button.click())
    expect(tracker.startCalibration).toHaveBeenCalledWith({ reps: 3 })
  })

  it('offers the start when a template exists', () => {
    act(() => mounted.root.unmount())
    mounted.host.remove()
    writeRepTemplate(TEMPLATE)
    tracker = fakeTracker()
    mounted = mount()
    expect(mounted.host.textContent).toContain('Start set')
    const button = [...mounted.host.querySelectorAll('button')].find(b => b.textContent?.includes('Start set'))
    act(() => button.click())
    expect(tracker.startTracking).toHaveBeenCalled()
  })

  it('shows the Apple Health hint for a Watch sensor that would run in the foreground', async () => {
    support.watch = true
    support.watchReason = null
    const watch = [...mounted.host.querySelectorAll('.rt-source-btn')][1]
    act(() => watch.click())
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mounted.host.textContent).toContain('Without Apple Health')
    expect(mounted.host.textContent).toContain('Apple Health settings')
  })

  it('lets the Watch source be chosen so it can explain and retry a missing link', () => {
    const buttons = [...mounted.host.querySelectorAll('.rt-source-btn')]
    expect(buttons).toHaveLength(2)
    expect(buttons[1].disabled).toBe(false)
    expect(buttons[1].textContent).toContain('Not available')
    act(() => buttons[1].click())
    expect(mounted.host.textContent).toContain('The Watch is not reachable')
    expect(mounted.host.textContent).toContain('Check again')
  })

  it('shows the live count and ends the set', () => {
    act(() => mounted.root.unmount())
    mounted.host.remove()
    tracker = fakeTracker({ state: { ...fakeTracker().state, phase: 'tracking', reps: 7, lastRepDurationMs: 1700, autoRemaining: 4 } })
    mounted = mount()
    expect(mounted.host.textContent).toContain('7')
    const button = [...mounted.host.querySelectorAll('button')].find(b => b.textContent?.includes('Finish set'))
    act(() => button.click())
    expect(tracker.finishTracking).toHaveBeenCalledWith(true)
  })
})
