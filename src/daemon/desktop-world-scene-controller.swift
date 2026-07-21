import Foundation

struct AOSDesktopWorldSceneTopologyDescriptor {
    let identity: AOSDesktopWorldSceneStageIdentity
    let segments: [AOSDesktopWorldSceneStageSegment]
}

struct AOSDesktopWorldSceneDelivery {
    let payload: [String: Any]
    let route: AOSSceneLeaseRoute
}

struct AOSDesktopWorldSceneInvalidationPlan {
    let identityToRetire: AOSDesktopWorldSceneStageIdentity?
    let deliveries: [AOSDesktopWorldSceneDelivery]
}

struct AOSDesktopWorldSceneDisconnectPlan {
    let barrierActions: [AOSDesktopWorldSceneBarrierAction]
    let invalidation: AOSDesktopWorldSceneInvalidationPlan?
}

enum AOSDesktopWorldSceneSubscriptionOutcome {
    case accepted(Set<String>)
    case busy
    case stageUnavailable
}

enum AOSDesktopWorldSceneOperationAdmission {
    case accepted(AOSDesktopWorldSceneBarrierAction)
    case leaseBusy
    case operationPending
    case stageUnavailable
}

/// Owns the complete in-memory lifecycle aggregate for the shared DesktopWorld
/// scene stage. Canvas creation and outbound IPC remain daemon I/O concerns;
/// lease, generation, readiness, subscription, and barrier state live here.
final class AOSDesktopWorldSceneController {
    private let lock = NSLock()
    private let leases = AOSSceneLeaseRegistry()
    private let results = AOSDesktopWorldSceneResultCoordinator()
    private let readiness = AOSDesktopWorldSceneStageReadiness()
    private var operationTokens: [String: AOSSceneLeaseToken] = [:]
    private var retiringIdentity: AOSDesktopWorldSceneStageIdentity?

    func key(owner: String, resource: String) -> String {
        "\(owner)::\(resource)"
    }

    func configureInitial(_ topology: AOSDesktopWorldSceneTopologyDescriptor) -> Bool {
        withLock {
            guard retiringIdentity == nil,
                  readiness.currentIdentity().map({ $0 == topology.identity }) ?? true else {
                return false
            }
            return readiness.configure(identity: topology.identity, segments: topology.segments)
        }
    }

    func recordReady(
        topology: AOSDesktopWorldSceneTopologyDescriptor,
        displayID: UInt32,
        index: Int,
        manifest: [String: Any]
    ) -> Bool {
        withLock {
            guard retiringIdentity == nil,
                  readiness.currentIdentity().map({ $0 == topology.identity }) ?? true,
                  readiness.configure(identity: topology.identity, segments: topology.segments) else {
                return false
            }
            return readiness.record(
                identity: topology.identity,
                displayID: displayID,
                index: index,
                manifest: manifest
            )
        }
    }

    func isReady(_ topology: AOSDesktopWorldSceneTopologyDescriptor) -> Bool {
        withLock {
            retiringIdentity != topology.identity && readiness.isReady(for: topology.identity)
        }
    }

    func topologySettled(
        _ topology: AOSDesktopWorldSceneTopologyDescriptor,
        code: String
    ) -> AOSDesktopWorldSceneInvalidationPlan? {
        withLock {
            guard retiringIdentity == nil else { return nil }
            let previous = readiness.currentIdentity()
            guard readiness.configure(identity: topology.identity, segments: topology.segments) else {
                return nil
            }
            guard let previous, previous != topology.identity,
                  readiness.invalidateIfCurrent(topology.identity) else { return nil }
            return invalidateLocked(identityToRetire: topology.identity, code: code)
        }
    }

    func stageRemoved(code: String) -> AOSDesktopWorldSceneInvalidationPlan? {
        withLock {
            guard let identity = readiness.currentIdentity() else {
                return invalidateOwnershipLocked(code: code)
            }
            guard retiringIdentity != identity else { return nil }
            return invalidateStageLocked(identity: identity, code: code)
        }
    }

    func invalidateOwnership(code: String) -> AOSDesktopWorldSceneInvalidationPlan {
        withLock { invalidateOwnershipLocked(code: code) }
    }

    func invalidateStage(
        identity: AOSDesktopWorldSceneStageIdentity,
        code: String,
        primaryCompletion: AOSDesktopWorldSceneResultCompletion? = nil,
        primaryOperationID: String? = nil
    ) -> AOSDesktopWorldSceneInvalidationPlan? {
        withLock {
            guard readiness.invalidateIfCurrent(identity) else {
                guard let primaryCompletion, let primaryOperationID,
                      let delivery = completeLocked(primaryCompletion, operationID: primaryOperationID) else {
                    return nil
                }
                return AOSDesktopWorldSceneInvalidationPlan(
                    identityToRetire: nil,
                    deliveries: [delivery]
                )
            }
            return invalidateLocked(
                identityToRetire: identity,
                code: code,
                primaryCompletion: primaryCompletion
            )
        }
    }

    func finishRetirement(_ identity: AOSDesktopWorldSceneStageIdentity) {
        withLock {
            guard retiringIdentity == identity else { return }
            readiness.clear()
            retiringIdentity = nil
        }
    }

    func beginDisconnect(
        connectionID: UUID,
        topology: AOSDesktopWorldSceneTopologyDescriptor?
    ) -> AOSDesktopWorldSceneDisconnectPlan {
        withLock {
            var actions: [AOSDesktopWorldSceneBarrierAction] = []
            for token in leases.beginDisconnect(connectionID: connectionID) {
                let leaseKey = token.key
                let cleanup = results.ownerDisconnected(leaseKey: leaseKey)
                if !cleanup.isEmpty || results.hasPending(leaseKey: leaseKey) {
                    actions.append(contentsOf: cleanup)
                    continue
                }
                guard let parts = leaseIdentity(from: leaseKey) else {
                    return AOSDesktopWorldSceneDisconnectPlan(
                        barrierActions: [],
                        invalidation: invalidateOwnershipLocked(code: "SCENE_OWNER_DISCONNECTED")
                    )
                }
                guard let topology else {
                    let invalidation = readiness.currentIdentity().map {
                        invalidateStageLocked(identity: $0, code: "SCENE_OWNER_DISCONNECTED")
                    } ?? invalidateOwnershipLocked(code: "SCENE_OWNER_DISCONNECTED")
                    return AOSDesktopWorldSceneDisconnectPlan(barrierActions: [], invalidation: invalidation)
                }
                guard readiness.isReady(for: topology.identity) else {
                    let identity = readiness.currentIdentity() ?? topology.identity
                    return AOSDesktopWorldSceneDisconnectPlan(
                        barrierActions: [],
                        invalidation: invalidateStageLocked(
                            identity: identity,
                            code: "SCENE_OWNER_DISCONNECTED"
                        )
                    )
                }
                let operationID = UUID().uuidString.lowercased()
                guard let action = results.begin(
                    operationID: operationID,
                    leaseKey: leaseKey,
                    owner: parts.owner,
                    operation: "close",
                    operationPayload: ["op": "close"],
                    resource: parts.resource,
                    canvasGeneration: topology.identity.canvasGeneration,
                    topologyGeneration: topology.identity.topologyGeneration,
                    segments: topology.segments.map { (displayID: $0.displayID, index: $0.index) }
                ), leases.beginOperation(token, allowingClosing: true) else {
                    _ = results.cancel(operationID: operationID)
                    return AOSDesktopWorldSceneDisconnectPlan(
                        barrierActions: [],
                        invalidation: invalidateStageLocked(
                            identity: topology.identity,
                            code: "SCENE_OWNER_DISCONNECTED"
                        )
                    )
                }
                operationTokens[operationID] = token
                actions.append(action)
            }
            return AOSDesktopWorldSceneDisconnectPlan(barrierActions: actions, invalidation: nil)
        }
    }

    func complete(
        _ completion: AOSDesktopWorldSceneResultCompletion,
        operationID: String
    ) -> AOSDesktopWorldSceneDelivery? {
        withLock { completeLocked(completion, operationID: operationID) }
    }

    func acceptResult(
        identity: AOSDesktopWorldSceneStageIdentity,
        payload: [String: Any]
    ) -> [AOSDesktopWorldSceneBarrierAction] {
        withLock {
            guard readiness.isCurrent(identity) else { return [] }
            return results.accept(payload)
        }
    }

    func expire(
        operationID: String,
        phase: AOSDesktopWorldSceneBarrierPhase,
        topologyGeneration: UInt64?
    ) -> [AOSDesktopWorldSceneBarrierAction] {
        withLock {
            results.expire(
                operationID: operationID,
                phase: phase,
                topologyGeneration: topologyGeneration
            )
        }
    }

    func withAuthorizedBroadcast(
        _ broadcast: AOSDesktopWorldSceneBarrierBroadcast,
        topology: AOSDesktopWorldSceneTopologyDescriptor,
        post: () -> Bool
    ) -> Bool {
        withLock {
            guard topology.identity.canvasGeneration == broadcast.canvasGeneration
                && topology.identity.topologyGeneration == broadcast.topologyGeneration
                && retiringIdentity != topology.identity
                && readiness.isReady(for: topology.identity)
                && operationTokens[broadcast.operationID]?.key == broadcast.leaseKey else { return false }
            return post()
        }
    }

    func withEventRoute(
        identity: AOSDesktopWorldSceneStageIdentity,
        key: String,
        event: String,
        deliver: (AOSSceneLeaseRoute) -> Void
    ) {
        withLock {
            guard retiringIdentity != identity,
                  readiness.isReady(for: identity),
                  let route = leases.routeEvent(key: key, event: event) else { return }
            deliver(route)
        }
    }

    func updateSubscriptions(
        key: String,
        connectionID: UUID,
        ref: String?,
        adding: Set<String>,
        removing: Set<String>,
        removeAll: Bool
    ) -> AOSDesktopWorldSceneSubscriptionOutcome {
        withLock {
            guard retiringIdentity == nil else { return .stageUnavailable }
            let acquisition = leases.acquire(key: key, connectionID: connectionID, ref: ref)
            guard case .acquired(let token, let isNewLease) = acquisition else { return .busy }
            let events = leases.updateSubscriptions(
                token: token,
                adding: adding,
                removing: removing,
                removeAll: removeAll
            )
            if events == nil, isNewLease { _ = leases.release(token) }
            guard let events else { return .busy }
            return .accepted(events)
        }
    }

    func admitOperation(
        topology: AOSDesktopWorldSceneTopologyDescriptor,
        key: String,
        owner: String,
        resource: String,
        operationName: String,
        operation: [String: Any],
        connectionID: UUID,
        ref: String?
    ) -> AOSDesktopWorldSceneOperationAdmission {
        withLock {
            guard retiringIdentity != topology.identity,
                  readiness.isReady(for: topology.identity) else { return .stageUnavailable }
            let acquisition = leases.acquire(key: key, connectionID: connectionID, ref: ref)
            guard case .acquired(let token, let isNewLease) = acquisition else { return .leaseBusy }
            let operationID = UUID().uuidString.lowercased()
            let action = results.begin(
                operationID: operationID,
                leaseKey: key,
                owner: owner,
                operation: operationName,
                operationPayload: operation,
                resource: resource,
                canvasGeneration: topology.identity.canvasGeneration,
                topologyGeneration: topology.identity.topologyGeneration,
                segments: topology.segments.map { (displayID: $0.displayID, index: $0.index) }
            )
            let admitted = action != nil && leases.beginOperation(token)
            guard admitted, let action else {
                _ = results.cancel(operationID: operationID)
                if isNewLease { _ = leases.release(token) }
                return results.hasPending(leaseKey: key) ? .operationPending : .stageUnavailable
            }
            operationTokens[operationID] = token
            return .accepted(action)
        }
    }

    private func completeLocked(
        _ completion: AOSDesktopWorldSceneResultCompletion,
        operationID: String
    ) -> AOSDesktopWorldSceneDelivery? {
        let payload = completion.payload
        guard let key = payload["lease_key"] as? String,
              let token = operationTokens.removeValue(forKey: operationID),
              token.key == key else { return nil }
        let releaseLease = payload["operation"] as? String == "close"
            || payload["release_lease"] as? Bool == true
        guard let route = leases.completeOperation(token, releaseLease: releaseLease) else { return nil }
        return AOSDesktopWorldSceneDelivery(payload: payload, route: route)
    }

    private func invalidateStageLocked(
        identity: AOSDesktopWorldSceneStageIdentity,
        code: String
    ) -> AOSDesktopWorldSceneInvalidationPlan {
        if readiness.invalidateIfCurrent(identity) {
            return invalidateLocked(identityToRetire: identity, code: code)
        }
        return invalidateOwnershipLocked(code: code)
    }

    private func invalidateOwnershipLocked(code: String) -> AOSDesktopWorldSceneInvalidationPlan {
        invalidateLocked(identityToRetire: nil, code: code)
    }

    private func invalidateLocked(
        identityToRetire: AOSDesktopWorldSceneStageIdentity?,
        code: String,
        primaryCompletion: AOSDesktopWorldSceneResultCompletion? = nil
    ) -> AOSDesktopWorldSceneInvalidationPlan {
        let invalidated = leases.invalidateAll()
        results.cancelAll()
        operationTokens.removeAll(keepingCapacity: false)
        if let identityToRetire { retiringIdentity = identityToRetire }
        let primaryKey = primaryCompletion?.payload["lease_key"] as? String
        let deliveries = invalidated.map { invalidation -> AOSDesktopWorldSceneDelivery in
            let payload: [String: Any]
            if invalidation.key == primaryKey, let primaryCompletion {
                payload = primaryCompletion.payload
            } else {
                payload = [
                    "lease_key": invalidation.key,
                    "operation": "release",
                    "resource": resource(from: invalidation.key),
                    "status": "error",
                    "code": code,
                ]
            }
            return AOSDesktopWorldSceneDelivery(payload: payload, route: invalidation.route)
        }
        return AOSDesktopWorldSceneInvalidationPlan(
            identityToRetire: identityToRetire,
            deliveries: deliveries
        )
    }

    private func resource(from leaseKey: String) -> String {
        leaseKey.split(separator: "::", maxSplits: 1, omittingEmptySubsequences: false)
            .last.map(String.init) ?? leaseKey
    }

    private func leaseIdentity(from leaseKey: String) -> (owner: String, resource: String)? {
        let parts = leaseKey.split(separator: "::", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else { return nil }
        return (String(parts[0]), String(parts[1]))
    }

    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}
