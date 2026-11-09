/**
 * openGym - SmartSetTracker Component
 * 
 * Gym-Ready Auto-Rep & Set Tracker UI with:
 * - Real-time High-DPI Canvas Oscilloscope (5s signal buffer, threshold bands & neutral zone)
 * - Hands-free 3s countdown with synthetic Web Audio & Haptics
 * - Auto-stop calibration on rest detection (1.5s quiescent period)
 * - Auto-set-finish inactivity timer with live remaining time badge
 * - Live parameter tuning panel (Smoothing alpha, Fatigue tolerance, Set timeout)
 * - Calibration Template details, JSON inspection & clipboard export
 */

import React, { useState, useEffect, useRef } from "react";
import {
  useRepTracker,
  RepTemplate,
  OscilloscopePoint
} from "../lib/useRepTracker";

export interface SmartSetTrackerProps {
  exerciseId?: string;
  exerciseName?: string;
  onSetFinished?: (totalReps: number, history: Array<{ repNumber: number; durationMs: number }>) => void;
  onClose?: () => void;
}

export const SmartSetTracker: React.FC<SmartSetTrackerProps> = ({
  exerciseId = "bench_press",
  exerciseName = "Bankdrücken",
  onSetFinished,
  onClose
}) => {
  // Live tuning parameter states
  const [alpha, setAlpha] = useState<number>(0.20);
  const [tolerance, setTolerance] = useState<number>(0.65);
  const [setEndTimeoutSec, setSetEndTimeoutSec] = useState<number>(6.0);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [hapticsEnabled, setHapticsEnabled] = useState<boolean>(true);
  const [showJsonModal, setShowJsonModal] = useState<boolean>(false);
  const [showTuning, setShowTuning] = useState<boolean>(false);
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  // Canvas references
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Hook initialization
  const tracker = useRepTracker({
    exerciseId,
    alpha,
    tolerance,
    setEndTimeoutSec,
    audioFeedback: audioEnabled,
    hapticFeedback: hapticsEnabled,
    onSetFinished: (totalReps) => {
      if (onSetFinished) {
        onSetFinished(totalReps, tracker.state.historyReps);
      }
    }
  });

  const {
    state,
    ringBufferRef,
    requestPermission,
    startRecordingWithCountdown,
    stopRecording,
    startTracking,
    stopTracking,
    resetTracker,
    deleteTemplate
  } = tracker;

  // ============================================================================
  // Canvas Real-Time Oscilloscope Rendering Loop
  // ============================================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();

      // Ensure high-DPI scaling
      const width = rect.width;
      const height = rect.height;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // 1. Background Fill
      ctx.fillStyle = "#0c0d10";
      ctx.fillRect(0, 0, width, height);

      // 2. Grid & Axis Setup
      const centerY = height / 2;
      const tpl = state.template;
      const tol = tolerance;

      // Determine vertical scale (m/s² per pixel)
      let maxAmp = 6.0; // Default +/- 6 m/s²
      if (tpl) {
        const peak = Math.max(Math.abs(tpl.pMax), Math.abs(tpl.pMin));
        maxAmp = Math.max(maxAmp, peak * 1.35);
      }
      const buffer = ringBufferRef.current;
      for (let i = Math.max(0, buffer.length - 80); i < buffer.length; i++) {
        if (Math.abs(buffer[i].smoothed) > maxAmp * 0.9) {
          maxAmp = Math.abs(buffer[i].smoothed) * 1.25;
        }
      }

      const scaleY = (height / 2 - 14) / maxAmp;

      // Draw subtle horizontal grid lines (every 2 m/s²)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      const gridStep = maxAmp > 10 ? 4 : 2;
      for (let g = gridStep; g < maxAmp; g += gridStep) {
        // Positive grid line
        const yp = centerY - g * scaleY;
        ctx.beginPath();
        ctx.moveTo(0, yp);
        ctx.lineTo(width, yp);
        ctx.stroke();

        // Negative grid line
        const yn = centerY + g * scaleY;
        ctx.beginPath();
        ctx.moveTo(0, yn);
        ctx.lineTo(width, yn);
        ctx.stroke();
      }

      // Neutral rest zone band shading (if template exists)
      if (tpl) {
        const neutralZoneH = tpl.neutralThreshold * scaleY;
        ctx.fillStyle = "rgba(56, 189, 248, 0.07)"; // subtle cyan
        ctx.fillRect(0, centerY - neutralZoneH, width, neutralZoneH * 2);

        // Neutral boundary lines
        ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, centerY - neutralZoneH);
        ctx.lineTo(width, centerY - neutralZoneH);
        ctx.moveTo(0, centerY + neutralZoneH);
        ctx.lineTo(width, centerY + neutralZoneH);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Center baseline (0 m/s²)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.20)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // 3. Threshold Lines (if template exists)
      if (tpl) {
        const pMaxThresh = tpl.pMax * tol;
        const pMinThresh = tpl.pMin * tol;
        const yPMax = centerY - pMaxThresh * scaleY;
        const yPMin = centerY - pMinThresh * scaleY;

        // P_max threshold line (Emerald / Neon Green)
        ctx.strokeStyle = "#34d399";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.moveTo(0, yPMax);
        ctx.lineTo(width, yPMax);
        ctx.stroke();

        // P_min threshold line (Amber / Coral Red)
        ctx.strokeStyle = "#fb7185";
        ctx.beginPath();
        ctx.moveTo(0, yPMin);
        ctx.lineTo(width, yPMin);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label thresholds
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = "#34d399";
        ctx.fillText(`+${pMaxThresh.toFixed(1)} m/s² (T1)`, 6, Math.max(12, yPMax - 4));

        ctx.fillStyle = "#fb7185";
        ctx.fillText(`${pMinThresh.toFixed(1)} m/s² (T2)`, 6, Math.min(height - 4, yPMin + 12));
      }

      // 4. Draw Real-time Signal Buffer (Last 5 seconds)
      if (buffer.length > 1) {
        const now = buffer[buffer.length - 1].timestamp;
        const timeWindowMs = 5000;

        // Trace smoothed curve
        ctx.beginPath();
        let started = false;

        for (let i = 0; i < buffer.length; i++) {
          const pt = buffer[i];
          const timeOffset = now - pt.timestamp;
          if (timeOffset > timeWindowMs) continue;

          const x = width - (timeOffset / timeWindowMs) * width;
          const y = centerY - pt.smoothed * scaleY;

          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }

        // Color depends on tracker phase
        let strokeColor = "#38bdf8"; // Cyan default
        if (state.mode === "tracking") {
          if (state.trackingPhase === "phase1") strokeColor = "#34d399"; // Green in phase 1
          else if (state.trackingPhase === "phase2") strokeColor = "#f59e0b"; // Amber in phase 2
          else strokeColor = "#a78bfa"; // Purple in neutral
        } else if (state.mode === "recording_template") {
          strokeColor = "#ec4899"; // Pink during recording
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();

        // Glowing live dot on head point
        const headPt = buffer[buffer.length - 1];
        const headX = width;
        const headY = centerY - headPt.smoothed * scaleY;

        ctx.beginPath();
        ctx.arc(headX - 3, headY, 5, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(headX - 3, headY, 9, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor + "44"; // transparent glow
        ctx.fill();
      }

      // 5. Metadata Overlay (Hz, m/s², Status)
      ctx.font = "11px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      const liveAccStr = (state.currentValue >= 0 ? "+" : "") + state.currentValue.toFixed(2) + " m/s²";
      ctx.fillText(liveAccStr, width - 75, 16);

      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(255, 255, 255, 0.40)";
      ctx.fillText(`${state.sampleRateHz} Hz`, width - 42, height - 6);

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [state.template, state.mode, state.trackingPhase, state.currentValue, state.sampleRateHz, tolerance]);

  // Copy JSON Template helper
  const handleCopyJson = () => {
    if (!state.template) return;
    navigator.clipboard.writeText(JSON.stringify(state.template, null, 2)).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
  };

  return (
    <div className="flex flex-col w-full max-w-xl mx-auto bg-zinc-950 text-zinc-100 rounded-3xl p-5 shadow-2xl border border-zinc-800/80 select-none">
      {/* ---------------- Header ---------------- */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
        <div className="flex items-center space-x-2">
          <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-lg font-bold tracking-tight text-white">{exerciseName}</h2>
          <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-mono">
            {exerciseId}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Sound Toggle */}
          <button
            type="button"
            onClick={() => setAudioEnabled(!audioEnabled)}
            className={`p-2 rounded-xl text-xs transition-colors ${
              audioEnabled ? "bg-zinc-800 text-emerald-400" : "bg-zinc-900 text-zinc-600"
            }`}
            title="Audio-Feedback an/aus"
          >
            {audioEnabled ? "🔊 Ton An" : "🔇 Stumm"}
          </button>

          {/* Haptic Toggle */}
          <button
            type="button"
            onClick={() => setHapticsEnabled(!hapticsEnabled)}
            className={`p-2 rounded-xl text-xs transition-colors ${
              hapticsEnabled ? "bg-zinc-800 text-emerald-400" : "bg-zinc-900 text-zinc-600"
            }`}
            title="Vibrations-Feedback an/aus"
          >
            {hapticsEnabled ? "📳 Haptik" : "📴 Keine"}
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ---------------- Permission Status Banner (if prompt or denied) ---------------- */}
      {state.permissionState === "prompt" && (
        <div className="mt-3 p-3 bg-amber-950/40 border border-amber-600/40 rounded-2xl flex items-center justify-between text-xs text-amber-200">
          <span>iPhone iOS 13+ Sensorberechtigung erforderlich</span>
          <button
            type="button"
            onClick={() => requestPermission()}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl text-xs transition shadow"
          >
            Aktivieren
          </button>
        </div>
      )}

      {state.permissionState === "denied" && (
        <div className="mt-3 p-3 bg-red-950/40 border border-red-600/40 rounded-2xl text-xs text-red-200">
          ⚠️ Sensorzugriff wurde verweigert. Bitte öffne die Safari-Einstellungen und erlaube Bewegungssensoren.
        </div>
      )}

      {/* ---------------- Main Rep Counter & Status Display ---------------- */}
      <div className="my-4 p-5 bg-gradient-to-b from-zinc-900/90 to-zinc-900/40 border border-zinc-800/80 rounded-3xl flex flex-col items-center justify-center relative overflow-hidden">
        {/* State Banner */}
        <div className="mb-2">
          {state.mode === "idle" && (
            <span className="px-3 py-1 bg-zinc-800 text-zinc-300 text-xs font-medium rounded-full tracking-wide">
              {state.template ? "Bereit für Satz" : "Kalibrierung erforderlich"}
            </span>
          )}
          {state.mode === "countdown" && (
            <span className="px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold rounded-full animate-bounce">
              Start in {state.countdown}s... (Handy platzieren)
            </span>
          )}
          {state.mode === "recording_template" && (
            <span className="px-3 py-1 bg-pink-500/20 text-pink-300 border border-pink-500/30 text-xs font-semibold rounded-full animate-pulse">
              1 Wiederholung sauber ausführen...
            </span>
          )}
          {state.mode === "tracking" && (
            <span
              className={`px-3 py-1 text-xs font-semibold rounded-full transition-all ${
                state.trackingPhase === "phase1"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : state.trackingPhase === "phase2"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "bg-purple-500/20 text-purple-300 border border-purple-500/40"
              }`}
            >
              {state.trackingPhase === "phase1" && "Tracking: Phase 1 (Aufwärts/Abwärts)"}
              {state.trackingPhase === "phase2" && "Tracking: Phase 2 (Rückweg)"}
              {state.trackingPhase === "idle" && "Tracking: Bereit für nächste Rep"}
            </span>
          )}
          {state.mode === "finished" && (
            <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-semibold rounded-full">
              Satz beendet! 🎉
            </span>
          )}
        </div>

        {/* Big Counter */}
        <div className="flex items-baseline space-x-2 my-1">
          <span className="text-7xl font-black tracking-tighter text-white drop-shadow-sm font-mono">
            {state.reps}
          </span>
          <span className="text-zinc-500 text-xl font-bold">Reps</span>
        </div>

        {/* Sub-info: Last Rep Duration & Auto-Finish Inactivity Countdown */}
        <div className="flex items-center space-x-4 mt-2 text-xs font-mono text-zinc-400">
          {state.lastRepDurationMs !== null && (
            <span>Letzte Rep: {(state.lastRepDurationMs / 1000).toFixed(2)}s</span>
          )}

          {state.mode === "tracking" && state.reps > 0 && (
            <span
              className={`font-semibold ${
                state.inactiveSecondsRemaining <= 2 ? "text-red-400 animate-pulse" : "text-amber-400"
              }`}
            >
              Auto-Stopp in {state.inactiveSecondsRemaining}s
            </span>
          )}
        </div>
      </div>

      {/* ---------------- Real-time Live Oscilloscope (Canvas) ---------------- */}
      <div className="flex flex-col space-y-1.5 mb-4">
        <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
          <span className="font-semibold text-zinc-300">Live-Oszilloskop (5s Puffer)</span>
          <span className="text-[11px] font-mono text-zinc-500">
            {state.template
              ? `T1: +${(state.template.pMax * tolerance).toFixed(1)} / T2: ${(state.template.pMin * tolerance).toFixed(1)} m/s²`
              : "Kein Template"}
          </span>
        </div>

        <div className="w-full h-36 bg-black rounded-2xl overflow-hidden border border-zinc-800 shadow-inner relative">
          <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
      </div>

      {/* ---------------- Primary Touch Control Buttons ---------------- */}
      <div className="grid grid-cols-1 gap-2.5 mb-3">
        {state.mode === "idle" && (
          <div className="flex flex-col gap-2">
            {state.template ? (
              <button
                type="button"
                onClick={() => startTracking()}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-black font-extrabold text-lg rounded-2xl transition shadow-lg shadow-emerald-950/40 flex items-center justify-center space-x-2"
              >
                <span>Satz starten</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => startRecordingWithCountdown()}
              className={`w-full py-3.5 font-bold text-sm rounded-2xl transition active:scale-[0.98] flex items-center justify-center space-x-2 ${
                state.template
                  ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/40 py-4 text-base"
              }`}
            >
              <span>{state.template ? "Referenz-Wiederholung neu aufnehmen (3s Countdown)" : "1. Referenz-Wiederholung aufnehmen (3s Countdown)"}</span>
            </button>
          </div>
        )}

        {state.mode === "countdown" && (
          <div className="w-full py-4 bg-amber-600 text-black font-extrabold text-lg rounded-2xl text-center animate-pulse">
            Hands-Free Start in {state.countdown}...
          </div>
        )}

        {state.mode === "recording_template" && (
          <button
            type="button"
            onClick={() => stopRecording()}
            className="w-full py-4 bg-pink-600 hover:bg-pink-500 text-white font-extrabold text-base rounded-2xl transition shadow-lg shadow-pink-950/40 flex items-center justify-center space-x-2"
          >
            <span>Aufnahme stoppen & speichern (oder ablegen)</span>
          </button>
        )}

        {state.mode === "tracking" && (
          <button
            type="button"
            onClick={() => stopTracking()}
            className="w-full py-4 bg-red-600 hover:bg-red-500 text-white font-extrabold text-lg rounded-2xl transition shadow-lg shadow-red-950/40"
          >
            Satz jetzt manuell beenden
          </button>
        )}

        {state.mode === "finished" && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => resetTracker()}
              className="flex-1 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-base rounded-2xl transition"
            >
              Nächster Satz (Reset)
            </button>
            <button
              type="button"
              onClick={() => startTracking()}
              className="flex-1 py-3.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-base rounded-2xl transition"
            >
              Gleicher Satz fortsetzen
            </button>
          </div>
        )}
      </div>

      {/* ---------------- Tuning & Template Utility Bar ---------------- */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60 text-xs">
        <button
          type="button"
          onClick={() => setShowTuning(!showTuning)}
          className="text-zinc-400 hover:text-white font-medium py-1 px-2 rounded-lg hover:bg-zinc-800/60 transition flex items-center space-x-1"
        >
          <span>{showTuning ? "▼ Parameter verbergen" : "⚙️ Parameter tunen"}</span>
        </button>

        {state.template && (
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setShowJsonModal(true)}
              className="text-zinc-400 hover:text-white font-mono py-1 px-2 rounded-lg hover:bg-zinc-800/60 transition"
            >
              Template JSON
            </button>
            <button
              type="button"
              onClick={() => deleteTemplate()}
              className="text-red-400 hover:text-red-300 py-1 px-2 rounded-lg hover:bg-zinc-800/60 transition"
              title="Template löschen"
            >
              Löschen
            </button>
          </div>
        )}
      </div>

      {/* ---------------- Live Tuning Panel ---------------- */}
      {showTuning && (
        <div className="mt-3 p-4 bg-zinc-900/90 rounded-2xl border border-zinc-800 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
            Echtzeit-Parameter Tuning
          </h4>

          {/* 1. Glättung Alpha */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-300">Signalglättung (Low-Pass EMA α):</span>
              <span className="font-mono text-emerald-400">{alpha.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.50"
              step="0.01"
              value={alpha}
              onChange={(e) => setAlpha(parseFloat(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
              <span>0.05 (Sehr weich)</span>
              <span>0.50 (Direkt/Rau)</span>
            </div>
          </div>

          {/* 2. Fatigue Tolerance */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-300">Ermüdungs-Toleranz (Peak-Faktor):</span>
              <span className="font-mono text-emerald-400">{Math.round(tolerance * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.40"
              max="0.90"
              step="0.01"
              value={tolerance}
              onChange={(e) => setTolerance(parseFloat(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
              <span>40% (Sehr tolerant bei Ermüdung)</span>
              <span>90% (Strikte Spitzen)</span>
            </div>
          </div>

          {/* 3. Set-End Timeout */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-300">Satz-Ende Inaktivitäts-Timeout:</span>
              <span className="font-mono text-emerald-400">{setEndTimeoutSec.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min="3.0"
              max="10.0"
              step="0.5"
              value={setEndTimeoutSec}
              onChange={(e) => setSetEndTimeoutSec(parseFloat(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
              <span>3.0s (Schnell)</span>
              <span>10.0s (Lange Pause)</span>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Template JSON Modal ---------------- */}
      {showJsonModal && state.template && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white">Kalibrierungs-Template ({exerciseId})</h3>
              <button
                type="button"
                onClick={() => setShowJsonModal(false)}
                className="text-zinc-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 gap-2 my-3 text-xs font-mono">
              <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80">
                <span className="text-zinc-500 block">Dauer (T_rep):</span>
                <span className="text-white font-bold">{state.template.durationMs} ms</span>
              </div>
              <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80">
                <span className="text-zinc-500 block">Phasen-Reihenfolge:</span>
                <span className="text-white font-bold">{state.template.phaseOrder}</span>
              </div>
              <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80">
                <span className="text-zinc-500 block">P_max / P_min:</span>
                <span className="text-emerald-400 font-bold">
                  +{state.template.pMax} / {state.template.pMin} m/s²
                </span>
              </div>
              <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80">
                <span className="text-zinc-500 block">Hauptvektor (PCA):</span>
                <span className="text-cyan-400 font-bold">
                  [{state.template.dominantVector.map(v => v.toFixed(2)).join(", ")}]
                </span>
              </div>
            </div>

            {/* Raw JSON */}
            <div className="flex-1 overflow-auto bg-black p-3 rounded-xl border border-zinc-800/80 font-mono text-[11px] text-zinc-300">
              <pre>{JSON.stringify(state.template, null, 2)}</pre>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleCopyJson}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-xl transition"
              >
                {copyFeedback ? "✓ In Zwischenablage kopiert!" : "JSON kopieren"}
              </button>
              <button
                type="button"
                onClick={() => setShowJsonModal(false)}
                className="py-2.5 px-4 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-semibold rounded-xl transition"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartSetTracker;
