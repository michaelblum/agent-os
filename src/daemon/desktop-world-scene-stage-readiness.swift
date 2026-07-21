import Foundation

struct AOSDesktopWorldSceneStageIdentity: Hashable {
    let canvasGeneration: UInt64
    let topologyGeneration: UInt64

    init(canvasGeneration: UInt64, topologyGeneration: UInt64) {
        precondition(canvasGeneration > 0, "DesktopWorld stage canvas generation must be positive")
        self.canvasGeneration = canvasGeneration
        self.topologyGeneration = topologyGeneration
    }
}

struct AOSDesktopWorldSceneStageSegment: Equatable {
    let displayID: UInt32
    let index: Int
}

/// Tracks readiness for one exact native DesktopWorld stage generation.
/// A stage is usable only after every current display segment reports ready.
final class AOSDesktopWorldSceneStageReadiness {
    private struct State {
        let identity: AOSDesktopWorldSceneStageIdentity
        let expected: [UInt32: Int]
        var manifests: [UInt32: [String: Any]]
        var invalidated: Bool
    }

    private let lock = NSLock()
    private var state: State?

    @discardableResult
    func configure(
        identity: AOSDesktopWorldSceneStageIdentity,
        segments: [AOSDesktopWorldSceneStageSegment]
    ) -> Bool {
        guard !segments.isEmpty, segments.count <= 32 else { return false }
        var expected: [UInt32: Int] = [:]
        for segment in segments {
            guard segment.index >= 0,
                  segment.index < 32,
                  expected[segment.displayID] == nil else { return false }
            expected[segment.displayID] = segment.index
        }
        guard expected.values.filter({ $0 == 0 }).count == 1 else { return false }

        lock.lock()
        defer { lock.unlock() }
        if let current = state,
           current.identity == identity,
           current.expected == expected {
            return !current.invalidated
        }
        state = State(
            identity: identity,
            expected: expected,
            manifests: [:],
            invalidated: false
        )
        return true
    }

    @discardableResult
    func record(
        identity: AOSDesktopWorldSceneStageIdentity,
        displayID: UInt32,
        index: Int,
        manifest: [String: Any]
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard var current = state,
              current.identity == identity,
              !current.invalidated,
              current.expected[displayID] == index,
              manifest["name"] as? String == "desktop-world-stage" else { return false }
        current.manifests[displayID] = manifest
        state = current
        return current.manifests.count == current.expected.count
    }

    func readyManifest(for identity: AOSDesktopWorldSceneStageIdentity) -> [String: Any]? {
        lock.lock()
        defer { lock.unlock() }
        guard let current = state,
              current.identity == identity,
              !current.invalidated,
              current.manifests.count == current.expected.count,
              let primaryID = current.expected.first(where: { $0.value == 0 })?.key else { return nil }
        return current.manifests[primaryID]
    }

    func isReady(for identity: AOSDesktopWorldSceneStageIdentity) -> Bool {
        readyManifest(for: identity) != nil
    }

    func isCurrent(_ identity: AOSDesktopWorldSceneStageIdentity) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return state?.identity == identity
    }

    func currentIdentity() -> AOSDesktopWorldSceneStageIdentity? {
        lock.lock()
        defer { lock.unlock() }
        return state?.identity
    }

    @discardableResult
    func invalidateIfCurrent(_ identity: AOSDesktopWorldSceneStageIdentity) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard var current = state,
              current.identity == identity,
              !current.invalidated else { return false }
        current.invalidated = true
        current.manifests.removeAll(keepingCapacity: false)
        state = current
        return true
    }

    func clear() {
        lock.lock()
        state = nil
        lock.unlock()
    }
}
