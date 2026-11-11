// The React adapter around rep-core and the native motion sources. The detector stays pure; this
// hook only owns the sensor session, the 3-2-1, the wall-clock inactivity timer and the state the
// sheet renders. It starts no sensor on the web: motion-source has no browser implementation.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  REP_SET_END_SEC, REP_TOLERANCE,
  buildRepTemplate, createRepDetector, magnitude, setEndRemaining,
} from './rep-core.js'
import { startPhoneMotion, startWatchMotion } from './motion-source.js'

const COUNTDOWN_FROM = 3
const QUIET_MS = 3000
const MOVING_MS = 1.2
const QUIET_LEVEL = 0.6
const UI_HZ_MS = 55

const initialState = (setEndSec = REP_SET_END_SEC) => ({
  phase: 'idle',          // idle | countdown | recording | calibrated | tracking | confirm | finished | error
  kind: null,             // calibration | tracking
  countdown: COUNTDOWN_FROM,
  reps: 0,
  currentValue: 0,
  wave: [],
  sampleRate: 0,
  lastRepDurationMs: null,
  autoRemaining: setEndSec,
  calibration: null,      // the result of the last calibration: { ok, template, code, detectedReps }
  error: null,            // a code from motion-source or rep-core, or 'no_reps'
})

export function useRepTracker({
  exerciseId,
  source = 'iphone',
  template = null,
  mode = 'auto',
  setEndSec = REP_SET_END_SEC,
  tolerance = REP_TOLERANCE,
  onRep,
  onSetFinished,
  onTemplateRecorded,
  onError,
} = {}) {
  const [state, setState] = useState(() => initialState(setEndSec))
  const stateRef = useRef(state)
  const phaseRef = useRef('idle')
  const optionsRef = useRef({ exerciseId, source, mode, setEndSec, tolerance, onRep, onSetFinished, onTemplateRecorded, onError })
  const templateRef = useRef(template)
  const activeRef = useRef(null)
  const stoppingRef = useRef(false)
  const countdownRef = useRef(null)
  const autoRef = useRef(null)
  const watchdogRef = useRef(null)
  const lastSampleAtRef = useRef(0)
  const detectorRef = useRef(null)
  const recordingRef = useRef([])
  const recordingStartRef = useRef(0)
  const peakRef = useRef(false)
  const quietFromRef = useRef(null)
  const repsRef = useRef(0)
  const historyRef = useRef([])
  const lastRepWallRef = useRef(0)
  const waveRef = useRef([])
  const lastUiRef = useRef(0)
  const rateRef = useRef({ count: 0, at: 0, hz: 0 })
  const aliveRef = useRef(true)
  const calibrationRepsRef = useRef(3)

  optionsRef.current = { exerciseId, source, mode, setEndSec, tolerance, onRep, onSetFinished, onTemplateRecorded, onError }
  templateRef.current = template

  const patch = useCallback(next => setState(prev => {
    const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next }
    stateRef.current = merged
    return merged
  }), [])

  const setPhase = useCallback((phase, extra = {}) => {
    phaseRef.current = phase
    patch({ ...extra, phase })
  }, [patch])

  const clearTimers = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null }
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null }
  }, [])

  const stopSource = useCallback(async () => {
    const active = activeRef.current
    activeRef.current = null
    stoppingRef.current = true
    try { await active?.stop?.() } catch { /* the source may already be gone */ }
    stoppingRef.current = false
  }, [])

  const stopAll = useCallback(async () => {
    clearTimers()
    await stopSource()
  }, [clearTimers, stopSource])

  const fail = useCallback(code => {
    if (!aliveRef.current) { void stopSource(); return }
    void stopSource()
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null }
    phaseRef.current = 'error'
    optionsRef.current.onError?.({ code })
    patch({ phase: 'error', error: code, autoRemaining: optionsRef.current.setEndSec })
  }, [patch, stopSource])

  const pushWave = useCallback((value, now, force = false) => {
    waveRef.current.push(Number(value) || 0)
    if (waveRef.current.length > 70) waveRef.current.shift()
    if (!force && now - lastUiRef.current < UI_HZ_MS) return
    lastUiRef.current = now
    const hz = rateRef.current.hz
    patch(prev => ({
      ...prev,
      currentValue: Number(value) || 0,
      wave: [...waveRef.current],
      ...(hz ? { sampleRate: hz } : {}),
    }))
  }, [patch])

  const rateSample = useCallback(now => {
    const r = rateRef.current
    r.count += 1
    if (!r.at) { r.at = now; return }
    if (now - r.at >= 1000) {
      r.hz = Math.round(r.count * 1000 / (now - r.at))
      r.count = 0; r.at = now
    }
  }, [])

  const finishCalibration = useCallback(async () => {
    if (phaseRef.current !== 'recording') return
    await stopSource()
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null }
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null }
    waveRef.current = []
    const result = buildRepTemplate({
      exerciseId: optionsRef.current.exerciseId,
      source: optionsRef.current.source,
      samples: recordingRef.current,
      repCount: calibrationRepsRef.current,
    })
    if (result.ok) {
      templateRef.current = result.template
      optionsRef.current.onTemplateRecorded?.(result.template)
      phaseRef.current = 'calibrated'
      patch({ phase: 'calibrated', calibration: result, error: null, reps: 0, currentValue: 0, wave: [] })
    } else {
      phaseRef.current = 'idle'
      patch({ phase: 'idle', calibration: result, error: result.code, reps: 0, currentValue: 0, wave: [] })
    }
  }, [patch, stopSource])

  const onSamples = useCallback((samples, info = {}) => {
    if (!aliveRef.current || !Array.isArray(samples) || !samples.length) return
    const now = Date.now()
    lastSampleAtRef.current = now
    if (phaseRef.current === 'recording') {
      const start = recordingStartRef.current || now
      if (!recordingStartRef.current) recordingStartRef.current = now
      for (const s of samples) {
        recordingRef.current.push(s)
        rateSample(now)
        const mag = magnitude(s)
        pushWave(mag, now)
        if (mag > MOVING_MS) { peakRef.current = true; quietFromRef.current = null }
        if (peakRef.current && mag < QUIET_LEVEL) {
          if (quietFromRef.current == null) quietFromRef.current = now
          else if (now - quietFromRef.current >= QUIET_MS && now - start > 500) {
            void finishCalibration()
            return
          }
        } else if (mag >= QUIET_LEVEL) quietFromRef.current = null
      }
      return
    }
    if (phaseRef.current !== 'tracking') return
    const det = detectorRef.current
    if (!det) return
    for (const s of samples) {
      rateSample(now)
      const result = det.push(s)
      if (result.rep) {
        repsRef.current += 1
        lastRepWallRef.current = now
        const durationMs = result.durationMs
        historyRef.current.push({ repNumber: repsRef.current, durationMs })
        optionsRef.current.onRep?.(repsRef.current, durationMs)
        patch(prev => ({
          ...prev,
          reps: repsRef.current,
          lastRepDurationMs: durationMs,
          autoRemaining: optionsRef.current.setEndSec,
        }))
      }
      pushWave(result.value, now, result.rep)
    }
    // A sequence gap is reported by the watch source; a received batch is not trusted to fill it.
    if (info?.seq && info.seq !== rateRef.current.lastSeq + 1 && rateRef.current.lastSeq) {
      fail('watch_gap')
      return
    }
    if (info?.seq) rateRef.current.lastSeq = info.seq
  }, [fail, finishCalibration, patch, pushWave, rateSample])

  const startSource = useCallback(async kind => {
    await stopSource()
    const now = Date.now()
    recordingStartRef.current = kind === 'recording' ? now : 0
    peakRef.current = false
    quietFromRef.current = null
    rateRef.current = { count: 0, at: 0, hz: 0, lastSeq: 0 }
    waveRef.current = []
    lastUiRef.current = 0
    lastSampleAtRef.current = now
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null }
    try {
      const callbacks = { onSamples, onState: st => {
        if (stoppingRef.current) return
        if (st?.state === 'started') return
        if (st?.state === 'error') fail(st.code || 'watch_error')
        else if (st?.state === 'ended' && (phaseRef.current === 'tracking' || phaseRef.current === 'recording')) fail('watch_stopped')
      } }
      const session = optionsRef.current.source === 'watch'
        ? await startWatchMotion(callbacks)
        : await startPhoneMotion({ onSamples, onError: e => fail(e?.code || 'sensor_stopped') })
      if (!aliveRef.current) { await session?.stop?.(); return }
      activeRef.current = session
      // The Watch is a live sensor, not a queued event source. If its app loses the workout
      // session or the wrist drops without Apple Health, no batch arrives; stop rather than let
      // the set-end timer log a set from a signal that is no longer there. The grace starts after
      // the start command itself resolved, not before a slow handshake.
      lastSampleAtRef.current = Date.now()
      if (optionsRef.current.source === 'watch') {
        watchdogRef.current = setInterval(() => {
          if (phaseRef.current !== 'recording' && phaseRef.current !== 'tracking') return
          if (Date.now() - lastSampleAtRef.current > 1500) fail('watch_stopped')
        }, 500)
      }
    } catch (e) {
      fail(e?.code || 'unavailable')
    }
  }, [fail, onSamples, stopSource])

  const startAutoTimer = useCallback(() => {
    if (autoRef.current) clearInterval(autoRef.current)
    autoRef.current = setInterval(() => {
      if (phaseRef.current !== 'tracking' || !repsRef.current || !lastRepWallRef.current) return
      const remaining = setEndRemaining(lastRepWallRef.current, Date.now(), optionsRef.current.setEndSec)
      patch(prev => prev.autoRemaining === remaining ? prev : { ...prev, autoRemaining: remaining })
      if (remaining > 0 || optionsRef.current.mode === 'manual') return
      if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null }
      if (optionsRef.current.mode === 'auto') void finishTracking(true)
      else void finishTracking(false)
    }, 250)
  }, [patch])

  const beginTracking = useCallback(async ({ keep = false } = {}) => {
    const tpl = templateRef.current
    if (!tpl) { fail('no_template'); return }
    if (!keep) {
      detectorRef.current = createRepDetector(tpl, { tolerance: optionsRef.current.tolerance })
      repsRef.current = 0
      historyRef.current = []
      lastRepWallRef.current = 0
    } else {
      detectorRef.current = detectorRef.current || createRepDetector(tpl, { tolerance: optionsRef.current.tolerance })
      lastRepWallRef.current = Date.now()
    }
    setPhase('tracking', {
      kind: 'tracking', countdown: 0, reps: repsRef.current, lastRepDurationMs: null,
      autoRemaining: optionsRef.current.setEndSec,
      calibration: stateRef.current.calibration, error: null, wave: [],
    })
    await startSource('tracking')
    if (phaseRef.current === 'tracking') startAutoTimer()
  }, [fail, setPhase, startAutoTimer, startSource])

  const beginCalibration = useCallback(async () => {
    recordingRef.current = []
    setPhase('recording', { kind: 'calibration', countdown: 0, reps: 0, lastRepDurationMs: null, autoRemaining: 0, error: null, wave: [] })
    await startSource('recording')
  }, [setPhase, startSource])

  const startWithCountdown = useCallback((kind, { reps = 3 } = {}) => {
    if (kind === 'tracking' && !templateRef.current) { fail('no_template'); return }
    void stopSource()
    clearTimers()
    calibrationRepsRef.current = kind === 'calibration' ? (reps === 1 ? 1 : 3) : calibrationRepsRef.current
    phaseRef.current = 'countdown'
    patch({ ...initialState(optionsRef.current.setEndSec), phase: 'countdown', kind, countdown: COUNTDOWN_FROM, calibration: stateRef.current.calibration })
    let n = COUNTDOWN_FROM
    countdownRef.current = setInterval(() => {
      n -= 1
      if (n > 0) { patch({ countdown: n }); return }
      clearInterval(countdownRef.current); countdownRef.current = null
      if (kind === 'calibration') void beginCalibration()
      else void beginTracking()
    }, 1000)
  }, [beginCalibration, beginTracking, clearTimers, patch, stopSource])

  const finishTracking = useCallback(async (apply = true) => {
    if (phaseRef.current !== 'tracking') return
    const reps = repsRef.current
    await stopAll()
    if (apply && reps > 0) {
      phaseRef.current = 'finished'
      patch({ phase: 'finished', autoRemaining: 0 })
      optionsRef.current.onSetFinished?.(reps, [...historyRef.current])
    } else {
      phaseRef.current = 'confirm'
      patch({ phase: 'confirm', autoRemaining: 0 })
    }
  }, [patch, stopAll])

  const accept = useCallback(() => {
    const reps = repsRef.current
    if (reps <= 0) return
    phaseRef.current = 'finished'
    patch({ phase: 'finished' })
    optionsRef.current.onSetFinished?.(reps, [...historyRef.current])
  }, [patch])

  const resume = useCallback(() => {
    void beginTracking({ keep: true })
  }, [beginTracking])

  const discard = useCallback(async () => {
    await stopAll()
    detectorRef.current = null
    repsRef.current = 0
    historyRef.current = []
    lastRepWallRef.current = 0
    phaseRef.current = 'idle'
    patch({ ...initialState(optionsRef.current.setEndSec), phase: 'idle', calibration: stateRef.current.calibration })
  }, [patch, stopAll])

  const stop = useCallback(() => {
    if (phaseRef.current === 'tracking') void finishTracking(true)
  }, [finishTracking])

  const reset = useCallback(async () => {
    await stopAll()
    detectorRef.current = null
    repsRef.current = 0
    historyRef.current = []
    lastRepWallRef.current = 0
    phaseRef.current = 'idle'
    patch(initialState(optionsRef.current.setEndSec))
  }, [patch, stopAll])

  useEffect(() => {
    aliveRef.current = true
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden' &&
          (phaseRef.current === 'recording' || phaseRef.current === 'tracking')) {
        fail('sensor_stopped')
      }
    }
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', onVisibility)
    return () => {
      aliveRef.current = false
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', onVisibility)
      clearTimers()
      void stopSource()
    }
  }, [clearTimers, fail, stopSource])

  return {
    state,
    startCalibration: ({ reps = 3 } = {}) => startWithCountdown('calibration', { reps }),
    startTracking: () => startWithCountdown('tracking'),
    finishTracking,
    finishCalibration,
    accept,
    resume,
    discard,
    stop,
    reset,
  }
}
