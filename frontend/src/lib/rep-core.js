// Rep counting from a motion sensor, as pure functions: calibration turns one or more clean
// repetitions into a small template, and the detector turns a stream of acceleration samples back
// into repetitions. Nothing here touches React, the DOM, a sensor or storage, so the hard part is
// tested with synthetic signals (rep-core.test.js).
//
// Sample shape: { t, x, y, z }, with t in milliseconds on any monotonic clock and x/y/z linear
// acceleration in m/s² (gravity already removed by CoreMotion or the native iPhone plugin).
// A template is per exercise and per sensor. A wrist and a phone in a pocket do not move the same
// way, so their templates are never shared.

export const REP_TEMPLATE_VERSION = 1
export const REP_SOURCE_PHONE = 'iphone'
export const REP_SOURCE_WATCH = 'watch'
export const REP_ALPHA = 0.2
export const REP_TOLERANCE = 0.62
export const REP_SET_END_SEC = 6
export const REP_CALIBRATION_REPS = 3
export const REP_MIN_SAMPLES = 18
export const REP_MIN_DURATION_MS = 350
export const REP_MIN_PEAK_TO_PEAK = 0.8
export const REP_MAX_TEMPLATE_MS = 10 * 60 * 1000

const finite = v => Number.isFinite(v)
const num = v => (finite(Number(v)) ? Number(v) : 0)
const round2 = v => Math.round(v * 100) / 100
const median = values => {
  if (!values.length) return 0
  const a = [...values].sort((x, y) => x - y)
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

export function normalizeSamples(samples) {
  if (!Array.isArray(samples)) return []
  return samples
    .map(s => ({ t: num(s?.t), x: num(s?.x), y: num(s?.y), z: num(s?.z) }))
    .filter(s => finite(s.t) && (s.x !== 0 || s.y !== 0 || s.z !== 0))
    .sort((a, b) => a.t - b.t)
}

/** The acceleration magnitude, used before an axis is known (recording feedback). */
export function magnitude(sample) {
  return Math.sqrt(num(sample?.x) ** 2 + num(sample?.y) ** 2 + num(sample?.z) ** 2)
}

/**
 * 3D principal component analysis by power iteration: the axis a movement mostly happened on.
 * One calibration repetition is enough to find it, but more repetitions make the direction less
 * sensitive to a single bump. Returns a unit vector, or [0, 0, 1] for too little data.
 */
export function dominantAxis(samples) {
  const s = normalizeSamples(samples)
  if (s.length < 5) return [0, 0, 1]
  let mx = 0, my = 0, mz = 0
  for (const p of s) { mx += p.x; my += p.y; mz += p.z }
  mx /= s.length; my /= s.length; mz /= s.length
  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0
  for (const p of s) {
    const dx = p.x - mx, dy = p.y - my, dz = p.z - mz
    cxx += dx * dx; cyy += dy * dy; czz += dz * dz
    cxy += dx * dy; cxz += dx * dz; cyz += dy * dz
  }
  cxx /= s.length; cyy /= s.length; czz /= s.length
  cxy /= s.length; cxz /= s.length; cyz /= s.length
  let vx = 1, vy = 1, vz = 1
  const initial = Math.hypot(vx, vy, vz)
  vx /= initial; vy /= initial; vz /= initial
  for (let i = 0; i < 24; i++) {
    const nx = cxx * vx + cxy * vy + cxz * vz
    const ny = cxy * vx + cyy * vy + cyz * vz
    const nz = cxz * vx + cyz * vy + czz * vz
    const mag = Math.hypot(nx, ny, nz)
    if (mag < 1e-9) break
    vx = nx / mag; vy = ny / mag; vz = nz / mag
  }
  return [vx, vy, vz]
}

export function project(sample, axis) {
  return num(sample?.x) * axis[0] + num(sample?.y) * axis[1] + num(sample?.z) * axis[2]
}

export function smoothSeries(values, alpha = REP_ALPHA) {
  if (!values.length) return []
  const a = Math.max(0.01, Math.min(0.8, Number(alpha) || REP_ALPHA))
  const out = [values[0]]
  for (let i = 1; i < values.length; i++) out.push(a * values[i] + (1 - a) * out[i - 1])
  return out
}

export function resampleCurve(values, points = 50) {
  if (!values.length) return new Array(points).fill(0)
  if (values.length === 1) return new Array(points).fill(round2(values[0]))
  const out = []
  const step = (values.length - 1) / (points - 1)
  for (let i = 0; i < points; i++) {
    const at = i * step
    const lo = Math.floor(at)
    const hi = Math.min(lo + 1, values.length - 1)
    const f = at - lo
    out.push(round2(values[lo] + (values[hi] - values[lo]) * f))
  }
  return out
}

function peaksOf(values, minAbs) {
  const peaks = []
  for (let i = 1; i < values.length - 1; i++) {
    const v = values[i]
    if (Math.abs(v) < minAbs) continue
    const prev = values[i - 1], next = values[i + 1]
    if ((v > 0 && v >= prev && v >= next) || (v < 0 && v <= prev && v <= next)) peaks.push({ i, v, t: i })
  }
  // Keep the largest of two peaks of the same sign without an opposite one between them.
  const out = []
  for (const p of peaks) {
    const last = out[out.length - 1]
    if (last && Math.sign(last.v) === Math.sign(p.v)) {
      if (Math.abs(p.v) > Math.abs(last.v)) out[out.length - 1] = p
    } else out.push(p)
  }
  return out
}

function firstLastAbove(values, threshold) {
  let first = -1, last = -1
  for (let i = 0; i < values.length; i++) {
    if (Math.abs(values[i]) >= threshold) {
      if (first < 0) first = i
      last = i
    }
  }
  return { first, last }
}

/**
 * Turn recorded repetitions into a template.
 *
 * `repCount` is what the lifter was asked to perform. The recording may contain a quiet lead-in
 * and a quiet tail; those are trimmed. For three repetitions the median of the per-rep peaks and
 * the time between equal peaks is used, so one poor repetition does not decide the thresholds.
 *
 * Returns { ok: true, template } or { ok: false, code, detectedReps? }.
 */
export function buildRepTemplate({
  exerciseId,
  source = REP_SOURCE_PHONE,
  samples,
  repCount = 1,
  alpha = REP_ALPHA,
  now = Date.now(),
} = {}) {
  const all = normalizeSamples(samples)
  const wanted = repCount === 3 ? 3 : 1
  if (!exerciseId) return { ok: false, code: 'missing_exercise' }
  if (all.length < REP_MIN_SAMPLES) return { ok: false, code: 'too_short' }
  if (all[all.length - 1].t - all[0].t < REP_MIN_DURATION_MS) return { ok: false, code: 'too_short' }
  if (all[all.length - 1].t - all[0].t > REP_MAX_TEMPLATE_MS) return { ok: false, code: 'too_long' }

  const axis = dominantAxis(all)
  const raw = all.map(s => project(s, axis))
  const smooth = smoothSeries(raw, alpha)
  const sortedAbs = smooth.map(Math.abs).sort((a, b) => a - b)
  const quietPart = sortedAbs.slice(0, Math.max(3, Math.floor(sortedAbs.length * 0.2)))
  const noiseFloor = Math.max(median(quietPart), 0.04)
  const significant = Math.max(0.55, noiseFloor * 3)
  const edge = firstLastAbove(smooth, significant)
  if (edge.first < 0 || edge.last <= edge.first) return { ok: false, code: 'too_weak' }

  // Keep a small margin around the movement: a detector starts on the threshold crossing, not on
  // the first sample of the recording.
  const pad = Math.max(2, Math.round((edge.last - edge.first) * 0.04))
  const from = Math.max(0, edge.first - pad)
  const to = Math.min(smooth.length - 1, edge.last + pad)
  const trimmed = smooth.slice(from, to + 1)
  const trimmedTimes = all.slice(from, to + 1).map(s => s.t)
  const globalMax = Math.max(...trimmed.map(v => Math.abs(v)))
  if (globalMax < 0.45) return { ok: false, code: 'too_weak' }

  const peaks = peaksOf(trimmed, Math.max(significant, globalMax * 0.28))
  const positives = peaks.filter(p => p.v > 0)
  const negatives = peaks.filter(p => p.v < 0)
  if (!positives.length || !negatives.length) return { ok: false, code: 'one_direction' }

  const firstPeak = peaks[0]
  const secondPeak = peaks.find(p => Math.sign(p.v) !== Math.sign(firstPeak.v))
  if (!secondPeak) return { ok: false, code: 'one_direction' }
  const phaseOrder = firstPeak.v > 0 ? 'positive_first' : 'negative_first'

  // A complete repetition is one positive and one negative peak. Count pairs only when they
  // alternate; a stray bump of the same sign was already merged by peaksOf.
  const detectedReps = Math.min(positives.length, negatives.length)
  if (wanted > 1 && detectedReps < wanted) {
    return { ok: false, code: 'not_enough_reps', detectedReps: Math.max(1, detectedReps) }
  }

  const sameSign = phaseOrder === 'positive_first' ? positives : negatives
  // The time from one peak to the opposite peak is about half a repetition. Twice that is the
  // repetition itself, without the idle gap the lifter may leave between two reps.
  const halfGaps = []
  for (let i = 1; i < peaks.length; i++) {
    if (Math.sign(peaks[i].v) !== Math.sign(peaks[i - 1].v)) {
      halfGaps.push(trimmedTimes[peaks[i].i] - trimmedTimes[peaks[i - 1].i])
    }
  }
  let durationMs = halfGaps.length
    ? median(halfGaps) * 2
    : trimmedTimes[trimmedTimes.length - 1] - trimmedTimes[0]
  durationMs = Math.max(REP_MIN_DURATION_MS, Math.round(durationMs))

  const pMax = median(positives.map(p => p.v))
  const pMin = median(negatives.map(p => p.v))
  if (pMax - pMin < REP_MIN_PEAK_TO_PEAK) return { ok: false, code: 'too_weak' }

  const neutralThreshold = Math.max(
    0.22 * Math.min(Math.abs(pMax), Math.abs(pMin)),
    2.5 * noiseFloor,
    0.25,
  )

  // The first full cycle, as a shape for a future template matcher and for the UI's preview.
  const cycleStart = firstPeak.i
  const nextSame = sameSign.find(p => p.i > cycleStart)
  const cycle = nextSame ? trimmed.slice(cycleStart, nextSame.i + 1) : trimmed
  const template = {
    v: REP_TEMPLATE_VERSION,
    exerciseId: String(exerciseId),
    source: source === REP_SOURCE_WATCH ? REP_SOURCE_WATCH : REP_SOURCE_PHONE,
    createdAt: now,
    reps: wanted,
    detectedReps,
    sampleCount: to - from + 1,
    durationMs,
    axis: axis.map(v => Math.round(v * 1000) / 1000),
    pMax: round2(pMax),
    pMin: round2(pMin),
    phaseOrder,
    noiseFloor: round2(noiseFloor),
    neutralThreshold: round2(neutralThreshold),
    minRepMs: Math.max(350, Math.round(durationMs * 0.45)),
    maxRepMs: Math.max(5000, Math.round(durationMs * 3)),
    alpha: Math.max(0.05, Math.min(0.5, Number(alpha) || REP_ALPHA)),
    normalizedCurve: resampleCurve(cycle, 50),
    peakToPeak: round2(pMax - pMin),
  }
  return { ok: true, template }
}

/** Whether a stored object still has the shape the detector needs. Older keys are ignored. */
export function validTemplate(t) {
  return !!t && t.v === REP_TEMPLATE_VERSION && typeof t.exerciseId === 'string' &&
    Array.isArray(t.axis) && t.axis.length === 3 && t.axis.every(finite) &&
    finite(t.pMax) && finite(t.pMin) && Math.abs(t.pMax) > 0.01 && Math.abs(t.pMin) > 0.01 &&
    finite(t.durationMs) && finite(t.neutralThreshold) && (t.phaseOrder === 'positive_first' || t.phaseOrder === 'negative_first')
}

/**
 * A state machine over the projected, smoothed signal. One repetition is one excursion past the
 * calibrated peak in one direction, then past the opposite peak, then back to the neutral zone.
 * The thresholds are lower than the calibration peaks (fatigue tolerance), and a repetition that
 * takes too long is abandoned rather than counted.
 *
 * `push` returns { count, rep, phase, durationMs, value }. `rep` is true on the sample that
 * completes a repetition. `lastRepAt` is the sample time of that completion.
 */
export function createRepDetector(template, { tolerance = REP_TOLERANCE } = {}) {
  if (!validTemplate(template)) throw new Error('invalid rep template')
  const tpl = {
    ...template,
    alpha: Math.max(0.05, Math.min(0.5, Number(template.alpha) || REP_ALPHA)),
    minRepMs: Math.max(250, Number(template.minRepMs) || template.durationMs * 0.45),
    maxRepMs: Math.max(1200, Number(template.maxRepMs) || template.durationMs * 3),
  }
  const tol = Math.max(0.3, Math.min(0.95, Number(tolerance) || REP_TOLERANCE))
  const posThreshold = tpl.pMax * tol
  const negThreshold = tpl.pMin * tol
  const neutral = tpl.neutralThreshold
  let phase = 'idle'
  let startAt = 0
  let lastT = null
  let smooth = 0
  let started = false
  let count = 0
  let lastRepAt = null
  let lastDurationMs = null

  const begin = t => { phase = 'first'; startAt = t }
  const cancel = () => { phase = 'idle'; startAt = 0 }
  const complete = t => {
    const durationMs = Math.round(t - startAt)
    if (durationMs < tpl.minRepMs) { cancel(); return false }
    count += 1
    lastRepAt = t
    lastDurationMs = durationMs
    phase = 'idle'
    startAt = 0
    return true
  }

  function push(sample) {
    const t = Number(sample?.t)
    if (!finite(t)) return { count, rep: false, phase, durationMs: null, value: smooth }
    if (lastT != null && t < lastT) return { count, rep: false, phase, durationMs: null, value: smooth }
    lastT = t
    const value = project(sample, tpl.axis)
    smooth = started ? tpl.alpha * value + (1 - tpl.alpha) * smooth : value
    started = true
    if (phase !== 'idle' && t - startAt > tpl.maxRepMs) cancel()

    let rep = false
    if (tpl.phaseOrder === 'positive_first') {
      if (phase === 'idle' && smooth >= posThreshold) begin(t)
      else if (phase === 'first' && smooth <= negThreshold) phase = 'second'
      else if (phase === 'second' && Math.abs(smooth) <= neutral) rep = complete(t)
    } else {
      if (phase === 'idle' && smooth <= negThreshold) begin(t)
      else if (phase === 'first' && smooth >= posThreshold) phase = 'second'
      else if (phase === 'second' && Math.abs(smooth) <= neutral) rep = complete(t)
    }
    return { count, rep, phase, durationMs: rep ? lastDurationMs : null, value: smooth }
  }

  function reset() {
    phase = 'idle'; startAt = 0; lastT = null; smooth = 0; started = false
    count = 0; lastRepAt = null; lastDurationMs = null
  }

  return {
    push,
    reset,
    get count() { return count },
    get phase() { return phase },
    get lastRepAt() { return lastRepAt },
    get lastDurationMs() { return lastDurationMs },
    get template() { return tpl },
  }
}

/** Whether the set's inactivity window has elapsed since its last completed repetition. */
export function setEndDue(lastRepAt, now, timeoutSec = REP_SET_END_SEC) {
  if (lastRepAt == null) return false
  const at = Number(lastRepAt)
  const sec = Number(timeoutSec)
  if (!finite(at) || !finite(sec) || sec <= 0) return false
  return now - at >= sec * 1000
}

export function setEndRemaining(lastRepAt, now, timeoutSec = REP_SET_END_SEC) {
  if (lastRepAt == null) return timeoutSec
  const at = Number(lastRepAt)
  const sec = Number(timeoutSec)
  if (!finite(at) || !finite(sec) || sec <= 0) return sec
  return Math.max(0, Math.ceil(sec - (now - at) / 1000))
}

/** A short, human quality word for the calibration result. */
export function templateQuality(t) {
  if (!validTemplate(t)) return 'bad'
  if (t.peakToPeak >= 5 && t.noiseFloor <= 0.8) return 'good'
  if (t.peakToPeak >= 2.5 && t.noiseFloor <= 1.4) return 'ok'
  return 'weak'
}
