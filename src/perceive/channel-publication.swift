import CoreGraphics
import Foundation

let aosMaximumChannelTraversalDepth = 15

func aosChannelTraversalDepthIsValid(_ depth: Int) -> Bool {
    (0...aosMaximumChannelTraversalDepth).contains(depth)
}

struct AOSChannelWindowObservation: Equatable {
    let pid: Int
    let bounds: CGRect
    let display: Int
    let scaleFactor: Double

    init(pid: Int, bounds: CGRect, display: Int, scaleFactor: Double) {
        self.pid = pid
        self.bounds = bounds.integral
        self.display = display
        self.scaleFactor = scaleFactor
    }
}

func aosChannelWindowObservationIsStable(
    before: AOSChannelWindowObservation,
    after: AOSChannelWindowObservation,
    expectedPID: Int
) -> Bool {
    before.pid == expectedPID
        && after.pid == expectedPID
        && before.bounds == after.bounds
        && before.display == after.display
        && before.scaleFactor == after.scaleFactor
}

func aosChannelPublicationIdentityIsCurrent(
    currentInstanceID: UUID,
    currentRevision: UInt64,
    expectedInstanceID: UUID,
    expectedRevision: UInt64
) -> Bool {
    currentInstanceID == expectedInstanceID
        && currentRevision == expectedRevision
}

/// Serializes only the short focus-channel commit/removal section: revision
/// CAS, atomic file work, memory publication, and callbacks. CG/AX preparation
/// must remain outside this lock so one app cannot block unrelated channels.
final class AOSChannelPublicationSerializer {
    private let lock = NSRecursiveLock()

    func sync<Result>(_ operation: () throws -> Result) rethrows -> Result {
        lock.lock()
        defer { lock.unlock() }
        return try operation()
    }
}
