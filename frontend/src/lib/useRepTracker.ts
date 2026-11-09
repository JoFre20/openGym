/**
 * openGym - Sensor-based Auto-Rep & Set Tracker
 * Mathematics & Motion Engine Hook
 * 
 * Implements:
 * - iOS 13+ DeviceMotionEvent permission handling
 * - Linear acceleration with gravity compensation fallback (High-Pass filter)
 * - 3D Principal Component Analysis (Power Iteration) for dominant axis orientation
 * - Real-time Low-Pass Exponential Moving Average (EMA) smoothing
 * - 1-Rep Template calibration, noise floor estimation & hysteresis threshold extraction
 * - Hysteresis 3-state machine (IDLE -> PHASE_1 -> PHASE_2 -> REP_COMPLETE)
 * - Rep minimum duration debounce lock (fatigue tolerant)
 * - Auto-set-finish inactivity timer
 * - Synthetic Web Audio API & Haptic feedback (zero external MP3 dependencies)
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ============================================================================
// Types & Interfaces
// ============================================================================

export type PermissionState = "prompt" | "granted" | "denied" | "unsupported";
export type TrackerMode = "idle" | "countdown" | "recording_template" | "tracking" | "finished";
export type TrackingPhase = "idle" | "phase1" | "phase2";
export type PhaseOrder = "positive_first" | "negative_first";

export interface RawMotionSample {
  timestamp: number; // ms
  x: number;
  y: number;
  z: number;
}

export interface OscilloscopePoint {
  timestamp: number;
  raw: number;
  smoothed: number;
}

export interface RepTemplate {
  exerciseId: string;
  name?: string;
  createdAt: number;
  sampleCount: number;
  durationMs: number; // T_rep in ms
  dominantVector: [number, number, number]; // [vx, vy, vz] normalized unit vector
  pMax: number; // Peak positive acceleration (m/s²)
  pMin: number; // Peak negative acceleration (m/s²)
  phaseOrder: PhaseOrder;
  noiseFloor: number; // Baseline standard deviation (m/s²)
  neutralThreshold: number; // Rest zone threshold (m/s²)
  normalizedCurve: number[]; // 50 resampled points for visualization/debug
}

export interface RepTrackerOptions {
  exerciseId: string;
  alpha?: number; // Smoothing factor (0.05 - 0.5, default: 0.20)
  tolerance?: number; // Fatigue tolerance factor (0.40 - 0.90, default: 0.65)
  setEndTimeoutSec?: number; // Inactivity timeout in seconds (3 - 10, default: 6.0)
  audioFeedback?: boolean; // Enable synthetic Web Audio beeps
  hapticFeedback?: boolean; // Enable vibration patterns
  onRepCounted?: (repNumber: number, durationMs: number) => void;
  onSetFinished?: (totalReps: number) => void;
  onTemplateRecorded?: (template: RepTemplate) => void;
  onError?: (errorMessage: string) => void;
}

export interface RepTrackerState {
  isSupported: boolean;
  permissionState: PermissionState;
  mode: TrackerMode;
  trackingPhase: TrackingPhase;
  countdown: number;
  reps: number;
  currentValue: number;
  sampleRateHz: number;
  template: RepTemplate | null;
  inactiveSecondsRemaining: number;
  lastRepDurationMs: number | null;
  historyReps: Array<{ repNumber: number; durationMs: number }>;
}

// Storage prefix for localStorage templates
export const REPTRACKER_STORAGE_PREFIX = "opengym_rep_template_";

// ============================================================================
// Synthetic Web Audio & Haptic Feedback Engine
// ============================================================================

export class SoundHapticEngine {
  private ctx: AudioContext | null = null;
  private soundEnabled = true;
  private hapticsEnabled = true;

  public setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
  }

  public setHapticsEnabled(enabled: boolean) {
    this.hapticsEnabled = enabled;
  }

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx || this.ctx.state === "closed") {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public vibrate(pattern: number | number[]) {
    if (!this.hapticsEnabled) return;
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore vibration errors
    }
  }

  /**
   * Short low pitch beep for countdown ticks (e.g. 3, 2, 1)
   */
  public playCountdownTick() {
    this.vibrate(40);
    if (!this.soundEnabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;

      osc.type = "sine";
      osc.frequency.setValueAtTime(440, now); // A4 (440Hz)

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.09);
    } catch {
      // Fallback if blocked
    }
  }

  /**
   * Crisp high pitch beep for start / recording trigger (GO!)
   */
  public playCountdownGo() {
    this.vibrate([100, 40, 100]);
    if (!this.soundEnabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;

      osc.type = "triangle";
      osc.frequency.setValueAtTime(880, now); // A5 (880Hz)

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.23);
    } catch {}
  }

  /**
   * Crisp two-tone harmonic beep when a repetition is completed
   */
  public playRepSuccess(repNum: number) {
    this.vibrate([60, 30, 80]);
    if (!this.soundEnabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const baseFreq = 587.33; // D5
      const highFreq = 880.0; // A5

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc2.type = "triangle";

      osc1.frequency.setValueAtTime(baseFreq, now);
      osc1.frequency.exponentialRampToValueAtTime(highFreq, now + 0.12);

      osc2.frequency.setValueAtTime(highFreq * 1.5, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.15);
      osc2.stop(now + 0.15);
    } catch {}
  }

  /**
   * Ascending celebratory chime when the set is finished
   */
  public playSetFinished() {
    this.vibrate([120, 60, 180, 60, 240]);
    if (!this.soundEnabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

      freqs.forEach((freq, idx) => {
        const toneTime = now + idx * 0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, toneTime);

        gain.gain.setValueAtTime(0.001, toneTime);
        gain.gain.exponentialRampToValueAtTime(0.28, toneTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, toneTime + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(toneTime);
        osc.stop(toneTime + 0.24);
      });
    } catch {}
  }

  public unlockAudio() {
    const ctx = this.getContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  }
}

export const soundEngine = new SoundHapticEngine();

// ============================================================================
// Mathematical Helpers: High-Pass, Power Iteration & Signal Processing
// ============================================================================

/**
 * 3D Principal Component Analysis using Power Iteration
 * Finds the dominant axis of movement from a series of (x, y, z) acceleration samples.
 */
export function calculateDominantVector(samples: RawMotionSample[]): [number, number, number] {
  if (samples.length < 5) {
    return [0, 0, 1];
  }

  const n = samples.length;
  // 1. Compute means
  let meanX = 0, meanY = 0, meanZ = 0;
  for (let i = 0; i < n; i++) {
    meanX += samples[i].x;
    meanY += samples[i].y;
    meanZ += samples[i].z;
  }
  meanX /= n;
  meanY /= n;
  meanZ /= n;

  // 2. Compute 3x3 covariance matrix
  let cxx = 0, cyy = 0, czz = 0;
  let cxy = 0, cxz = 0, cyz = 0;

  for (let i = 0; i < n; i++) {
    const dx = samples[i].x - meanX;
    const dy = samples[i].y - meanY;
    const dz = samples[i].z - meanZ;

    cxx += dx * dx;
    cyy += dy * dy;
    czz += dz * dz;
    cxy += dx * dy;
    cxz += dx * dz;
    cyz += dy * dz;
  }

  cxx /= n;
  cyy /= n;
  czz /= n;
  cxy /= n;
  cxz /= n;
  cyz /= n;

  // 3. Power Iteration to find principal eigenvector
  let vx = 1, vy = 1, vz = 1;
  const initialMag = Math.sqrt(vx * vx + vy * vy + vz * vz);
  vx /= initialMag;
  vy /= initialMag;
  vz /= initialMag;

  // 20 iterations for high precision convergence
  for (let iter = 0; iter < 20; iter++) {
    const nextVx = cxx * vx + cxy * vy + cxz * vz;
    const nextVy = cxy * vx + cyy * vy + cyz * vz;
    const nextVz = cxz * vx + cyz * vy + czz * vz;

    const mag = Math.sqrt(nextVx * nextVx + nextVy * nextVy + nextVz * nextVz);
    if (mag > 1e-9) {
      vx = nextVx / mag;
      vy = nextVy / mag;
      vz = nextVz / mag;
    } else {
      break;
    }
  }

  return [vx, vy, vz];
}

/**
 * Project a 3D acceleration vector onto the normalized unit vector
 */
export function projectVector(x: number, y: number, z: number, unitVector: [number, number, number]): number {
  return x * unitVector[0] + y * unitVector[1] + z * unitVector[2];
}

/**
 * Resample a curve to N equidistant points (for visualization & export)
 */
export function resampleCurve(data: number[], targetPoints = 50): number[] {
  if (data.length === 0) return new Array(targetPoints).fill(0);
  if (data.length === 1) return new Array(targetPoints).fill(data[0]);

  const result: number[] = [];
  const step = (data.length - 1) / (targetPoints - 1);

  for (let i = 0; i < targetPoints; i++) {
    const indexFloat = i * step;
    const lowerIndex = Math.floor(indexFloat);
    const upperIndex = Math.min(lowerIndex + 1, data.length - 1);
    const fraction = indexFloat - lowerIndex;

    const interpolated = data[lowerIndex] + fraction * (data[upperIndex] - data[lowerIndex]);
    result.push(Number(interpolated.toFixed(3)));
  }

  return result;
}

// ============================================================================
// Custom Hook: useRepTracker
// ============================================================================

export function useRepTracker(options: RepTrackerOptions) {
  const {
    exerciseId,
    alpha = 0.20,
    tolerance = 0.65,
    setEndTimeoutSec = 6.0,
    audioFeedback = true,
    hapticFeedback = true,
    onRepCounted,
    onSetFinished,
    onTemplateRecorded,
    onError
  } = options;

  // Options ref to avoid stale closures in sensor event callbacks
  const optionsRef = useRef({
    exerciseId,
    alpha,
    tolerance,
    setEndTimeoutSec,
    audioFeedback,
    hapticFeedback,
    onRepCounted,
    onSetFinished,
    onTemplateRecorded,
    onError
  });

  useEffect(() => {
    optionsRef.current = {
      exerciseId,
      alpha,
      tolerance,
      setEndTimeoutSec,
      audioFeedback,
      hapticFeedback,
      onRepCounted,
      onSetFinished,
      onTemplateRecorded,
      onError
    };
    soundEngine.setSoundEnabled(audioFeedback);
    soundEngine.setHapticsEnabled(hapticFeedback);
  }, [
    exerciseId,
    alpha,
    tolerance,
    setEndTimeoutSec,
    audioFeedback,
    hapticFeedback,
    onRepCounted,
    onSetFinished,
    onTemplateRecorded,
    onError
  ]);

  // Main state
  const [state, setState] = useState<RepTrackerState>(() => ({
    isSupported: typeof window !== "undefined" && "DeviceMotionEvent" in window,
    permissionState: "prompt",
    mode: "idle",
    trackingPhase: "idle",
    countdown: 0,
    reps: 0,
    currentValue: 0,
    sampleRateHz: 60,
    template: null,
    inactiveSecondsRemaining: setEndTimeoutSec,
    lastRepDurationMs: null,
    historyReps: []
  }));

  // Oscilloscope ring buffer for 60fps canvas rendering
  // Stores past 5 seconds (up to 500 points)
  const ringBufferRef = useRef<OscilloscopePoint[]>([]);
  const ringBufferCapacity = 500;

  // High-Pass filter state for gravity removal fallback
  const gravityRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 9.81, z: 0 });
  const hasDirectLinearAccRef = useRef<boolean | null>(null);

  // EMA smoothing state
  const smoothedValueRef = useRef<number>(0);

  // Sample rate counter
  const sampleCountRef = useRef<number>(0);
  const sampleTimeAnchorRef = useRef<number>(0);

  // Recording state
  const recordingSamplesRef = useRef<RawMotionSample[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const autoStopPeakDetectedRef = useRef<boolean>(false);
  const autoStopQuietStartRef = useRef<number | null>(null);

  // Tracking state machine refs
  const trackingPhaseRef = useRef<TrackingPhase>("idle");
  const repStartTimeRef = useRef<number>(0);
  const lastRepFinishTimeRef = useRef<number>(0);
  const repsCountRef = useRef<number>(0);

  // Inactivity set end timer
  const inactivityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Template ref
  const templateRef = useRef<RepTemplate | null>(null);

  // Load existing template for this exercise from localStorage
  const loadSavedTemplate = useCallback((id: string): RepTemplate | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(REPTRACKER_STORAGE_PREFIX + id);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as RepTemplate;
      if (parsed && parsed.dominantVector && parsed.pMax && parsed.pMin) {
        return parsed;
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }, []);

  // Save template to localStorage
  const saveTemplateToStorage = useCallback((tpl: RepTemplate) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(REPTRACKER_STORAGE_PREFIX + tpl.exerciseId, JSON.stringify(tpl));
    } catch (e) {
      console.warn("Could not persist template to localStorage", e);
    }
  }, []);

  // Initialize template on mount or exercise change
  useEffect(() => {
    const existing = loadSavedTemplate(exerciseId);
    templateRef.current = existing;
    setState(prev => ({
      ...prev,
      template: existing,
      reps: 0,
      mode: "idle",
      trackingPhase: "idle",
      historyReps: []
    }));
  }, [exerciseId, loadSavedTemplate]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) clearInterval(inactivityTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  // Request iOS 13+ permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    soundEngine.unlockAudio();

    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) {
      setState(prev => ({ ...prev, permissionState: "unsupported" }));
      optionsRef.current.onError?.("DeviceMotionEvent wird auf diesem Gerät oder Browser nicht unterstützt.");
      return false;
    }

    const DME = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    if (typeof DME.requestPermission === "function") {
      try {
        const response = await DME.requestPermission();
        if (response === "granted") {
          setState(prev => ({ ...prev, permissionState: "granted" }));
          return true;
        } else {
          setState(prev => ({ ...prev, permissionState: "denied" }));
          optionsRef.current.onError?.("Bewegungssensor-Zugriff verweigert (iOS Permission).");
          return false;
        }
      } catch (err) {
        setState(prev => ({ ...prev, permissionState: "denied" }));
        optionsRef.current.onError?.("Fehler bei der Berechtigungsanfrage: " + String(err));
        return false;
      }
    } else {
      // Android or desktop browser where permission is implicit
      setState(prev => ({ ...prev, permissionState: "granted" }));
      return true;
    }
  }, []);

  // ============================================================================
  // Process 1-Rep Calibration Template
  // ============================================================================
  const processAndSaveTemplate = useCallback((): RepTemplate | null => {
    const rawSamples = recordingSamplesRef.current;
    if (rawSamples.length < 15) {
      optionsRef.current.onError?.("Die Aufnahme war zu kurz oder enthielt keine Daten. Bitte wiederholen.");
      return null;
    }

    // 1. Calculate dominant vector via PCA / Power Iteration
    const dominantVector = calculateDominantVector(rawSamples);

    // 2. Project all samples onto dominant vector
    const projected: number[] = [];
    for (let i = 0; i < rawSamples.length; i++) {
      const p = projectVector(rawSamples[i].x, rawSamples[i].y, rawSamples[i].z, dominantVector);
      projected.push(p);
    }

    // 3. Smooth with EMA filter
    const emaAlpha = optionsRef.current.alpha;
    const smoothed: number[] = [];
    let currentSmoothed = projected[0];
    for (let i = 0; i < projected.length; i++) {
      currentSmoothed = emaAlpha * projected[i] + (1 - emaAlpha) * currentSmoothed;
      smoothed.push(currentSmoothed);
    }

    // 4. Estimate baseline noise from the first 250ms (or first 15 samples)
    const noiseSamples = Math.min(Math.floor(rawSamples.length * 0.2), 20);
    let noiseSum = 0;
    for (let i = 0; i < noiseSamples; i++) {
      noiseSum += smoothed[i];
    }
    const noiseMean = noiseSum / noiseSamples;
    let noiseVar = 0;
    for (let i = 0; i < noiseSamples; i++) {
      const d = smoothed[i] - noiseMean;
      noiseVar += d * d;
    }
    const noiseFloor = Math.max(Math.sqrt(noiseVar / noiseSamples), 0.15);

    // 5. Detect P_max and P_min
    let pMax = -Infinity;
    let pMin = Infinity;
    let maxIdx = 0;
    let minIdx = 0;

    for (let i = 0; i < smoothed.length; i++) {
      const val = smoothed[i];
      if (val > pMax) {
        pMax = val;
        maxIdx = i;
      }
      if (val < pMin) {
        pMin = val;
        minIdx = i;
      }
    }

    // Validation: Amplitude check
    const peakToPeak = pMax - pMin;
    if (peakToPeak < 1.0) {
      optionsRef.current.onError?.("Bewegung zu schwach (Peak-to-Peak < 1.0 m/s²). Führe eine saubere Wiederholung aus.");
      return null;
    }

    // 6. Phase order detection
    const phaseOrder: PhaseOrder = maxIdx < minIdx ? "positive_first" : "negative_first";

    // 7. Rep duration (T_rep)
    const tStart = rawSamples[0].timestamp;
    const tEnd = rawSamples[rawSamples.length - 1].timestamp;
    const durationMs = Math.max(tEnd - tStart, 400);

    // 8. Neutral threshold
    const neutralThreshold = Math.max(
      0.22 * Math.min(Math.abs(pMax), Math.abs(pMin)),
      2.5 * noiseFloor,
      0.30
    );

    // 9. Resample curve to 50 normalized points
    const normalizedCurve = resampleCurve(smoothed, 50);

    const template: RepTemplate = {
      exerciseId: optionsRef.current.exerciseId,
      createdAt: Date.now(),
      sampleCount: rawSamples.length,
      durationMs,
      dominantVector,
      pMax: Number(pMax.toFixed(2)),
      pMin: Number(pMin.toFixed(2)),
      phaseOrder,
      noiseFloor: Number(noiseFloor.toFixed(2)),
      neutralThreshold: Number(neutralThreshold.toFixed(2)),
      normalizedCurve
    };

    templateRef.current = template;
    saveTemplateToStorage(template);
    setState(prev => ({ ...prev, template }));
    optionsRef.current.onTemplateRecorded?.(template);

    return template;
  }, [saveTemplateToStorage]);

  // ============================================================================
  // State Machine Trigger: Stop Recording
  // ============================================================================
  const stopRecording = useCallback(() => {
    setState(prev => ({ ...prev, mode: "idle" }));
    const tpl = processAndSaveTemplate();
    if (tpl) {
      soundEngine.playCountdownGo();
    }
  }, [processAndSaveTemplate]);

  // ============================================================================
  // Hands-Free 3-Second Countdown & Recording Start
  // ============================================================================
  const startRecordingWithCountdown = useCallback(async () => {
    const granted = await requestPermission();
    if (!granted) return;

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (inactivityTimerRef.current) clearInterval(inactivityTimerRef.current);

    let count = 3;
    setState(prev => ({
      ...prev,
      mode: "countdown",
      countdown: count
    }));
    soundEngine.playCountdownTick();

    countdownTimerRef.current = setInterval(() => {
      count -= 1;
      if (count > 0) {
        setState(prev => ({ ...prev, countdown: count }));
        soundEngine.playCountdownTick();
      } else {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;

        // Start calibration recording
        recordingSamplesRef.current = [];
        recordingStartTimeRef.current = performance.now();
        autoStopPeakDetectedRef.current = false;
        autoStopQuietStartRef.current = null;

        soundEngine.playCountdownGo();

        setState(prev => ({
          ...prev,
          mode: "recording_template",
          countdown: 0
        }));
      }
    }, 1000);
  }, [requestPermission]);

  // ============================================================================
  // Start Set Tracking
  // ============================================================================
  const startTracking = useCallback(async () => {
    if (!templateRef.current) {
      optionsRef.current.onError?.("Bitte nimm zuerst eine Referenz-Wiederholung auf.");
      return;
    }

    const granted = await requestPermission();
    if (!granted) return;

    if (inactivityTimerRef.current) clearInterval(inactivityTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    repsCountRef.current = 0;
    trackingPhaseRef.current = "idle";
    lastRepFinishTimeRef.current = performance.now();

    soundEngine.playCountdownGo();

    setState(prev => ({
      ...prev,
      mode: "tracking",
      trackingPhase: "idle",
      reps: 0,
      inactiveSecondsRemaining: optionsRef.current.setEndTimeoutSec,
      historyReps: []
    }));

    // Inactivity Timer interval (250ms tick for smooth countdown display)
    inactivityTimerRef.current = setInterval(() => {
      if (repsCountRef.current === 0) {
        // Inactivity timer only runs after at least 1 rep has been completed
        return;
      }

      const elapsedSec = (performance.now() - lastRepFinishTimeRef.current) / 1000;
      const remaining = Math.max(0, Math.ceil(optionsRef.current.setEndTimeoutSec - elapsedSec));

      setState(prev => {
        if (prev.mode !== "tracking") return prev;
        return { ...prev, inactiveSecondsRemaining: remaining };
      });

      if (remaining <= 0) {
        // Set Finished by inactivity!
        if (inactivityTimerRef.current) {
          clearInterval(inactivityTimerRef.current);
          inactivityTimerRef.current = null;
        }

        const totalReps = repsCountRef.current;
        soundEngine.playSetFinished();

        setState(prev => ({
          ...prev,
          mode: "finished",
          trackingPhase: "idle"
        }));

        optionsRef.current.onSetFinished?.(totalReps);
      }
    }, 250);
  }, [requestPermission]);

  // ============================================================================
  // Stop Tracking Manually
  // ============================================================================
  const stopTracking = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearInterval(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    const totalReps = repsCountRef.current;
    if (totalReps > 0) {
      soundEngine.playSetFinished();
      optionsRef.current.onSetFinished?.(totalReps);
    }

    setState(prev => ({
      ...prev,
      mode: "finished",
      trackingPhase: "idle"
    }));
  }, []);

  // Reset tracker to ready idle
  const resetTracker = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearInterval(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    repsCountRef.current = 0;
    trackingPhaseRef.current = "idle";

    setState(prev => ({
      ...prev,
      mode: "idle",
      trackingPhase: "idle",
      reps: 0,
      inactiveSecondsRemaining: optionsRef.current.setEndTimeoutSec,
      historyReps: []
    }));
  }, []);

  // ============================================================================
  // Core Device Motion Event Listener
  // ============================================================================
  useEffect(() => {
    if (typeof window === "undefined") return;

    let animFrameId: number | null = null;
    let lastUiUpdate = 0;

    const handleMotion = (event: DeviceMotionEvent) => {
      const now = performance.now();

      // Sample Rate calculation
      sampleCountRef.current += 1;
      if (now - sampleTimeAnchorRef.current >= 1000) {
        const measuredHz = Math.round((sampleCountRef.current * 1000) / (now - sampleTimeAnchorRef.current));
        sampleCountRef.current = 0;
        sampleTimeAnchorRef.current = now;
        setState(prev => ({ ...prev, sampleRateHz: measuredHz }));
      }

      // 1. Acceleration extraction (linear or gravity-compensated fallback)
      let ax = 0, ay = 0, az = 0;

      if (event.acceleration && event.acceleration.x != null && event.acceleration.x !== 0) {
        hasDirectLinearAccRef.current = true;
        ax = event.acceleration.x;
        ay = event.acceleration.y || 0;
        az = event.acceleration.z || 0;
      } else if (event.accelerationIncludingGravity && event.accelerationIncludingGravity.x != null) {
        // High-pass filter fallback: gravity constant alpha ~ 0.85
        hasDirectLinearAccRef.current = false;
        const rawX = event.accelerationIncludingGravity.x;
        const rawY = event.accelerationIncludingGravity.y || 0;
        const rawZ = event.accelerationIncludingGravity.z || 0;

        const gAlpha = 0.85;
        gravityRef.current.x = gAlpha * gravityRef.current.x + (1 - gAlpha) * rawX;
        gravityRef.current.y = gAlpha * gravityRef.current.y + (1 - gAlpha) * rawY;
        gravityRef.current.z = gAlpha * gravityRef.current.z + (1 - gAlpha) * rawZ;

        ax = rawX - gravityRef.current.x;
        ay = rawY - gravityRef.current.y;
        az = rawZ - gravityRef.current.z;
      } else {
        return;
      }

      // 2. Active Mode Handling
      const currentMode = state.mode;

      if (currentMode === "recording_template") {
        // Collect 3D sample
        const sample: RawMotionSample = { timestamp: now, x: ax, y: ay, z: az };
        recordingSamplesRef.current.push(sample);

        // Compute instantaneous projection onto current dominant vector or magnitude
        const mag = Math.sqrt(ax * ax + ay * ay + az * az);
        const smoothVal = optionsRef.current.alpha * mag + (1 - optionsRef.current.alpha) * smoothedValueRef.current;
        smoothedValueRef.current = smoothVal;

        // Push to oscilloscope buffer
        ringBufferRef.current.push({ timestamp: now, raw: mag, smoothed: smoothVal });
        if (ringBufferRef.current.length > ringBufferCapacity) {
          ringBufferRef.current.shift();
        }

        // Auto-stop logic:
        // Once a noticeable movement is detected (> 1.2 m/s²), wait until signal drops
        // back to quiet level for 1.5 seconds.
        if (mag > 1.2) {
          autoStopPeakDetectedRef.current = true;
        }

        if (autoStopPeakDetectedRef.current) {
          if (mag < 0.6) {
            if (autoStopQuietStartRef.current === null) {
              autoStopQuietStartRef.current = now;
            } else if (now - autoStopQuietStartRef.current >= 1500) {
              // Auto-stop triggered!
              stopRecording();
            }
          } else {
            autoStopQuietStartRef.current = null;
          }
        }
      } else if (currentMode === "tracking") {
        const tpl = templateRef.current;
        if (!tpl) return;

        // 3. Project 3D vector onto template dominant vector
        const rawProjected = projectVector(ax, ay, az, tpl.dominantVector);

        // 4. Smooth via EMA filter
        const smoothAlpha = optionsRef.current.alpha;
        const smoothed = smoothAlpha * rawProjected + (1 - smoothAlpha) * smoothedValueRef.current;
        smoothedValueRef.current = smoothed;

        // Push to oscilloscope buffer
        ringBufferRef.current.push({ timestamp: now, raw: rawProjected, smoothed });
        if (ringBufferRef.current.length > ringBufferCapacity) {
          ringBufferRef.current.shift();
        }

        // 5. Hysteresis State Machine
        const tol = optionsRef.current.tolerance;
        const thresholdPMax = tpl.pMax * tol;
        const thresholdPMin = tpl.pMin * tol;
        const neutralZone = tpl.neutralThreshold;
        const minRepDuration = Math.max(tpl.durationMs * 0.45, 380); // Min duration debounce

        const phase = trackingPhaseRef.current;

        if (tpl.phaseOrder === "positive_first") {
          // Expect positive peak first, then negative peak, then return to neutral
          if (phase === "idle") {
            if (smoothed >= thresholdPMax) {
              trackingPhaseRef.current = "phase1";
              repStartTimeRef.current = now;
              setState(prev => ({ ...prev, trackingPhase: "phase1" }));
            }
          } else if (phase === "phase1") {
            if (smoothed <= thresholdPMin) {
              trackingPhaseRef.current = "phase2";
              setState(prev => ({ ...prev, trackingPhase: "phase2" }));
            }
          } else if (phase === "phase2") {
            // Returned to neutral zone
            if (Math.abs(smoothed) <= neutralZone) {
              const repDuration = now - repStartTimeRef.current;
              if (repDuration >= minRepDuration) {
                // REP COMPLETE!
                repsCountRef.current += 1;
                const newRepCount = repsCountRef.current;
                lastRepFinishTimeRef.current = now;
                trackingPhaseRef.current = "idle";

                soundEngine.playRepSuccess(newRepCount);
                optionsRef.current.onRepCounted?.(newRepCount, repDuration);

                setState(prev => ({
                  ...prev,
                  trackingPhase: "idle",
                  reps: newRepCount,
                  lastRepDurationMs: Math.round(repDuration),
                  inactiveSecondsRemaining: optionsRef.current.setEndTimeoutSec,
                  historyReps: [...prev.historyReps, { repNumber: newRepCount, durationMs: Math.round(repDuration) }]
                }));
              }
            }
          }
        } else {
          // Expect negative peak first, then positive peak, then return to neutral
          if (phase === "idle") {
            if (smoothed <= thresholdPMin) {
              trackingPhaseRef.current = "phase1";
              repStartTimeRef.current = now;
              setState(prev => ({ ...prev, trackingPhase: "phase1" }));
            }
          } else if (phase === "phase1") {
            if (smoothed >= thresholdPMax) {
              trackingPhaseRef.current = "phase2";
              setState(prev => ({ ...prev, trackingPhase: "phase2" }));
            }
          } else if (phase === "phase2") {
            if (Math.abs(smoothed) <= neutralZone) {
              const repDuration = now - repStartTimeRef.current;
              if (repDuration >= minRepDuration) {
                // REP COMPLETE!
                repsCountRef.current += 1;
                const newRepCount = repsCountRef.current;
                lastRepFinishTimeRef.current = now;
                trackingPhaseRef.current = "idle";

                soundEngine.playRepSuccess(newRepCount);
                optionsRef.current.onRepCounted?.(newRepCount, repDuration);

                setState(prev => ({
                  ...prev,
                  trackingPhase: "idle",
                  reps: newRepCount,
                  lastRepDurationMs: Math.round(repDuration),
                  inactiveSecondsRemaining: optionsRef.current.setEndTimeoutSec,
                  historyReps: [...prev.historyReps, { repNumber: newRepCount, durationMs: Math.round(repDuration) }]
                }));
              }
            }
          }
        }
      } else {
        // Idle / Finished - still feed buffer for live preview
        const mag = Math.sqrt(ax * ax + ay * ay + az * az);
        const smoothVal = optionsRef.current.alpha * mag + (1 - optionsRef.current.alpha) * smoothedValueRef.current;
        smoothedValueRef.current = smoothVal;

        ringBufferRef.current.push({ timestamp: now, raw: mag, smoothed: smoothVal });
        if (ringBufferRef.current.length > ringBufferCapacity) {
          ringBufferRef.current.shift();
        }
      }

      // Throttle React state update for current live value to ~20Hz
      if (now - lastUiUpdate > 50) {
        lastUiUpdate = now;
        setState(prev => ({ ...prev, currentValue: smoothedValueRef.current }));
      }
    };

    window.addEventListener("devicemotion", handleMotion, { passive: true });

    return () => {
      window.removeEventListener("devicemotion", handleMotion);
      if (animFrameId) cancelAnimationFrame(animFrameId);
    };
  }, [state.mode, stopRecording]);

  // Export or Clear template
  const deleteTemplate = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(REPTRACKER_STORAGE_PREFIX + exerciseId);
    }
    templateRef.current = null;
    setState(prev => ({ ...prev, template: null, mode: "idle", reps: 0 }));
  }, [exerciseId]);

  return {
    state,
    ringBufferRef,
    requestPermission,
    startRecordingWithCountdown,
    stopRecording,
    startTracking,
    stopTracking,
    resetTracker,
    deleteTemplate,
    soundEngine
  };
}
