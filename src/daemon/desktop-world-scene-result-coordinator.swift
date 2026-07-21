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
    "SCENE_OWNER_DISCONNECTED",
    "SCENE_PROJECTION_FAILED",
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
            guard statuses.count == 1,
                  let status = statuses.first,
                  status == "ok" || status == "ignored" else {
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
            guard statuses == Set(["ok"]),
                  let preparedFingerprint = operation.preparedFingerprint,
                  fingerprints == Set([preparedFingerprint]) else {
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
            return [.complete(completion(operation, status: "error", code: operation.errorCode ?? "SCENE_SEGMENT_FAILED"))]
        case .release:
            guard operation.results.values.allSatisfy({
                guard let status = $0["status"] as? String else { return false }
                return status == "ok" || status == "ignored"
            }) else {
                _ = removePending(operationID)
                return [retirement(operation, code: "SCENE_SEGMENT_DIVERGED")]
            }
            _ = removePending(operationID)
            return [.complete(completion(operation, status: "error", code: operation.errorCode ?? "SCENE_SEGMENT_FAILED"))]
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
        code: String?
    ) -> AOSDesktopWorldSceneResultCompletion {
        var result: [String: Any] = [
            "lease_key": operation.leaseKey,
            "operation": operation.operation,
            "resource": operation.resource,
            "status": status,
        ]
        if let code { result["code"] = code }
        if operation.releaseLeaseOnCompletion { result["release_lease"] = true }
        if status == "ok",
           let primaryID = operation.expected.values.first(where: { $0.index == 0 })?.displayID,
           let snapshot = operation.results[primaryID]?["snapshot"] as? [String: Any] {
            result["snapshot"] = snapshot
        }
        return AOSDesktopWorldSceneResultCompletion(payload: result)
    }

    private func retirement(
        _ operation: PendingOperation,
        code: String
    ) -> AOSDesktopWorldSceneBarrierAction {
        .retire(AOSDesktopWorldSceneStageRetirement(
            completion: completion(operation, status: "error", code: code),
            canvasGeneration: operation.canvasGeneration,
            topologyGeneration: operation.topologyGeneration
        ))
    }

    private func removePending(_ operationID: String) -> PendingOperation? {
        guard let operation = pending.removeValue(forKey: operationID) else { return nil }
        pendingLeaseKeys.remove(operation.leaseKey)
        return operation
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
