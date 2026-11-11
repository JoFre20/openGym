import SwiftUI

/// The Watch's own motion rep tracker, for training without the iPhone. The phone-side sheet is
/// the same idea with more room; this one keeps the watch layout: one big number, one primary
/// action, everything else small.
struct RepTrackerView: View {
    let store: SessionStore
    @StateObject private var model: RepTrackerModel
    @Environment(\.dismiss) private var dismiss
    private let title: String

    init(store: SessionStore, entryIdx: Int, setIdx: Int, exerciseId: String) {
        self.store = store
        if let w = store.workout, w.entries.indices.contains(entryIdx) {
            self.title = w.entries[entryIdx].name
        } else {
            self.title = ""
        }
        _model = StateObject(wrappedValue: RepTrackerModel(
            exerciseId: exerciseId,
            entryIdx: entryIdx,
            setIdx: setIdx,
            template: store.repTemplate(for: exerciseId),
            mode: store.repMotionMode,
            setEndSec: store.repMotionSetEndSec,
            calibrationReps: store.repMotionCalibReps
        ))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text(title)
                    .font(.system(.footnote, design: .rounded).weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                content
            }
            .padding(.horizontal, 2)
        }
        .onAppear {
            model.onTemplate = { store.saveRepTemplate($0) }
        }
        .onChange(of: model.phase) { phase in
            guard phase == .finished else { return }
            _ = store.completeMotionSet(reps: Double(model.reps), exerciseId: model.exerciseId, entryIdx: model.entryIdx, setIdx: model.setIdx)
            dismiss()
        }
        .onDisappear { model.stop() }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .idle: idle
        case .countdown: countdown
        case .calibrating: recording
        case .calibrated: calibrated
        case .tracking: tracking
        case .confirm: confirm
        case .error: error
        case .finished: Text("Set saved")
        }
    }

    private var idle: some View {
        VStack(spacing: 7) {
            if let template = model.template {
                Text("Calibration")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(templateSummary(template))
                    .font(.caption2)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                if let error = model.error {
                    Text(LocalizedStringKey(errorText(error)))
                        .font(.caption2)
                        .foregroundStyle(Theme.warmup)
                        .multilineTextAlignment(.center)
                }
                Button {
                    model.startTracking()
                } label: {
                    Text("Start set")
                        .frame(maxWidth: .infinity, minHeight: Theme.tap)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                Button("Calibrate again") { model.startCalibration() }
                    .font(.caption2)
            } else {
                Text("Calibrate this exercise")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Text("Reference repetitions")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    targetChoice(1)
                    targetChoice(3)
                }
                Button {
                    model.startCalibration(target: model.targetReps)
                } label: {
                    Text("Record reference")
                        .frame(maxWidth: .infinity, minHeight: Theme.tap)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                if let error = model.error {
                    Text(LocalizedStringKey(errorText(error)))
                        .font(.caption2)
                        .foregroundStyle(Theme.warmup)
                        .multilineTextAlignment(.center)
                }
            }
        }
    }

    private func targetChoice(_ n: Int) -> some View {
        Button {
            model.targetReps = n
        } label: {
            Text("\(n)")
                .font(.system(.body, design: .rounded).weight(.bold))
                .frame(width: 38, height: 32)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(model.targetReps == n ? Theme.accent : Theme.dim)
                )
                .foregroundStyle(model.targetReps == n ? Color.black : Color.white)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(n == 1 ? LocalizedStringKey("One repetition") : LocalizedStringKey("Three repetitions")))
    }

    private var countdown: some View {
        VStack(spacing: 6) {
            Text("\(model.countdown)")
                .font(.system(size: 64, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundStyle(Theme.accent)
            Text("Get ready")
                .font(.headline)
            Text("Hold still, then move.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Button("Cancel") { model.reset() }
                .font(.caption2)
        }
        .padding(.top, 12)
    }

    private var recording: some View {
        VStack(spacing: 6) {
            Text("Recording")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.warmup)
                .textCase(.uppercase)
            Text("\(model.targetReps)")
                .font(.system(size: 52, weight: .bold, design: .rounded).monospacedDigit())
            Text("clean repetitions")
                .font(.caption2)
                .foregroundStyle(.secondary)
            WatchWave(values: model.wave)
            Button("Finish recording") { model.finishCalibration() }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .font(.caption2)
        }
    }

    private var calibrated: some View {
        VStack(spacing: 7) {
            Text("Calibration saved")
                .font(.headline)
                .foregroundStyle(Theme.accent)
            if let t = model.template {
                Text(templateSummary(t))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.startTracking()
            } label: {
                Text("Start set")
                    .frame(maxWidth: .infinity, minHeight: Theme.tap)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            Button("Record again") { model.startCalibration() }
                .font(.caption2)
        }
    }

    private var tracking: some View {
        VStack(spacing: 5) {
            Text("\(model.reps)")
                .font(.system(size: 62, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundStyle(.white)
            Text("Reps")
                .font(.caption2)
                .foregroundStyle(.secondary)
            if let d = model.lastRepDurationMs {
                Text("Last rep \(String(format: "%.1f", d / 1000)) s")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            WatchWave(values: model.wave)
            if model.mode != "manual", model.reps > 0 {
                Text("Set ends automatically")
                    .font(.caption2)
                    .foregroundStyle(Theme.warmup)
                Text("\(Int(model.autoRemaining)) s")
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(Theme.warmup)
            }
            Button {
                model.finishSet(apply: true)
            } label: {
                Text("Finish set")
                    .frame(maxWidth: .infinity, minHeight: Theme.tap)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            .disabled(model.reps == 0)
            Button("Cancel") { model.reset() }
                .font(.caption2)
        }
    }

    private var confirm: some View {
        VStack(spacing: 8) {
            Text("\(model.reps)")
                .font(.system(size: 56, weight: .bold, design: .rounded).monospacedDigit())
            Text("Reps")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Button {
                model.accept()
            } label: {
                Text("Accept")
                    .frame(maxWidth: .infinity, minHeight: Theme.tap)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            Button("Keep counting") { model.resume() }
                .font(.caption2)
            Button("Discard") { model.discard() }
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var error: some View {
        VStack(spacing: 8) {
            Text("Motion counting")
                .font(.headline)
            Text(LocalizedStringKey(errorText(model.error)))
                .font(.caption2)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Try again") { model.reset() }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
            Button("Done") { dismiss() }
                .font(.caption2)
        }
    }

    private func templateSummary(_ t: RepTemplate) -> String {
        let seconds = String(format: "%.1f", t.durationMs / 1000)
        return "\(seconds) s · \(String(format: "%.1f", t.peakToPeak)) m/s²"
    }

    private func errorText(_ code: String?) -> String {
        switch code {
        case "too_short": return "The recording was too short. Try again."
        case "too_weak": return "Too little movement. Perform clean, full reps."
        case "one_direction": return "One direction only. Perform a full repetition."
        case "not_enough_reps": return "Not enough repetitions recognized. Try again."
        case "no_template": return "Calibrate this exercise first."
        case "no_reps": return "No repetitions were counted."
        case "unavailable": return "The motion sensor is not available."
        case "sensor_error": return "The sensor stopped. Try again."
        default: return "Motion counting could not start. Try again."
        }
    }
}

/// A tiny signal trace for the watch. Values are already smoothed or magnitude data.
struct WatchWave: View {
    let values: [Double]

    var body: some View {
        GeometryReader { geo in
            let maxValue = max(1, values.map(abs).max() ?? 1)
            Path { path in
                guard values.count > 1 else { return }
                for (i, v) in values.enumerated() {
                    let x = geo.size.width * Double(i) / Double(values.count - 1)
                    let y = geo.size.height / 2 - (v / maxValue) * (geo.size.height / 2 - 3)
                    if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                    else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(Theme.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
        .frame(height: 34)
        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.dim))
        .accessibilityHidden(true)
    }
}
