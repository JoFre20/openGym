import XCTest
@testable import WatchCore

final class RepCoreTests: XCTestCase {
    private let step = 20.0

    private func trace(reps: Int = 3, durationMs: Double = 1600, amp: Double = 4,
                       fade: Double = 0.92, noise: Double = 0.04,
                       axis: [Double] = [1, 0, 0], leadMs: Double = 700,
                       gapMs: Double = 420, tailMs: Double = 900, seed: UInt64 = 7) -> [RepSample] {
        var state = seed
        func random() -> Double {
            state = state &* 1664525 &+ 1013904223
            return Double(state & 0xffffffff) / Double(UInt32.max)
        }
        func noiseAt() -> Double { (random() * 2 - 1) * noise }
        var out: [RepSample] = []
        var t = 0.0
        func push(_ v: Double) {
            out.append(RepSample(t: t,
                                 x: axis[0] * v + noiseAt(),
                                 y: axis[1] * v + noiseAt(),
                                 z: axis[2] * v + noiseAt()))
            t += step
        }
        for _ in 0..<Int(leadMs / step) { push(noiseAt()) }
        for r in 0..<reps {
            let a = amp * pow(fade, Double(r))
            let n = Int(durationMs / step)
            for i in 0..<n { push(sin(Double(i) / Double(n) * .pi * 2) * a + noiseAt()) }
            for _ in 0..<Int(gapMs / step) { push(noiseAt()) }
        }
        for _ in 0..<Int(tailMs / step) { push(noiseAt()) }
        return out
    }

    private func template(_ opts: (Int, Double, Double, Double, [Double])? = nil) -> RepTemplate {
        let (reps, duration, amp, fade, axis) = opts ?? (3, 1600, 4, 0.92, [1, 0, 0])
        let result = RepCore.buildTemplate(exerciseId: "0025",
                                           samples: trace(reps: reps, durationMs: duration, amp: amp, fade: fade, axis: axis),
                                           repCount: reps)
        guard case .ok(let t) = result else {
            XCTFail("calibration failed: \(result)")
            return RepTemplate(v: 0, exerciseId: "", source: "", createdAt: 0, reps: 0, detectedReps: 0,
                               sampleCount: 0, durationMs: 0, axis: [0, 0, 1], pMax: 0, pMin: 0,
                               phaseOrder: .positiveFirst, noiseFloor: 0, neutralThreshold: 0,
                               minRepMs: 0, maxRepMs: 0, alpha: 0, normalizedCurve: [], peakToPeak: 0)
        }
        return t
    }

    func testBuildsThreeRepTemplateFromContinuousTrace() {
        let t = template()
        XCTAssertTrue(RepCore.valid(t))
        XCTAssertEqual(t.reps, 3)
        XCTAssertEqual(t.detectedReps, 3)
        XCTAssertGreaterThan(t.durationMs, 1400)
        XCTAssertLessThan(t.durationMs, 1800)
        XCTAssertGreaterThan(t.pMax, 2.5)
        XCTAssertLessThan(t.pMin, -2.5)
        XCTAssertGreaterThan(t.peakToPeak, 5)
    }

    func testBuildsOneRepTemplate() {
        let result = RepCore.buildTemplate(exerciseId: "0043", samples: trace(reps: 1), repCount: 1)
        guard case .ok(let t) = result else { return XCTFail("\(result)") }
        XCTAssertEqual(t.reps, 1)
        XCTAssertEqual(t.detectedReps, 1)
    }

    func testFindsDiagonalAxis() {
        let axis = RepCore.dominantAxis(trace(axis: [0, 0.7071, 0.7071]))
        XCTAssertEqual(abs(axis[1]), 0.707, accuracy: 0.02)
        XCTAssertEqual(abs(axis[2]), 0.707, accuracy: 0.02)
        XCTAssertLessThan(abs(axis[0]), 0.05)
    }

    func testRefusesWeakAndShortSignals() {
        if case .ok = RepCore.buildTemplate(exerciseId: "x", samples: trace(amp: 0.1), repCount: 1) {
            XCTFail("a tiny signal should not calibrate")
        }
        if case .ok = RepCore.buildTemplate(exerciseId: "x", samples: [RepSample(t: 0, x: 1, y: 0, z: 0)], repCount: 1) {
            XCTFail("one sample should not calibrate")
        }
    }

    func testReportsHowManyRepsItSaw() {
        let result = RepCore.buildTemplate(exerciseId: "0025", samples: trace(reps: 2, gapMs: 250), repCount: 3)
        guard case .failed(let code, let detected) = result else { return XCTFail("should fail") }
        XCTAssertEqual(code, "not_enough_reps")
        XCTAssertEqual(detected, 2)
    }

    func testDetectorCountsCleanReps() {
        let t = template()
        let detector = RepDetector(template: t)
        var reps = 0
        for s in trace(reps: 8, fade: 0.95) where detector.push(s).rep { reps += 1 }
        XCTAssertEqual(reps, 8)
    }

    func testDetectorToleratesFatigue() {
        let t = template((3, 1600, 4, 0.92, [1, 0, 0]))
        let detector = RepDetector(template: t)
        var reps = 0
        for s in trace(reps: 6, amp: 4, fade: 0.92) where detector.push(s).rep { reps += 1 }
        XCTAssertEqual(reps, 6)
    }

    func testDetectorIgnoresOneDirectionalBumps() {
        let t = template()
        let detector = RepDetector(template: t)
        var reps = 0
        var bump: [RepSample] = []
        var now = 1200.0
        for i in 0..<30 { bump.append(RepSample(t: now + Double(i) * step, x: i < 15 ? 9 : 0, y: 0, z: 0)) }
        now += 800
        for i in 0..<30 { bump.append(RepSample(t: now + Double(i) * step, x: 0, y: i < 15 ? 9 : 0, z: 0)) }
        for s in bump where detector.push(s).rep { reps += 1 }
        XCTAssertEqual(reps, 0)
    }

    func testSetEndRemaining() {
        let t = template()
        let d = RepDetector(template: t)
        for s in trace(reps: 1) { _ = d.push(s) }
        XCTAssertEqual(d.setEndRemaining(now: (d.lastRepAt ?? 0) + 4000, timeoutSec: 6), 2)
    }
}
