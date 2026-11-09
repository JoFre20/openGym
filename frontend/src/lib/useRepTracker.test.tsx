// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  calculateDominantVector,
  projectVector,
  resampleCurve,
  SoundHapticEngine,
  RawMotionSample,
  useRepTracker,
  REPTRACKER_STORAGE_PREFIX,
  RepTemplate
} from "./useRepTracker";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("useRepTracker - Mathematical Engine & Signal Processing", () => {
  it("computes the dominant axis vector using Power Iteration for linear motion along X", () => {
    const samples: RawMotionSample[] = [];
    for (let i = 0; i < 50; i++) {
      const t = i * 20;
      const x = Math.sin((i / 50) * Math.PI * 2) * 4.5;
      const y = (Math.random() - 0.5) * 0.1;
      const z = (Math.random() - 0.5) * 0.1;
      samples.push({ timestamp: t, x, y, z });
    }

    const dominant = calculateDominantVector(samples);
    expect(Math.abs(dominant[0])).toBeGreaterThan(0.95);
    expect(Math.abs(dominant[1])).toBeLessThan(0.15);
    expect(Math.abs(dominant[2])).toBeLessThan(0.15);

    const mag = Math.sqrt(dominant[0] ** 2 + dominant[1] ** 2 + dominant[2] ** 2);
    expect(mag).toBeCloseTo(1.0, 4);
  });

  it("computes the dominant axis vector for diagonal 3D motion (e.g. phone in pocket)", () => {
    const samples: RawMotionSample[] = [];
    for (let i = 0; i < 60; i++) {
      const t = i * 20;
      const amp = Math.sin((i / 60) * Math.PI * 2) * 5.0;
      samples.push({
        timestamp: t,
        x: (Math.random() - 0.5) * 0.05,
        y: amp * 0.7071,
        z: amp * 0.7071
      });
    }

    const dominant = calculateDominantVector(samples);
    expect(Math.abs(dominant[0])).toBeLessThan(0.1);
    expect(Math.abs(dominant[1])).toBeCloseTo(0.707, 1);
    expect(Math.abs(dominant[2])).toBeCloseTo(0.707, 1);
  });

  it("projects 3D acceleration accurately onto the dominant unit vector", () => {
    const unitVec: [number, number, number] = [0, 0.8, 0.6];
    const p1 = projectVector(0, 10, 0, unitVec);
    expect(p1).toBeCloseTo(8.0, 3);

    const p2 = projectVector(5, 5, 5, [1, 0, 0]);
    expect(p2).toBeCloseTo(5.0, 3);
  });

  it("resamples arbitrary curve points to exactly target count", () => {
    const rawCurve = [0, 2, 8, 4, -2, -6, -1, 0];
    const resampled = resampleCurve(rawCurve, 50);

    expect(resampled.length).toBe(50);
    expect(resampled[0]).toBeCloseTo(0, 1);
    const maxVal = Math.max(...resampled);
    expect(maxVal).toBeGreaterThan(6.0);
  });

  it("SoundHapticEngine safe calls when WebAudio is suspended or navigator.vibrate is absent", () => {
    const engine = new SoundHapticEngine();
    engine.setSoundEnabled(true);
    engine.setHapticsEnabled(true);

    expect(() => engine.playCountdownTick()).not.toThrow();
    expect(() => engine.playCountdownGo()).not.toThrow();
    expect(() => engine.playRepSuccess(1)).not.toThrow();
    expect(() => engine.playSetFinished()).not.toThrow();
    expect(() => engine.unlockAudio()).not.toThrow();
  });
});

describe("useRepTracker - Lifecycle & State Machine Harness", () => {
  let host: HTMLDivElement;
  let root: any;
  let trackerInstance: ReturnType<typeof useRepTracker>;

  function TestComponent({ onRepCounted, onSetFinished }: any) {
    trackerInstance = useRepTracker({
      exerciseId: "bench_press",
      alpha: 0.25,
      tolerance: 0.65,
      setEndTimeoutSec: 4.0,
      onRepCounted,
      onSetFinished
    });
    return (
      <div>
        <div data-testid="mode">{trackerInstance.state.mode}</div>
        <div data-testid="reps">{trackerInstance.state.reps}</div>
        <div data-testid="phase">{trackerInstance.state.trackingPhase}</div>
      </div>
    );
  }

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("loads stored template on mount and initializes ready state", async () => {
    const savedTpl: RepTemplate = {
      exerciseId: "bench_press",
      createdAt: Date.now(),
      sampleCount: 60,
      durationMs: 1500,
      dominantVector: [0, 0, 1],
      pMax: 4.0,
      pMin: -3.0,
      phaseOrder: "positive_first",
      noiseFloor: 0.2,
      neutralThreshold: 0.4,
      normalizedCurve: new Array(50).fill(0)
    };
    localStorage.setItem(REPTRACKER_STORAGE_PREFIX + "bench_press", JSON.stringify(savedTpl));

    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(trackerInstance.state.template).not.toBeNull();
    expect(trackerInstance.state.template?.pMax).toBe(4.0);
    expect(trackerInstance.state.reps).toBe(0);
  });

  it("transitions into countdown mode and then recording_template", async () => {
    await act(async () => {
      root.render(<TestComponent />);
    });

    await act(async () => {
      await trackerInstance.startRecordingWithCountdown();
    });

    expect(trackerInstance.state.mode).toBe("countdown");
    expect(trackerInstance.state.countdown).toBe(3);

    // Fast-forward 1s -> 2
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(trackerInstance.state.countdown).toBe(2);

    // Fast-forward 1s -> 1
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(trackerInstance.state.countdown).toBe(1);

    // Fast-forward 1s -> mode should change to recording_template
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(trackerInstance.state.mode).toBe("recording_template");
  });
});
