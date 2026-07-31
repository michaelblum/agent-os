import Foundation

let aosDesktopWorldSceneResultErrorCodes: Set<String> = [
    "SCENE_BUDGET_EXCEEDED",
    "SCENE_EXTENSION_CONTEXT_LOST_FAILED",
    "SCENE_EXTENSION_CONTEXT_RESTORED_FAILED",
    "SCENE_EXTENSION_DISPOSE_FAILED",
    "SCENE_EXTENSION_IDENTITY_MISMATCH",
    "SCENE_EXTENSION_IMPORT_FAILED",
    "SCENE_EXTENSION_IMPORT_TIMEOUT",
    "SCENE_EXTENSION_INTERACTION_FAILED",
    "SCENE_EXTENSION_LOADER_CAPACITY",
    "SCENE_EXTENSION_LOADER_INVALID",
    "SCENE_EXTENSION_MODULE_INVALID",
    "SCENE_EXTENSION_OWNER_MISMATCH",
    "SCENE_EXTENSION_REFERENCE_INVALID",
    "SCENE_EXTENSION_REGISTRATION_FAILED",
    "SCENE_EXTENSION_REGISTRY_FAILED",
    "SCENE_EXTENSION_REGISTRY_LIMIT",
    "SCENE_EXTENSION_RESUME_FAILED",
    "SCENE_EXTENSION_SIGNAL_FAILED",
    "SCENE_EXTENSION_SUSPEND_FAILED",
    "SCENE_EXTENSION_TICK_FAILED",
    "SCENE_EXTENSION_URL_INVALID",
    "SCENE_FRAMEBUFFER_PROOF_RATE_LIMITED",
    "SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE",
    "SCENE_FRAMEBUFFER_READBACK_FAILED",
    "SCENE_OWNER_DISCONNECTED",
    "SCENE_PROJECTION_FAILED",
    "SCENE_RENDER_PASS_CONFIGURATION_FAILED",
    "SCENE_RENDER_FAILED",
    "SCENE_SEGMENT_DIVERGED",
    "SCENE_SEGMENT_FAILED",
    "SCENE_SEGMENT_RESOURCE_ACCOUNTING_FAILED",
    "SCENE_SEGMENT_RESOURCE_BUDGET_EXCEEDED",
    "SCENE_SEGMENT_TIMEOUT",
    "SCENE_STAGE_DISPOSED",
    "SCENE_STAGE_REMOVED",
    "SCENE_STAGE_RETIRED",
    "SCENE_STAGE_RETIRE_FAILED",
    "SCENE_TOPOLOGY_CHANGED",
]

private let aosDesktopWorldFramebufferProofLocalErrorCodes: Set<String> = [
    "SCENE_FRAMEBUFFER_PROOF_RATE_LIMITED",
    "SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE",
    "SCENE_FRAMEBUFFER_READBACK_FAILED",
]

func aosCanonicalDesktopWorldSceneResultErrorCode(_ value: Any?, fallback: String) -> String {
    precondition(aosDesktopWorldSceneResultErrorCodes.contains(fallback))
    guard let code = value as? String,
          aosDesktopWorldSceneResultErrorCodes.contains(code) else { return fallback }
    return code
}

enum AOSDesktopWorldSceneBarrierPhase: String {
    case apply
    case prepare
    case commit
    case abort
    case release
}

struct AOSDesktopWorldSceneResultCompletion {
    let payload: [String: Any]
}

struct AOSDesktopWorldSceneBarrierBroadcast {
    let operationID: String
    let phase: AOSDesktopWorldSceneBarrierPhase
    let leaseKey: String
    let owner: String
    let resource: String
    let operation: [String: Any]
    let canvasGeneration: UInt64
    let topologyGeneration: UInt64
}

struct AOSDesktopWorldSceneStageRetirement {
    let completion: AOSDesktopWorldSceneResultCompletion
    let canvasGeneration: UInt64
    let topologyGeneration: UInt64
}

enum AOSDesktopWorldSceneBarrierAction {
    case broadcast(AOSDesktopWorldSceneBarrierBroadcast)
    case complete(AOSDesktopWorldSceneResultCompletion)
    case retire(AOSDesktopWorldSceneStageRetirement)
}

final class AOSDesktopWorldSceneResultCoordinator {
    private enum InputGeneration: Equatable {
        case active(String)
        case inactive
    }

    private enum InputGenerationConsensus {
        case absent
        case invalid
        case value(InputGeneration)

        var isInvalid: Bool {
            if case .invalid = self { return true }
            return false
        }

        var isValue: Bool {
            if case .value = self { return true }
            return false
        }
    }

    private struct ExpectedSegment {
        let displayID: UInt32
        let index: Int
    }

    private struct PendingOperation {
        let leaseKey: String
        let owner: String
        let operation: String
        let operationPayload: [String: Any]
        let resource: String
        let canvasGeneration: UInt64
        let topologyGeneration: UInt64
        let expected: [UInt32: ExpectedSegment]
        var phase: AOSDesktopWorldSceneBarrierPhase
        var results: [UInt32: [String: Any]]
        var errorCode: String?
        var preparedFingerprint: String?
        var releaseLeaseOnCompletion: Bool
    }

    private let lock = NSLock()
    private var pending: [String: PendingOperation] = [:]
    private var pendingLeaseKeys: Set<String> = []
    private let maximumPending = 128

    func begin(
        operationID: String,
        leaseKey: String,
        owner: String,
        operation: String,
        operationPayload: [String: Any],
        resource: String,
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        segments: [(displayID: UInt32, index: Int)]
    ) -> AOSDesktopWorldSceneBarrierAction? {
        guard !operationID.isEmpty,
              operationID.count <= 128,
              !leaseKey.isEmpty,
              leaseKey.count <= 512,
              !owner.isEmpty,
              !resource.isEmpty,
              canvasGeneration > 0,
              !segments.isEmpty,
              segments.count <= 32 else { return nil }
        var expected: [UInt32: ExpectedSegment] = [:]
        for segment in segments {
            guard segment.index >= 0,
                  segment.index < 32,
                  expected[segment.displayID] == nil else { return nil }
            expected[segment.displayID] = ExpectedSegment(displayID: segment.displayID, index: segment.index)
        }
        guard expected.values.filter({ $0.index == 0 }).count == 1 else { return nil }

        lock.lock()
        defer { lock.unlock() }
        guard pending[operationID] == nil,
              !pendingLeaseKeys.contains(leaseKey),
              pending.count < maximumPending else { return nil }
        let initialPhase: AOSDesktopWorldSceneBarrierPhase = (operation == "mount" || operation == "transact")
            ? .prepare
            : .apply
        let operation = PendingOperation(
            leaseKey: leaseKey,
            owner: owner,
            operation: operation,
            operationPayload: operationPayload,
            resource: resource,
            canvasGeneration: canvasGeneration,
            topologyGeneration: topologyGeneration,
            expected: expected,
            phase: initialPhase,
            results: [:],
            errorCode: nil,
            preparedFingerprint: nil,
            releaseLeaseOnCompletion: false
        )
        pending[operationID] = operation
        pendingLeaseKeys.insert(leaseKey)
        return .broadcast(broadcast(operationID, operation))
    }

    func accept(_ payload: [String: Any]) -> [AOSDesktopWorldSceneBarrierAction] {
        guard let operationID = payload["operation_id"] as? String,
              let displayID = uint32(payload["segment_display_id"]),
              let segmentIndex = integer(payload["segment_index"]),
              let canvasGeneration = uint64(payload["canvas_generation"]),
              let topologyGeneration = uint64(payload["topology_generation"]),
              let phaseName = payload["barrier_phase"] as? String,
              let phase = AOSDesktopWorldSceneBarrierPhase(rawValue: phaseName) else { return [] }

        lock.lock()
        defer { lock.unlock() }
        guard var operation = pending[operationID],
              phase == operation.phase,
              let expected = operation.expected[displayID],
              expected.index == segmentIndex,
              operation.results[displayID] == nil else { return [] }
        guard canvasGeneration == operation.canvasGeneration,
              topologyGeneration == operation.topologyGeneration else {
            _ = removePending(operationID)
            return [retirement(operation, code: "SCENE_TOPOLOGY_CHANGED")]
        }

        operation.results[displayID] = payload
        pending[operationID] = operation
        if payload["status"] as? String == "error" {
            return handlePhaseFailure(
                operationID,
                operation,
                code: aosCanonicalDesktopWorldSceneResultErrorCode(
                    payload["code"],
                    fallback: "SCENE_SEGMENT_FAILED"
                )
            )
        }
        guard operation.results.count == operation.expected.count else { return [] }
        return handlePhaseSuccess(operationID, operation)
    }

    func expire(
        operationID: String,
        phase: AOSDesktopWorldSceneBarrierPhase,
        topologyGeneration: UInt64?
    ) -> [AOSDesktopWorldSceneBarrierAction] {
        lock.lock()
        defer { lock.unlock() }
        guard let operation = pending[operationID], operation.phase == phase else { return [] }
        guard topologyGeneration == operation.topologyGeneration else {
            _ = removePending(operationID)
            return [retirement(operation, code: "SCENE_TOPOLOGY_CHANGED")]
        }
        switch operation.phase {
        case .apply, .commit:
            if operation.phase == .apply, operation.operation == "prove" {
                _ = removePending(operationID)
                return [.complete(completion(operation, status: "error", code: "SCENE_SEGMENT_TIMEOUT"))]
            }
            return transition(operationID, operation, to: .release, code: "SCENE_SEGMENT_TIMEOUT")
        case .prepare:
            return transition(operationID, operation, to: .abort, code: "SCENE_SEGMENT_TIMEOUT")
        case .abort, .release:
            _ = removePending(operationID)
            return [retirement(operation, code: "SCENE_SEGMENT_TIMEOUT")]
        }
    }

    /// Converts owner loss into an operation-ID-scoped cleanup barrier. A
    /// replacement always aborts before its lease can be released, including
    /// when disconnect races the commit phase.
    func ownerDisconnected(leaseKey: String) -> [AOSDesktopWorldSceneBarrierAction] {
        lock.lock()
        defer { lock.unlock() }
        guard let operationID = pending.first(where: { $0.value.leaseKey == leaseKey })?.key,
              var operation = pending[operationID] else { return [] }
        operation.releaseLeaseOnCompletion = true
        operation.errorCode = "SCENE_OWNER_DISCONNECTED"
        switch operation.phase {
        case .abort, .release:
            pending[operationID] = operation
            return []
        case .prepare, .commit:
            if operation.operation == "mount" || operation.operation == "transact" {
                return transition(operationID, operation, to: .abort, code: "SCENE_OWNER_DISCONNECTED")
            }
            return transition(operationID, operation, to: .release, code: "SCENE_OWNER_DISCONNECTED")
        case .apply:
            return transition(operationID, operation, to: .release, code: "SCENE_OWNER_DISCONNECTED")
        }
    }

    @discardableResult
    func cancel(operationID: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return removePending(operationID) != nil
    }

    @discardableResult
    func cancel(leaseKey: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let operationID = pending.first(where: { $0.value.leaseKey == leaseKey })?.key else { return false }
        return removePending(operationID) != nil
    }

    func cancelAll() {
        lock.lock()
        pending.removeAll(keepingCapacity: false)
        pendingLeaseKeys.removeAll(keepingCapacity: false)
        lock.unlock()
    }

    func hasPending(leaseKey: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return pendingLeaseKeys.contains(leaseKey)
    }

    private func handlePhaseFailure(
        _ operationID: String,
        _ operation: PendingOperation,
        code: String
    ) -> [AOSDesktopWorldSceneBarrierAction] {
        if operation.phase == .apply,
           operation.operation == "prove",
           aosDesktopWorldFramebufferProofLocalErrorCodes.contains(code) {
            _ = removePending(operationID)
            return [.complete(completion(operation, status: "error", code: code))]
        }
        switch operation.phase {
        case .apply, .commit, .abort:
            return transition(operationID, operation, to: .release, code: code)
        case .prepare:
            return transition(operationID, operation, to: .abort, code: code)
        case .release:
            _ = removePending(operationID)
            return [retirement(operation, code: code)]
        }
    }

    private func handlePhaseSuccess(
        _ operationID: String,
        _ operation: PendingOperation
    ) -> [AOSDesktopWorldSceneBarrierAction] {
        let statuses = Set(operation.results.values.compactMap { $0["status"] as? String })
        let fingerprints = Set(operation.results.values.compactMap { $0["candidate_fingerprint"] as? String })
        switch operation.phase {
        case .apply:
            let inputGeneration = inputGenerationConsensus(operation)
            guard statuses.count == 1,
                  let status = statuses.first,
                  status == "ok" || status == "ignored",
                  operation.operation == "prove"
                    ? !inputGeneration.isInvalid
                    : inputGeneration.isValue else {
                return transition(operationID, operation, to: .release, code: "SCENE_SEGMENT_DIVERGED")
            }
            if operation.operation == "prove", framebufferProofCompletion(operation) == nil {
                return transition(operationID, operation, to: .release, code: "SCENE_SEGMENT_DIVERGED")
            }
            _ = removePending(operationID)
            return [.complete(completion(operation, status: status, code: nil))]
        case .prepare:
            guard statuses == Set(["ok"]), fingerprints.count == 1, fingerprints.first?.isEmpty == false else {
                return transition(operationID, operation, to: .abort, code: "SCENE_SEGMENT_DIVERGED")
            }
            var prepared = operation
            prepared.preparedFingerprint = fingerprints.first
            return transition(operationID, prepared, to: .commit, code: nil)
        case .commit:
            let inputGeneration = inputGenerationConsensus(operation)
            guard statuses == Set(["ok"]),
                  let preparedFingerprint = operation.preparedFingerprint,
                  fingerprints == Set([preparedFingerprint]),
                  inputGeneration.isValue else {
                return transition(operationID, operation, to: .release, code: "SCENE_SEGMENT_DIVERGED")
            }
            _ = removePending(operationID)
            return [.complete(completion(operation, status: "ok", code: nil))]
        case .abort:
            guard operation.results.values.allSatisfy({
                guard let status = $0["status"] as? String else { return false }
                return status == "ok" || status == "ignored"
            }) else {
                return transition(operationID, operation, to: .release, code: "SCENE_SEGMENT_DIVERGED")
            }
            if operation.releaseLeaseOnCompletion {
                return transition(
                    operationID,
                    operation,
                    to: .release,
                    code: operation.errorCode ?? "SCENE_OWNER_DISCONNECTED"
                )
            }
            _ = removePending(operationID)
            return [.complete(completion(
                operation,
                status: "error",
                code: operation.errorCode ?? "SCENE_SEGMENT_FAILED"
            ))]
        case .release:
            guard operation.results.values.allSatisfy({
                guard let status = $0["status"] as? String else { return false }
                return status == "ok" || status == "ignored"
            }) else {
                _ = removePending(operationID)
                return [retirement(operation, code: "SCENE_SEGMENT_DIVERGED")]
            }
            _ = removePending(operationID)
            return [.complete(completion(
                operation,
                status: "error",
                code: operation.errorCode ?? "SCENE_SEGMENT_FAILED",
                projectionReleased: true
            ))]
        }
    }

    private func transition(
        _ operationID: String,
        _ input: PendingOperation,
        to phase: AOSDesktopWorldSceneBarrierPhase,
        code: String?
    ) -> [AOSDesktopWorldSceneBarrierAction] {
        var operation = input
        operation.phase = phase
        operation.results = [:]
        operation.errorCode = code ?? operation.errorCode
        pending[operationID] = operation
        return [.broadcast(broadcast(operationID, operation))]
    }

    private func broadcast(
        _ operationID: String,
        _ operation: PendingOperation
    ) -> AOSDesktopWorldSceneBarrierBroadcast {
        AOSDesktopWorldSceneBarrierBroadcast(
            operationID: operationID,
            phase: operation.phase,
            leaseKey: operation.leaseKey,
            owner: operation.owner,
            resource: operation.resource,
            operation: operation.operationPayload,
            canvasGeneration: operation.canvasGeneration,
            topologyGeneration: operation.topologyGeneration
        )
    }

    private func completion(
        _ operation: PendingOperation,
        status: String,
        code: String?,
        projectionReleased: Bool = false
    ) -> AOSDesktopWorldSceneResultCompletion {
        var result: [String: Any] = [
            "lease_key": operation.leaseKey,
            "operation": operation.operation,
            "resource": operation.resource,
            "status": status,
        ]
        if let code { result["code"] = code }
        if projectionReleased { result["projection_released"] = true }
        if operation.releaseLeaseOnCompletion { result["release_lease"] = true }
        if status == "ok",
           operation.operation != "prove",
           let primaryID = operation.expected.values.first(where: { $0.index == 0 })?.displayID,
           let snapshot = operation.results[primaryID]?["snapshot"] as? [String: Any] {
            result["snapshot"] = snapshot
        }
        if status == "ok" {
            switch inputGenerationConsensus(operation) {
            case .value(.active(let generation)):
                result["input_generation"] = generation
            case .value(.inactive):
                result["input_generation"] = NSNull()
            case .absent, .invalid:
                break
            }
        }
        if status == "ok", operation.operation == "prove" {
            guard let proof = framebufferProofCompletion(operation) else {
                result["status"] = "error"
                result["code"] = "SCENE_SEGMENT_FAILED"
                return AOSDesktopWorldSceneResultCompletion(payload: result)
            }
            result["proof"] = proof
        }
        return AOSDesktopWorldSceneResultCompletion(payload: result)
    }

    private func framebufferProofCompletion(_ operation: PendingOperation) -> [String: Any]? {
        guard let proofID = operation.operationPayload["proofId"] as? String,
              let expectedRevision = operation.operationPayload["expectedRevision"] as? Int,
              expectedRevision >= 0,
              let expectedDigest = operation.operationPayload["expectedExtensionDigest"] as? String,
              expectedDigest.utf8.count == 64,
              operation.results.count == operation.expected.count else { return nil }
        var passedSegments = 0
        var maximumDuration = 0.0
        for payload in operation.results.values {
            guard let proof = payload["proof"] as? [String: Any],
                  Set(proof.keys) == Set([
                    "extension_digest", "passed", "pixels_persisted", "pixels_returned",
                    "proof_id", "readback_duration_ms", "resource_revision",
                  ]),
                  proof["proof_id"] as? String == proofID,
                  proof["extension_digest"] as? String == expectedDigest,
                  proof["resource_revision"] as? Int == expectedRevision,
                  proof["pixels_persisted"] as? Bool == false,
                  proof["pixels_returned"] as? Bool == false,
                  let segmentPassed = proof["passed"] as? Bool,
                  let readbackDuration = (proof["readback_duration_ms"] as? NSNumber)?.doubleValue,
                  readbackDuration >= 0,
                  readbackDuration <= 1_000 else { return nil }
            if segmentPassed { passedSegments += 1 }
            maximumDuration = max(maximumDuration, readbackDuration)
        }
        return [
            "contract": "aos.desktop-world.framebuffer-proof.result.v1",
            "extension_digest": expectedDigest,
            "max_readback_duration_ms": maximumDuration,
            "passed": passedSegments == operation.expected.count,
            "passed_segment_count": passedSegments,
            "pixels_persisted": false,
            "pixels_returned": false,
            "proof_id": proofID,
            "resource_revision": expectedRevision,
            "segment_count": operation.expected.count,
        ]
    }

    private func retirement(
        _ operation: PendingOperation,
        code: String
    ) -> AOSDesktopWorldSceneBarrierAction {
        .retire(AOSDesktopWorldSceneStageRetirement(
            completion: completion(
                operation,
                status: "error",
                code: code,
                projectionReleased: true
            ),
            canvasGeneration: operation.canvasGeneration,
            topologyGeneration: operation.topologyGeneration
        ))
    }

    private func removePending(_ operationID: String) -> PendingOperation? {
        guard let operation = pending.removeValue(forKey: operationID) else { return nil }
        pendingLeaseKeys.remove(operation.leaseKey)
        return operation
    }

    private func inputGenerationConsensus(
        _ operation: PendingOperation
    ) -> InputGenerationConsensus {
        var values: [InputGeneration] = []
        var absent = 0
        for payload in operation.results.values {
            if let generation = payload["input_generation"] as? String {
                guard !generation.isEmpty, generation.utf8.count <= 128 else { return .invalid }
                values.append(.active(generation))
            } else if payload["input_generation"] is NSNull {
                values.append(.inactive)
            } else if payload.keys.contains("input_generation") {
                return .invalid
            } else {
                absent += 1
            }
        }
        if absent == operation.results.count { return .absent }
        guard absent == 0, let first = values.first,
              values.allSatisfy({ $0 == first }) else { return .invalid }
        return .value(first)
    }

    private func integer(_ value: Any?) -> Int? {
        if let value = value as? Int { return value }
        return (value as? NSNumber)?.intValue
    }

    private func uint32(_ value: Any?) -> UInt32? {
        guard let raw = (value as? NSNumber)?.int64Value, raw >= 0, raw <= Int64(UInt32.max) else { return nil }
        return UInt32(raw)
    }

    private func uint64(_ value: Any?) -> UInt64? {
        guard let raw = (value as? NSNumber)?.int64Value, raw >= 0 else { return nil }
        return UInt64(raw)
    }

}
