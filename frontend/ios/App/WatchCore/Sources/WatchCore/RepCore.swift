import Foundation

/*
 * The watch's own motion rep counting. The phone has the same rules in
 * frontend/src/lib/rep-core.js; the two are kept in step by the same synthetic test cases. A
 * template is per exercise and is stored on the watch, because the wrist has a different movement
 * axis from a phone in a pocket.
 *
 * CoreMotion reports userAcceleration in g. Watch motion converts to m/s² before creating a
 * RepSample, so this file only ever sees m/s².
 */

public struct RepSample: Codable, Equatable {
    public var t: Double
    public var x: Double
    public var y: Double
    public var z: Double

    public init(t: Double, x: Double, y: Double, z: Double) {
        self.t = t; self.x = x; self.y = y; self.z = z
    }
}

public enum RepPhaseOrder: String, Codable, Equatable {
    case positiveFirst = "positive_first"
    case negativeFirst = "negative_first"
}

public struct RepTemplate: Codable, Equatable {
    public var v: Int
    public var exerciseId: String
    public var source: String
    public var createdAt: Double
    public var reps: Int
    public var detectedReps: Int
    public var sampleCount: Int
    public var durationMs: Double
    public var axis: [Double]
    public var pMax: Double
    public var pMin: Double
    public var phaseOrder: RepPhaseOrder
    public var noiseFloor: Double
    public var neutralThreshold: Double
    public var minRepMs: Double
    public var maxRepMs: Double
    public var alpha: Double
    public var normalizedCurve: [Double]
    public var peakToPeak: Double
}

public enum RepCalibrationOutcome: Equatable {
    case ok(RepTemplate)
    case failed(code: String, detectedReps: Int?)
}

public struct RepDetection: Equatable {
    public var count: Int
    public var rep: Bool
    public var phase: String
    public var durationMs: Double?
    public var value: Double
}

public enum RepCore {
    public static let templateVersion = 1
    public static let defaultAlpha = 0.2
    public static let defaultTolerance = 0.62
    public static let defaultSetEndSec = 6.0
    public static let minSamples = 18
    public static let minDurationMs = 350.0
    public static let minPeakToPeak = 0.8
    public static let maxTemplateMs = 10 * 60 * 1000.0

    private static func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    private static func median(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        let a = values.sorted()
        let mid = a.count / 2
        return a.count % 2 == 1 ? a[mid] : (a[mid - 1] + a[mid]) / 2
    }

    public static func normalized(_ samples: [RepSample]) -> [RepSample] {
        samples
            .filter { $0.t.isFinite && $0.x.isFinite && $0.y.isFinite && $0.z.isFinite }
            .sorted { $0.t < $1.t }
    }

    public static func magnitude(_ s: RepSample) -> Double {
        (s.x * s.x + s.y * s.y + s.z * s.z).squareRoot()
    }

    /// The dominant movement axis, as a unit vector.
    public static func dominantAxis(_ samples: [RepSample]) -> [Double] {
        let s = normalized(samples)
        guard s.count >= 5 else { return [0, 0, 1] }
        var mx = 0.0, my = 0.0, mz = 0.0
        for p in s { mx += p.x; my += p.y; mz += p.z }
        mx /= Double(s.count); my /= Double(s.count); mz /= Double(s.count)
        var cxx = 0.0, cyy = 0.0, czz = 0.0, cxy = 0.0, cxz = 0.0, cyz = 0.0
        for p in s {
            let dx = p.x - mx, dy = p.y - my, dz = p.z - mz
            cxx += dx * dx; cyy += dy * dy; czz += dz * dz
            cxy += dx * dy; cxz += dx * dz; cyz += dy * dz
        }
        let n = Double(s.count)
        cxx /= n; cyy /= n; czz /= n; cxy /= n; cxz /= n; cyz /= n
        var vx = 1.0, vy = 1.0, vz = 1.0
        let initial = (vx * vx + vy * vy + vz * vz).squareRoot()
        vx /= initial; vy /= initial; vz /= initial
        for _ in 0..<24 {
            let nx = cxx * vx + cxy * vy + cxz * vz
            let ny = cxy * vx + cyy * vy + cyz * vz
            let nz = cxz * vx + cyz * vy + czz * vz
            let mag = (nx * nx + ny * ny + nz * nz).squareRoot()
            if mag < 1e-9 { break }
            vx = nx / mag; vy = ny / mag; vz = nz / mag
        }
        return [vx, vy, vz]
    }

    public static func project(_ sample: RepSample, axis: [Double]) -> Double {
        sample.x * axis[0] + sample.y * axis[1] + sample.z * axis[2]
    }

    public static func smoothed(_ values: [Double], alpha: Double = defaultAlpha) -> [Double] {
        guard !values.isEmpty else { return [] }
        let a = min(0.8, max(0.01, alpha))
        var out = [values[0]]
        for i in 1..<values.count { out.append(a * values[i] + (1 - a) * out[i - 1]) }
        return out
    }

    public static func resample(_ values: [Double], points: Int = 50) -> [Double] {
        guard !values.isEmpty else { return Array(repeating: 0, count: points) }
        if values.count == 1 { return Array(repeating: round2(values[0]), count: points) }
        var out: [Double] = []
        let step = Double(values.count - 1) / Double(points - 1)
        for i in 0..<points {
            let at = Double(i) * step
            let lo = Int(at.rounded(.down))
            let hi = min(lo + 1, values.count - 1)
            let f = at - Double(lo)
            out.append(round2(values[lo] + (values[hi] - values[lo]) * f))
        }
        return out
    }

    private struct Peak {
        var i: Int
        var v: Double
    }

    private static func peaks(_ values: [Double], minAbs: Double) -> [Peak] {
        var found: [Peak] = []
        guard values.count >= 3 else { return found }
        for i in 1..<(values.count - 1) {
            let v = values[i]
            guard abs(v) >= minAbs else { continue }
            let prev = values[i - 1], next = values[i + 1]
            if (v > 0 && v >= prev && v >= next) || (v < 0 && v <= prev && v <= next) {
                found.append(Peak(i: i, v: v))
            }
        }
        var out: [Peak] = []
        for p in found {
            if let last = out.last, (last.v > 0) == (p.v > 0) {
                if abs(p.v) > abs(last.v) { out[out.count - 1] = p }
            } else { out.append(p) }
        }
        return out
    }

    private static func firstLastAbove(_ values: [Double], threshold: Double) -> (Int, Int) {
        var first = -1, last = -1
        for (i, v) in values.enumerated() where abs(v) >= threshold {
            if first < 0 { first = i }
            last = i
        }
        return (first, last)
    }

    /**
     * Turn one or three clean repetitions into a template. Returns a failure code rather than
     * throwing so the watch UI can explain what went wrong.
     */
    public static func buildTemplate(exerciseId: String,
                                     samples: [RepSample],
                                     repCount: Int = 1,
                                     alpha: Double = defaultAlpha,
                                     now: Double = Date().timeIntervalSince1970 * 1000) -> RepCalibrationOutcome {
        let all = normalized(samples)
        let wanted = repCount == 3 ? 3 : 1
        guard !exerciseId.isEmpty else { return .failed(code: "missing_exercise", detectedReps: nil) }
        guard all.count >= minSamples else { return .failed(code: "too_short", detectedReps: nil) }
        guard let firstT = all.first?.t, let lastT = all.last?.t else {
            return .failed(code: "too_short", detectedReps: nil)
        }
        let span = lastT - firstT
        guard span >= minDurationMs else { return .failed(code: "too_short", detectedReps: nil) }
        guard span <= maxTemplateMs else { return .failed(code: "too_long", detectedReps: nil) }
        let axis = dominantAxis(all)
        let raw = all.map { project($0, axis: axis) }
        let smooth = smoothed(raw, alpha: alpha)
        let absSorted = smooth.map(abs).sorted()
        let quietCount = max(3, Int(Double(absSorted.count) * 0.2))
        let noise = max(median(Array(absSorted.prefix(quietCount))), 0.04)
        let significant = max(0.55, noise * 3)
        let (first, last) = firstLastAbove(smooth, threshold: significant)
        guard first >= 0, last > first else { return .failed(code: "too_weak", detectedReps: nil) }
        let pad = max(2, Int(Double(last - first) * 0.04))
        let from = max(0, first - pad)
        let to = min(smooth.count - 1, last + pad)
        let trimmed = Array(smooth[from...to])
        let times = all[from...to].map(\.t)
        guard let globalMax = trimmed.map(abs).max(), globalMax >= 0.45 else {
            return .failed(code: "too_weak", detectedReps: nil)
        }
        let p = peaks(trimmed, minAbs: max(significant, globalMax * 0.28))
        let positives = p.filter { $0.v > 0 }
        let negatives = p.filter { $0.v < 0 }
        guard !positives.isEmpty, !negatives.isEmpty else { return .failed(code: "one_direction", detectedReps: nil) }
        guard let firstPeak = p.first, p.contains(where: { ($0.v > 0) != (firstPeak.v > 0) }) else {
            return .failed(code: "one_direction", detectedReps: nil)
        }
        let order: RepPhaseOrder = firstPeak.v > 0 ? .positiveFirst : .negativeFirst
        let detected = min(positives.count, negatives.count)
        if wanted > 1 && detected < wanted {
            return .failed(code: "not_enough_reps", detectedReps: max(1, detected))
        }
        let sameSign = order == .positiveFirst ? positives : negatives
        var halfGaps: [Double] = []
        if p.count > 1 {
            for i in 1..<p.count where (p[i].v > 0) != (p[i - 1].v > 0) {
                halfGaps.append(times[p[i].i] - times[p[i - 1].i])
            }
        }
        var duration = halfGaps.isEmpty ? (times.last! - times.first!) : median(halfGaps) * 2
        duration = max(minDurationMs, duration.rounded())
        let pMax = median(positives.map(\.v))
        let pMin = median(negatives.map(\.v))
        guard pMax - pMin >= minPeakToPeak else { return .failed(code: "too_weak", detectedReps: nil) }
        let neutral = max(0.22 * min(abs(pMax), abs(pMin)), 2.5 * noise, 0.25)
        let cycleStart = firstPeak.i
        let nextSame = sameSign.first { $0.i > cycleStart }
        let cycle = nextSame.map { Array(trimmed[cycleStart...$0.i]) } ?? trimmed
        let template = RepTemplate(
            v: templateVersion,
            exerciseId: exerciseId,
            source: "watch",
            createdAt: now,
            reps: wanted,
            detectedReps: detected,
            sampleCount: to - from + 1,
            durationMs: duration,
            axis: axis.map { ($0 * 1000).rounded() / 1000 },
            pMax: round2(pMax),
            pMin: round2(pMin),
            phaseOrder: order,
            noiseFloor: round2(noise),
            neutralThreshold: round2(neutral),
            minRepMs: max(350, (duration * 0.45).rounded()),
            maxRepMs: max(5000, (duration * 3).rounded()),
            alpha: min(0.5, max(0.05, alpha)),
            normalizedCurve: resample(cycle),
            peakToPeak: round2(pMax - pMin)
        )
        return .ok(template)
    }

    public static func valid(_ t: RepTemplate) -> Bool {
        t.v == templateVersion && t.axis.count == 3 && t.axis.allSatisfy { $0.isFinite } &&
            t.pMax.isFinite && t.pMin.isFinite && abs(t.pMax) > 0.01 && abs(t.pMin) > 0.01 &&
            t.durationMs.isFinite && t.neutralThreshold.isFinite
    }
}

/** The live state machine, the Swift twin of createRepDetector in rep-core.js. */
public final class RepDetector {
    public let template: RepTemplate
    private let tolerance: Double
    private var phase = "idle"
    private var startAt = 0.0
    private var lastT: Double?
    private var smooth = 0.0
    private var started = false
    private var count = 0
    public private(set) var lastRepAt: Double?
    public private(set) var lastDurationMs: Double?

    public init(template: RepTemplate, tolerance: Double = RepCore.defaultTolerance) {
        self.template = template
        self.tolerance = min(0.95, max(0.3, tolerance))
    }

    public func reset() {
        phase = "idle"; startAt = 0; lastT = nil; smooth = 0; started = false
        count = 0; lastRepAt = nil; lastDurationMs = nil
    }

    @discardableResult
    public func push(_ sample: RepSample) -> RepDetection {
        guard sample.t.isFinite else { return detection(rep: false) }
        if let last = lastT, sample.t < last { return detection(rep: false) }
        lastT = sample.t
        let value = RepCore.project(sample, axis: template.axis)
        smooth = started ? template.alpha * value + (1 - template.alpha) * smooth : value
        started = true
        if phase != "idle" && sample.t - startAt > template.maxRepMs { phase = "idle"; startAt = 0 }

        let pos = template.pMax * tolerance
        let neg = template.pMin * tolerance
        var rep = false
        if template.phaseOrder == .positiveFirst {
            if phase == "idle" && smooth >= pos { phase = "first"; startAt = sample.t }
            else if phase == "first" && smooth <= neg { phase = "second" }
            else if phase == "second" && abs(smooth) <= template.neutralThreshold {
                rep = complete(sample.t)
            }
        } else {
            if phase == "idle" && smooth <= neg { phase = "first"; startAt = sample.t }
            else if phase == "first" && smooth >= pos { phase = "second" }
            else if phase == "second" && abs(smooth) <= template.neutralThreshold {
                rep = complete(sample.t)
            }
        }
        return detection(rep: rep)
    }

    private func complete(_ t: Double) -> Bool {
        let duration = t - startAt
        guard duration >= template.minRepMs else { phase = "idle"; startAt = 0; return false }
        count += 1
        lastRepAt = t
        lastDurationMs = duration
        phase = "idle"; startAt = 0
        return true
    }

    private func detection(rep: Bool) -> RepDetection {
        RepDetection(count: count, rep: rep, phase: phase, durationMs: rep ? lastDurationMs : nil, value: smooth)
    }

    public func setEndRemaining(now: Double, timeoutSec: Double = RepCore.defaultSetEndSec) -> Double {
        guard let last = lastRepAt else { return timeoutSec }
        return max(0, (timeoutSec - (now - last) / 1000).rounded(.up))
    }
}
