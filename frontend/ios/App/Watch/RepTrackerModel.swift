import Foundation
import WatchKit

/**
 * The Watch's standalone rep tracker. It owns a local CoreMotion stream and the pure RepCore
 * detector; the phone is not involved. Calibration templates stay in SessionStore's UserDefaults.
 *
 * The same three phases as the phone sheet are kept: calibration, tracking and confirmation. The
 * mode and inactivity window come from the phone's snapshot; without one the defaults apply.
 */
@MainActor
final class RepTrackerModel: ObservableObject {
    enum Phase: Equatable {
        case idle, countdown, calibrating, calibrated, tracking, confirm, finished, error
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var countdown = 3
    @Published private(set) var reps = 0
    @Published private(set) var wave: [Double] = []
    @Published private(set) var lastRepDurationMs: Double?
    @Published private(set) var autoRemaining: Double = 6
    @Published private(set) var error: String?
    @Published private(set) var template: RepTemplate?
    @Published var targetReps = 3

    let exerciseId: String
    let entryIdx: Int
    let setIdx: Int
    let mode: String
    let setEndSec: Double
    let calibrationReps: Int

    /// Called once when a calibration succeeds. The view writes it to the watch's local store.
    var onTemplate: ((RepTemplate) -> Void)?

    private let motion = WatchMotion()
    private var detector: RepDetector?
    private var recording: [RepSample] = []
    private var recordingStart = Date()
    private var peakSeen = false
    private var quietFrom: Date?
    private var lastRepWall: Date?
    private var countdownTimer: Timer?
    private var autoTimer: Timer?
    private var lastUi = Date.distantPast
    private var stopping = false

    init(exerciseId: String, entryIdx: Int, setIdx: Int, template: RepTemplate?,
         mode: String, setEndSec: Double, calibrationReps: Int) {
        self.exerciseId = exerciseId
        self.entryIdx = entryIdx
        self.setIdx = setIdx
        self.template = template
        self.mode = mode == "confirm" || mode == "manual" ? mode : "auto"
        self.setEndSec = setEndSec > 0 ? setEndSec : 6
        self.calibrationReps = calibrationReps == 1 ? 1 : 3
        self.targetReps = self.calibrationReps
        self.autoRemaining = self.setEndSec
        motion.onSample = { [weak self] sample in
            DispatchQueue.main.async { self?.handle(sample) }
        }
        motion.onError = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.phase == .calibrating || self.phase == .tracking else { return }
                self.fail("sensor_error")
            }
        }
    }

    deinit {
        countdownTimer?.invalidate()
        autoTimer?.invalidate()
        motion.stop()
    }

    /* ---------- starting ---------- */

    func startCalibration(target: Int? = nil) {
        if let target { targetReps = target == 1 ? 1 : 3 }
        startCountdown { [weak self] in self?.beginCalibration() }
    }

    func startTracking() {
        guard let template else { fail("no_template"); return }
        startCountdown { [weak self] in self?.beginTracking(template) }
    }

    private func startCountdown(_ then: @escaping () -> Void) {
        stopAll()
        phase = .countdown
        countdown = 3
        countdownTimer?.invalidate()
        countdownTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }
            if self.countdown > 1 {
                self.countdown -= 1
                Haptics.count()
            } else {
                timer.invalidate()
                self.countdownTimer = nil
                then()
            }
        }
        Haptics.count()
    }

    private func beginCalibration() {
        recording = []
        recordingStart = Date()
        peakSeen = false
        quietFrom = nil
        wave = []
        error = nil
        phase = .calibrating
        if !motion.start() { fail("unavailable") }
    }

    private func beginTracking(_ template: RepTemplate) {
        detector = RepDetector(template: template)
        reps = 0
        wave = []
        lastRepDurationMs = nil
        autoRemaining = setEndSec
        lastRepWall = nil
        error = nil
        phase = .tracking
        if !motion.start() { fail("unavailable"); return }
        startAutoTimer()
    }

    /* ---------- samples and state ---------- */

    private func handle(_ sample: RepSample) {
        guard !stopping else { return }
        switch phase {
        case .calibrating:
            recording.append(sample)
            let mag = RepCore.magnitude(sample)
            pushWave(mag, force: false)
            if mag > 1.2 {
                peakSeen = true
                quietFrom = nil
            }
            if peakSeen && mag < 0.6 {
                if quietFrom == nil { quietFrom = Date() }
                else if let q = quietFrom, Date().timeIntervalSince(q) >= 3, Date().timeIntervalSince(recordingStart) > 0.5 {
                    finishCalibration()
                }
            } else if mag >= 0.6 {
                quietFrom = nil
            }
        case .tracking:
            guard let detector else { return }
            let result = detector.push(sample)
            if result.rep {
                reps = result.count
                lastRepWall = Date()
                lastRepDurationMs = result.durationMs
                autoRemaining = setEndSec
                Haptics.count()
                pushWave(result.value, force: true)
            } else {
                pushWave(result.value, force: false)
            }
        default:
            break
        }
    }

    private func pushWave(_ value: Double, force: Bool) {
        wave.append(value)
        if wave.count > 70 { wave.removeFirst(wave.count - 70) }
        guard force || Date().timeIntervalSince(lastUi) >= 0.1 else { return }
        lastUi = Date()
    }

    private func startAutoTimer() {
        autoTimer?.invalidate()
        autoTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] timer in
            guard let self, self.phase == .tracking, self.reps > 0, let last = self.lastRepWall else { return }
            let elapsed = Date().timeIntervalSince(last)
            self.autoRemaining = max(0, (self.setEndSec - elapsed).rounded(.up))
            guard elapsed >= self.setEndSec, self.mode != "manual" else { return }
            timer.invalidate()
            self.autoTimer = nil
            self.finishSet(apply: self.mode == "auto")
        }
    }

    /* ---------- finishing ---------- */

    func finishCalibration() {
        guard phase == .calibrating else { return }
        stopMotion()
        let result = RepCore.buildTemplate(exerciseId: exerciseId, samples: recording,
                                           repCount: targetReps)
        switch result {
        case .ok(let t):
            template = t
            error = nil
            phase = .calibrated
            onTemplate?(t)
            Haptics.done()
        case .failed(let code, _):
            error = code
            phase = .idle
        }
    }

    func finishSet(apply: Bool = true) {
        guard phase == .tracking else { return }
        stopAll()
        if reps > 0 {
            phase = apply ? .finished : .confirm
            if apply { Haptics.done() }
        } else {
            phase = .idle
            error = "no_reps"
        }
    }

    func accept() {
        guard reps > 0 else { return }
        phase = .finished
        Haptics.done()
    }

    func resume() {
        guard let t = template else { fail("no_template"); return }
        if detector == nil { detector = RepDetector(template: t) }
        lastRepWall = Date()
        autoRemaining = setEndSec
        phase = .tracking
        if !motion.start() { fail("unavailable"); return }
        startAutoTimer()
    }

    func discard() {
        stopAll()
        reps = 0
        wave = []
        lastRepDurationMs = nil
        lastRepWall = nil
        error = nil
        phase = .idle
    }

    func reset() {
        stopAll()
        reps = 0
        wave = []
        lastRepDurationMs = nil
        lastRepWall = nil
        error = nil
        phase = .idle
    }

    func stop() {
        stopAll()
    }

    private func stopMotion() {
        stopping = true
        motion.stop()
        stopping = false
    }

    private func stopAll() {
        countdownTimer?.invalidate()
        countdownTimer = nil
        autoTimer?.invalidate()
        autoTimer = nil
        stopMotion()
    }

    private func fail(_ code: String) {
        stopAll()
        error = code
        phase = .error
    }
}
