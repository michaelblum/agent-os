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
    case recordingSystemAudioUnavailable
    case recordingSystemAudioNoSamples
    case recordingSystemAudioFailed
    case recordingTimestampNonMonotonic
    case recordingBackpressureExceeded
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
        case .recordingNoFrames: return "SCREEN_RECORDING_NO_VIDEO_FRAMES"
        case .recordingSystemAudioUnavailable: return "SCREEN_RECORDING_SYSTEM_AUDIO_UNAVAILABLE"
        case .recordingSystemAudioNoSamples: return "SCREEN_RECORDING_SYSTEM_AUDIO_NO_SAMPLES"
        case .recordingSystemAudioFailed: return "SCREEN_RECORDING_SYSTEM_AUDIO_FAILED"
        case .recordingTimestampNonMonotonic: return "SCREEN_RECORDING_TIMESTAMP_NON_MONOTONIC"
        case .recordingBackpressureExceeded: return "SCREEN_RECORDING_BACKPRESSURE_EXCEEDED"
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
    var failureCode: String?
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
    var trackSummary: AOSScreenRecordingTrackSummary?

    init(
        frameCount: UInt64,
        byteCount: UInt64,
        elapsedMilliseconds: UInt64,
        droppedFrameCount: UInt64,
        trackSummary: AOSScreenRecordingTrackSummary? = nil
    ) {
        self.frameCount = frameCount
        self.byteCount = byteCount
        self.elapsedMilliseconds = elapsedMilliseconds
        self.droppedFrameCount = droppedFrameCount
        self.trackSummary = trackSummary
    }
}

enum AOSScreenRecordingTrackKind: String, Codable, CaseIterable {
    case video
    case systemAudio = "system_audio"
}

struct AOSScreenRecordingTrackTruth: Codable, Equatable {
    let selected: Bool
    let admitted: Bool
    let available: Bool
    let firstSamplePresent: Bool
    let sampleCount: UInt64
    let sampleByteCount: UInt64
    let failureCode: String?
    let drained: Bool
    let finalized: Bool
}

struct AOSScreenRecordingTrackSummary: Codable, Equatable {
    let selectedTracks: [String]
    let finalizedTracks: [String]
    let commonMediaEpochNanoseconds: UInt64?
    let video: AOSScreenRecordingTrackTruth
    let systemAudio: AOSScreenRecordingTrackTruth

    static func initial(systemAudioSelected: Bool) -> Self {
        let pending = AOSScreenRecordingTrackTruth(
            selected: true,
            admitted: true,
            available: false,
            firstSamplePresent: false,
            sampleCount: 0,
            sampleByteCount: 0,
            failureCode: nil,
            drained: false,
            finalized: false
        )
        return Self(
            selectedTracks: systemAudioSelected ? ["video", "system_audio"] : ["video"],
            finalizedTracks: [],
            commonMediaEpochNanoseconds: nil,
            video: pending,
            systemAudio: AOSScreenRecordingTrackTruth(
                selected: systemAudioSelected,
                admitted: systemAudioSelected,
                available: false,
                firstSamplePresent: false,
                sampleCount: 0,
                sampleByteCount: 0,
                failureCode: nil,
                drained: !systemAudioSelected,
                finalized: !systemAudioSelected
            )
        )
    }

    var selectedSystemAudio: Bool { systemAudio.selected }

    var expectedMediaType: String {
        selectedSystemAudio
            ? "video/quicktime; codecs=avc1,mp4a.40.2"
            : "video/quicktime; codecs=avc1"
    }

    var isSuccessful: Bool {
        selectedTracks == (systemAudio.selected ? ["video", "system_audio"] : ["video"])
            && commonMediaEpochNanoseconds != nil
            && video.selected
            && video.admitted
            && video.available
            && video.firstSamplePresent
            && video.sampleCount > 0
            && video.sampleByteCount > 0
            && video.failureCode == nil
            && video.drained
            && video.finalized
            && (!systemAudio.selected || (
                systemAudio.admitted
                    && systemAudio.available
                    && systemAudio.firstSamplePresent
                    && systemAudio.sampleCount > 0
                    && systemAudio.sampleByteCount > 0
                    && systemAudio.failureCode == nil
                    && systemAudio.drained
                    && systemAudio.finalized
            ))
            && (systemAudio.selected || (
                !systemAudio.admitted
                    && !systemAudio.available
                    && !systemAudio.firstSamplePresent
                    && systemAudio.sampleCount == 0
                    && systemAudio.sampleByteCount == 0
                    && systemAudio.failureCode == nil
                    && systemAudio.drained
                    && systemAudio.finalized
            ))
            && finalizedTracks == selectedTracks
    }
}

func aosScreenRecordingTrackSummaryValue(
    _ summary: AOSScreenRecordingTrackSummary
) -> [String: Any] {
    func track(_ value: AOSScreenRecordingTrackTruth) -> [String: Any] {
        [
            "selected": value.selected,
            "admitted": value.admitted,
            "available": value.available,
            "first_sample_present": value.firstSamplePresent,
            "sample_count": value.sampleCount,
            "sample_byte_count": value.sampleByteCount,
            "failure_code": value.failureCode ?? NSNull(),
            "drained": value.drained,
            "finalized": value.finalized,
        ]
    }
    return [
        "selected_tracks": summary.selectedTracks,
        "finalized_tracks": summary.finalizedTracks,
        "common_media_epoch_ns": summary.commonMediaEpochNanoseconds ?? NSNull(),
        "video": track(summary.video),
        "system_audio": track(summary.systemAudio),
    ]
}

enum AOSOperationPublicProjection {
    static func list(
        action: String,
        filters: [String: Any],
        operations: [AOSOperationRecord],
        state: AOSOperationDurableState,
        checkedAt: String
    ) -> [String: Any] {
        [
            "schema_version": "aos.operation.list-result.v1",
            "operation": action,
            "filters": filters,
            "operations": operations.prefix(4_096).map { snapshot($0, state: state) },
            "checked_at": checkedAt,
        ]
    }

    static func inspect(
        action: String,
        selector: [String: Any],
        operation: AOSOperationRecord,
        state: AOSOperationDurableState,
        checkedAt: String
    ) -> [String: Any] {
        [
            "schema_version": "aos.operation.inspect-result.v1",
            "operation": action,
            "selector": selector,
            "snapshot": snapshot(operation, state: state),
            "checked_at": checkedAt,
        ]
    }

    static func snapshot(
        _ operation: AOSOperationRecord,
        state: AOSOperationDurableState
    ) -> [String: Any] {
        let transactions = state.resourceTransactions.filter {
            $0.operation == operation.identity
        }
        let claims = state.resourceClaims.filter { $0.operation == operation.identity }
        let brokerIDs = Set(claims.compactMap(\.brokerID))
        let brokers = state.resourceBrokers.filter { brokerIDs.contains($0.brokerID) }
        let streams = state.streams.filter { $0.parentOperation == operation.identity }
        let taps = state.taps.filter { $0.parentOperation == operation.identity }
        let artifacts = state.artifacts.filter { $0.parentOperation == operation.identity }
        var residuals: [String] = []
        residuals += transactions.filter { $0.state != .terminal }.map {
            "claim-set:\($0.transactionID)"
        }
        residuals += claims.filter { $0.state != .terminal }.map {
            "claim:\($0.claimID):\($0.resourceGeneration)"
        }
        residuals += brokers.filter { $0.state != .terminal }.map {
            "broker:\($0.brokerID):\($0.brokerGeneration)"
        }
        residuals += streams.filter { $0.state != .terminal }.map {
            "stream:\($0.identity.id):\($0.identity.generation)"
        }
        residuals += taps.filter { $0.state != .terminal }.map {
            "tap:\($0.identity.id):\($0.identity.generation)"
        }
        residuals += artifacts.filter {
            ![AOSArtifactLifecycleState.offered, .released, .retained, .removed].contains($0.state)
        }.map { "artifact:\($0.identity.id):\($0.identity.generation)" }
        residuals += state.finalizedExternalSpawnRecords.filter {
            $0.skipRecord.operationID == operation.identity.id
                && $0.skipRecord.operationGeneration == operation.identity.generation
        }.map { "external-spawn:\($0.skipRecord.spawnRecordID)" }
        residuals.sort()
        let residualDigest = (try? AOSOperationDigest.sha256(
            domain: .residualSet,
            residuals
        )) ?? AOSOperationDigest.empty(.residualSet)
        let terminalAllowed = operation.state == .terminal && residuals.isEmpty
        let cleanupResult: String
        if terminalAllowed {
            cleanupResult = "zero_residuals"
        } else if [.cleanupRequired, .recovering].contains(operation.state) {
            cleanupResult = residuals.isEmpty ? "recovery_active" : "residuals_present"
        } else if [.stopping].contains(operation.state) {
            cleanupResult = "pending"
        } else {
            cleanupResult = "not_started"
        }
        let wireState = operation.state == .terminal && !residuals.isEmpty
            ? AOSOperationLifecycleState.cleanupRequired.rawValue
            : operation.state.rawValue
        let completedAt: Any = terminalAllowed
            ? timestamp(operation.updatedAtNanoseconds) : NSNull()
        let terminalValue: Any = terminalAllowed
            ? terminal(
                operation,
                completedAt: timestamp(operation.updatedAtNanoseconds)
            ) : NSNull()
        let startedAt: Any = operation.state == .prepared
            ? NSNull() : timestamp(operation.updatedAtNanoseconds)
        return [
            "schema_version": "aos.operation.v1",
            "operation_id": operation.identity.id,
            "operation_generation": operation.identity.generation,
            "daemon_generation": operation.daemonGeneration,
            "adapter_registry_revision": state.adapterRegistry.revision,
            "adapter_registration": [
                "adapter_registration_id": operation.adapterRegistrationID,
                "adapter_registration_revision": operation.adapterRegistrationRevision,
            ],
            "capability_id": operation.capabilityID,
            "status_indicator_class": operation.state == .active ? "recording" : "neutral",
            "state": wireState,
            "lineage": lineage(operation),
            "requested_bounds": operation.requestedBounds.map {
                [
                    "max_duration_ms": $0.durationMilliseconds,
                    "frame_rate": $0.frameRate,
                    "max_pixel_count": $0.pixelCount,
                    "max_queue_items": $0.queueFrames,
                    "max_bytes": $0.maximumOutputBytes,
                ]
            } ?? [:],
            "progress": progress(operation),
            "claim_set_transactions": transactions.map {
                claimSetTransaction($0, state: state)
            },
            "resource_claims": claims.map(resourceClaim),
            "multiplex_brokers": brokers.map(broker),
            "streams": streams.map {
                ["id": $0.identity.id, "generation": $0.identity.generation]
            },
            "taps": taps.map {
                ["id": $0.identity.id, "generation": $0.identity.generation]
            },
            "artifacts": artifacts.map {
                ["id": $0.identity.id, "generation": $0.identity.generation]
            },
            "cleanup": [
                "result": cleanupResult,
                "residual": [
                    "classification": residuals.isEmpty ? "none" : "present",
                    "count": residuals.count,
                    "digest": residualDigest,
                ],
                "completed_at": completedAt,
            ],
            "terminal": terminalValue,
            "prepared_at": timestamp(operation.createdAtNanoseconds),
            "started_at": startedAt,
            "updated_at": timestamp(operation.updatedAtNanoseconds),
        ]
    }

    private static func progress(_ operation: AOSOperationRecord) -> [String: Any] {
        var value: [String: Any] = [
            "items": operation.progress?.frameCount ?? 0,
            "bytes": operation.progress?.byteCount ?? 0,
            "duration_ms": operation.progress?.elapsedMilliseconds ?? 0,
            "last_event_sequence": operation.progress?.frameCount ?? 0,
        ]
        if let summary = operation.progress?.trackSummary {
            value["track_summary"] = aosScreenRecordingTrackSummaryValue(summary)
        }
        return value
    }

    private static func terminal(
        _ operation: AOSOperationRecord,
        completedAt: String
    ) -> [String: Any] {
        let trigger: String
        let blame: String
        switch operation.stopIntent {
        case .complete: trigger = "adapter_complete"; blame = "adapter"
        case .cancel: trigger = "caller_cancel"; blame = "caller"
        case .kill: trigger = "kill_one"; blame = "aos_control_plane"
        case .ownerKill: trigger = "owner_kill"; blame = "aos_control_plane"
        case .hostStop: trigger = "host_stop_all"; blame = "host_shutdown"
        case .deadline: trigger = "deadline"; blame = "adapter"
        case .peerLost: trigger = "peer_lost"; blame = "caller"
        case .transportLost: trigger = "transport_lost"; blame = "caller"
        case .permissionRevoked: trigger = "permission_failure"; blame = "permission"
        case .adapterFailed: trigger = "adapter_failure"; blame = "adapter"
        case nil: trigger = "start_rejected"; blame = "unknown"
        }
        return [
            "outcome": (operation.outcome ?? .failed).rawValue,
            "trigger": trigger,
            "blame": blame,
            "duration_ms": (operation.updatedAtNanoseconds - operation.createdAtNanoseconds)
                / 1_000_000,
            "completed_at": completedAt,
            "failure_code": operation.failureCode ?? NSNull(),
            "track_summary": operation.progress?.trackSummary
                .map(aosScreenRecordingTrackSummaryValue) ?? NSNull(),
        ]
    }

    private static func timestamp(_ nanoseconds: UInt64) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date(
            timeIntervalSince1970: Double(nanoseconds) / 1_000_000_000
        ))
    }

    private static func lineage(_ operation: AOSOperationRecord) -> [String: Any] {
        let binding = operation.ownerRoot.verifiedBinding
        let immediate: [String: Any]
        let boundary: [String: Any]
        let edges: [[String: Any]]
        let proofs: [[String: Any]]
        let outcome: String
        if let binding {
            let peerGeneration = binding.ancestorEdges.first?.child.generation
                ?? binding.ownerRoot.generation
            immediate = [
                "audit_token": (try? AOSOperationDigest.sha256(
                    domain: .callerEvidence,
                    binding.immediatePeer.auditToken.words
                )) ?? AOSOperationDigest.empty(.callerEvidence),
                "effective_uid": binding.immediatePeer.effectiveUID,
                "pid": binding.immediatePeer.pid,
                "pid_generation": pidGeneration(peerGeneration),
            ]
            boundary = processBoundary(binding.ownerRoot)
            edges = binding.ancestorEdges.map(ancestorEdge)
            proofs = binding.skippedNodes.compactMap(skipProof)
            outcome = binding.outcome.rawValue
        } else {
            immediate = [
                "audit_token": AOSOperationDigest.empty(.callerEvidence),
                "effective_uid": operation.ownerRoot.effectiveUID,
                "pid": operation.ownerRoot.pid,
                "pid_generation": max(1, operation.ownerRoot.pidGeneration),
            ]
            boundary = [
                "effective_uid": operation.ownerRoot.effectiveUID,
                "pid": operation.ownerRoot.pid,
                "pid_generation": max(1, operation.ownerRoot.pidGeneration),
                "executable_identity_digest": operation.ownerRoot.executableIdentityDigest,
                "executable_file_digest": operation.ownerRoot.executableIdentityDigest,
            ]
            edges = []
            proofs = []
            outcome = "conservative_immediate_peer_boundary"
        }
        var attribution: [String: Any] = [:]
        let values: [(String, String?)] = [
            ("client_id", operation.attribution.clientID),
            ("agent_id", operation.attribution.agentID),
            ("project_id", operation.attribution.projectID),
            ("task_id", operation.attribution.taskID),
            ("run_id", operation.attribution.runID),
            ("skill_id", operation.attribution.skillID),
            ("target_id", operation.attribution.targetID),
            ("capability_label", operation.attribution.capabilityLabel),
            ("retry_id", operation.attribution.retryID),
        ]
        for (key, value) in values { if let value { attribution[key] = value } }
        return [
            "schema_version": "aos.operation-lineage.v1",
            "operation_id": operation.identity.id,
            "operation_generation": operation.identity.generation,
            "owner_root": [
                "capture_phase": "local_socket_accept",
                "resolver_outcome": outcome,
                "immediate_peer": immediate,
                "selected_boundary": boundary,
                "ancestor_edges": edges,
                "adapter_skip_proofs": proofs,
                "captured_at": timestamp(operation.createdAtNanoseconds),
            ],
            "parent_operation": NSNull(),
            "mechanically_bound_scopes": [],
            "asserted_attribution": attribution,
        ]
    }

    private static func processBoundary(
        _ observation: AOSProcessObservation
    ) -> [String: Any] {
        [
            "effective_uid": observation.generation.effectiveUID,
            "pid": observation.generation.pid,
            "pid_generation": pidGeneration(observation.generation),
            "executable_identity_digest": observation.image.executableIdentityDigest.value,
            "executable_file_digest": observation.image.executableDigest.value,
        ]
    }

    private static func operationStartTime(
        _ identity: AOSProcessGenerationIdentity
    ) -> [String: Any] {
        [
            "seconds": identity.startTimeSeconds,
            "microseconds": identity.startTimeMicroseconds,
        ]
    }

    private static func ancestorEdge(_ edge: AOSStableProcessEdge) -> [String: Any] {
        [
            "child_pid": edge.child.generation.pid,
            "child_effective_uid": edge.child.generation.effectiveUID,
            "child_proc_start_time_sample_1": operationStartTime(edge.child.generation),
            "child_proc_start_time_sample_2": operationStartTime(edge.child.generation),
            "parent_pid": edge.parent.generation.pid,
            "parent_effective_uid": edge.parent.generation.effectiveUID,
            "parent_proc_start_time_sample_1": operationStartTime(edge.parent.generation),
            "parent_proc_start_time_sample_2": operationStartTime(edge.parent.generation),
            "same_observation_parent_edge_receipt": edge.receipt.digest.value,
            "executable_identity_digest": edge.child.image.executableIdentityDigest.value,
            "executable_file_digest": edge.child.image.executableDigest.value,
        ]
    }

    private static func skipProof(
        _ skipped: AOSOwnerRootSkippedNode
    ) -> [String: Any]? {
        if let proof = skipped.exactImageProof {
            return [
                "kind": "exact_aos_image",
                "evidence_scope": "verified_ancestor",
                "child_pid": proof.child.pid,
                "child_effective_uid": proof.child.effectiveUID,
                "child_pid_generation": pidGeneration(proof.child),
                "parent_pid": proof.parent.pid,
                "parent_pid_generation": pidGeneration(proof.parent),
                "same_observation_parent_edge_receipt": proof.parentEdgeReceipt.digest.value,
                "adapter_registration": [
                    "adapter_registration_id": proof.adapterRegistrationID,
                    "adapter_registration_revision": proof.adapterRegistrationRevision,
                ],
                "executable_identity_digest": proof.image.executableIdentityDigest.value,
                "executable_file_digest": proof.image.executableDigest.value,
            ]
        }
        if let record = skipped.spawnRecord {
            var result: [String: Any] = [
                "kind": "generation_bound_daemon_spawn_record",
                "evidence_scope": record.evidenceScope.rawValue,
                "spawn_record_id": record.spawnRecordID,
                "child_pid": record.child.pid,
                "child_effective_uid": record.child.effectiveUID,
                "child_pid_generation": pidGeneration(record.child),
                "parent_pid": record.parent.pid,
                "parent_pid_generation": pidGeneration(record.parent),
                "same_observation_parent_edge_receipt": record.parentEdgeReceipt.digest.value,
                "operation_id": record.operationID,
                "operation_generation": record.operationGeneration,
                "adapter_registration": [
                    "adapter_registration_id": record.adapterID,
                    "adapter_registration_revision": record.adapterRegistrationRevision,
                ],
                "executable_identity_digest": record.executableIdentityDigest.value,
                "executable_file_digest": record.executableDigest.value,
            ]
            if let token = record.childAuditToken {
                result["child_audit_token"] = (try? AOSOperationDigest.sha256(
                    domain: .callerEvidence,
                    token.words
                )) ?? AOSOperationDigest.empty(.callerEvidence)
            }
            return result
        }
        return nil
    }

    private static func claimRequest(_ request: AOSResourceClaimRequest) -> [String: Any] {
        var result: [String: Any] = [
            "adapter_registration_id": request.adapterRegistrationID,
            "adapter_registration_revision": request.adapterRegistrationRevision,
            "resource_key": request.resourceKey,
            "admission_mode": request.admissionMode.rawValue,
            "resource_declaration_digest": request.resourceDeclarationDigest,
            "expected_resource_generation": request.expectedResourceGeneration,
        ]
        if request.admissionMode == .multiplexable {
            result["expected_broker_generation"] = request.expectedBrokerGeneration ?? 0
            result["expected_subscriber_set_revision"] = request.expectedSubscriberSetRevision ?? 0
            result["expected_subscriber_set_count"] = request.expectedSubscriberSetCount ?? 0
            result["expected_subscriber_set_digest"] = request.expectedSubscriberSetDigest
                ?? AOSOperationDigest.empty(.subscriberSet)
        }
        return result
    }

    private static func claimSetTransaction(
        _ transaction: AOSResourceTransactionRecord,
        state: AOSOperationDurableState
    ) -> [String: Any] {
        let publishedCount = state.resourceClaims.filter {
            $0.transactionID == transaction.transactionID
        }.count
        return [
            "transaction_id": transaction.transactionID,
            "attempt_sequence": transaction.attemptSequence,
            "operation_id": transaction.operation.id,
            "operation_generation": transaction.operation.generation,
            "daemon_generation": transaction.daemonGeneration,
            "expected_barrier_generation": transaction.expectedBarrierGeneration,
            "expected_adapter_registry_revision": transaction.expectedAdapterRegistryRevision,
            "expected_resource_declaration_set_count": transaction.expectedResourceDeclarationSetCount,
            "expected_resource_declaration_set_digest": transaction.expectedResourceDeclarationSetDigest,
            "adapter_registry_revision": state.adapterRegistry.revision,
            "resource_declaration_set_count": state.adapterRegistry.resourceDeclarationSetCount,
            "resource_declaration_set_digest": state.adapterRegistry.resourceDeclarationSetDigest,
            "canonical_request_array": transaction.canonicalRequests.map(claimRequest),
            "claim_set_digest": transaction.claimSetDigest,
            "state": transaction.state.rawValue,
            "recovery_disposition": transaction.recoveryDisposition?.rawValue ?? NSNull(),
            "receipt": [
                "outcome": publishedCount > 0 ? "committed" : "rejected",
                "attempt_sequence": transaction.attemptSequence,
                "conflict_resource_key": NSNull(),
                "published_claim_count": publishedCount,
            ],
        ]
    }

    private static func resourceClaim(_ claim: AOSResourceClaimRecord) -> [String: Any] {
        var result: [String: Any] = [
            "claim_id": claim.claimID,
            "transaction_id": claim.transactionID,
            "operation_id": claim.operation.id,
            "operation_generation": claim.operation.generation,
            "resource_key": claim.resourceKey,
            "resource_generation": claim.resourceGeneration,
            "admission_mode": claim.admissionMode.rawValue,
            "adapter_registration_id": claim.adapterRegistrationID,
            "adapter_registration_revision": claim.adapterRegistrationRevision,
            "resource_declaration_digest": claim.resourceDeclarationDigest,
            "adapter_registry_revision": claim.adapterRegistryRevision,
            "resource_declaration_set_count": claim.resourceDeclarationSetCount,
            "resource_declaration_set_digest": claim.resourceDeclarationSetDigest,
            "committed_claim_set_transaction_id": claim.transactionID,
            "committed_claim_set_digest": claim.committedClaimSetDigest,
            "state": claim.state.rawValue,
            "reattach_binding": [
                "operation_generation": claim.operation.generation,
                "resource_generation": claim.resourceGeneration,
                "token_digest": claim.reattachTokenDigest,
            ],
        ]
        if claim.admissionMode == .multiplexable {
            result["broker_id"] = claim.brokerID
            result["broker_generation"] = claim.brokerGeneration
            result["subscriber_id"] = claim.subscriberID
        }
        return result
    }

    private static func broker(_ broker: AOSResourceBrokerRecord) -> [String: Any] {
        [
            "broker_id": broker.brokerID,
            "broker_generation": broker.brokerGeneration,
            "resource_key": broker.resourceKey,
            "resource_generation": broker.resourceGeneration,
            "adapter_registration_id": broker.adapterRegistrationID,
            "adapter_registration_revision": broker.adapterRegistrationRevision,
            "resource_declaration_digest": broker.resourceDeclarationDigest,
            "adapter_registry_revision": broker.adapterRegistryRevision,
            "resource_declaration_set_count": broker.resourceDeclarationSetCount,
            "resource_declaration_set_digest": broker.resourceDeclarationSetDigest,
            "committed_claim_set_transaction_id": broker.committedClaimSetTransactionID,
            "committed_claim_set_digest": broker.committedClaimSetDigest,
            "fanout_bound": broker.fanoutBound,
            "subscriber_set_count": broker.subscribers.count,
            "subscriber_set_revision": broker.subscriberSetRevision,
            "subscriber_set_digest": broker.subscriberSetDigest,
            "state": broker.state.rawValue,
        ]
    }

    private static func pidGeneration(_ identity: AOSProcessGenerationIdentity) -> UInt64 {
        let seconds = identity.startTimeSeconds.multipliedReportingOverflow(by: 1_000_000)
        guard !seconds.overflow else { return UInt64.max }
        let value = seconds.partialValue.addingReportingOverflow(identity.startTimeMicroseconds)
        return value.overflow ? UInt64.max : max(1, value.partialValue)
    }
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
    let trackSummary: AOSScreenRecordingTrackSummary?

    init(
        rootIdentityDigest: String,
        relativeLocatorDigest: String,
        device: UInt64,
        inode: UInt64,
        byteCount: UInt64,
        contentDigest: String,
        mediaType: String,
        trackSummary: AOSScreenRecordingTrackSummary? = nil
    ) {
        self.rootIdentityDigest = rootIdentityDigest
        self.relativeLocatorDigest = relativeLocatorDigest
        self.device = device
        self.inode = inode
        self.byteCount = byteCount
        self.contentDigest = contentDigest
        self.mediaType = mediaType
        self.trackSummary = trackSummary
    }
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
        filePresent: Bool,
        expectedSummary: AOSScreenRecordingTrackSummary
    ) throws {
        try requireFrames(frameCount)
        guard let artifact,
              artifact.byteCount > 0,
              filePresent,
              artifact.trackSummary == expectedSummary,
              artifact.mediaType == expectedSummary.expectedMediaType,
              expectedSummary.isSuccessful else {
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
    var trackSummary: AOSScreenRecordingTrackSummary?
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
