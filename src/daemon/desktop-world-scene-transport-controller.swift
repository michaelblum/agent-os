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
    private let authorizationChanged: () -> Void
    private let emit: (AOSSceneLeaseRoute, String, [String: Any]) -> Bool
    private let eventRouter: AOSDesktopWorldSceneEventRouter

    init(
        canvasManager: CanvasManager,
        scene: AOSDesktopWorldSceneController = AOSDesktopWorldSceneController(),
        extensionStore: AOSSceneExtensionStore,
        eventDiagnostics: AOSDesktopWorldSceneEventRouteDiagnostics = AOSDesktopWorldSceneEventRouteDiagnostics(),
        nativeFeedback: @escaping (AOSDesktopWorldNativeEffectRequest) -> Void = { _ in },
        nativeGestureFeedback: @escaping (
            AOSDesktopWorldNativeEffectGestureEvent,
            AOSDesktopWorldNativeEffectRequest?
        ) -> Void = { _, _ in },
        resolveContentURL: @escaping (String) -> String,
        clearReadyManifest: @escaping () -> Void,
        authorizationChanged: @escaping () -> Void = {},
        emit: @escaping (AOSSceneLeaseRoute, String, [String: Any]) -> Bool
    ) {
        self.canvasManager = canvasManager
        self.scene = scene
        self.extensionStore = extensionStore
        self.resolveContentURL = resolveContentURL
        self.clearReadyManifest = clearReadyManifest
        self.authorizationChanged = authorizationChanged
        self.emit = emit
        self.eventRouter = AOSDesktopWorldSceneEventRouter(
            scene: scene,
            diagnostics: eventDiagnostics,
            nativeFeedback: nativeFeedback,
            nativeGestureFeedback: nativeGestureFeedback,
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
        authorizationChanged()
        if let invalidation = plan.invalidation {
            finishInvalidation(invalidation)
            return
        }
        dispatch(plan.barrierActions)
    }

    func validResourceIdentifier(_ value: String) -> Bool {
        validIdentifier(value, allowSlash: true)
    }

    func authorizeDesktopFrame(
        _ payload: [String: Any]
    ) -> AOSDesktopFrameCaptureAuthorization? {
        guard let owner = payload["owner"] as? String,
              let resource = payload["resource"] as? String,
              let resourceRevision = (payload["revision"] as? NSNumber)?.intValue,
              resourceRevision >= 0,
              let extensionDictionary = payload["extension"] as? [String: Any],
              let extensionReference = try? AOSSceneExtensionReference(
                  dictionary: extensionDictionary
              ),
              extensionReference.ownerID == owner,
              let canvasGeneration = (payload["canvas_generation"] as? NSNumber)?.uint64Value,
              let topologyGeneration = (payload["topology_generation"] as? NSNumber)?.uint64Value,
              let displayIDValue = (payload["segment_display_id"] as? NSNumber)?.uint64Value,
              displayIDValue <= UInt64(UInt32.max),
              let segmentIndex = (payload["segment_index"] as? NSNumber)?.intValue,
              let topology = canvasManager.desktopWorldSceneBarrierTopology(
                  canvasID: Self.stageCanvasID
              ),
              topology.canvasGeneration == canvasGeneration,
              topology.generation == topologyGeneration,
              topology.segments.contains(where: {
                  $0.displayID == UInt32(displayIDValue) && $0.index == segmentIndex
              }) else {
            return nil
        }
        let identity = stageIdentity(topology)
        guard scene.authorizes(
            identity: identity,
            key: scene.key(owner: owner, resource: resource),
            extensionDigest: extensionReference.digest,
            extensionID: extensionReference.id,
            extensionOwnerID: extensionReference.ownerID,
            resourceRevision: resourceRevision,
            sceneABI: extensionReference.sceneABI,
            threeRevision: extensionReference.threeRevision,
            capability: "aos.scene.desktop_frame_texture"
        ) else {
            return nil
        }
        return AOSDesktopFrameCaptureAuthorization(
            canvasID: Self.stageCanvasID,
            canvasGeneration: canvasGeneration,
            extensionReference: extensionReference,
            ownerID: owner,
            resourceID: resource,
            resourceRevision: resourceRevision,
            topologyGeneration: topologyGeneration
        )
    }

    func authorizesDesktopFrame(
        _ authorization: AOSDesktopFrameLeaseIdentity
    ) -> Bool {
        guard authorization.canvasID == Self.stageCanvasID else { return false }
        return scene.authorizes(
            identity: AOSDesktopWorldSceneStageIdentity(
                canvasGeneration: authorization.canvasGeneration,
                topologyGeneration: authorization.topologyGeneration
            ),
            key: scene.key(
                owner: authorization.ownerID,
                resource: authorization.resourceID
            ),
            extensionDigest: authorization.extensionReference.digest,
            extensionID: authorization.extensionReference.id,
            extensionOwnerID: authorization.extensionReference.ownerID,
            resourceRevision: authorization.resourceRevision,
            sceneABI: authorization.extensionReference.sceneABI,
            threeRevision: authorization.extensionReference.threeRevision,
            capability: "aos.scene.desktop_frame_texture"
        )
    }

    func authorizesNativeEffect(
        _ request: AOSDesktopWorldNativeEffectRequest
    ) -> Bool {
        scene.authorizesNativeEffect(request)
    }

    func hasNativeEffectAuthorization() -> Bool {
        scene.hasNativeEffectAuthorization()
    }

    func nativeEffectPrograms() -> [AOSDesktopWorldNativeEffectProgram] {
        scene.nativeEffectPrograms()
    }

    func nativePointerEffectRequest(
        region: AOSInputRegionRecord,
        phase: AOSInputEventPhase,
        button: AOSInputButton?,
        desktopWorld: CGPoint,
        pointerSessionID: String,
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldNativeEffectRequest? {
        guard region.ownerCanvasID == Self.stageCanvasID,
              phase == .down,
              let button,
              let ownerID = region.metadata["scene_owner"],
              let resourceID = region.metadata["scene_resource"],
              let affordanceID = region.metadata["scene_affordance"],
              let regionGeneration = region.metadata["scene_input_generation"],
              !regionGeneration.isEmpty,
              regionGeneration.utf8.count <= 128 else {
            return nil
        }
        return scene.nativePointerEffectRequest(
            ownerID: ownerID,
            resourceID: resourceID,
            regionGeneration: regionGeneration,
            affordanceID: affordanceID,
            canvasGeneration: region.ownerCanvasGeneration.value,
            phase: phase.rawValue,
            button: button.rawValue,
            point: desktopWorld,
            pointerSessionID: pointerSessionID,
            triggeredAt: triggeredAt
        )
    }

    func desktopFrameTextureAuthorization()
        -> AOSDesktopFrameWarmAuthorization? {
        guard let topology = canvasManager.desktopWorldSceneBarrierTopology(
            canvasID: Self.stageCanvasID
        ) else { return nil }
        let identity = stageIdentity(topology)
        guard scene.hasAuthorizedCapability(
            identity: identity,
            capability: "aos.scene.desktop_frame_texture"
        ) else { return nil }
        return AOSDesktopFrameWarmAuthorization(
            canvasGeneration: identity.canvasGeneration,
            topologyGeneration: identity.topologyGeneration
        )
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
            "mount", "transact", "signal", "play", "suspend", "resume", "inspect", "prove",
            "remove", "close", "subscribe", "unsubscribe",
        ])
        guard allowed.contains(op) else {
            return response(error: "Unsupported scene operation", code: "INVALID_SCENE_OPERATION")
        }
        let acceptedOperation: [String: Any]
        let extensionAuthorization: [String: Any]?
        do {
            acceptedOperation = try extensionStore.admitSceneOperation(operation, expectedOwnerID: owner)
            if let extensionDictionary = acceptedOperation["extension"] as? [String: Any] {
                var authorization = try extensionStore.authorization(
                    for: AOSSceneExtensionReference(dictionary: extensionDictionary)
                )
                guard let document = acceptedOperation["document"] as? [String: Any],
                      let revision = document["revision"] as? Int,
                      revision >= 0 else {
                    return response(
                        error: "Scene extension revision is unavailable",
                        code: "INVALID_SCENE_OPERATION"
                    )
                }
                authorization["resourceRevision"] = revision
                extensionAuthorization = authorization
            } else {
                extensionAuthorization = nil
            }
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
        if op == "unsubscribe" {
            return subscriptionResponse(
                scene.unsubscribe(
                    key: key,
                    connectionID: connectionID,
                    ref: ref,
                    events: Set(requestedSceneEvents),
                    removeAll: requestedSceneEvents.isEmpty
                ),
                operation: op,
                resource: resource
            )
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
        if op == "subscribe" {
            return subscriptionResponse(
                scene.subscribe(
                    identity: topologyDescriptor(topology).identity,
                    key: key,
                    connectionID: connectionID,
                    ref: ref,
                    events: Set(requestedSceneEvents)
                ),
                operation: op,
                resource: resource
            )
        }
        switch scene.admitOperation(
            topology: topologyDescriptor(topology),
            key: key,
            owner: owner,
            resource: resource,
            operationName: op,
            operation: acceptedOperation,
            extensionAuthorization: extensionAuthorization,
            connectionID: connectionID,
            ref: ref
        ) {
        case .stageUnavailable:
            return response(error: "DesktopWorld scene generation is no longer ready", code: "SCENE_STAGE_UNAVAILABLE")
        case .leaseBusy:
            return response(error: "Scene resource already has an active lease", code: "SCENE_LEASE_BUSY")
        case .nativeEffectBudgetExceeded:
            return response(
                error: "DesktopWorld native effect program budget exceeded",
                code: "NATIVE_EFFECT_PROGRAM_LIMIT"
            )
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

    private func subscriptionResponse(
        _ outcome: AOSDesktopWorldSceneSubscriptionOutcome,
        operation: String,
        resource: String
    ) -> AOSDesktopWorldSceneFollowResponse {
        switch outcome {
        case .stageUnavailable:
            return response(error: "DesktopWorld scene stage is retiring", code: "SCENE_STAGE_UNAVAILABLE")
        case .busy:
            return response(error: "Scene resource already has an active lease", code: "SCENE_LEASE_BUSY")
        case .accepted(let acceptedEvents):
            return AOSDesktopWorldSceneFollowResponse(payload: [
                "status": "ok",
                "operation": operation,
                "resource": resource,
                "events": acceptedEvents.sorted(),
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
        authorizationChanged()
        deliver(delivery)
    }

    private func deliver(_ delivery: AOSDesktopWorldSceneDelivery) {
        var data = delivery.payload
        data.removeValue(forKey: "input_generation")
        data.removeValue(forKey: "lease_key")
        data.removeValue(forKey: "projection_released")
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
        authorizationChanged()
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
        if actions.contains(where: { action in
            switch action {
            case .broadcast(let broadcast):
                return broadcast.phase == .release
            case .complete(let completion):
                return completion.payload["projection_released"] as? Bool == true
            case .retire:
                return true
            }
        }) {
            authorizationChanged()
        }
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
