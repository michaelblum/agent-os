import CryptoKit
import CoreFoundation
import Foundation

enum AOSOperationCoreError: Error, Equatable, CustomStringConvertible {
    case invalidRecord(String)
    case storeUnavailable
    case storeCorrupt
    case storeLocked
    case generationConflict
    case ownerMismatch
    case callerNotAuthenticated
    case unsupportedControlOrigin
    case operationNotFound
    case invalidTransition
    case barrierClosed
    case barrierNotClosed
    case barrierGenerationConflict
    case adapterRegistryConflict
    case resourceDeclarationConflict
    case resourceBusy
    case fanoutExhausted
    case resourceCASConflict
    case spawnRecordCapacity
    case idempotencyConflict
    case residualsPresent
    case reconciliationIncomplete
    case staleRecoveryClaim
    case tapUnavailable
    case artifactCustodyUnavailable
    case artifactRetainUnavailable
    case artifactIdentityMismatch
    case artifactDestinationExists
    case recordingBoundsExceeded
    case recordingTargetDrift
    case recordingStartupDeadlineExceeded
    case recordingNoFrames
    case recordingArtifactMissing
    case recordingEncoderFailed
    case recordingCleanupRequired

    var code: String {
        switch self {
        case .invalidRecord: return "OPERATION_RECORD_INVALID"
        case .storeUnavailable: return "OPERATION_STORE_UNAVAILABLE"
        case .storeCorrupt: return "OPERATION_STORE_CORRUPT"
        case .storeLocked: return "OPERATION_STORE_LOCKED"
        case .generationConflict: return "OPERATION_GENERATION_CONFLICT"
        case .ownerMismatch: return "OPERATION_OWNER_MISMATCH"
        case .callerNotAuthenticated: return "OPERATION_CALLER_NOT_AUTHENTICATED"
        case .unsupportedControlOrigin: return "OPERATION_CONTROL_ORIGIN_UNSUPPORTED"
        case .operationNotFound: return "OPERATION_NOT_FOUND"
        case .invalidTransition: return "OPERATION_TRANSITION_INVALID"
        case .barrierClosed: return "OPERATION_BARRIER_CLOSED"
        case .barrierNotClosed: return "OPERATION_BARRIER_NOT_CLOSED"
        case .barrierGenerationConflict: return "OPERATION_BARRIER_GENERATION_CONFLICT"
        case .adapterRegistryConflict: return "OPERATION_ADAPTER_REGISTRY_CONFLICT"
        case .resourceDeclarationConflict: return "OPERATION_RESOURCE_DECLARATION_CONFLICT"
        case .resourceBusy: return "OPERATION_RESOURCE_BUSY"
        case .fanoutExhausted: return "OPERATION_RESOURCE_FANOUT_EXHAUSTED"
        case .resourceCASConflict: return "OPERATION_RESOURCE_CAS_CONFLICT"
        case .spawnRecordCapacity: return "OPERATION_SPAWN_RECORD_CAPACITY"
        case .idempotencyConflict: return "OPERATION_IDEMPOTENCY_CONFLICT"
        case .residualsPresent: return "OPERATION_RESIDUALS_PRESENT"
        case .reconciliationIncomplete: return "OPERATION_RECONCILIATION_INCOMPLETE"
        case .staleRecoveryClaim: return "OPERATION_RECOVERY_CLAIM_STALE"
        case .tapUnavailable: return "OPERATION_TAP_UNAVAILABLE"
        case .artifactCustodyUnavailable: return "OPERATION_ARTIFACT_CUSTODY_UNAVAILABLE"
        case .artifactRetainUnavailable: return "OPERATION_ARTIFACT_RETAIN_UNAVAILABLE"
        case .artifactIdentityMismatch: return "OPERATION_ARTIFACT_IDENTITY_MISMATCH"
        case .artifactDestinationExists: return "OPERATION_ARTIFACT_DESTINATION_EXISTS"
        case .recordingBoundsExceeded: return "SCREEN_RECORDING_BOUNDS_EXCEEDED"
        case .recordingTargetDrift: return "SCREEN_RECORDING_TARGET_DRIFT"
        case .recordingStartupDeadlineExceeded: return "SCREEN_RECORDING_STARTUP_DEADLINE_EXCEEDED"
        case .recordingNoFrames: return "SCREEN_RECORDING_NO_FRAMES"
        case .recordingArtifactMissing: return "SCREEN_RECORDING_ARTIFACT_MISSING"
        case .recordingEncoderFailed: return "SCREEN_RECORDING_ENCODER_FAILED"
        case .recordingCleanupRequired: return "SCREEN_RECORDING_CLEANUP_REQUIRED"
        }
    }

    var description: String {
        if case let .invalidRecord(field) = self { return "\(code):\(field)" }
        return code
    }
}

enum AOSOperationDigestDomain: String, CaseIterable {
    case resourceDeclaration = "resource-declaration"
    case resourceDeclarationSet = "resource-declaration-set"
    case registeredOperationSet = "registered-operation-set"
    case selectedOperationSet = "selected-operation-set"
    case subscriberSet = "subscriber-set"
    case claimSet = "claim-set"
    case openBarrierSnapshot = "open-barrier-snapshot"
    case barrierSnapshot = "barrier-snapshot"
    case callerEvidence = "caller-evidence"
    case residualSet = "residual-set"
    case reattachToken = "reattach-token"
}

enum AOSOperationDigest {
    static func canonicalData<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    static func sha256<T: Encodable>(domain: AOSOperationDigestDomain, _ value: T) throws -> String {
        var data = Data("aos:\(domain.rawValue):v1\n".utf8)
        data.append(try canonicalData(value))
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func empty(_ domain: AOSOperationDigestDomain) -> String {
        try! sha256(domain: domain, [String]())
    }
}

struct AOSOperationIdentity: Codable, Equatable, Hashable, Comparable {
    let id: String
    let generation: UInt64

    static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id ? lhs.generation < rhs.generation : lhs.id < rhs.id
    }
}

struct AOSArtifactActionRequest: Equatable {
    let requestID: String
    let canonicalParameterDigest: String
    let selector: AOSOperationIdentity
    let destinationPath: String?
}

func aosDecodeArtifactActionRequest(
    action: String,
    data: [String: Any]
) throws -> AOSArtifactActionRequest {
    let selectorActions = Set([
        "artifact_reveal", "artifact_remove", "artifact_retain",
    ])
    let releaseAction = "artifact_release"
    let expectedKeys: Set<String>
    if selectorActions.contains(action) {
        expectedKeys = ["request_id", "canonical_parameter_digest", "selector"]
    } else if action == releaseAction {
        expectedKeys = [
            "request_id", "canonical_parameter_digest", "selector", "destination",
        ]
    } else {
        throw AOSOperationCoreError.invalidRecord("artifact_action")
    }
    guard Set(data.keys) == expectedKeys,
          let requestID = data["request_id"] as? String,
          aosArtifactWireIdentifier(requestID),
          let digest = data["canonical_parameter_digest"] as? String,
          digest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
          let selector = data["selector"] as? [String: Any],
          Set(selector.keys) == ["artifact_id", "artifact_generation"],
          let artifactID = selector["artifact_id"] as? String,
          aosArtifactWireIdentifier(artifactID),
          let generation = aosArtifactExactGeneration(
            selector["artifact_generation"]
          ) else {
        throw AOSOperationCoreError.invalidRecord("artifact_action_request")
    }
    let destination: String?
    if action == releaseAction {
        guard let value = data["destination"] as? String,
              value.first == "/",
              value.count <= 4_096,
              !value.contains("\0") else {
            throw AOSOperationCoreError.invalidRecord("artifact_release_destination")
        }
        destination = value
    } else {
        destination = nil
    }
    return AOSArtifactActionRequest(
        requestID: requestID,
        canonicalParameterDigest: digest,
        selector: AOSOperationIdentity(id: artifactID, generation: generation),
        destinationPath: destination
    )
}

private func aosArtifactWireIdentifier(_ value: String) -> Bool {
    !value.isEmpty
        && value.count <= 128
        && value.range(
            of: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
            options: .regularExpression
        ) != nil
}

private func aosArtifactExactGeneration(_ value: Any?) -> UInt64? {
    guard let number = value as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.compare(NSNumber(value: UInt64(1))) != .orderedAscending,
          number.compare(NSNumber(value: UInt64(9_007_199_254_740_991)))
            != .orderedDescending else { return nil }
    let result = number.uint64Value
    return NSNumber(value: result).compare(number) == .orderedSame ? result : nil
}

struct AOSMechanicalOwnerRoot: Codable, Equatable, Hashable {
    let ownerID: String
    let effectiveUID: UInt32
    let pid: Int32
    let pidGeneration: UInt64
    let executableIdentityDigest: String
    let verifiedBinding: AOSOwnerRootBinding?

    init(
        ownerID: String,
        effectiveUID: UInt32,
        pid: Int32,
        pidGeneration: UInt64,
        executableIdentityDigest: String,
        verifiedBinding: AOSOwnerRootBinding? = nil
    ) {
        self.ownerID = ownerID
        self.effectiveUID = effectiveUID
        self.pid = pid
        self.pidGeneration = pidGeneration
        self.executableIdentityDigest = executableIdentityDigest
        self.verifiedBinding = verifiedBinding
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.ownerID == rhs.ownerID
            && lhs.effectiveUID == rhs.effectiveUID
            && lhs.pid == rhs.pid
            && lhs.pidGeneration == rhs.pidGeneration
            && lhs.executableIdentityDigest == rhs.executableIdentityDigest
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(ownerID)
        hasher.combine(effectiveUID)
        hasher.combine(pid)
        hasher.combine(pidGeneration)
        hasher.combine(executableIdentityDigest)
    }
}

struct AOSOperationAttribution: Codable, Equatable {
    var clientID: String?
    var agentID: String?
    var projectID: String?
    var taskID: String?
    var runID: String?
    var skillID: String?
    var targetID: String?
    var capabilityLabel: String?
    var retryID: String?

    init(
        clientID: String? = nil,
        agentID: String? = nil,
        projectID: String? = nil,
        taskID: String? = nil,
        runID: String? = nil,
        skillID: String? = nil,
        targetID: String? = nil,
        capabilityLabel: String? = nil,
        retryID: String? = nil
    ) {
        self.clientID = clientID
        self.agentID = agentID
        self.projectID = projectID
        self.taskID = taskID
        self.runID = runID
        self.skillID = skillID
        self.targetID = targetID
        self.capabilityLabel = capabilityLabel
        self.retryID = retryID
    }

    static func validatingPublicValue(_ value: Any?) throws -> Self {
        guard let value else { return Self() }
        guard let object = value as? [String: Any] else {
            throw AOSOperationCoreError.invalidRecord("asserted_attribution")
        }
        let fields: [(wire: String, value: String?)] = [
            ("client_id", object["client_id"] as? String),
            ("agent_id", object["agent_id"] as? String),
            ("project_id", object["project_id"] as? String),
            ("task_id", object["task_id"] as? String),
            ("run_id", object["run_id"] as? String),
            ("skill_id", object["skill_id"] as? String),
            ("target_id", object["target_id"] as? String),
            ("capability_label", object["capability_label"] as? String),
            ("retry_id", object["retry_id"] as? String),
        ]
        let allowedKeys = Set(fields.map { $0.wire })
        guard Set(object.keys).isSubset(of: allowedKeys) else {
            throw AOSOperationCoreError.invalidRecord("asserted_attribution")
        }
        for field in fields where object.keys.contains(field.wire) {
            guard let identifier = field.value,
                  identifier.count <= 128,
                  identifier.range(
                    of: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
                    options: .regularExpression
                  ) != nil else {
                throw AOSOperationCoreError.invalidRecord("asserted_attribution")
            }
        }
        return Self(
            clientID: fields[0].value,
            agentID: fields[1].value,
            projectID: fields[2].value,
            taskID: fields[3].value,
            runID: fields[4].value,
            skillID: fields[5].value,
            targetID: fields[6].value,
            capabilityLabel: fields[7].value,
            retryID: fields[8].value
        )
    }

    var publicValue: [String: String] {
        let fields: [(String, String?)] = [
            ("client_id", clientID),
            ("agent_id", agentID),
            ("project_id", projectID),
            ("task_id", taskID),
            ("run_id", runID),
            ("skill_id", skillID),
            ("target_id", targetID),
            ("capability_label", capabilityLabel),
            ("retry_id", retryID),
        ]
        return Dictionary(uniqueKeysWithValues: fields.compactMap { key, value in
            value.map { (key, $0) }
        })
    }
}

enum AOSOperationLifecycleState: String, Codable, CaseIterable {
    case prepared, starting, active, stopping, cleanupRequired = "cleanup_required", recovering, terminal
}

enum AOSStreamLifecycleState: String, Codable {
    case prepared, starting, active, stopping, cleanupRequired = "cleanup_required", recovering, terminal
}

enum AOSTapLifecycleState: String, Codable {
    case prepared, active, expired, revoked, cleanupRequired = "cleanup_required", recovering, terminal
}

enum AOSTapChannel: String, Codable { case metadata, data }

struct AOSTapBounds: Codable, Equatable {
    let rateItemsPerSecond: UInt64
    let sampleEvery: UInt64
    let maxQueueItems: UInt64
    let maxItems: UInt64
    let maxBytes: UInt64
    let idleTimeoutMilliseconds: UInt64
    let durationMilliseconds: UInt64

    init(
        rateItemsPerSecond: UInt64,
        sampleEvery: UInt64,
        maxQueueItems: UInt64,
        maxItems: UInt64,
        maxBytes: UInt64,
        idleTimeoutMilliseconds: UInt64,
        durationMilliseconds: UInt64
    ) throws {
        guard (1...60).contains(rateItemsPerSecond),
              (1...10_000).contains(sampleEvery),
              (1...1_024).contains(maxQueueItems),
              (1...10_000).contains(maxItems),
              (1...10_485_760).contains(maxBytes),
              (1...300_000).contains(idleTimeoutMilliseconds),
              (1...300_000).contains(durationMilliseconds) else {
            throw AOSOperationCoreError.invalidRecord("tap_bounds")
        }
        self.rateItemsPerSecond = rateItemsPerSecond
        self.sampleEvery = sampleEvery
        self.maxQueueItems = maxQueueItems
        self.maxItems = maxItems
        self.maxBytes = maxBytes
        self.idleTimeoutMilliseconds = idleTimeoutMilliseconds
        self.durationMilliseconds = durationMilliseconds
    }
}

struct AOSTapCounters: Codable, Equatable {
    var sourceSeen: UInt64 = 0
    var sampleSkipped: UInt64 = 0
    var rateSkipped: UInt64 = 0
    var enqueuedItems: UInt64 = 0
    var enqueuedBytes: UInt64 = 0
    var deliveredItems: UInt64 = 0
    var deliveredBytes: UInt64 = 0
    var queueHighWater: UInt64 = 0
    var overflowRejectedCount: UInt64 = 0
}

enum AOSTapBoundReason: String, Codable {
    case maxItemsReached = "max_items_reached"
    case maxBytesReachedOrWouldExceed = "max_bytes_reached_or_would_exceed"
    case queueFull = "queue_full"
    case idleTimeout = "idle_timeout"
    case durationElapsed = "duration_elapsed"
}

enum AOSArtifactLifecycleState: String, Codable {
    case transient, offered, released, retained, removing, removed
    case cleanupRequired = "cleanup_required"
    case recovering
}

enum AOSClaimSetLifecycleState: String, Codable {
    case prepared, reserving, committed, rollingBack = "rolling_back"
    case cleanupRequired = "cleanup_required"
    case recovering, terminal
}

enum AOSResourceClaimLifecycleState: String, Codable {
    case prepared, active, releasing, cleanupRequired = "cleanup_required", recovering, terminal
}

enum AOSResourceBrokerLifecycleState: String, Codable {
    case prepared, starting, active, stopping, cleanupRequired = "cleanup_required", recovering, terminal
}

enum AOSHostBarrierLifecycleState: String, Codable {
    case bootReconciling = "boot_reconciling"
    case open, closing, closed, cleanupRequired = "cleanup_required", recovering
}

enum AOSRecoveryLifecycleState: String, Codable {
    case idle, scanning, recovering, cleanupRequired = "cleanup_required"
    case blockedUnresolved = "blocked_unresolved"
    case terminal
}

enum AOSOperationOutcome: String, Codable {
    case succeeded, cancelled, killed, rejected, failed, crashed, timedOut = "timed_out", orphaned
}

enum AOSStopIntent: String, Codable {
    case complete, cancel, kill, ownerKill = "owner_kill", hostStop = "host_stop"
    case deadline, peerLost = "peer_lost", transportLost = "transport_lost"
    case permissionRevoked = "permission_revoked", adapterFailed = "adapter_failed"
}

struct AOSOperationRecord: Codable, Equatable {
    let identity: AOSOperationIdentity
    let daemonGeneration: UInt64
    let ownerRoot: AOSMechanicalOwnerRoot
    let attribution: AOSOperationAttribution
    let capabilityID: String
    let adapterRegistrationID: String
    let adapterRegistrationRevision: UInt64
    var state: AOSOperationLifecycleState
    var stopIntent: AOSStopIntent?
    var outcome: AOSOperationOutcome?
    var residualDigest: String?
    var requestedBounds: AOSOperationRequestedBounds?
    var progress: AOSOperationProgress?
    let createdAtNanoseconds: UInt64
    var updatedAtNanoseconds: UInt64
}

struct AOSStreamRecord: Codable, Equatable {
    let identity: AOSOperationIdentity
    let parentOperation: AOSOperationIdentity
    let daemonGeneration: UInt64
    var state: AOSStreamLifecycleState
    var residualDigest: String?
    var frameCount: UInt64 = 0
    var byteCount: UInt64 = 0
    var updatedAtNanoseconds: UInt64 = 0
}

struct AOSTapRecord: Codable, Equatable {
    let identity: AOSOperationIdentity
    let parentOperation: AOSOperationIdentity
    let daemonGeneration: UInt64
    let channel: AOSTapChannel
    let bounds: AOSTapBounds
    let follow: Bool
    var state: AOSTapLifecycleState
    var counters: AOSTapCounters
    var terminalBoundReason: AOSTapBoundReason?
    var residualDigest: String?
    let preparedAtNanoseconds: UInt64
    var activatedAtNanoseconds: UInt64?
    var updatedAtNanoseconds: UInt64
}

enum AOSArtifactRecoveryDisposition: String, Codable {
    case releaseVerification = "release_verification"
    case retentionVerification = "retention_verification"
    case removalVerification = "removal_verification"
}

struct AOSOperationRequestedBounds: Codable, Equatable {
    let durationMilliseconds: UInt64
    let frameRate: UInt64
    let pixelCount: UInt64
    let queueFrames: UInt64
    let maximumOutputBytes: UInt64
}

struct AOSOperationProgress: Codable, Equatable {
    var frameCount: UInt64
    var byteCount: UInt64
    var elapsedMilliseconds: UInt64
    var droppedFrameCount: UInt64
}

enum AOSArtifactPendingAction: String, Codable {
    case remove
}

struct AOSArtifactFileIdentity: Codable, Equatable {
    let rootIdentityDigest: String
    let relativeLocatorDigest: String
    let device: UInt64
    let inode: UInt64
    let byteCount: UInt64
    let contentDigest: String
    let mediaType: String
}

enum AOSScreenRecordingTerminalTruth {
    static func requireFrames(_ frameCount: UInt64) throws {
        guard frameCount > 0 else {
            throw AOSOperationCoreError.recordingNoFrames
        }
    }

    static func requireFinalizedArtifact(
        frameCount: UInt64,
        artifact: AOSArtifactFileIdentity?,
        filePresent: Bool
    ) throws {
        try requireFrames(frameCount)
        guard let artifact,
              artifact.byteCount > 0,
              filePresent else {
            throw AOSOperationCoreError.recordingArtifactMissing
        }
    }
}

enum AOSArtifactReleasePhase: String, Codable {
    case prepared
    case destinationLinked = "destination_linked"
}

struct AOSArtifactReleaseDestinationIdentity: Codable, Equatable {
    let absolutePath: String
    let pathDigest: String
    let parentDevice: UInt64
    let parentInode: UInt64
}

struct AOSArtifactReleaseDestinationFileIdentity: Codable, Equatable {
    let device: UInt64
    let inode: UInt64
    let byteCount: UInt64
    let contentDigest: String

    func matches(_ source: AOSArtifactFileIdentity) -> Bool {
        device == source.device
            && inode == source.inode
            && byteCount == source.byteCount
            && contentDigest == source.contentDigest
    }
}

struct AOSArtifactReleaseRecord: Codable, Equatable {
    let releaseGeneration: UInt64
    let artifact: AOSOperationIdentity
    let daemonGeneration: UInt64
    let sourceIdentity: AOSArtifactFileIdentity
    let destinationIdentity: AOSArtifactReleaseDestinationIdentity
    var phase: AOSArtifactReleasePhase
    var destinationFileIdentity: AOSArtifactReleaseDestinationFileIdentity?
}

enum AOSArtifactReleaseObservation: Equatable {
    case absent
    case exact
    case conflicting
}

enum AOSArtifactReleaseResolution: Equatable {
    case released
    case rolledBack
    case residual
}

struct AOSArtifactReleaseExecutionDependencies {
    let linkDestination: () throws -> AOSArtifactReleaseDestinationFileIdentity
    let persistDestinationLinked: (AOSArtifactReleaseDestinationFileIdentity) throws -> Void
    let removeSource: () throws -> Void
    let persistReleased: (AOSArtifactReleaseDestinationFileIdentity) throws -> Void
}

struct AOSArtifactReleaseRecoveryDependencies {
    let removeExactDestination: () throws -> Void
    let persistResolution: (AOSArtifactReleaseResolution) throws -> Void
}

enum AOSArtifactReleaseCoordinator {
    static func execute(
        _ release: AOSArtifactReleaseRecord,
        dependencies: AOSArtifactReleaseExecutionDependencies
    ) throws {
        guard release.releaseGeneration > 0,
              release.daemonGeneration > 0,
              release.artifact.generation > 0,
              release.phase == .prepared,
              release.destinationFileIdentity == nil,
              !release.destinationIdentity.absolutePath.isEmpty,
              release.destinationIdentity.pathDigest.count == 64 else {
            throw AOSOperationCoreError.invalidRecord("artifact_release_record")
        }
        let linked = try dependencies.linkDestination()
        guard linked.matches(release.sourceIdentity) else {
            throw AOSOperationCoreError.artifactIdentityMismatch
        }
        try dependencies.persistDestinationLinked(linked)
        try dependencies.removeSource()
        try dependencies.persistReleased(linked)
    }

    static func resolution(
        source: AOSArtifactReleaseObservation,
        destination: AOSArtifactReleaseObservation
    ) -> AOSArtifactReleaseResolution {
        if source == .exact, destination != .conflicting { return .rolledBack }
        if source == .absent, destination == .exact { return .released }
        return .residual
    }

    @discardableResult
    static func recover(
        source: AOSArtifactReleaseObservation,
        destination: AOSArtifactReleaseObservation,
        dependencies: AOSArtifactReleaseRecoveryDependencies
    ) throws -> AOSArtifactReleaseResolution {
        var result = resolution(source: source, destination: destination)
        if result == .rolledBack, destination == .exact {
            do {
                try dependencies.removeExactDestination()
            } catch {
                result = .residual
            }
        }
        try dependencies.persistResolution(result)
        return result
    }
}

struct AOSArtifactCustodyReceipt: Codable, Equatable {
    enum Action: String, Codable {
        case remove, release
    }

    let action: Action
    let completedAtNanoseconds: UInt64
    let destinationIdentityDigest: String?
}

struct AOSArtifactRecord: Codable, Equatable {
    let identity: AOSOperationIdentity
    let parentOperation: AOSOperationIdentity
    let daemonGeneration: UInt64
    var state: AOSArtifactLifecycleState
    var recoveryOriginState: AOSArtifactLifecycleState?
    var recoveryDisposition: AOSArtifactRecoveryDisposition?
    var custodyDigest: String?
    var fileIdentity: AOSArtifactFileIdentity?
    var pendingAction: AOSArtifactPendingAction?
    var release: AOSArtifactReleaseRecord? = nil
    var custodyReceipt: AOSArtifactCustodyReceipt?
    var updatedAtNanoseconds: UInt64 = 0
}

enum AOSResourceAdmissionMode: String, Codable {
    case exclusive, multiplexable
}

struct AOSResourceDeclaration: Codable, Equatable, Hashable {
    let adapterRegistrationID: String
    let adapterRegistrationRevision: UInt64
    let resourceKey: String
    let admissionMode: AOSResourceAdmissionMode
    let fanoutBound: UInt64?
    let declarationDigest: String

    static func make(
        adapterRegistrationID: String,
        adapterRegistrationRevision: UInt64,
        resourceKey: String,
        admissionMode: AOSResourceAdmissionMode,
        fanoutBound: UInt64? = nil
    ) throws -> Self {
        guard !adapterRegistrationID.isEmpty, adapterRegistrationRevision > 0, !resourceKey.isEmpty else {
            throw AOSOperationCoreError.invalidRecord("resource_declaration")
        }
        switch admissionMode {
        case .exclusive where fanoutBound != nil:
            throw AOSOperationCoreError.invalidRecord("exclusive_fanout_bound")
        case .multiplexable where fanoutBound == nil || fanoutBound == 0:
            throw AOSOperationCoreError.invalidRecord("multiplex_fanout_bound")
        default:
            break
        }
        struct DigestInput: Codable {
            let adapterRegistrationID: String
            let adapterRegistrationRevision: UInt64
            let resourceKey: String
            let admissionMode: AOSResourceAdmissionMode
            let fanoutBound: UInt64?

            enum CodingKeys: String, CodingKey {
                case adapterRegistrationID = "adapter_registration_id"
                case adapterRegistrationRevision = "adapter_registration_revision"
                case resourceKey = "resource_key"
                case admissionMode = "admission_mode"
                case fanoutBound = "fanout_bound"
            }
        }
        let digest = try AOSOperationDigest.sha256(domain: .resourceDeclaration, DigestInput(
            adapterRegistrationID: adapterRegistrationID,
            adapterRegistrationRevision: adapterRegistrationRevision,
            resourceKey: resourceKey,
            admissionMode: admissionMode,
            fanoutBound: fanoutBound
        ))
        return Self(
            adapterRegistrationID: adapterRegistrationID,
            adapterRegistrationRevision: adapterRegistrationRevision,
            resourceKey: resourceKey,
            admissionMode: admissionMode,
            fanoutBound: fanoutBound,
            declarationDigest: digest
        )
    }
}

struct AOSOperationAdapterRegistration: Codable, Equatable {
    let id: String
    let revision: UInt64
    let operationClass: String
    let capabilityIDs: [String]
    let resourceDeclarations: [AOSResourceDeclaration]
}

struct AOSAdapterRegistrySnapshot: Codable, Equatable {
    let revision: UInt64
    let registrations: [AOSOperationAdapterRegistration]
    let registeredOperationSetCount: UInt64
    let registeredOperationSetDigest: String
    let resourceDeclarationSetCount: UInt64
    let resourceDeclarationSetDigest: String

    static func make(revision: UInt64, registrations: [AOSOperationAdapterRegistration]) throws -> Self {
        guard revision > 0 else { throw AOSOperationCoreError.invalidRecord("adapter_registry_revision") }
        let ordered = registrations.sorted { lhs, rhs in
            lhs.id == rhs.id ? lhs.revision < rhs.revision : lhs.id < rhs.id
        }
        guard Set(ordered.map(\.id)).count == ordered.count else {
            throw AOSOperationCoreError.invalidRecord("duplicate_adapter_registration")
        }
        let declarations = ordered.flatMap(\.resourceDeclarations).sorted { $0.resourceKey < $1.resourceKey }
        guard Set(declarations.map(\.resourceKey)).count == declarations.count else {
            throw AOSOperationCoreError.invalidRecord("duplicate_resource_key")
        }
        for registration in ordered {
            guard registration.revision > 0,
                  registration.resourceDeclarations.allSatisfy({
                      $0.adapterRegistrationID == registration.id
                          && $0.adapterRegistrationRevision == registration.revision
                  }) else {
                throw AOSOperationCoreError.invalidRecord("adapter_declaration_binding")
            }
        }
        struct RegisteredOperationMember: Codable {
            let adapterRegistrationID: String
            let adapterRegistrationRevision: UInt64
            let capabilityID: String
            let operationClass: String
            let resourceDeclarationSetDigest: String

            enum CodingKeys: String, CodingKey {
                case adapterRegistrationID = "adapter_registration_id"
                case adapterRegistrationRevision = "adapter_registration_revision"
                case capabilityID = "capability_id"
                case operationClass = "operation_class"
                case resourceDeclarationSetDigest = "resource_declaration_set_digest"
            }
        }
        struct DeclarationMember: Codable {
            let adapterRegistrationID: String
            let adapterRegistrationRevision: UInt64
            let resourceKey: String
            let admissionMode: AOSResourceAdmissionMode
            let declarationDigest: String
            let fanoutBound: UInt64?

            enum CodingKeys: String, CodingKey {
                case adapterRegistrationID = "adapter_registration_id"
                case adapterRegistrationRevision = "adapter_registration_revision"
                case resourceKey = "resource_key"
                case admissionMode = "admission_mode"
                case declarationDigest = "declaration_digest"
                case fanoutBound = "fanout_bound"
            }
        }
        let declarationMembers = declarations.map {
            DeclarationMember(
                adapterRegistrationID: $0.adapterRegistrationID,
                adapterRegistrationRevision: $0.adapterRegistrationRevision,
                resourceKey: $0.resourceKey,
                admissionMode: $0.admissionMode,
                declarationDigest: $0.declarationDigest,
                fanoutBound: $0.fanoutBound
            )
        }
        let declarationDigest = try AOSOperationDigest.sha256(
            domain: .resourceDeclarationSet,
            declarationMembers
        )
        let registeredMembers = ordered.flatMap { registration in
            registration.capabilityIDs.sorted().map {
                RegisteredOperationMember(
                    adapterRegistrationID: registration.id,
                    adapterRegistrationRevision: registration.revision,
                    capabilityID: $0,
                    operationClass: registration.operationClass,
                    resourceDeclarationSetDigest: declarationDigest
                )
            }
        }
        let registeredDigest = try AOSOperationDigest.sha256(domain: .registeredOperationSet, registeredMembers)
        return Self(
            revision: revision,
            registrations: ordered,
            registeredOperationSetCount: UInt64(registeredMembers.count),
            registeredOperationSetDigest: registeredDigest,
            resourceDeclarationSetCount: UInt64(declarations.count),
            resourceDeclarationSetDigest: declarationDigest
        )
    }

    func registration(id: String, revision: UInt64) -> AOSOperationAdapterRegistration? {
        registrations.first { $0.id == id && $0.revision == revision }
    }

    func declaration(resourceKey: String) -> AOSResourceDeclaration? {
        registrations.lazy.flatMap(\.resourceDeclarations).first { $0.resourceKey == resourceKey }
    }
}

struct AOSResourceClaimRequest: Codable, Equatable {
    let adapterRegistrationID: String
    let adapterRegistrationRevision: UInt64
    let resourceKey: String
    let admissionMode: AOSResourceAdmissionMode
    let resourceDeclarationDigest: String
    let expectedResourceGeneration: UInt64
    let expectedBrokerGeneration: UInt64?
    let expectedSubscriberSetRevision: UInt64?
    let expectedSubscriberSetCount: UInt64?
    let expectedSubscriberSetDigest: String?
}

enum AOSClaimSetRecoveryDisposition: String, Codable {
    case rollbackPending = "rollback_pending"
    case commitPendingHandoff = "commit_pending_handoff"
}

struct AOSResourceTransactionRecord: Codable, Equatable {
    let transactionID: String
    let attemptSequence: UInt64
    let operation: AOSOperationIdentity
    let daemonGeneration: UInt64
    let expectedBarrierGeneration: UInt64
    let expectedAdapterRegistryRevision: UInt64
    let expectedResourceDeclarationSetCount: UInt64
    let expectedResourceDeclarationSetDigest: String
    let canonicalRequests: [AOSResourceClaimRequest]
    let claimSetDigest: String
    var state: AOSClaimSetLifecycleState
    var recoveryOriginState: AOSClaimSetLifecycleState?
    var recoveryDisposition: AOSClaimSetRecoveryDisposition?
    var outcome: AOSOperationOutcome?
}

struct AOSResourceClaimRecord: Codable, Equatable {
    let claimID: String
    let transactionID: String
    let operation: AOSOperationIdentity
    let daemonGeneration: UInt64
    let resourceKey: String
    let resourceGeneration: UInt64
    let admissionMode: AOSResourceAdmissionMode
    let adapterRegistrationID: String
    let adapterRegistrationRevision: UInt64
    let resourceDeclarationDigest: String
    let adapterRegistryRevision: UInt64
    let resourceDeclarationSetCount: UInt64
    let resourceDeclarationSetDigest: String
    let committedClaimSetDigest: String
    let brokerID: String?
    let brokerGeneration: UInt64?
    let subscriberID: String?
    let reattachTokenDigest: String
    var state: AOSResourceClaimLifecycleState
}

struct AOSResourceSubscriber: Codable, Equatable, Hashable, Comparable {
    let subscriberID: String
    let claimID: String
    let operation: AOSOperationIdentity
    let resourceKey: String
    let resourceGeneration: UInt64

    static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.subscriberID == rhs.subscriberID
            ? lhs.claimID < rhs.claimID
            : lhs.subscriberID < rhs.subscriberID
    }
}

struct AOSResourceBrokerRecord: Codable, Equatable {
    let brokerID: String
    let brokerGeneration: UInt64
    let daemonGeneration: UInt64
    let resourceKey: String
    let resourceGeneration: UInt64
    let adapterRegistrationID: String
    let adapterRegistrationRevision: UInt64
    let resourceDeclarationDigest: String
    let adapterRegistryRevision: UInt64
    let resourceDeclarationSetCount: UInt64
    let resourceDeclarationSetDigest: String
    let committedClaimSetTransactionID: String
    let committedClaimSetDigest: String
    let fanoutBound: UInt64
    var subscribers: [AOSResourceSubscriber]
    var subscriberSetRevision: UInt64
    var subscriberSetDigest: String
    var state: AOSResourceBrokerLifecycleState
}

struct AOSOpenBarrierSnapshot: Codable, Equatable {
    let barrierGeneration: UInt64
    let adapterRegistryRevision: UInt64
    let registeredOperationSetCount: UInt64
    let registeredOperationSetDigest: String
    let snapshotDigest: String

    static func make(barrierGeneration: UInt64, registry: AOSAdapterRegistrySnapshot) throws -> Self {
        struct Input: Codable {
            let barrierGeneration: UInt64
            let adapterRegistryRevision: UInt64
            let registeredOperationSetCount: UInt64
            let registeredOperationSetDigest: String
        }
        let input = Input(
            barrierGeneration: barrierGeneration,
            adapterRegistryRevision: registry.revision,
            registeredOperationSetCount: registry.registeredOperationSetCount,
            registeredOperationSetDigest: registry.registeredOperationSetDigest
        )
        return Self(
            barrierGeneration: barrierGeneration,
            adapterRegistryRevision: registry.revision,
            registeredOperationSetCount: registry.registeredOperationSetCount,
            registeredOperationSetDigest: registry.registeredOperationSetDigest,
            snapshotDigest: try AOSOperationDigest.sha256(domain: .openBarrierSnapshot, input)
        )
    }
}

struct AOSHostBarrierSnapshot: Codable, Equatable {
    let barrierGeneration: UInt64
    let stopOperation: AOSOperationIdentity
    let adapterRegistryRevision: UInt64
    let registeredOperationSetCount: UInt64
    let registeredOperationSetDigest: String
    let selectedOperations: [AOSOperationIdentity]
    let selectedOperationCount: UInt64
    let selectedOperationDigest: String
    let barrierSnapshotDigest: String

    static func make(
        barrierGeneration: UInt64,
        stopOperation: AOSOperationIdentity,
        registry: AOSAdapterRegistrySnapshot,
        selectedOperationRecords: [AOSOperationRecord]
    ) throws -> Self {
        let selectedRecords = selectedOperationRecords.sorted { $0.identity < $1.identity }
        let selected = selectedRecords.map(\.identity)
        struct SelectedOperationMember: Codable {
            let operationID: String
            let operationGeneration: UInt64
            let adapterRegistrationID: String
            let adapterRegistrationRevision: UInt64
            let capabilityID: String

            enum CodingKeys: String, CodingKey {
                case operationID = "operation_id"
                case operationGeneration = "operation_generation"
                case adapterRegistrationID = "adapter_registration_id"
                case adapterRegistrationRevision = "adapter_registration_revision"
                case capabilityID = "capability_id"
            }
        }
        let selectedMembers = selectedRecords.map {
            SelectedOperationMember(
                operationID: $0.identity.id,
                operationGeneration: $0.identity.generation,
                adapterRegistrationID: $0.adapterRegistrationID,
                adapterRegistrationRevision: $0.adapterRegistrationRevision,
                capabilityID: $0.capabilityID
            )
        }
        struct Input: Codable {
            let barrierGeneration: UInt64
            let stopOperation: AOSOperationIdentity
            let adapterRegistryRevision: UInt64
            let registeredOperationSetCount: UInt64
            let registeredOperationSetDigest: String
            let selectedOperations: [AOSOperationIdentity]
        }
        let input = Input(
            barrierGeneration: barrierGeneration,
            stopOperation: stopOperation,
            adapterRegistryRevision: registry.revision,
            registeredOperationSetCount: registry.registeredOperationSetCount,
            registeredOperationSetDigest: registry.registeredOperationSetDigest,
            selectedOperations: selected
        )
        return Self(
            barrierGeneration: barrierGeneration,
            stopOperation: stopOperation,
            adapterRegistryRevision: registry.revision,
            registeredOperationSetCount: registry.registeredOperationSetCount,
            registeredOperationSetDigest: registry.registeredOperationSetDigest,
            selectedOperations: selected,
            selectedOperationCount: UInt64(selected.count),
            selectedOperationDigest: try AOSOperationDigest.sha256(domain: .selectedOperationSet, selectedMembers),
            barrierSnapshotDigest: try AOSOperationDigest.sha256(domain: .barrierSnapshot, input)
        )
    }
}

enum AOSCleanupResult: String, Codable {
    case pending, zeroResiduals = "zero_residuals", residualsPresent = "residuals_present"
    case recoveryActive = "recovery_active"
}

struct AOSHostBarrierRecord: Codable, Equatable {
    var daemonGeneration: UInt64
    var state: AOSHostBarrierLifecycleState
    var generation: UInt64
    var openSnapshot: AOSOpenBarrierSnapshot?
    var stopSnapshot: AOSHostBarrierSnapshot?
    var residualCount: UInt64
    var residualDigest: String
    var cleanupResult: AOSCleanupResult
    var reconciliationState: String
}

enum AOSCallerOrigin: String, Codable {
    case liveTransportPeer = "live_transport_peer"
    case ordinaryCanvasCapturedPeer = "ordinary_canvas_captured_peer"
    case statusItemHost = "status_item_host"
    case statusOpenedCanvasHost = "status_opened_canvas_host"
}

struct AOSLiveTransportPeerEvidence: Codable, Equatable {
    let auditTokenDigest: String
    let effectiveUID: UInt32
    let pid: Int32
    let pidGeneration: UInt64
}

struct AOSOrdinaryCanvasPeerEvidence: Codable, Equatable {
    let canvasInstanceID: String
    let canvasGeneration: UInt64
    let captureID: String
    let capturedConnectionEpoch: UInt64
    let auditTokenDigest: String
    let effectiveUID: UInt32
    let pid: Int32
    let pidGeneration: UInt64
    let captureIsLive: Bool
}

struct AOSStatusItemHostEvidence: Codable, Equatable {
    let statusHostID: String
    let statusHostGeneration: UInt64
    let daemonGeneration: UInt64
    let effectiveUID: UInt32
}

struct AOSStatusOpenedCanvasHostEvidence: Codable, Equatable {
    let canvasInstanceID: String
    let canvasGeneration: UInt64
    let parentStatusHostID: String
    let parentStatusHostGeneration: UInt64
    let daemonGeneration: UInt64
    let effectiveUID: UInt32
}

enum AOSCallerEvidence: Codable, Equatable {
    case liveTransportPeer(AOSLiveTransportPeerEvidence)
    case ordinaryCanvasCapturedPeer(AOSOrdinaryCanvasPeerEvidence)
    case statusItemHost(AOSStatusItemHostEvidence)
    case statusOpenedCanvasHost(AOSStatusOpenedCanvasHostEvidence)

    var origin: AOSCallerOrigin {
        switch self {
        case .liveTransportPeer: return .liveTransportPeer
        case .ordinaryCanvasCapturedPeer: return .ordinaryCanvasCapturedPeer
        case .statusItemHost: return .statusItemHost
        case .statusOpenedCanvasHost: return .statusOpenedCanvasHost
        }
    }

    var effectiveUID: UInt32 {
        switch self {
        case let .liveTransportPeer(value): return value.effectiveUID
        case let .ordinaryCanvasCapturedPeer(value): return value.effectiveUID
        case let .statusItemHost(value): return value.effectiveUID
        case let .statusOpenedCanvasHost(value): return value.effectiveUID
        }
    }

    func permitsHostAction(_ action: AOSHostControlAction) -> Bool {
        switch self {
        case .liveTransportPeer:
            return true
        case .ordinaryCanvasCapturedPeer:
            return false
        case .statusItemHost:
            return action == .stopAll || action == .reopen
        case .statusOpenedCanvasHost:
            return action == .stopAll
        }
    }

    var evidenceDigest: String {
        (try? AOSOperationDigest.sha256(domain: .callerEvidence, self))
            ?? AOSOperationDigest.empty(.callerEvidence)
    }
}

enum AOSHostControlAction: String, Codable {
    case stopAll = "stop_all"
    case barrierStatus = "barrier_status"
    case reopen
}

struct AOSHostControlContext: Codable, Equatable {
    let expectedDaemonGeneration: UInt64
    let connectionEpoch: UInt64
    let caller: AOSCallerEvidence
}

struct AOSHostControlRequest: Codable, Equatable {
    let requestID: String
    let action: AOSHostControlAction
    let canonicalParameterDigest: String
    let expectedBarrierGeneration: UInt64?
}

enum AOSStopAllOutcome: String, Codable {
    case recorded, reconciliationInProgress = "reconciliation_in_progress", storeBlocked = "store_blocked"
    case closingStarted = "closing_started", alreadyClosing = "already_closing", alreadyClosed = "already_closed"
    case cleanupRequired = "cleanup_required", recoveryInProgress = "recovery_in_progress"
}

enum AOSReopenOutcome: String, Codable {
    case reopened
}

struct AOSStopAllReceipt: Codable, Equatable {
    let requestID: String
    let canonicalParameterDigest: String
    let expectedBarrierGeneration: UInt64
    let daemonGeneration: UInt64
    let callerOrigin: AOSCallerOrigin
    let callerOriginEvidence: AOSCallerEvidence
    let scope: String
    let priorBarrierState: AOSHostBarrierLifecycleState
    let priorBarrierGeneration: UInt64
    let resultingBarrierState: AOSHostBarrierLifecycleState
    let resultingBarrierGeneration: UInt64
    let snapshot: AOSHostBarrierSnapshot
    let outcome: AOSStopAllOutcome
    let residualCount: UInt64
    let residualDigest: String
    let cleanupResult: AOSCleanupResult
}

struct AOSBarrierStatusReceipt: Codable, Equatable {
    let requestID: String
    let canonicalParameterDigest: String
    let daemonGeneration: UInt64
    let callerOrigin: AOSCallerOrigin
    let callerOriginEvidence: AOSCallerEvidence
    let barrierState: AOSHostBarrierLifecycleState
    let barrierGeneration: UInt64
    let admissionOpen: Bool
    let stopSnapshot: AOSHostBarrierSnapshot?
    let openSnapshot: AOSOpenBarrierSnapshot?
    let residualCount: UInt64
    let residualDigest: String
    let reconciliationState: String
}

struct AOSReopenReceipt: Codable, Equatable {
    let requestID: String
    let canonicalParameterDigest: String
    let expectedBarrierGeneration: UInt64
    let callerOrigin: AOSCallerOrigin
    let callerOriginEvidence: AOSCallerEvidence
    let priorBarrierState: AOSHostBarrierLifecycleState
    let priorSnapshot: AOSHostBarrierSnapshot
    let priorResidualCount: UInt64
    let priorResidualDigest: String
    let resultingBarrierState: AOSHostBarrierLifecycleState
    let resultingBarrierGeneration: UInt64
    let daemonGeneration: UInt64
    let resultingOpenSnapshot: AOSOpenBarrierSnapshot
    let outcome: AOSReopenOutcome
    let cleanupResult: AOSCleanupResult
    let reconciliationState: String
}

enum AOSHostReceipt: Codable, Equatable {
    case stopAll(AOSStopAllReceipt)
    case reopen(AOSReopenReceipt)
}

struct AOSRetainedHostReceipt: Codable, Equatable {
    let requestID: String
    let canonicalParameterDigest: String
    let action: AOSHostControlAction
    let retainedAtSeconds: UInt64
    var receipt: AOSHostReceipt
}

struct AOSRecoveryRecord: Codable, Equatable {
    var daemonGeneration: UInt64
    var generation: UInt64
    var state: AOSRecoveryLifecycleState
    var claimTokenDigest: String?
    var residualCount: UInt64
    var residualDigest: String
}

struct AOSOperationDurableState: Codable, Equatable {
    static let schemaVersion = "aos.operation-control-state.v1"

    let schema: String
    var daemonGeneration: UInt64
    var nextGeneration: UInt64
    var adapterRegistry: AOSAdapterRegistrySnapshot
    var barrier: AOSHostBarrierRecord
    var operations: [AOSOperationRecord]
    var streams: [AOSStreamRecord]
    var taps: [AOSTapRecord]
    var artifacts: [AOSArtifactRecord]
    var resourceTransactions: [AOSResourceTransactionRecord]
    var resourceClaims: [AOSResourceClaimRecord]
    var resourceBrokers: [AOSResourceBrokerRecord]
    var pendingExternalSpawnIntents: [AOSExternalDispatchSpawnIntent]
    var closedExternalSpawnIntents: [AOSClosedExternalDispatchSpawnIntent]
    var finalizedExternalSpawnRecords: [AOSFinalizedExternalDispatchSpawnRecord]
    var retainedHostReceipts: [AOSRetainedHostReceipt]
    var recovery: AOSRecoveryRecord

    static func empty(daemonGeneration: UInt64, adapterRegistry: AOSAdapterRegistrySnapshot) -> Self {
        Self(
            schema: schemaVersion,
            daemonGeneration: daemonGeneration,
            nextGeneration: 2,
            adapterRegistry: adapterRegistry,
            barrier: AOSHostBarrierRecord(
                daemonGeneration: daemonGeneration,
                state: .bootReconciling,
                generation: 1,
                openSnapshot: nil,
                stopSnapshot: nil,
                residualCount: 0,
                residualDigest: AOSOperationDigest.empty(.residualSet),
                cleanupResult: .pending,
                reconciliationState: "pending"
            ),
            operations: [], streams: [], taps: [], artifacts: [],
            resourceTransactions: [], resourceClaims: [], resourceBrokers: [],
            pendingExternalSpawnIntents: [], closedExternalSpawnIntents: [],
            finalizedExternalSpawnRecords: [],
            retainedHostReceipts: [],
            recovery: AOSRecoveryRecord(
                daemonGeneration: daemonGeneration,
                generation: 1,
                state: .idle,
                claimTokenDigest: nil,
                residualCount: 0,
                residualDigest: AOSOperationDigest.empty(.residualSet)
            )
        )
    }

    mutating func allocateGeneration() -> UInt64 {
        let value = nextGeneration
        nextGeneration &+= 1
        return value
    }
}
