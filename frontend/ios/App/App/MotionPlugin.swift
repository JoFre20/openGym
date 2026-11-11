import Capacitor
import CoreMotion
import UIKit

/**
 * The iPhone's own motion sensor for rep counting (frontend lib/motion-source.js). Only the native
 * app calls it; there is no browser fallback by design.
 *
 * CoreMotion delivers `userAcceleration` with gravity already removed, in m/s². Samples are batched
 * before crossing the Capacitor bridge: five samples every 100 ms keeps the bridge quiet enough for
 * a whole set while the page still sees the movement at 50 Hz.
 *
 * The sensor never runs in the background: iOS would suspend this app anyway, and a count from a
 * suspended page is worse than a clear pause. Stopping it here also releases the sensor if the
 * WebView goes away without calling stop().
 */
@objc(MotionPlugin)
public class MotionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MotionPlugin"
    public let jsName = "Motion"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let manager = CMMotionManager()
    private let work = OperationQueue()
    private var batch: [[Double]] = []
    private var batchSize = 5
    private var running = false
    private var backgroundObserver: NSObjectProtocol?

    override public func load() {
        work.qualityOfService = .userInitiated
        work.maxConcurrentOperationCount = 1
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.running else { return }
            self.stopUpdates(notify: true, reason: "background")
        }
    }

    deinit {
        if let backgroundObserver {
            NotificationCenter.default.removeObserver(backgroundObserver)
        }
        manager.stopDeviceMotionUpdates()
    }

    @objc func start(_ call: CAPPluginCall) {
        guard manager.isDeviceMotionAvailable else {
            call.resolve(["supported": false])
            return
        }
        let hz = min(100, max(10, call.getDouble("hz") ?? 50))
        batchSize = min(20, max(1, Int(call.getDouble("batchSize") ?? 5)))
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.running { self.stopUpdates(notify: false) }
            self.batch = []
            self.running = true
            self.manager.deviceMotionUpdateInterval = 1.0 / hz
            self.manager.startDeviceMotionUpdates(to: self.work) { [weak self] motion, error in
                guard let self, let motion else {
                    if error != nil { self?.fail("sensor_error") }
                    return
                }
                self.append(motion)
            }
            call.resolve(["supported": true, "hz": hz])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.stopUpdates(notify: false)
            call.resolve(["stopped": true])
        }
    }

    private func append(_ motion: CMDeviceMotion) {
        let a = motion.userAcceleration
        // CoreMotion reports userAcceleration in g. The detector works in m/s², so convert here,
        // once, rather than making every JS consumer remember the unit.
        let g = 9.80665
        // `motion.timestamp` is monotonic: it survives a wall-clock change mid-set and gives the
        // detector clean intervals.
        batch.append([motion.timestamp * 1000, a.x * g, a.y * g, a.z * g])
        guard batch.count >= batchSize else { return }
        let samples = batch
        batch.removeAll(keepingCapacity: true)
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("motion", data: ["samples": samples])
        }
    }

    private func fail(_ code: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.running else { return }
            self.stopUpdates(notify: false)
            self.notifyListeners("motion", data: ["ended": true, "reason": code])
        }
    }

    private func stopUpdates(notify: Bool, reason: String = "stopped") {
        manager.stopDeviceMotionUpdates()
        running = false
        if !batch.isEmpty {
            let samples = batch
            batch.removeAll(keepingCapacity: true)
            notifyListeners("motion", data: ["samples": samples])
        }
        if notify { notifyListeners("motion", data: ["ended": true, "reason": reason]) }
    }
}
