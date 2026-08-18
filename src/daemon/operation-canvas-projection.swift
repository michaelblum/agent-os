import CoreFoundation
import Foundation

struct AOSOperationCanvasIdentity: Codable, Equatable, Hashable {
    let id: String
    let generation: UInt64

    func validate() throws {
        guard !id.isEmpty, generation > 0 else {
            throw AOSOperationProjectionError.invalidCanvasIdentity
        }
    }
}

protocol AOSOperationCanvasHosting: AnyObject {
    func openOperationControlCanvas() throws -> AOSOperationCanvasIdentity
    func postOperationControlMessage(
        to canvas: AOSOperationCanvasIdentity,
        payload: [String: Any]
    ) -> Bool
}

final class AOSClosureOperationCanvasHost: AOSOperationCanvasHosting {
    typealias Opener = () throws -> AOSOperationCanvasIdentity
    typealias Poster = (AOSOperationCanvasIdentity, [String: Any]) -> Bool

    private let opener: Opener
    private let poster: Poster

    init(open: @escaping Opener, post: @escaping Poster) {
        opener = open
        poster = post
    }

    func openOperationControlCanvas() throws -> AOSOperationCanvasIdentity {
        try opener()
    }

    func postOperationControlMessage(
        to canvas: AOSOperationCanvasIdentity,
        payload: [String: Any]
    ) -> Bool {
        poster(canvas, payload)
    }
}

enum AOSOperationCanvasRouteResult: Equatable {
    case notHandled
    case handled
    case rejected(String)
}

final class AOSOperationCanvasProjection {
    typealias StateReader = () -> AOSOperationDurableState
    typealias OrdinaryContextResolver = () -> AOSOrdinaryControlContext?
    typealias CheckedAtFactory = () -> String

    private enum SessionAuthority {
        case ordinary(resolveContext: OrdinaryContextResolver)
        case statusHost(AOSOperationStatusHostLeaseIdentity)
    }

    private struct Session {
        let canvas: AOSOperationCanvasIdentity
        let authority: SessionAuthority
    }

    private enum Action: String {
        case list, inspect, status, recent, cancel, kill
        case killOwner = "kill_owner"
        case stopAll = "stop_all"
        case barrierStatus = "barrier_status"
        case reopen
    }

    private struct Request {
        let requestID: String
        let action: Action
        let payload: [String: Any]
    }

    private struct OperationSelector {
        let identity: AOSOperationIdentity
    }

    private struct Execution {
        let receipt: [String: Any]?
        let records: [AOSOperationRecord]?

        init(receipt: [String: Any]? = nil, records: [AOSOperationRecord]? = nil) {
            self.receipt = receipt
            self.records = records
        }
    }

    private let controlPlane: AOSOperationControlPlane
    private let readState: StateReader
    private let indicatorRegistry: AOSOperationStatusIndicatorRegistry
    private let canvasHost: AOSOperationCanvasHosting
    private let statusHostLease: AOSOperationStatusHostLease
    private let checkedAt: CheckedAtFactory
    private let lock = NSLock()
    private var sessions: [String: Session] = [:]
    private var projectionRevision: UInt64 = 0

    init(
        controlPlane: AOSOperationControlPlane,
        readState: @escaping StateReader,
        indicatorRegistry: AOSOperationStatusIndicatorRegistry,
        canvasHost: AOSOperationCanvasHosting,
        statusHostLease: AOSOperationStatusHostLease,
        checkedAt: @escaping CheckedAtFactory = {
            String(UInt64(Date().timeIntervalSince1970 * 1_000))
        }
    ) throws {
        try indicatorRegistry.validate(against: readState().adapterRegistry)
        self.controlPlane = controlPlane
        self.readState = readState
        self.indicatorRegistry = indicatorRegistry
        self.canvasHost = canvasHost
        self.statusHostLease = statusHostLease
        self.checkedAt = checkedAt
    }

    @discardableResult
    func openStatusCanvas(
        statusHostLeaseIdentity: AOSOperationStatusHostLeaseIdentity
    ) throws -> AOSOperationCanvasIdentity {
        let admission = try statusHostLease.admit(statusHostLeaseIdentity)
        let statusHost = admission.binding
        try statusHost.validate(against: readState())
        let canvas = try canvasHost.openOperationControlCanvas()
        try canvas.validate()
        store(Session(canvas: canvas, authority: .statusHost(statusHostLeaseIdentity)))
        guard publish(sessionFor: canvas, requestID: nil, receipt: nil, errorCode: nil) else {
            detachCanvas(canvas)
            throw AOSOperationProjectionError.canvasDeliveryFailed
        }
        return canvas
    }

    func attachOrdinaryCanvas(
        _ canvas: AOSOperationCanvasIdentity,
        resolveContext: @escaping OrdinaryContextResolver
    ) throws {
        try canvas.validate()
        let context = try validateOrdinaryContext(resolveContext(), canvas: canvas)
        _ = try controlPlane.list(context: context)
        store(Session(canvas: canvas, authority: .ordinary(resolveContext: resolveContext)))
        guard publish(
            sessionFor: canvas,
            requestID: nil,
            receipt: nil,
            errorCode: nil,
            ordinaryContext: context
        ) else {
            detachCanvas(canvas)
            throw AOSOperationProjectionError.canvasDeliveryFailed
        }
    }

    func detachCanvas(_ canvas: AOSOperationCanvasIdentity) {
        lock.lock()
        defer { lock.unlock() }
        guard sessions[canvas.id]?.canvas.generation == canvas.generation else { return }
        sessions.removeValue(forKey: canvas.id)
    }

    @discardableResult
    func refresh(_ canvas: AOSOperationCanvasIdentity) -> AOSOperationCanvasRouteResult {
        guard let session = session(for: canvas.id) else { return .notHandled }
        guard session.canvas.generation == canvas.generation else {
            return .rejected(AOSOperationProjectionError.staleCanvasGeneration.code)
        }
        do {
            let context = try ordinaryContext(for: session)
            guard publish(
                session,
                requestID: nil,
                receipt: nil,
                errorCode: nil,
                ordinaryContext: context
            ) else {
                return .rejected(AOSOperationProjectionError.canvasDeliveryFailed.code)
            }
            return .handled
        } catch {
            let code = errorCode(error)
            _ = publish(session, requestID: nil, receipt: nil, errorCode: code)
            return .rejected(code)
        }
    }

    @discardableResult
    func routeMessage(
        canvasID: String,
        canvasGeneration: UInt64,
        message: [String: Any]
    ) -> AOSOperationCanvasRouteResult {
        guard let session = session(for: canvasID) else { return .notHandled }
        guard session.canvas.generation == canvasGeneration else {
            return .rejected(AOSOperationProjectionError.staleCanvasGeneration.code)
        }
        do {
            guard message["schema_version"] as? String == "aos.canvas-operation-control.request.v1" else {
                return .notHandled
            }
            if containsAuthorityClaim(message) {
                throw AOSOperationProjectionError.authorityClaimRejected
            }
            let request = try parseRequest(message)
            let context = try ordinaryContext(for: session)
            let execution = try execute(request, session: session, ordinaryContext: context)
            guard publish(
                session,
                requestID: request.requestID,
                receipt: execution.receipt,
                errorCode: nil,
                ordinaryContext: context,
                records: execution.records
            ) else {
                return .rejected(AOSOperationProjectionError.canvasDeliveryFailed.code)
            }
            return .handled
        } catch {
            let requestID = message["request_id"] as? String
            let code = errorCode(error)
            _ = publish(session, requestID: requestID, receipt: nil, errorCode: code)
            return .rejected(code)
        }
    }

    private func execute(
        _ request: Request,
        session: Session,
        ordinaryContext: AOSOrdinaryControlContext?
    ) throws -> Execution {
        switch session.authority {
        case .ordinary:
            guard let context = ordinaryContext else {
                throw AOSOperationProjectionError.capturedPeerUnavailable
            }
            switch request.action {
            case .list:
                let filter = try parseFilterPayload(request.payload)
                let records = try controlPlane.list(context: context, filter: filter)
                return Execution(
                    receipt: ["action": request.action.rawValue, "outcome": "observed"],
                    records: records
                )
            case .inspect:
                let selector = try parseOperationSelector(request.payload)
                let record = try controlPlane.inspect(context: context, operation: selector.identity)
                return Execution(
                    receipt: [
                        "action": request.action.rawValue,
                        "outcome": "observed",
                        "operation_id": record.identity.id,
                        "operation_generation": record.identity.generation,
                    ],
                    records: [record]
                )
            case .cancel:
                let selector = try parseOperationSelector(request.payload)
                return Execution(receipt: ordinaryReceipt(try controlPlane.cancel(
                    context: context, operation: selector.identity
                )))
            case .kill:
                let selector = try parseOperationSelector(request.payload)
                return Execution(receipt: ordinaryReceipt(try controlPlane.kill(
                    context: context, operation: selector.identity
                )))
            case .killOwner:
                let filter = try parseFilterPayload(request.payload)
                return Execution(receipt: ordinaryReceipt(try controlPlane.killOwner(
                    context: context, filter: filter
                )))
            case .status, .recent, .stopAll, .barrierStatus, .reopen:
                throw AOSOperationProjectionError.unsupportedAction
            }
        case let .statusHost(leaseIdentity):
            switch request.action {
            case .list:
                _ = try parseEmptyFilterPayload(request.payload)
                return Execution(receipt: [
                    "action": request.action.rawValue,
                    "outcome": "observed",
                ])
            case .stopAll:
                let expectedBarrierGeneration = try parseExpectedBarrierGeneration(request.payload)
                let admission = try statusHostLease.admit(leaseIdentity)
                let statusHost = admission.binding
                let state = readState()
                try statusHost.validate(against: state)
                let context = AOSHostControlContext(
                    expectedDaemonGeneration: statusHost.daemonGeneration,
                    connectionEpoch: statusHost.connectionEpoch,
                    caller: .statusOpenedCanvasHost(AOSStatusOpenedCanvasHostEvidence(
                        canvasInstanceID: session.canvas.id,
                        canvasGeneration: session.canvas.generation,
                        parentStatusHostID: statusHost.statusHostID,
                        parentStatusHostGeneration: statusHost.statusHostGeneration,
                        daemonGeneration: statusHost.daemonGeneration,
                        effectiveUID: statusHost.effectiveUID
                    ))
                )
                let receipt = try controlPlane.stopAll(
                    context: context,
                    request: AOSHostControlRequest(
                        requestID: request.requestID,
                        action: .stopAll,
                        canonicalParameterDigest: try AOSOperationProjectionRequestDigest.hostAction(
                            .stopAll,
                            expectedBarrierGeneration: expectedBarrierGeneration
                        ),
                        expectedBarrierGeneration: expectedBarrierGeneration
                    )
                )
                return Execution(receipt: stopAllReceipt(receipt))
            case .inspect, .status, .recent, .cancel, .kill, .killOwner, .barrierStatus, .reopen:
                throw AOSOperationProjectionError.unsupportedAction
            }
        }
    }

    private func publish(
        sessionFor canvas: AOSOperationCanvasIdentity,
        requestID: String?,
        receipt: [String: Any]?,
        errorCode: String?,
        ordinaryContext: AOSOrdinaryControlContext? = nil,
        records: [AOSOperationRecord]? = nil
    ) -> Bool {
        guard let session = session(for: canvas.id), session.canvas == canvas else { return false }
        return publish(
            session,
            requestID: requestID,
            receipt: receipt,
            errorCode: errorCode,
            ordinaryContext: ordinaryContext,
            records: records
        )
    }

    private func publish(
        _ session: Session,
        requestID: String?,
        receipt: [String: Any]?,
        errorCode: String?,
        ordinaryContext: AOSOrdinaryControlContext? = nil,
        records projectedRecords: [AOSOperationRecord]? = nil
    ) -> Bool {
        do {
            let state = readState()
            try indicatorRegistry.validate(against: state.adapterRegistry)
            let records: [AOSOperationRecord]
            if let projectedRecords {
                records = projectedRecords
            } else {
                switch session.authority {
                case .statusHost:
                    records = registeredOperations(in: state)
                case .ordinary:
                    let context = try ordinaryContext
                        ?? validateOrdinaryContextForSession(session)
                    records = try controlPlane.list(context: context)
                }
            }
            let operations = try records.sorted { $0.identity < $1.identity }.map {
                try projectedOperation($0, state: state)
            }
            var payload: [String: Any] = [
                "schema_version": "aos.canvas-operation-control.projection.v1",
                "revision": nextProjectionRevision(),
                "checked_at": checkedAt(),
                "barrier": [
                    "generation": state.barrier.generation,
                    "state": state.barrier.state.rawValue,
                    "admission_open": state.barrier.state == .open,
                    "adapter_registry_revision": state.adapterRegistry.revision,
                    "registered_operation_set_count": state.adapterRegistry.registeredOperationSetCount,
                    "registered_operation_set_digest": state.adapterRegistry.registeredOperationSetDigest,
                ],
                "operations": operations,
            ]
            if let requestID { payload["request_id"] = requestID }
            if let receipt { payload["receipt"] = receipt }
            if let errorCode {
                payload["error"] = ["request_id": requestID ?? "", "code": errorCode]
            }
            return canvasHost.postOperationControlMessage(to: session.canvas, payload: payload)
        } catch {
            var payload: [String: Any] = [
                "schema_version": "aos.canvas-operation-control.projection.v1",
                "revision": nextProjectionRevision(),
                "checked_at": checkedAt(),
                "barrier": [
                    "generation": 0,
                    "state": AOSHostBarrierLifecycleState.bootReconciling.rawValue,
                    "admission_open": false,
                ],
                "operations": [],
                "error": ["request_id": requestID ?? "", "code": self.errorCode(error)],
            ]
            if let requestID { payload["request_id"] = requestID }
            return canvasHost.postOperationControlMessage(to: session.canvas, payload: payload)
        }
    }

    private func registeredOperations(in state: AOSOperationDurableState) -> [AOSOperationRecord] {
        state.operations.filter { operation in
            guard let registration = state.adapterRegistry.registration(
                id: operation.adapterRegistrationID,
                revision: operation.adapterRegistrationRevision
            ) else { return false }
            return registration.capabilityIDs.contains(operation.capabilityID)
        }
    }

    private func projectedOperation(
        _ operation: AOSOperationRecord,
        state: AOSOperationDurableState
    ) throws -> [String: Any] {
        let indicatorClass = try indicatorRegistry.indicatorClass(
            for: operation,
            registry: state.adapterRegistry
        )
        let resourceClaims = state.resourceClaims
            .filter { $0.operation == operation.identity }
            .sorted {
                if $0.resourceKey != $1.resourceKey { return $0.resourceKey < $1.resourceKey }
                if $0.resourceGeneration != $1.resourceGeneration {
                    return $0.resourceGeneration < $1.resourceGeneration
                }
                return $0.claimID < $1.claimID
            }
            .map(projectedResourceClaim)
        let artifacts = state.artifacts
            .filter { $0.parentOperation == operation.identity }
            .sorted { $0.identity < $1.identity }
            .map(projectedArtifact)
        let cleanupResult: String
        if operation.state == .cleanupRequired
            || operation.state == .recovering
            || operation.residualDigest != nil {
            cleanupResult = "residual"
        } else if operation.state == .terminal {
            cleanupResult = "zero_residuals"
        } else {
            cleanupResult = "pending"
        }
        return [
            "operation_id": operation.identity.id,
            "operation_generation": operation.identity.generation,
            "capability_id": operation.capabilityID,
            "capability_label": "",
            "owner_root_id": operation.ownerRoot.ownerID,
            "state": operation.state.rawValue,
            "status_indicator_class": indicatorClass.rawValue,
            "outcome": operation.outcome?.rawValue ?? "",
            "trigger": operation.stopIntent?.rawValue ?? "",
            "blame": operation.outcome == nil ? "" : "unknown",
            "cleanup_result": cleanupResult,
            "resource_claim_count": resourceClaims.count,
            "resource_claims": resourceClaims,
            "artifact_count": artifacts.count,
            "artifacts": artifacts,
            "updated_at": String(operation.updatedAtNanoseconds),
        ]
    }

    private func projectedResourceClaim(_ claim: AOSResourceClaimRecord) -> [String: Any] {
        [
            "claim_id": claim.claimID,
            "transaction_id": claim.transactionID,
            "resource_key": claim.resourceKey,
            "resource_generation": claim.resourceGeneration,
            "admission_mode": claim.admissionMode.rawValue,
            "adapter_registration_id": claim.adapterRegistrationID,
            "adapter_registration_revision": claim.adapterRegistrationRevision,
            "state": claim.state.rawValue,
            "broker_id": claim.brokerID ?? NSNull(),
            "broker_generation": claim.brokerGeneration ?? NSNull(),
            "subscriber_id": claim.subscriberID ?? NSNull(),
        ]
    }

    private func projectedArtifact(_ artifact: AOSArtifactRecord) -> [String: Any] {
        [
            "artifact_id": artifact.identity.id,
            "artifact_generation": artifact.identity.generation,
            "state": artifact.state.rawValue,
            "recovery_origin_state": artifact.recoveryOriginState?.rawValue ?? NSNull(),
            "recovery_disposition": artifact.recoveryDisposition?.rawValue ?? NSNull(),
            "custody_digest": artifact.custodyDigest ?? NSNull(),
        ]
    }

    private func parseRequest(_ message: [String: Any]) throws -> Request {
        guard Set(message.keys) == Set(["schema_version", "request_id", "action", "payload"]),
              message["schema_version"] as? String == "aos.canvas-operation-control.request.v1",
              let requestID = boundedString(message["request_id"], maximum: 128),
              let actionValue = message["action"] as? String,
              let action = Action(rawValue: actionValue),
              let payload = message["payload"] as? [String: Any] else {
            throw AOSOperationProjectionError.invalidRequest
        }
        return Request(requestID: requestID, action: action, payload: payload)
    }

    private func parseOperationSelector(_ payload: [String: Any]) throws -> OperationSelector {
        guard Set(payload.keys) == Set(["operation_id", "operation_generation"]),
              let operationID = boundedString(payload["operation_id"], maximum: 128),
              let generation = positiveUInt64(payload["operation_generation"]) else {
            throw AOSOperationProjectionError.invalidRequest
        }
        return OperationSelector(identity: AOSOperationIdentity(id: operationID, generation: generation))
    }

    private func parseExpectedBarrierGeneration(_ payload: [String: Any]) throws -> UInt64 {
        guard Set(payload.keys) == Set(["expected_barrier_generation"]),
              let generation = positiveUInt64(payload["expected_barrier_generation"]) else {
            throw AOSOperationProjectionError.invalidRequest
        }
        return generation
    }

    private func parseFilterPayload(_ payload: [String: Any]) throws -> AOSOperationFilter {
        guard Set(payload.keys).isSubset(of: Set(["filters"])) else {
            throw AOSOperationProjectionError.invalidRequest
        }
        let raw: [String: Any]
        if let value = payload["filters"] {
            guard let filters = value as? [String: Any] else {
                throw AOSOperationProjectionError.invalidRequest
            }
            raw = filters
        } else {
            raw = [:]
        }
        let accepted = Set([
            "capability_id", "client_id", "agent_id", "project_id", "task_id",
            "run_id", "skill_id", "target_id", "capability_label",
        ])
        guard Set(raw.keys).isSubset(of: accepted) else {
            throw AOSOperationProjectionError.invalidRequest
        }
        func value(_ key: String) throws -> String? {
            guard let rawValue = raw[key] else { return nil }
            guard let result = boundedString(rawValue, maximum: 256, allowEmpty: true) else {
                throw AOSOperationProjectionError.invalidRequest
            }
            return result
        }
        return try AOSOperationFilter(
            capabilityID: value("capability_id"),
            clientID: value("client_id"),
            agentID: value("agent_id"),
            projectID: value("project_id"),
            taskID: value("task_id"),
            runID: value("run_id"),
            skillID: value("skill_id"),
            targetID: value("target_id"),
            capabilityLabel: value("capability_label")
        )
    }

    private func parseEmptyFilterPayload(_ payload: [String: Any]) throws -> AOSOperationFilter {
        let filter = try parseFilterPayload(payload)
        guard filter == AOSOperationFilter() else {
            throw AOSOperationProjectionError.unsupportedAction
        }
        return filter
    }

    private func ordinaryReceipt(_ receipt: AOSOperationControlReceipt) -> [String: Any] {
        [
            "action": receipt.action.rawValue,
            "outcome": receipt.terminalOutcome.rawValue,
            "stop_intent": receipt.stopIntent.rawValue,
            "selected_operation_count": receipt.selectedOperationCount,
            "selected_operation_digest": receipt.selectedOperationDigest,
            "selected_operations": receipt.selectedOperations.map {
                ["operation_id": $0.id, "operation_generation": $0.generation]
            },
        ]
    }

    private func stopAllReceipt(_ receipt: AOSStopAllReceipt) -> [String: Any] {
        [
            "action": AOSHostControlAction.stopAll.rawValue,
            "outcome": receipt.outcome.rawValue,
            "prior_barrier_state": receipt.priorBarrierState.rawValue,
            "prior_barrier_generation": receipt.priorBarrierGeneration,
            "resulting_barrier_state": receipt.resultingBarrierState.rawValue,
            "resulting_barrier_generation": receipt.resultingBarrierGeneration,
            "selected_operation_count": receipt.snapshot.selectedOperationCount,
            "selected_operation_digest": receipt.snapshot.selectedOperationDigest,
            "residual_count": receipt.residualCount,
            "cleanup_result": receipt.cleanupResult.rawValue,
        ]
    }

    private func ordinaryContext(for session: Session) throws -> AOSOrdinaryControlContext? {
        switch session.authority {
        case .statusHost:
            return nil
        case let .ordinary(resolveContext):
            return try validateOrdinaryContext(resolveContext(), canvas: session.canvas)
        }
    }

    private func validateOrdinaryContextForSession(
        _ session: Session
    ) throws -> AOSOrdinaryControlContext {
        guard case let .ordinary(resolveContext) = session.authority else {
            throw AOSOperationProjectionError.capturedPeerUnavailable
        }
        return try validateOrdinaryContext(resolveContext(), canvas: session.canvas)
    }

    private func validateOrdinaryContext(
        _ context: AOSOrdinaryControlContext?,
        canvas: AOSOperationCanvasIdentity
    ) throws -> AOSOrdinaryControlContext {
        guard let context,
              case let .ordinaryCanvasCapturedPeer(evidence) = context.caller,
              evidence.canvasInstanceID == canvas.id,
              evidence.canvasGeneration == canvas.generation,
              evidence.captureIsLive,
              evidence.capturedConnectionEpoch == context.connectionEpoch else {
            throw AOSOperationProjectionError.capturedPeerUnavailable
        }
        return context
    }

    private func containsAuthorityClaim(_ value: Any) -> Bool {
        let forbidden = Set([
            "owner_root", "owner_root_id", "caller_origin", "caller_origin_evidence",
            "human_initiated", "effective_uid", "pid", "pid_generation",
        ])
        if let object = value as? [String: Any] {
            for (key, child) in object {
                if forbidden.contains(key) || containsAuthorityClaim(child) { return true }
            }
        } else if let array = value as? [Any] {
            return array.contains(where: containsAuthorityClaim)
        }
        return false
    }

    private func boundedString(
        _ value: Any?,
        maximum: Int,
        allowEmpty: Bool = false
    ) -> String? {
        guard let value = value as? String,
              value.utf8.count <= maximum,
              allowEmpty || !value.isEmpty else { return nil }
        return value
    }

    private func positiveUInt64(_ value: Any?) -> UInt64? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite,
              double >= 1,
              double <= 9_007_199_254_740_991,
              double.rounded(.towardZero) == double else { return nil }
        return UInt64(double)
    }

    private func store(_ session: Session) {
        lock.lock()
        sessions[session.canvas.id] = session
        lock.unlock()
    }

    private func session(for canvasID: String) -> Session? {
        lock.lock()
        defer { lock.unlock() }
        return sessions[canvasID]
    }

    private func nextProjectionRevision() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        if projectionRevision < UInt64.max {
            projectionRevision += 1
        }
        return projectionRevision
    }

    private func errorCode(_ error: Error) -> String {
        if let error = error as? AOSOperationProjectionError { return error.code }
        if let error = error as? AOSOperationCoreError { return error.code }
        return AOSOperationProjectionError.invalidRequest.code
    }
}
