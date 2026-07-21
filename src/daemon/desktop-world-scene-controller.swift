import Foundation

enum AOSDesktopWorldSceneEventRouteOutcome: String, CaseIterable {
    case enqueued
    case enqueueFailed = "enqueue_failed"
    case identityMismatch = "identity_mismatch"
    case invalidEvent = "invalid_event"
    case stageUnavailable = "stage_unavailable"
    case staleTopology = "stale_topology"
    case unsubscribed
}

struct AOSDesktopWorldSceneTopologyDescriptor {
    let identity: AOSDesktopWorldSceneStageIdentity
    let segments: [AOSDesktopWorldSceneStageSegment]
}

struct AOSDesktopWorldSceneDelivery {
    let payload: [String: Any]
    let route: AOSSceneLeaseRoute
}

enum AOSDesktopWorldSceneStageRetirementOutcome {
    case retired
    case alreadyAbsent
    case superseded
    case failed
}

struct AOSDesktopWorldSceneRetirementRequest: Equatable {
    let token: UInt64
    let identity: AOSDesktopWorldSceneStageIdentity
}

enum AOSDesktopWorldSceneInvalidationPlan {
    case deliver([AOSDesktopWorldSceneDelivery])
    case retire(AOSDesktopWorldSceneRetirementRequest)
}

enum AOSDesktopWorldSceneRetirementResolution {
    case stale
    case recoverable([AOSDesktopWorldSceneDelivery])
    case terminal([AOSDesktopWorldSceneDelivery])
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
    private var blockedIdentity: AOSDesktopWorldSceneStageIdentity?
    private var nextRetirementToken: UInt64 = 0
    private var retirement: (
        request: AOSDesktopWorldSceneRetirementRequest,
        deliveries: [AOSDesktopWorldSceneDelivery]
    )?

    func key(owner: String, resource: String) -> String {
        "\(owner)::\(resource)"
    }

    func configureInitial(_ topology: AOSDesktopWorldSceneTopologyDescriptor) -> Bool {
        withLock {
            guard topologyIdentityAllowedLocked(topology.identity),
                  readiness.currentIdentity().map({ $0 == topology.identity }) ?? true,
                  readiness.configure(identity: topology.identity, segments: topology.segments) else {
                return false
            }
            clearBlockedIdentityForSuccessorLocked(topology.identity)
            return true
        }
    }

    func recordReady(
        topology: AOSDesktopWorldSceneTopologyDescriptor,
        displayID: UInt32,
        index: Int,
        manifest: [String: Any]
    ) -> Bool {
        withLock {
            guard topologyIdentityAllowedLocked(topology.identity),
                  readiness.currentIdentity().map({ $0 == topology.identity }) ?? true,
                  readiness.configure(identity: topology.identity, segments: topology.segments) else {
                return false
            }
            clearBlockedIdentityForSuccessorLocked(topology.identity)
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
            retirement == nil && readiness.isReady(for: topology.identity)
        }
    }

    func topologySettled(
        _ topology: AOSDesktopWorldSceneTopologyDescriptor,
        code: String
    ) -> AOSDesktopWorldSceneInvalidationPlan? {
        withLock {
            guard topologyIdentityAllowedLocked(topology.identity) else { return nil }
            if retirement != nil {
                guard readiness.configure(identity: topology.identity, segments: topology.segments) else { return nil }
                clearBlockedIdentityForSuccessorLocked(topology.identity)
                return nil
            }
            let previous = readiness.currentIdentity()
            guard readiness.configure(identity: topology.identity, segments: topology.segments) else {
                return nil
            }
            clearBlockedIdentityForSuccessorLocked(topology.identity)
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
            guard retirement?.request.identity != identity else { return nil }
            return invalidateStageLocked(identity: identity, code: code)
        }
    }

    func invalidateOwnership(code: String) -> AOSDesktopWorldSceneInvalidationPlan? {
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
                return planDeliveriesLocked([delivery])
            }
            return invalidateLocked(
                identityToRetire: identity,
                code: code,
                primaryCompletion: primaryCompletion
            )
        }
    }

    func settleRetirement(
        _ request: AOSDesktopWorldSceneRetirementRequest,
        outcome: AOSDesktopWorldSceneStageRetirementOutcome
    ) -> AOSDesktopWorldSceneRetirementResolution {
        withLock {
            guard let pending = retirement, pending.request == request else { return .stale }
            retirement = nil
            if readiness.currentIdentity() == request.identity { readiness.clear() }
            switch outcome {
            case .retired, .alreadyAbsent, .superseded:
                return .recoverable(pending.deliveries)
            case .failed:
                blockedIdentity = request.identity
                let deliveries = pending.deliveries.map { delivery in
                    var payload = delivery.payload
                    payload["status"] = "error"
                    payload["code"] = "SCENE_STAGE_RETIRE_FAILED"
                    return AOSDesktopWorldSceneDelivery(payload: payload, route: delivery.route)
                }
                return .terminal(deliveries)
            }
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
                && retirement == nil
                && readiness.isReady(for: topology.identity)
                && operationTokens[broadcast.operationID]?.key == broadcast.leaseKey else { return false }
            return post()
        }
    }

    func withEventRoute(
        identity: AOSDesktopWorldSceneStageIdentity,
        key: String,
        event: String,
        enqueue: (AOSSceneLeaseRoute) -> Bool
    ) -> AOSDesktopWorldSceneEventRouteOutcome {
        withLock {
            guard retirement == nil,
                  readiness.isReady(for: identity) else { return .stageUnavailable }
            guard let route = leases.routeEvent(key: key, event: event) else { return .unsubscribed }
            return enqueue(route) ? .enqueued : .enqueueFailed
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
            guard retirement == nil else { return .stageUnavailable }
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
            guard retirement == nil,
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
    ) -> AOSDesktopWorldSceneInvalidationPlan? {
        if readiness.invalidateIfCurrent(identity) {
            return invalidateLocked(identityToRetire: identity, code: code)
        }
        return invalidateOwnershipLocked(code: code)
    }

    private func invalidateOwnershipLocked(code: String) -> AOSDesktopWorldSceneInvalidationPlan? {
        invalidateLocked(identityToRetire: nil, code: code)
    }

    private func invalidateLocked(
        identityToRetire: AOSDesktopWorldSceneStageIdentity?,
        code: String,
        primaryCompletion: AOSDesktopWorldSceneResultCompletion? = nil
    ) -> AOSDesktopWorldSceneInvalidationPlan? {
        let invalidated = leases.invalidateAll()
        results.cancelAll()
        operationTokens.removeAll(keepingCapacity: false)
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
        if let identityToRetire {
            nextRetirementToken &+= 1
            let request = AOSDesktopWorldSceneRetirementRequest(
                token: nextRetirementToken,
                identity: identityToRetire
            )
            let retained = retirement?.deliveries ?? []
            retirement = (request: request, deliveries: retained + deliveries)
            return .retire(request)
        }
        return planDeliveriesLocked(deliveries)
    }

    private func planDeliveriesLocked(
        _ deliveries: [AOSDesktopWorldSceneDelivery]
    ) -> AOSDesktopWorldSceneInvalidationPlan? {
        guard !deliveries.isEmpty else { return nil }
        if var pending = retirement {
            pending.deliveries.append(contentsOf: deliveries)
            retirement = pending
            return nil
        }
        return .deliver(deliveries)
    }

    private func topologyIdentityAllowedLocked(_ identity: AOSDesktopWorldSceneStageIdentity) -> Bool {
        blockedIdentity != identity && retirement?.request.identity != identity
    }

    private func clearBlockedIdentityForSuccessorLocked(_ identity: AOSDesktopWorldSceneStageIdentity) {
        if blockedIdentity != nil, blockedIdentity != identity { blockedIdentity = nil }
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
