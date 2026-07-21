import Foundation

struct AOSDesktopWorldSceneFollowResponse {
    let payload: [String: Any]
}

/// Owns DesktopWorld scene transport orchestration. The scene controller owns
/// canonical lifecycle state; this boundary coordinates canvas I/O, extension
/// admission, result delivery, and the single bounded readiness wait.
final class AOSDesktopWorldSceneTransportController {
    static let stageCanvasID = "aos-desktop-world-stage"

    private let canvasManager: CanvasManager
    private let scene: AOSDesktopWorldSceneController
    private let extensionStore: AOSSceneExtensionStore
    private let resolveContentURL: (String) -> String
    private let clearReadyManifest: () -> Void
    private let emit: (AOSSceneLeaseRoute, String, [String: Any]) -> Bool
    private let eventRouter: AOSDesktopWorldSceneEventRouter

    init(
        canvasManager: CanvasManager,
        scene: AOSDesktopWorldSceneController = AOSDesktopWorldSceneController(),
        extensionStore: AOSSceneExtensionStore,
        eventDiagnostics: AOSDesktopWorldSceneEventRouteDiagnostics = AOSDesktopWorldSceneEventRouteDiagnostics(),
        resolveContentURL: @escaping (String) -> String,
        clearReadyManifest: @escaping () -> Void,
        emit: @escaping (AOSSceneLeaseRoute, String, [String: Any]) -> Bool
    ) {
        self.canvasManager = canvasManager
        self.scene = scene
        self.extensionStore = extensionStore
        self.resolveContentURL = resolveContentURL
        self.clearReadyManifest = clearReadyManifest
        self.emit = emit
        self.eventRouter = AOSDesktopWorldSceneEventRouter(
            scene: scene,
            diagnostics: eventDiagnostics,
            emit: emit
        )
    }

    func recordReady(
        target: CanvasLifecycleGeneration,
        payload: [String: Any]
    ) -> [String: Any]? {
        guard target.canvasID == Self.stageCanvasID,
              let canvasGeneration = (payload["canvas_generation"] as? NSNumber)?.uint64Value,
              canvasGeneration == target.value,
              let topologyGeneration = (payload["topology_generation"] as? NSNumber)?.uint64Value,
              let displayIDValue = (payload["segment_display_id"] as? NSNumber)?.uint64Value,
              displayIDValue <= UInt64(UInt32.max),
              let segmentIndex = (payload["segment_index"] as? NSNumber)?.intValue,
              let topology = canvasManager.desktopWorldSceneBarrierTopology(canvasID: Self.stageCanvasID),
              topology.canvasGeneration == canvasGeneration,
              topology.generation == topologyGeneration else { return nil }
        let descriptor = topologyDescriptor(topology)
        var publicManifest = payload
        publicManifest.removeValue(forKey: "canvas_generation")
        publicManifest.removeValue(forKey: "topology_generation")
        publicManifest.removeValue(forKey: "segment_display_id")
        publicManifest.removeValue(forKey: "segment_index")
        guard scene.recordReady(
            topology: descriptor,
            displayID: UInt32(displayIDValue),
            index: segmentIndex,
            manifest: publicManifest
        ) else { return nil }
        return publicManifest
    }

    func cleanupConnection(_ connectionID: UUID) {
        let topology = canvasManager.desktopWorldSceneBarrierTopology(canvasID: Self.stageCanvasID)
        let plan = scene.beginDisconnect(
            connectionID: connectionID,
            topology: topology.map(topologyDescriptor)
        )
        if let invalidation = plan.invalidation {
            finishInvalidation(invalidation)
            return
        }
        dispatch(plan.barrierActions)
    }

    func validResourceIdentifier(_ value: String) -> Bool {
        validIdentifier(value, allowSlash: true)
    }

    func stageRemoved() {
        guard let invalidation = scene.stageRemoved(code: "SCENE_STAGE_REMOVED") else { return }
        finishInvalidation(invalidation)
    }

    func topologySettled(_ payload: [String: Any]) {
        guard let canvasGeneration = (payload["canvas_generation"] as? NSNumber)?.uint64Value,
              canvasGeneration > 0,
              let topologyGeneration = (payload["topology_generation"] as? NSNumber)?.uint64Value,
              let topology = canvasManager.desktopWorldSceneBarrierTopology(canvasID: Self.stageCanvasID),
              topology.canvasGeneration == canvasGeneration,
              topology.generation == topologyGeneration,
              let invalidation = scene.topologySettled(
                topologyDescriptor(topology),
                code: "SCENE_TOPOLOGY_CHANGED"
              ) else { return }
        finishInvalidation(invalidation)
    }

    func handleResult(target: CanvasLifecycleGeneration, payload: [String: Any]) {
        guard let topology = authenticatedTopology(target: target, payload: payload),
              let operationID = payload["operation_id"] as? String else { return }
        dispatch(
            scene.acceptResult(identity: stageIdentity(topology), payload: payload),
            operationID: operationID
        )
    }

    func handleFault(target: CanvasLifecycleGeneration, payload: [String: Any]) {
        guard let topology = authenticatedTopology(target: target, payload: payload) else { return }
        invalidateStage(
            identity: stageIdentity(topology),
            code: aosCanonicalDesktopWorldSceneResultErrorCode(
                payload["code"],
                fallback: "SCENE_SEGMENT_FAILED"
            )
        )
    }

    func handleEvent(target: CanvasLifecycleGeneration, payload: [String: Any]) {
        guard let topology = authenticatedTopology(target: target, payload: payload) else {
            eventRouter.record(.staleTopology)
            return
        }
        eventRouter.handle(identity: stageIdentity(topology), payload: payload)
    }

    func ensureStage() -> DesktopWorldSceneBarrierTopology? {
        let semaphore = DispatchSemaphore(value: 0)
        var topology: DesktopWorldSceneBarrierTopology?
        DispatchQueue.main.async { [weak self] in
            guard let self else { semaphore.signal(); return }
            if !self.canvasManager.hasCanvas(Self.stageCanvasID) {
                var request = CanvasRequest(action: "create", id: Self.stageCanvasID)
                request.url = self.resolveContentURL("aos://toolkit/components/desktop-world-stage/index.html")
                request.surface = "desktop-world"
                request.interactive = false
                request.scope = "global"
                request.cascade = false
                request.suspended = true
                guard self.canvasManager.handle(request).status == "success" else {
                    semaphore.signal()
                    return
                }
            }
            topology = self.canvasManager.desktopWorldSceneBarrierTopology(canvasID: Self.stageCanvasID)
            semaphore.signal()
        }
        semaphore.wait()
        guard let topology else { return nil }
        let descriptor = topologyDescriptor(topology)
        guard scene.configureInitial(descriptor) else { return nil }
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            guard let current = canvasManager.desktopWorldSceneBarrierTopology(canvasID: Self.stageCanvasID),
                  current.canvasGeneration == topology.canvasGeneration,
                  current.generation == topology.generation,
                  current.segments == topology.segments else { return nil }
            if scene.isReady(descriptor) {
                let resumeSemaphore = DispatchSemaphore(value: 0)
                var resumed = false
                DispatchQueue.main.async { [weak self] in
                    guard let self else { resumeSemaphore.signal(); return }
                    if let candidate = self.canvasManager.desktopWorldSceneBarrierTopology(canvasID: Self.stageCanvasID),
                       candidate.canvasGeneration == topology.canvasGeneration,
                       candidate.generation == topology.generation,
                       candidate.segments == topology.segments {
                        resumed = self.canvasManager.handle(CanvasRequest(
                            action: "resume",
                            id: Self.stageCanvasID
                        )).status == "success"
                    }
                    resumeSemaphore.signal()
                }
                resumeSemaphore.wait()
                return resumed ? topology : nil
            }
            usleep(20_000)
        }
        return nil
    }

    func follow(
        json: [String: Any],
        connectionID: UUID,
        ref: String?
    ) -> AOSDesktopWorldSceneFollowResponse {
        guard json["stage"] as? String == "desktop-world/main",
              let owner = json["owner"] as? String,
              let resource = json["resource"] as? String,
              let operation = json["operation"] as? [String: Any],
              let op = operation["op"] as? String else {
            return response(error: "Invalid scene request", code: "INVALID_SCENE_OPERATION")
        }
        guard validIdentifier(owner, allowSlash: false),
              validIdentifier(resource, allowSlash: true) else {
            return response(error: "Invalid scene owner or resource", code: "INVALID_SCENE_IDENTITY")
        }
        let allowed = Set([
            "mount", "transact", "signal", "play", "suspend", "resume", "inspect",
            "remove", "close", "subscribe", "unsubscribe",
        ])
        guard allowed.contains(op) else {
            return response(error: "Unsupported scene operation", code: "INVALID_SCENE_OPERATION")
        }
        let acceptedOperation: [String: Any]
        do {
            acceptedOperation = try extensionStore.admitSceneOperation(operation, expectedOwnerID: owner)
        } catch let failure as AOSSceneExtensionStoreFailure {
            return response(error: "Scene extension is unavailable", code: failure.code)
        } catch {
            return response(error: "Scene extension is unavailable", code: "SCENE_EXTENSION_STORE_INVALID")
        }

        let requestedSceneEvents = operation["events"] as? [String] ?? []
        if op == "subscribe" || op == "unsubscribe" {
            let supportedSceneEvents = Set(["gesture"])
            guard Set(operation.keys).isSubset(of: Set(["op", "events"])),
                  requestedSceneEvents.count <= 8,
                  requestedSceneEvents.allSatisfy({ supportedSceneEvents.contains($0) }),
                  op != "subscribe" || !requestedSceneEvents.isEmpty else {
                return response(error: "Invalid scene event subscription", code: "INVALID_SCENE_SUBSCRIPTION")
            }
        }

        let key = scene.key(owner: owner, resource: resource)
        if op == "subscribe" || op == "unsubscribe" {
            let requested = Set(requestedSceneEvents)
            switch scene.updateSubscriptions(
                key: key,
                connectionID: connectionID,
                ref: ref,
                adding: op == "subscribe" ? requested : [],
                removing: op == "unsubscribe" ? requested : [],
                removeAll: op == "unsubscribe" && requested.isEmpty
            ) {
            case .stageUnavailable:
                return response(error: "DesktopWorld scene stage is retiring", code: "SCENE_STAGE_UNAVAILABLE")
            case .busy:
                return response(error: "Scene resource already has an active lease", code: "SCENE_LEASE_BUSY")
            case .accepted(let events):
                return AOSDesktopWorldSceneFollowResponse(payload: [
                    "status": "ok",
                    "operation": op,
                    "resource": resource,
                    "events": events.sorted(),
                ])
            }
        }

        guard let topology = ensureStage() else {
            return response(error: "DesktopWorld scene stage is unavailable", code: "SCENE_STAGE_UNAVAILABLE")
        }
        guard let current = canvasManager.desktopWorldSceneBarrierTopology(canvasID: Self.stageCanvasID),
              current.canvasGeneration == topology.canvasGeneration,
              current.generation == topology.generation,
              current.segments == topology.segments else {
            return response(error: "DesktopWorld scene segments are unavailable", code: "SCENE_STAGE_UNAVAILABLE")
        }
        switch scene.admitOperation(
            topology: topologyDescriptor(topology),
            key: key,
            owner: owner,
            resource: resource,
            operationName: op,
            operation: acceptedOperation,
            connectionID: connectionID,
            ref: ref
        ) {
        case .stageUnavailable:
            return response(error: "DesktopWorld scene generation is no longer ready", code: "SCENE_STAGE_UNAVAILABLE")
        case .leaseBusy:
            return response(error: "Scene resource already has an active lease", code: "SCENE_LEASE_BUSY")
        case .operationPending:
            return response(error: "DesktopWorld scene operation is still pending", code: "SCENE_OPERATION_PENDING")
        case .accepted(let initialAction):
            dispatch([initialAction])
            return AOSDesktopWorldSceneFollowResponse(payload: [
                "status": "ok",
                "operation": op,
                "resource": resource,
            ])
        }
    }

    private func response(error: String, code: String) -> AOSDesktopWorldSceneFollowResponse {
        AOSDesktopWorldSceneFollowResponse(payload: ["error": error, "code": code])
    }

    private func complete(
        _ completion: AOSDesktopWorldSceneResultCompletion,
        operationID: String
    ) {
        guard let delivery = scene.complete(completion, operationID: operationID) else { return }
        deliver(delivery)
    }

    private func deliver(_ delivery: AOSDesktopWorldSceneDelivery) {
        var data = delivery.payload
        data.removeValue(forKey: "lease_key")
        data.removeValue(forKey: "release_lease")
        _ = emit(delivery.route, "result", data)
    }

    private func invalidateStage(
        identity: AOSDesktopWorldSceneStageIdentity,
        code: String,
        primaryCompletion: AOSDesktopWorldSceneResultCompletion? = nil,
        primaryOperationID: String? = nil
    ) {
        guard let invalidation = scene.invalidateStage(
            identity: identity,
            code: code,
            primaryCompletion: primaryCompletion,
            primaryOperationID: primaryOperationID
        ) else { return }
        finishInvalidation(invalidation)
    }

    private func finishInvalidation(_ plan: AOSDesktopWorldSceneInvalidationPlan) {
        switch plan {
        case .deliver(let deliveries):
            deliveries.forEach(deliver)
        case .retire(let request):
            clearReadyManifest()
            canvasManager.retireDesktopWorldSceneStageAsync(
                canvasID: Self.stageCanvasID,
                canvasGeneration: request.identity.canvasGeneration,
                topologyGeneration: request.identity.topologyGeneration
            ) { [weak self] outcome in
                guard let self else { return }
                switch self.scene.settleRetirement(request, outcome: outcome) {
                case .stale:
                    return
                case .recoverable(let deliveries), .terminal(let deliveries):
                    deliveries.forEach(self.deliver)
                }
            }
        }
    }

    private func dispatch(
        _ actions: [AOSDesktopWorldSceneBarrierAction],
        operationID: String? = nil
    ) {
        for action in actions {
            switch action {
            case .broadcast(let broadcast):
                let message: [String: Any] = [
                    "type": "desktop_world_stage.scene.operation",
                    "payload": [
                        "lease_key": broadcast.leaseKey,
                        "operation_id": broadcast.operationID,
                        "barrier_phase": broadcast.phase.rawValue,
                        "owner": broadcast.owner,
                        "resource": broadcast.resource,
                        "operation": broadcast.operation,
                    ],
                ]
                guard post(broadcast, message: message) else {
                    dispatch(
                        scene.expire(
                            operationID: broadcast.operationID,
                            phase: broadcast.phase,
                            topologyGeneration: nil
                        ),
                        operationID: broadcast.operationID
                    )
                    continue
                }
                DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 3.0) { [weak self] in
                    guard let self else { return }
                    let current = self.canvasManager.desktopWorldSceneBarrierTopology(canvasID: Self.stageCanvasID)
                    let generation = current?.canvasGeneration == broadcast.canvasGeneration
                        ? current?.generation
                        : nil
                    self.dispatch(
                        self.scene.expire(
                            operationID: broadcast.operationID,
                            phase: broadcast.phase,
                            topologyGeneration: generation
                        ),
                        operationID: broadcast.operationID
                    )
                }
            case .complete(let completion):
                guard let operationID else { continue }
                complete(completion, operationID: operationID)
            case .retire(let retirement):
                invalidateStage(
                    identity: AOSDesktopWorldSceneStageIdentity(
                        canvasGeneration: retirement.canvasGeneration,
                        topologyGeneration: retirement.topologyGeneration
                    ),
                    code: retirement.completion.payload["code"] as? String ?? "SCENE_STAGE_RETIRED",
                    primaryCompletion: retirement.completion,
                    primaryOperationID: operationID
                )
            }
        }
    }

    private func post(
        _ broadcast: AOSDesktopWorldSceneBarrierBroadcast,
        message: [String: Any]
    ) -> Bool {
        var delivered = false
        let send = { [weak self] in
            guard let self,
                  let topology = self.canvasManager.desktopWorldSceneBarrierTopology(canvasID: Self.stageCanvasID),
                  topology.canvasGeneration == broadcast.canvasGeneration,
                  topology.generation == broadcast.topologyGeneration else { return }
            delivered = self.scene.withAuthorizedBroadcast(
                broadcast,
                topology: self.topologyDescriptor(topology)
            ) {
                self.canvasManager.postMessageToDesktopWorldSceneStage(
                    topology,
                    canvasID: Self.stageCanvasID,
                    payload: message
                )
            }
        }
        if Thread.isMainThread { send() } else { DispatchQueue.main.sync(execute: send) }
        return delivered
    }

    private func authenticatedTopology(
        target: CanvasLifecycleGeneration,
        payload: [String: Any]
    ) -> DesktopWorldSceneBarrierTopology? {
        guard target.canvasID == Self.stageCanvasID,
              let canvasGeneration = (payload["canvas_generation"] as? NSNumber)?.uint64Value,
              canvasGeneration == target.value,
              let topologyGeneration = (payload["topology_generation"] as? NSNumber)?.uint64Value,
              let displayIDValue = (payload["segment_display_id"] as? NSNumber)?.uint64Value,
              displayIDValue <= UInt64(UInt32.max),
              let segmentIndex = (payload["segment_index"] as? NSNumber)?.intValue,
              let topology = canvasManager.desktopWorldSceneBarrierTopology(canvasID: Self.stageCanvasID),
              topology.canvasGeneration == canvasGeneration,
              topology.generation == topologyGeneration,
              topology.segments.contains(where: {
                  $0.displayID == UInt32(displayIDValue) && $0.index == segmentIndex
              }) else { return nil }
        return topology
    }

    private func stageIdentity(
        _ topology: DesktopWorldSceneBarrierTopology
    ) -> AOSDesktopWorldSceneStageIdentity {
        AOSDesktopWorldSceneStageIdentity(
            canvasGeneration: topology.canvasGeneration,
            topologyGeneration: topology.generation
        )
    }

    private func topologyDescriptor(
        _ topology: DesktopWorldSceneBarrierTopology
    ) -> AOSDesktopWorldSceneTopologyDescriptor {
        AOSDesktopWorldSceneTopologyDescriptor(
            identity: stageIdentity(topology),
            segments: topology.segments.map {
                AOSDesktopWorldSceneStageSegment(displayID: $0.displayID, index: $0.index)
            }
        )
    }

    private func validIdentifier(_ value: String, allowSlash: Bool) -> Bool {
        let scalars = Array(value.unicodeScalars)
        guard !scalars.isEmpty, scalars.count <= 128 else { return false }
        func alphaNumeric(_ scalar: UnicodeScalar) -> Bool {
            (scalar.value >= 97 && scalar.value <= 122)
                || (scalar.value >= 48 && scalar.value <= 57)
        }
        guard let first = scalars.first, alphaNumeric(first), scalars.allSatisfy({ scalar in
            alphaNumeric(scalar)
                || scalar == "."
                || scalar == "_"
                || scalar == "-"
                || (allowSlash && scalar == "/")
        }) else { return false }
        return !allowSlash || !value.split(separator: "/", omittingEmptySubsequences: false).contains(where: {
            $0.isEmpty || $0 == "." || $0 == ".."
        })
    }
}
