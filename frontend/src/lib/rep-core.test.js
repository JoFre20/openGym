import { describe, it, expect } from 'vitest'
import {
  REP_SOURCE_WATCH, REP_TOLERANCE,
  buildRepTemplate, createRepDetector, dominantAxis, project,
  resampleCurve, setEndDue, setEndRemaining, templateQuality, validTemplate,
} from './rep-core.js'

const HZ = 50
const STEP = 1000 / HZ

/**
 * A synthetic acceleration trace: one sine cycle per repetition, quiet lead-in, a short quiet
 * pause between reps and a quiet tail. `axis` lets a test put the movement on a diagonal.
 */
function trace({
  reps = 3,
  durationMs = 1600,
  amp = 4,
  fade = 0.92,
  noise = 0.04,
  axis = [1, 0, 0],
  leadMs = 700,
  gapMs = 420,
  tailMs = 900,
  seed = 7,
} = {}) {
  let state = seed
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0xffffffff }
  const noiseAt = () => (random() * 2 - 1) * noise
  const samples = []
  let t = 0
  const push = v => {
    samples.push({ t, x: axis[0] * v + noiseAt(), y: axis[1] * v + noiseAt(), z: axis[2] * v + noiseAt() })
    t += STEP
  }
  for (let i = 0; i < leadMs / STEP; i++) push(noiseAt())
  for (let r = 0; r < reps; r++) {
    const a = amp * Math.pow(fade, r)
    const n = Math.round(durationMs / STEP)
    for (let i = 0; i < n; i++) push(Math.sin((i / n) * Math.PI * 2) * a + noiseAt())
    for (let i = 0; i < gapMs / STEP; i++) push(noiseAt())
  }
  for (let i = 0; i < tailMs / STEP; i++) push(noiseAt())
  return samples
}

function templateFor(opts = {}) {
  const result = buildRepTemplate({
    exerciseId: '0025', source: 'iphone', samples: trace(opts), repCount: opts.repCount || 3,
  })
  expect(result.ok).toBe(true)
  return result.template
}

describe('rep-core calibration', () => {
  it('finds the dominant axis of a diagonal movement', () => {
    const axis = dominantAxis(trace({ axis: [0, 0.7071, 0.7071] }))
    expect(Math.abs(axis[1])).toBeCloseTo(0.707, 2)
    expect(Math.abs(axis[2])).toBeCloseTo(0.707, 2)
    expect(Math.abs(axis[0])).toBeLessThan(0.05)
  })

  it('projects a 3D sample onto an axis', () => {
    expect(project({ x: 2, y: 3, z: 4 }, [1, 0, 0])).toBe(2)
    expect(project({ x: 2, y: 3, z: 4 }, [0, 0.6, 0.8])).toBeCloseTo(5)
  })

  it('builds a three-rep template from a continuous trace', () => {
    const t = templateFor()
    expect(validTemplate(t)).toBe(true)
    expect(t.source).toBe('iphone')
    expect(t.reps).toBe(3)
    expect(t.detectedReps).toBe(3)
    expect(t.durationMs).toBeGreaterThan(1450)
    expect(t.durationMs).toBeLessThan(1800)
    expect(t.pMax).toBeGreaterThan(2.5)
    expect(t.pMin).toBeLessThan(-2.5)
    expect(t.peakToPeak).toBeGreaterThan(5)
    expect(templateQuality(t)).toBe('good')
  })

  it('builds a one-rep template and stores the watch source', () => {
    const result = buildRepTemplate({
      exerciseId: '0043', source: REP_SOURCE_WATCH,
      samples: trace({ reps: 1 }), repCount: 1,
    })
    expect(result.ok).toBe(true)
    expect(result.template.source).toBe(REP_SOURCE_WATCH)
    expect(result.template.reps).toBe(1)
    expect(result.template.detectedReps).toBe(1)
  })

  it('refuses too little or one-directional movement', () => {
    const tiny = buildRepTemplate({ exerciseId: 'x', samples: trace({ amp: 0.1 }), repCount: 1 })
    expect(tiny.ok).toBe(false)
    expect(['too_weak', 'one_direction']).toContain(tiny.code)
    const short = buildRepTemplate({ exerciseId: 'x', samples: [{ t: 0, x: 1, y: 0, z: 0 }], repCount: 1 })
    expect(short.ok).toBe(false)
    expect(short.code).toBe('too_short')
  })

  it('says how many reps it saw when three were asked for', () => {
    const result = buildRepTemplate({
      exerciseId: '0025', samples: trace({ reps: 2, gapMs: 250 }), repCount: 3,
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('not_enough_reps')
    expect(result.detectedReps).toBe(2)
  })

  it('resamples a curve to the requested length', () => {
    const curve = resampleCurve([0, 1, 4, 1, 0, -2], 25)
    expect(curve).toHaveLength(25)
    expect(Math.max(...curve)).toBeGreaterThan(3.5)
  })
})

describe('rep-core detector', () => {
  it('counts every repetition in a clean trace', () => {
    const t = templateFor()
    const det = createRepDetector(t)
    let reps = 0
    for (const s of trace({ reps: 8, fade: 0.95 })) {
      const r = det.push(s)
      if (r.rep) reps += 1
    }
    expect(reps).toBe(8)
    expect(det.count).toBe(8)
  })

  it('keeps counting as the amplitude falls with fatigue', () => {
    const t = templateFor({ amp: 4 })
    const det = createRepDetector(t, { tolerance: REP_TOLERANCE })
    let reps = 0
    // Down to 62% of the calibrated peak: the default tolerance should still see it.
    for (const s of trace({ reps: 6, amp: 4, fade: 0.92 })) if (det.push(s).rep) reps += 1
    expect(reps).toBe(6)
  })

  it('does not count one-directional bumps or phone handling', () => {
    const t = templateFor()
    const det = createRepDetector(t)
    let reps = 0
    const bumped = [
      ...trace({ reps: 0, leadMs: 500, tailMs: 500 }),
      ...Array.from({ length: 30 }, (_, i) => ({ t: 1000 + i * STEP, x: i < 15 ? 9 : 0, y: 0, z: 0 })),
      ...Array.from({ length: 30 }, (_, i) => ({ t: 1800 + i * STEP, x: 0, y: i < 15 ? 9 : 0, z: 0 })),
    ]
    for (const s of bumped) if (det.push(s).rep) reps += 1
    expect(reps).toBe(0)
  })

  it('ignores a partial repetition', () => {
    const t = templateFor()
    const det = createRepDetector(t)
    let reps = 0
    const partial = trace({ reps: 0, leadMs: 500, tailMs: 200 })
    for (let i = 0; i < 22; i++) partial.push({ t: 1200 + i * STEP, x: 5, y: 0, z: 0 })
    for (const s of partial) if (det.push(s).rep) reps += 1
    expect(reps).toBe(0)
  })

  it('counts repetitions on a diagonal axis', () => {
    const t = templateFor({ axis: [0.6, 0.8, 0] })
    const det = createRepDetector(t)
    let reps = 0
    for (const s of trace({ reps: 5, axis: [0.6, 0.8, 0] })) if (det.push(s).rep) reps += 1
    expect(reps).toBe(5)
  })

  it('rejects an invalid template', () => {
    expect(() => createRepDetector({ v: 1, exerciseId: 'x' })).toThrow()
  })

  it('computes the inactivity window', () => {
    expect(setEndDue(1000, 6999, 6)).toBe(false)
    expect(setEndDue(1000, 7000, 6)).toBe(true)
    expect(setEndRemaining(1000, 4000, 6)).toBe(3)
    expect(setEndRemaining(null, 4000, 6)).toBe(6)
  })
})
