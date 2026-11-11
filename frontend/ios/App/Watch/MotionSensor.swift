import CoreMotion
import Foundation
import WatchConnectivity

/**
 * The Watch as a pure motion sensor for the iPhone (frontend lib/motion-source.js). It does not
 * count anything: CoreMotion samples go to the phone, where the same rep-core runs as for the
 * iPhone's own sensor. That keeps one detector and one calibration per sensor.
 *
 * Samples are sent in five-sample batches with a sequence number. The phone pauses on a gap rather
 * than counting from an incomplete signal, and the ring buffer here can resend a recent range.
 *
 * watchOS suspends CoreMotion when the wrist drops unless a workout session keeps the app alive.
 * With Apple Health on, the existing WorkoutManager session does that; without it the sensor works
 * while the watch app is frontmost. The phone sees the stream stop and pauses.
 */
final class MotionSensor: NSObject {
    private let manager = CMMotionManager()
    private let queue: OperationQueue = {
        let q = OperationQueue()
        q.qualityOfService = .userInitiated
        q.maxConcurrentOperationCount = 1
        return q
    }()
    private var batch: [[Double]] = []
    private var history: [[Double]] = []
    private var batchSize = 5
    private var seq = 0
    private var running = false
    private var hz: Double = 50
    private var maxWork: DispatchWorkItem?

    /// (state, reason): "started", "ended", "error".
    var onState: ((String, String?) -> Void)?

    var isRunning: Bool { running }

    @discardableResult
    func start(hz: Double = 50, batchSize: Int = 5) -> Bool {
        guard manager.isDeviceMotionAvailable else { return false }
        stop(sendState: false)
        self.hz = min(100, max(10, hz))
        self.batchSize = min(20, max(1, batchSize))
        batch = []
        history = []
        seq = 0
        running = true
        manager.deviceMotionUpdateInterval = 1.0 / self.hz
        // A phone that goes away without a Stop must not leave the sensor (and battery) running.
        let cap = DispatchWorkItem { [weak self] in self?.finish("ended", reason: "timeout") }
        maxWork = cap
        DispatchQueue.main.asyncAfter(deadline: .now() + 600, execute: cap)
        manager.startDeviceMotionUpdates(to: queue) { [weak self] motion, error in
            guard let self else { return }
            if let error {
                self.finish("error", reason: error.localizedDescription)
                return
            }
            guard let motion else { return }
            self.append(motion)
        }
        onState?("started", nil)
        return true
    }

    func stop(sendState: Bool = true) {
        guard running else { return }
        running = false
        maxWork?.cancel()
        maxWork = nil
        manager.stopDeviceMotionUpdates()
        flushBatch()
        if sendState { sendMotionState("ended", reason: "stopped") }
    }

    /// The phone noticed a missing sequence range and asks for it again. Kept small: a set is a few
    /// minutes, and the whole history is capped below.
    func resend(fromSeq: Int, toSeq: Int) {
        let first = max(0, (fromSeq - 1) * batchSize)
        let last = min(history.count, max(first, toSeq * batchSize))
        guard first < last else { return }
        var at = first
        while at < last {
            let end = min(last, at + batchSize)
            let samples = Array(history[at..<end])
            seq += 1
            sendSamples(samples, firstT: samples.first?.first ?? 0, seq: seq)
            at = end
        }
    }

    private func append(_ motion: CMDeviceMotion) {
        let a = motion.userAcceleration
        // CoreMotion reports userAcceleration in g; the phone's detector works in m/s².
        let g = 9.80665
        // Monotonic milliseconds: the phone only needs intervals, not a shared wall clock.
        batch.append([motion.timestamp * 1000, a.x * g, a.y * g, a.z * g])
        if batch.count >= batchSize { flushBatch() }
    }

    private func flushBatch() {
        guard !batch.isEmpty else { return }
        let samples = batch
        batch.removeAll(keepingCapacity: true)
        history.append(contentsOf: samples)
        // Ten minutes at 50 Hz. Enough to recover a set, small enough for the watch.
        if history.count > 30_000 { history.removeFirst(history.count - 30_000) }
        // The sequence advances for every batch, even one that cannot be sent: a phone that comes
        // back later must see a gap, not a stream that looks continuous across missing samples.
        seq += 1
        sendSamples(samples, firstT: samples.first?.first ?? 0, seq: seq)
    }

    private func sendSamples(_ samples: [[Double]], firstT: Double, seq: Int) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              WCSession.default.isReachable else {
            return
        }
        let payload: [String: Any] = [
            "motionSamples": [
                "seq": seq,
                "firstT": firstT,
                "samples": samples,
            ],
        ]
        WCSession.default.sendMessage(payload, replyHandler: nil) { [weak self] _ in
        }
    }

    private func sendMotionState(_ state: String, reason: String?) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              WCSession.default.isReachable else { return }
        var body: [String: Any] = ["state": state, "hz": hz]
        if let reason { body["reason"] = reason }
        WCSession.default.sendMessage(["motionState": body], replyHandler: nil, errorHandler: nil)
    }

    private func finish(_ state: String, reason: String?) {
        guard running else { return }
        running = false
        maxWork?.cancel()
        maxWork = nil
        manager.stopDeviceMotionUpdates()
        flushBatch()
        onState?(state, reason)
        sendMotionState(state, reason: reason)
    }
}
