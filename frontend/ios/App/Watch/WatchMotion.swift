import CoreMotion
import Foundation

/**
 * CoreMotion for the Watch's own rep tracker. It is deliberately separate from MotionSensor:
 * MotionSensor streams to the iPhone and never counts, while this one feeds the local RepCore.
 * Samples are converted from CoreMotion's g to m/s² so both detectors use the same unit.
 */
final class WatchMotion {
    private let manager = CMMotionManager()
    private let queue: OperationQueue = {
        let q = OperationQueue()
        q.qualityOfService = .userInitiated
        q.maxConcurrentOperationCount = 1
        return q
    }()
    private(set) var running = false

    var onSample: ((RepSample) -> Void)?
    var onError: ((String) -> Void)?

    @discardableResult
    func start() -> Bool {
        guard manager.isDeviceMotionAvailable else { return false }
        stop()
        running = true
        manager.deviceMotionUpdateInterval = 1.0 / 50.0
        manager.startDeviceMotionUpdates(to: queue) { [weak self] motion, error in
            guard let self else { return }
            if let error {
                self.running = false
                self.manager.stopDeviceMotionUpdates()
                self.onError?(error.localizedDescription)
                return
            }
            guard let motion else { return }
            let a = motion.userAcceleration
            let g = 9.80665
            let sample = RepSample(t: motion.timestamp * 1000,
                                   x: a.x * g, y: a.y * g, z: a.z * g)
            self.onSample?(sample)
        }
        return true
    }

    func stop() {
        guard running else { return }
        running = false
        manager.stopDeviceMotionUpdates()
    }
}
