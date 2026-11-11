// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRepTracker } from './use-rep-tracker.js'

let pushSamples = null
let pushWatchState = null
const stopPhone = vi.fn(async () => {})
const stopWatch = vi.fn(async () => {})

vi.mock('./motion-source.js', () => ({
  startPhoneMotion: vi.fn(async ({ onSamples }) => {
    pushSamples = onSamples
    return { stop: stopPhone }
  }),
  startWatchMotion: vi.fn(async ({ onSamples, onState }) => {
    pushSamples = onSamples
    pushWatchState = onState
    return { stop: stopWatch }
  }),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TEMPLATE = {
  v: 1, exerciseId: '0025', source: 'iphone', createdAt: 1, reps: 3, detectedReps: 3,
  sampleCount: 300, durationMs: 1600, axis: [0, 0, 1], pMax: 4, pMin: -3.8,
  phaseOrder: 'positive_first', noiseFloor: 0.1, neutralThreshold: 0.4,
  minRepMs: 720, maxRepMs: 5000, alpha: 0.2, normalizedCurve: new Array(50).fill(0), peakToPeak: 7.8,
}

function trace(reps = 1) {
  const out = []
  let t = 0
  for (let i = 0; i < 20; i++) out.push({ t: t += 20, x: 0, y: 0, z: 0.02 })
  for (let r = 0; r < reps; r++) {
    const n = 80
    for (let i = 0; i < n; i++) out.push({ t: t += 20, x: 0, y: 0, z: Math.sin((i / n) * Math.PI * 2) * 4 })
    for (let i = 0; i < 20; i++) out.push({ t: t += 20, x: 0, y: 0, z: 0.02 })
  }
  return out
}

function mount(options = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let instance = null
  function Test() {
    const tracker = useRepTracker({ exerciseId: '0025', source: 'iphone', template: TEMPLATE, ...options })
    useEffect(() => { instance = tracker })
    return <div>{tracker.state.phase}:{tracker.state.reps}</div>
  }
  act(() => root.render(<Test />))
  return { host, root, get: () => instance }
}

let mounted
let onSetFinished
let onError
beforeEach(() => {
  vi.useFakeTimers()
  pushSamples = null
  pushWatchState = null
  stopPhone.mockClear()
  stopWatch.mockClear()
  onSetFinished = vi.fn()
  onError = vi.fn()
  mounted = mount({ onSetFinished, onError })
})
afterEach(() => {
  act(() => mounted.root.unmount())
  mounted.host.remove()
  vi.useRealTimers()
})

describe('useRepTracker', () => {
  it('counts a synthetic set after the countdown', async () => {
    await act(async () => { mounted.get().startTracking() })
    expect(mounted.get().state.phase).toBe('countdown')
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(mounted.get().state.phase).toBe('tracking')
    expect(pushSamples).toBeTypeOf('function')
    await act(async () => {
      for (const s of trace(2)) pushSamples([s])
    })
    expect(mounted.get().state.reps).toBe(2)
    expect(mounted.get().state.lastRepDurationMs).toBeGreaterThan(500)
  })

  it('finishes automatically after the inactivity window', async () => {
    await act(async () => { mounted.get().startTracking() })
    await act(async () => { vi.advanceTimersByTime(3000) })
    await act(async () => { for (const s of trace(1)) pushSamples([s]) })
    expect(mounted.get().state.reps).toBe(1)
    await act(async () => { vi.advanceTimersByTime(6200) })
    expect(mounted.get().state.phase).toBe('finished')
    expect(onSetFinished).toHaveBeenCalledWith(1, expect.any(Array))
  })

  it('stops in the confirm phase when the setting says so', async () => {
    act(() => mounted.root.unmount())
    mounted.host.remove()
    mounted = mount({ mode: 'confirm', onSetFinished })
    await act(async () => { mounted.get().startTracking() })
    await act(async () => { vi.advanceTimersByTime(3000) })
    await act(async () => { for (const s of trace(1)) pushSamples([s]) })
    await act(async () => { vi.advanceTimersByTime(6200) })
    expect(mounted.get().state.phase).toBe('confirm')
    expect(onSetFinished).not.toHaveBeenCalled()
    act(() => mounted.get().accept())
    expect(onSetFinished).toHaveBeenCalledWith(1, expect.any(Array))
  })

  it('pauses a watch set when a sample batch is missing', async () => {
    act(() => mounted.root.unmount())
    mounted.host.remove()
    mounted = mount({ source: 'watch', onSetFinished, onError })
    await act(async () => { mounted.get().startTracking() })
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(pushWatchState).toBeTypeOf('function')
    await act(async () => {
      pushSamples([{ t: 1, x: 0, y: 0, z: 0.01 }], { seq: 1 })
      pushSamples([{ t: 2, x: 0, y: 0, z: 0.01 }], { seq: 3 })
    })
    expect(mounted.get().state.error).toBe('watch_gap')
    expect(onError).toHaveBeenCalledWith({ code: 'watch_gap' })
  })

  it('never starts the sensor without a template', async () => {
    act(() => mounted.root.unmount())
    mounted.host.remove()
    mounted = mount({ template: null, onSetFinished, onError })
    await act(async () => { mounted.get().startTracking() })
    expect(mounted.get().state.phase).toBe('error')
    expect(mounted.get().state.error).toBe('no_template')
  })
})
