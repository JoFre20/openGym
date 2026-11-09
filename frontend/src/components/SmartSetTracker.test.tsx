// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SmartSetTracker } from "./SmartSetTracker";
import { REPTRACKER_STORAGE_PREFIX, RepTemplate } from "../lib/useRepTracker";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SmartSetTracker Component", () => {
  let host: HTMLDivElement;
  let root: any;

  const dummyTemplate: RepTemplate = {
    exerciseId: "bench_press",
    createdAt: Date.now(),
    sampleCount: 50,
    durationMs: 1800,
    dominantVector: [0, 0, 1],
    pMax: 3.4,
    pMin: -2.8,
    phaseOrder: "positive_first",
    noiseFloor: 0.18,
    neutralThreshold: 0.45,
    normalizedCurve: new Array(50).fill(0)
  };

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.clearAllMocks();
  });

  it("renders with initial calibration prompt when no template exists", async () => {
    await act(async () => {
      root.render(
        <SmartSetTracker exerciseId="bench_press" exerciseName="Bankdrücken" />
      );
    });

    expect(host.textContent).toContain("Bankdrücken");
    expect(host.textContent).toContain("Kalibrierung erforderlich");
    expect(host.textContent).toContain("1. Referenz-Wiederholung aufnehmen (3s Countdown)");
  });

  it("renders ready to start set when template is already stored in localStorage", async () => {
    localStorage.setItem(
      REPTRACKER_STORAGE_PREFIX + "bench_press",
      JSON.stringify(dummyTemplate)
    );

    await act(async () => {
      root.render(
        <SmartSetTracker exerciseId="bench_press" exerciseName="Bankdrücken" />
      );
    });

    expect(host.textContent).toContain("Bereit für Satz");
    expect(host.textContent).toContain("Satz starten");
    expect(host.textContent).toContain("Referenz-Wiederholung neu aufnehmen (3s Countdown)");
    expect(host.textContent).toContain("Template JSON");
  });

  it("opens tuning panel when tuning toggle is clicked", async () => {
    await act(async () => {
      root.render(
        <SmartSetTracker exerciseId="bench_press" exerciseName="Bankdrücken" />
      );
    });

    const tuningBtn = Array.from(host.querySelectorAll("button")).find(b =>
      b.textContent?.includes("Parameter tunen")
    );
    expect(tuningBtn).toBeDefined();

    await act(async () => {
      tuningBtn?.click();
    });

    expect(host.textContent).toContain("Echtzeit-Parameter Tuning");
    expect(host.textContent).toContain("Signalglättung");
    expect(host.textContent).toContain("Ermüdungs-Toleranz");
    expect(host.textContent).toContain("Satz-Ende Inaktivitäts-Timeout");
  });

  it("opens and closes template JSON modal", async () => {
    localStorage.setItem(
      REPTRACKER_STORAGE_PREFIX + "bench_press",
      JSON.stringify(dummyTemplate)
    );

    await act(async () => {
      root.render(
        <SmartSetTracker exerciseId="bench_press" exerciseName="Bankdrücken" />
      );
    });

    const jsonBtn = Array.from(host.querySelectorAll("button")).find(b =>
      b.textContent?.includes("Template JSON")
    );
    expect(jsonBtn).toBeDefined();

    await act(async () => {
      jsonBtn?.click();
    });

    expect(host.textContent).toContain("Kalibrierungs-Template (bench_press)");
    expect(host.textContent).toContain("JSON kopieren");

    const closeBtn = Array.from(host.querySelectorAll("button")).find(b =>
      b.textContent?.includes("Schließen")
    );
    expect(closeBtn).toBeDefined();

    await act(async () => {
      closeBtn?.click();
    });

    expect(host.textContent).not.toContain("Kalibrierungs-Template (bench_press)");
  });
});
