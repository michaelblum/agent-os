import Foundation

final class AOSDesktopWorldSceneEventRouteDiagnostics {
    private static let maximumCount = 1_000_000_000
    private let lock = NSLock()
    private let now: () -> Double
    private var counts: [AOSDesktopWorldSceneEventRouteOutcome: Int] = [:]
    private var lastFailure: (outcome: AOSDesktopWorldSceneEventRouteOutcome, at: Double)?

    init(now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1_000 }) {
        self.now = now
    }

    func record(_ outcome: AOSDesktopWorldSceneEventRouteOutcome) {
        lock.lock()
        let failureAt = outcome == .enqueued ? nil : now()
        counts[outcome] = min(
            counts[outcome, default: 0] + 1,
            Self.maximumCount
        )
        if let failureAt {
            lastFailure = (outcome: outcome, at: failureAt)
        }
        lock.unlock()
    }

    func snapshot() -> [String: Any] {
        lock.lock()
        let currentCounts = counts
        let currentLastFailure = lastFailure
        lock.unlock()

        var byOutcome: [String: Int] = [:]
        for outcome in AOSDesktopWorldSceneEventRouteOutcome.allCases {
            byOutcome[outcome.rawValue] = currentCounts[outcome] ?? 0
        }
        let total = byOutcome.values.reduce(0, +)
        let enqueued = byOutcome[AOSDesktopWorldSceneEventRouteOutcome.enqueued.rawValue] ?? 0
        let lastFailureValue: Any = currentLastFailure.map {
            ["at": $0.at, "code": $0.outcome.rawValue] as [String: Any]
        } ?? NSNull()
        return [
            "contract": "aos.desktop-world.scene-event-routing.v1",
            "total": total,
            "failures": total - enqueued,
            "by_outcome": byOutcome,
            "last_failure": lastFailureValue,
        ]
    }
}

final class AOSDesktopWorldSceneEventRouter {
    private let scene: AOSDesktopWorldSceneController
    private let emit: (AOSSceneLeaseRoute, String, [String: Any]) -> Bool
    private let diagnostics: AOSDesktopWorldSceneEventRouteDiagnostics

    init(
        scene: AOSDesktopWorldSceneController,
        diagnostics: AOSDesktopWorldSceneEventRouteDiagnostics = AOSDesktopWorldSceneEventRouteDiagnostics(),
        emit: @escaping (AOSSceneLeaseRoute, String, [String: Any]) -> Bool
    ) {
        self.scene = scene
        self.diagnostics = diagnostics
        self.emit = emit
    }

    func record(_ outcome: AOSDesktopWorldSceneEventRouteOutcome) {
        diagnostics.record(outcome)
    }

    func handle(
        identity: AOSDesktopWorldSceneStageIdentity,
        payload: [String: Any]
    ) {
        guard let key = payload["lease_key"] as? String,
              let eventType = payload["event_type"] as? String,
              let event = payload["event"] as? [String: Any],
              let canonicalEvent = aosCanonicalSceneEvent(event),
              eventType == "gesture",
              canonicalEvent["type"] as? String == eventType else {
            diagnostics.record(.invalidEvent)
            return
        }
        guard let ownerID = canonicalEvent["ownerId"] as? String,
              let resourceID = canonicalEvent["resourceId"] as? String,
              scene.key(owner: ownerID, resource: resourceID) == key else {
            diagnostics.record(.identityMismatch)
            return
        }
        diagnostics.record(scene.withEventRoute(identity: identity, key: key, event: eventType) { route in
            emit(route, eventType, canonicalEvent)
        })
    }

    func snapshot() -> [String: Any] {
        diagnostics.snapshot()
    }
}
