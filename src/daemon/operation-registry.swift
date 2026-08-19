import Foundation

enum AOSAdapterStopDisposition: String, Codable {
    case accepted, alreadyStopping = "already_stopping", absent, residual
}

struct AOSAdapterStopResult: Codable, Equatable {
    let disposition: AOSAdapterStopDisposition
    let residualDigest: String?
}

protocol AOSOperationControlAdapter: AnyObject {
    var registration: AOSOperationAdapterRegistration { get }
    func requestStop(operation: AOSOperationIdentity, force: Bool) -> AOSAdapterStopResult
    func residualDigest(operation: AOSOperationIdentity) -> String?
}

struct AOSOperationFilter: Equatable {
    var capabilityID: String?
    var clientID: String?
    var agentID: String?
    var projectID: String?
    var taskID: String?
    var runID: String?
    var skillID: String?
    var targetID: String?
    var capabilityLabel: String?

    init(
        capabilityID: String? = nil,
        clientID: String? = nil,
        agentID: String? = nil,
        projectID: String? = nil,
        taskID: String? = nil,
        runID: String? = nil,
        skillID: String? = nil,
        targetID: String? = nil,
        capabilityLabel: String? = nil
    ) {
        self.capabilityID = capabilityID
        self.clientID = clientID
        self.agentID = agentID
        self.projectID = projectID
        self.taskID = taskID
        self.runID = runID
        self.skillID = skillID
        self.targetID = targetID
        self.capabilityLabel = capabilityLabel
    }

    func matches(_ operation: AOSOperationRecord) -> Bool {
        if let value = capabilityID, value != operation.capabilityID { return false }
        if let value = clientID, value != operation.attribution.clientID { return false }
        if let value = agentID, value != operation.attribution.agentID { return false }
        if let value = projectID, value != operation.attribution.projectID { return false }
        if let value = taskID, value != operation.attribution.taskID { return false }
        if let value = runID, value != operation.attribution.runID { return false }
        if let value = skillID, value != operation.attribution.skillID { return false }
        if let value = targetID, value != operation.attribution.targetID { return false }
        if let value = capabilityLabel, value != operation.attribution.capabilityLabel { return false }
        return true
    }
}

final class AOSOperationRegistry {
    static let pendingExternalSpawnIntentLimit = 4_096
    static let closedExternalSpawnIntentLimit = 4_096
    static let finalizedExternalSpawnRecordLimit = 4_096
    typealias Clock = () -> UInt64
    typealias IDFactory = () -> String

    private let lock = NSLock()
    private let store: AOSOperationStateStore
    private let clock: Clock
    private let idFactory: IDFactory
    private var state: AOSOperationDurableState
    private var adapters: [String: AOSOperationControlAdapter]

    init(
        store: AOSOperationStateStore,
        daemonGeneration: UInt64,
        adapterRegistry: AOSAdapterRegistrySnapshot,
        adapters: [AOSOperationControlAdapter] = [],
        clock: @escaping Clock = {
            UInt64(max(0, Date().timeIntervalSince1970 * 1_000_000_000))
        },
        idFactory: @escaping IDFactory = { UUID().uuidString.lowercased() }
    ) throws {
        guard daemonGeneration > 0 else { throw AOSOperationCoreError.invalidRecord("daemon_generation") }
        self.store = store
        self.clock = clock
        self.idFactory = idFactory
        let loaded = try store.load()
        if let loaded {
            guard loaded.schema == AOSOperationDurableState.schemaVersion else {
                throw AOSOperationCoreError.storeCorrupt
            }
            state = loaded
        } else {
            let initial = AOSOperationDurableState.empty(
                daemonGeneration: daemonGeneration,
                adapterRegistry: adapterRegistry
            )
            try store.save(initial)
            state = initial
        }
        self.adapters = Dictionary(uniqueKeysWithValues: adapters.map { ($0.registration.id, $0) })
    }

    func snapshot() -> AOSOperationDurableState {
        lock.lock()
        defer { lock.unlock() }
        return state
    }

    @discardableResult
    func mutateDurably<T>(_ mutation: (inout AOSOperationDurableState) throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        var candidate = state
        let result = try mutation(&candidate)
        try store.save(candidate)
        state = candidate
        return result
    }

    func installRuntimeAdapters(_ values: [AOSOperationControlAdapter]) throws {
        let byID = Dictionary(uniqueKeysWithValues: values.map { ($0.registration.id, $0) })
        let durable = snapshot().adapterRegistry
        guard byID.count == durable.registrations.count,
              durable.registrations.allSatisfy({ byID[$0.id]?.registration == $0 }) else {
            throw AOSOperationCoreError.adapterRegistryConflict
        }
        lock.lock()
        adapters = byID
        lock.unlock()
    }

    func runtimeAdapter(id: String, revision: UInt64) -> AOSOperationControlAdapter? {
        lock.lock()
        defer { lock.unlock() }
        guard let adapter = adapters[id], adapter.registration.revision == revision else { return nil }
        return adapter
    }

    func prepareOperation(
        ownerRoot: AOSMechanicalOwnerRoot,
        attribution: AOSOperationAttribution,
        capabilityID: String,
        adapterRegistrationID: String,
        adapterRegistrationRevision: UInt64,
        requestedBounds: AOSOperationRequestedBounds? = nil,
        initialProgress: AOSOperationProgress? = nil,
        screenRecordingGeometry: AOSScreenRecordingGeometryState? = nil
    ) throws -> AOSOperationRecord {
        let now = clock()
        return try mutateDurably { state in
            guard state.barrier.state == .open,
                  state.barrier.openSnapshot?.barrierGeneration == state.barrier.generation else {
                throw AOSOperationCoreError.barrierClosed
            }
            guard let registration = state.adapterRegistry.registration(
                id: adapterRegistrationID,
                revision: adapterRegistrationRevision
            ), registration.capabilityIDs.contains(capabilityID) else {
                throw AOSOperationCoreError.adapterRegistryConflict
            }
            if let bounds = requestedBounds, let initialProgress {
                guard initialProgress.byteCount <= bounds.maximumOutputBytes,
                      initialProgress.elapsedMilliseconds <= bounds.durationMilliseconds else {
                    throw AOSOperationCoreError.recordingBoundsExceeded
                }
            }
            let record = AOSOperationRecord(
                identity: AOSOperationIdentity(id: idFactory(), generation: state.allocateGeneration()),
                daemonGeneration: state.daemonGeneration,
                ownerRoot: ownerRoot,
                attribution: attribution,
                capabilityID: capabilityID,
                adapterRegistrationID: adapterRegistrationID,
                adapterRegistrationRevision: adapterRegistrationRevision,
                state: .prepared,
                stopIntent: nil,
                outcome: nil,
                failureCode: nil,
                residualDigest: nil,
                requestedBounds: requestedBounds,
                progress: initialProgress ?? requestedBounds.map { _ in AOSOperationProgress(
                    frameCount: 0,
                    byteCount: 0,
                    elapsedMilliseconds: 0,
                    droppedFrameCount: 0
                ) },
                screenRecordingGeometry: screenRecordingGeometry,
                createdAtNanoseconds: now,
                updatedAtNanoseconds: now
            )
            state.operations.append(record)
            return record
        }
    }

    func activateScreenRecordingFollowGeometry(
        _ identity: AOSOperationIdentity,
        nowNanoseconds: UInt64
    ) throws -> AOSScreenRecordingGeometryState {
        try mutateDurably { state in
            guard let index = state.operations.firstIndex(where: { $0.identity == identity }),
                  state.operations[index].state == .active,
                  var geometry = state.operations[index].screenRecordingGeometry,
                  geometry.accepted.mode == .callerFollowed,
                  geometry.deadlineState == .inactive,
                  let interval = geometry.accepted.updateIntervalMilliseconds,
                  let deadline = geometry.accepted.updateDeadlineMilliseconds else {
                throw AOSOperationCoreError.invalidTransition
            }
            geometry.deadlineState = .armed
            geometry.nextUpdateNotBeforeNanoseconds = try Self.addMilliseconds(
                interval, to: nowNanoseconds
            )
            geometry.nextDeadlineNanoseconds = try Self.addMilliseconds(
                deadline, to: nowNanoseconds
            )
            geometry.eventSequence = try aosNextScreenRecordingGeometryEventSequence(
                geometry.eventSequence
            )
            state.operations[index].screenRecordingGeometry = geometry
            state.operations[index].updatedAtNanoseconds = clock()
            return geometry
        }
    }

    func reserveScreenRecordingFollowUpdate(
        _ identity: AOSOperationIdentity,
        request: AOSScreenRecordingFollowUpdateRequest,
        candidate: AOSScreenRecordingGeometry,
        nowNanoseconds: UInt64
    ) throws -> AOSScreenRecordingGeometryState {
        try mutateDurably { state in
            guard let index = state.operations.firstIndex(where: { $0.identity == identity }),
                  state.operations[index].state == .active,
                  var geometry = state.operations[index].screenRecordingGeometry,
                  geometry.accepted.mode == .callerFollowed,
                  geometry.deadlineState == .armed,
                  geometry.pendingUpdate == nil,
                  geometry.accepted.geometryGeneration == request.expectedGeometryGeneration,
                  candidate.geometryGeneration == request.expectedGeometryGeneration + 1,
                  let notBefore = geometry.nextUpdateNotBeforeNanoseconds,
                  let deadline = geometry.nextDeadlineNanoseconds,
                  nowNanoseconds >= notBefore,
                  nowNanoseconds < deadline else {
                throw AOSOperationCoreError.generationConflict
            }
            geometry.pendingUpdate = AOSScreenRecordingPendingGeometryUpdate(
                requestID: request.requestID,
                canonicalParameterDigest: request.canonicalParameterDigest,
                expectedGeometryGeneration: request.expectedGeometryGeneration,
                candidate: candidate
            )
            geometry.eventSequence = try aosNextScreenRecordingGeometryEventSequence(
                geometry.eventSequence
            )
            state.operations[index].screenRecordingGeometry = geometry
            state.operations[index].updatedAtNanoseconds = clock()
            return geometry
        }
    }

    func commitScreenRecordingFollowUpdate(
        _ identity: AOSOperationIdentity,
        requestID: String,
        canonicalParameterDigest: String,
        nowNanoseconds: UInt64
    ) throws -> AOSScreenRecordingGeometryState {
        try mutateDurably { state in
            guard let index = state.operations.firstIndex(where: { $0.identity == identity }),
                  state.operations[index].state == .active,
                  var geometry = state.operations[index].screenRecordingGeometry,
                  geometry.deadlineState == .armed,
                  let pending = geometry.pendingUpdate,
                  pending.requestID == requestID,
                  pending.canonicalParameterDigest == canonicalParameterDigest,
                  let interval = pending.candidate.updateIntervalMilliseconds,
                  let deadlineDuration = pending.candidate.updateDeadlineMilliseconds,
                  let currentDeadline = geometry.nextDeadlineNanoseconds,
                  nowNanoseconds < currentDeadline else {
                throw AOSOperationCoreError.generationConflict
            }
            geometry.accepted = pending.candidate
            geometry.pendingUpdate = nil
            geometry.nextUpdateNotBeforeNanoseconds = try Self.addMilliseconds(
                interval, to: nowNanoseconds
            )
            geometry.nextDeadlineNanoseconds = try Self.addMilliseconds(
                deadlineDuration, to: nowNanoseconds
            )
            geometry.eventSequence = try aosNextScreenRecordingGeometryEventSequence(
                geometry.eventSequence
            )
            state.operations[index].screenRecordingGeometry = geometry
            state.operations[index].updatedAtNanoseconds = clock()
            return geometry
        }
    }

    func expireScreenRecordingFollowGeometry(
        _ identity: AOSOperationIdentity,
        expectedDeadlineNanoseconds: UInt64,
        nowNanoseconds: UInt64
    ) throws -> Bool {
        try mutateDurably { state in
            guard let index = state.operations.firstIndex(where: { $0.identity == identity }),
                  state.operations[index].state == .active,
                  var geometry = state.operations[index].screenRecordingGeometry,
                  geometry.deadlineState == .armed,
                  geometry.nextDeadlineNanoseconds == expectedDeadlineNanoseconds,
                  nowNanoseconds >= expectedDeadlineNanoseconds else {
                return false
            }
            geometry.deadlineState = .expired
            geometry.eventSequence = try aosNextScreenRecordingGeometryEventSequence(
                geometry.eventSequence
            )
            state.operations[index].screenRecordingGeometry = geometry
            state.operations[index].updatedAtNanoseconds = clock()
            return true
        }
    }

    func stopScreenRecordingFollowGeometry(
        _ identity: AOSOperationIdentity
    ) throws -> AOSScreenRecordingGeometryState? {
        try mutateDurably { state in
            guard let index = state.operations.firstIndex(where: { $0.identity == identity }),
                  var geometry = state.operations[index].screenRecordingGeometry else {
                return nil
            }
            let prior = geometry
            if geometry.accepted.mode == .callerFollowed {
                guard geometry.deadlineState != .expired else { return nil }
                geometry.deadlineState = .stopped
                geometry.nextUpdateNotBeforeNanoseconds = nil
                geometry.nextDeadlineNanoseconds = nil
            }
            guard geometry != prior else { return nil }
            geometry.eventSequence = try aosNextScreenRecordingGeometryEventSequence(
                geometry.eventSequence
            )
            state.operations[index].screenRecordingGeometry = geometry
            state.operations[index].updatedAtNanoseconds = clock()
            return geometry
        }
    }

    private static func addMilliseconds(
        _ milliseconds: UInt64,
        to nanoseconds: UInt64
    ) throws -> UInt64 {
        let multiplied = milliseconds.multipliedReportingOverflow(by: 1_000_000)
        let added = nanoseconds.addingReportingOverflow(multiplied.partialValue)
        guard !multiplied.overflow, !added.overflow else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_follow_deadline")
        }
        return added.partialValue
    }

    func updateOperationProgress(
        _ identity: AOSOperationIdentity,
        _ progress: AOSOperationProgress
    ) throws -> AOSOperationRecord {
        let now = clock()
        return try mutateDurably { state in
            guard let index = state.operations.firstIndex(where: { $0.identity == identity }),
                  state.operations[index].state != .terminal else {
                throw AOSOperationCoreError.operationNotFound
            }
            if let bounds = state.operations[index].requestedBounds {
                guard progress.byteCount <= bounds.maximumOutputBytes,
                      progress.elapsedMilliseconds <= bounds.durationMilliseconds else {
                    throw AOSOperationCoreError.recordingBoundsExceeded
                }
            }
            state.operations[index].progress = progress
            state.operations[index].updatedAtNanoseconds = now
            return state.operations[index]
        }
    }

    func prepareStream(parent: AOSOperationIdentity) throws -> AOSStreamRecord {
        let now = clock()
        return try mutateDurably { state in
            guard let operation = state.operations.first(where: { $0.identity == parent }),
                  operation.state != .terminal else {
                throw AOSOperationCoreError.operationNotFound
            }
            let record = AOSStreamRecord(
                identity: AOSOperationIdentity(id: idFactory(), generation: state.allocateGeneration()),
                parentOperation: parent,
                daemonGeneration: state.daemonGeneration,
                state: .prepared,
                residualDigest: nil,
                updatedAtNanoseconds: now
            )
            state.streams.append(record)
            return record
        }
    }

    func transitionStream(
        _ identity: AOSOperationIdentity,
        to newState: AOSStreamLifecycleState,
        frameCount: UInt64? = nil,
        byteCount: UInt64? = nil,
        residualDigest: String? = nil
    ) throws -> AOSStreamRecord {
        let now = clock()
        return try mutateDurably { state in
            guard let index = state.streams.firstIndex(where: { $0.identity == identity }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            guard Self.permitsStreamTransition(from: state.streams[index].state, to: newState) else {
                throw AOSOperationCoreError.invalidTransition
            }
            state.streams[index].state = newState
            if let frameCount { state.streams[index].frameCount = frameCount }
            if let byteCount { state.streams[index].byteCount = byteCount }
            state.streams[index].residualDigest = newState == .terminal ? nil : residualDigest
            state.streams[index].updatedAtNanoseconds = now
            return state.streams[index]
        }
    }

    func prepareArtifact(
        parent: AOSOperationIdentity,
        trackSummary: AOSScreenRecordingTrackSummary? = nil
    ) throws -> AOSArtifactRecord {
        let now = clock()
        return try mutateDurably { state in
            guard let operation = state.operations.first(where: { $0.identity == parent }),
                  operation.state != .terminal else {
                throw AOSOperationCoreError.operationNotFound
            }
            let record = AOSArtifactRecord(
                identity: AOSOperationIdentity(id: idFactory(), generation: state.allocateGeneration()),
                parentOperation: parent,
                daemonGeneration: state.daemonGeneration,
                state: .transient,
                recoveryOriginState: nil,
                recoveryDisposition: nil,
                custodyDigest: nil,
                fileIdentity: nil,
                trackSummary: trackSummary,
                pendingAction: nil,
                release: nil,
                custodyReceipt: nil,
                updatedAtNanoseconds: now
            )
            state.artifacts.append(record)
            return record
        }
    }

    func updateArtifact(
        _ identity: AOSOperationIdentity,
        state newState: AOSArtifactLifecycleState,
        fileIdentity: AOSArtifactFileIdentity? = nil,
        trackSummary: AOSScreenRecordingTrackSummary? = nil,
        pendingAction: AOSArtifactPendingAction? = nil,
        custodyReceipt: AOSArtifactCustodyReceipt? = nil,
        custodyDigest: String? = nil
    ) throws -> AOSArtifactRecord {
        let now = clock()
        return try mutateDurably { durable in
            guard let index = durable.artifacts.firstIndex(where: { $0.identity == identity }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            guard durable.artifacts[index].release == nil,
                  Self.permitsArtifactTransition(from: durable.artifacts[index].state, to: newState) else {
                throw AOSOperationCoreError.invalidTransition
            }
            durable.artifacts[index].state = newState
            if let fileIdentity { durable.artifacts[index].fileIdentity = fileIdentity }
            if let trackSummary { durable.artifacts[index].trackSummary = trackSummary }
            durable.artifacts[index].pendingAction = pendingAction
            if let custodyReceipt { durable.artifacts[index].custodyReceipt = custodyReceipt }
            if let custodyDigest { durable.artifacts[index].custodyDigest = custodyDigest }
            durable.artifacts[index].updatedAtNanoseconds = now
            return durable.artifacts[index]
        }
    }

    func prepareArtifactRelease(
        _ identity: AOSOperationIdentity,
        sourceIdentity: AOSArtifactFileIdentity,
        destinationIdentity: AOSArtifactReleaseDestinationIdentity
    ) throws -> AOSArtifactReleaseRecord {
        let now = clock()
        return try mutateDurably { durable in
            guard let index = durable.artifacts.firstIndex(where: {
                $0.identity == identity
            }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            guard durable.artifacts[index].state == .offered,
                  durable.artifacts[index].fileIdentity == sourceIdentity,
                  durable.artifacts[index].pendingAction == nil,
                  durable.artifacts[index].release == nil else {
                throw AOSOperationCoreError.invalidTransition
            }
            let release = AOSArtifactReleaseRecord(
                releaseGeneration: durable.allocateGeneration(),
                artifact: identity,
                daemonGeneration: durable.daemonGeneration,
                sourceIdentity: sourceIdentity,
                destinationIdentity: destinationIdentity,
                phase: .prepared,
                destinationFileIdentity: nil
            )
            durable.artifacts[index].release = release
            durable.artifacts[index].updatedAtNanoseconds = now
            return release
        }
    }

    func markArtifactReleaseDestinationLinked(
        _ identity: AOSOperationIdentity,
        releaseGeneration: UInt64,
        destinationFileIdentity: AOSArtifactReleaseDestinationFileIdentity
    ) throws -> AOSArtifactReleaseRecord {
        let now = clock()
        return try mutateDurably { durable in
            guard let index = durable.artifacts.firstIndex(where: {
                $0.identity == identity
            }), var release = durable.artifacts[index].release,
                  release.releaseGeneration == releaseGeneration,
                  release.artifact == identity,
                  release.daemonGeneration == durable.artifacts[index].daemonGeneration,
                  durable.artifacts[index].state == .offered,
                  durable.artifacts[index].pendingAction == nil,
                  release.phase == .prepared,
                  destinationFileIdentity.matches(release.sourceIdentity) else {
                throw AOSOperationCoreError.invalidTransition
            }
            release.phase = .destinationLinked
            release.destinationFileIdentity = destinationFileIdentity
            durable.artifacts[index].release = release
            durable.artifacts[index].updatedAtNanoseconds = now
            return release
        }
    }

    func resolveArtifactRelease(
        _ identity: AOSOperationIdentity,
        releaseGeneration: UInt64,
        resolution: AOSArtifactReleaseResolution,
        custodyReceipt: AOSArtifactCustodyReceipt? = nil,
        custodyDigest: String? = nil
    ) throws -> AOSArtifactRecord {
        let now = clock()
        return try mutateDurably { durable in
            guard let index = durable.artifacts.firstIndex(where: {
                $0.identity == identity
            }), let release = durable.artifacts[index].release,
                  release.releaseGeneration == releaseGeneration,
                  release.artifact == identity,
                  release.daemonGeneration == durable.artifacts[index].daemonGeneration else {
                throw AOSOperationCoreError.invalidTransition
            }
            switch resolution {
            case .released:
                guard let custodyReceipt,
                      custodyReceipt.action == .release,
                      custodyReceipt.destinationIdentityDigest
                        == release.destinationIdentity.pathDigest,
                      let custodyDigest else {
                    throw AOSOperationCoreError.invalidRecord("artifact_release_receipt")
                }
                durable.artifacts[index].state = .released
                durable.artifacts[index].custodyReceipt = custodyReceipt
                durable.artifacts[index].custodyDigest = custodyDigest
                durable.artifacts[index].release = nil
                durable.artifacts[index].recoveryOriginState = nil
                durable.artifacts[index].recoveryDisposition = nil
            case .rolledBack:
                durable.artifacts[index].state = .offered
                durable.artifacts[index].release = nil
                durable.artifacts[index].recoveryOriginState = nil
                durable.artifacts[index].recoveryDisposition = nil
            case .residual:
                durable.artifacts[index].state = .cleanupRequired
                durable.artifacts[index].recoveryOriginState = .offered
                durable.artifacts[index].recoveryDisposition = .releaseVerification
            }
            durable.artifacts[index].pendingAction = nil
            durable.artifacts[index].updatedAtNanoseconds = now
            return durable.artifacts[index]
        }
    }

    func transitionOperation(
        _ identity: AOSOperationIdentity,
        to newState: AOSOperationLifecycleState,
        stopIntent: AOSStopIntent? = nil,
        outcome: AOSOperationOutcome? = nil,
        residualDigest: String? = nil
    ) throws -> AOSOperationRecord {
        let now = clock()
        return try mutateDurably { state in
            guard let index = state.operations.firstIndex(where: { $0.identity == identity }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            let old = state.operations[index].state
            guard Self.permitsTransition(from: old, to: newState) else {
                throw AOSOperationCoreError.invalidTransition
            }
            if old == .prepared && newState == .starting {
                guard state.barrier.state == .open,
                      state.operations[index].stopIntent == nil else {
                    throw AOSOperationCoreError.barrierClosed
                }
            }
            if newState == .terminal,
               Self.hasNonterminalChildren(in: state, operation: identity) {
                throw AOSOperationCoreError.residualsPresent
            }
            state.operations[index].state = newState
            if let stopIntent { state.operations[index].stopIntent = stopIntent }
            if let outcome { state.operations[index].outcome = outcome }
            if newState == .terminal {
                guard state.operations[index].outcome != nil else {
                    throw AOSOperationCoreError.invalidRecord("terminal_operation_outcome")
                }
                state.operations[index].residualDigest = nil
            } else if let residualDigest {
                state.operations[index].residualDigest = residualDigest
            }
            state.operations[index].updatedAtNanoseconds = now
            return state.operations[index]
        }
    }

    /// Publishes the terminal parent only in the same durable mutation that
    /// proves every operation-owned child authority/residual is already closed.
    func terminalizeOperationAfterVerifiedCleanup(
        _ identity: AOSOperationIdentity,
        stopIntent: AOSStopIntent?,
        outcome: AOSOperationOutcome,
        failureCode: String? = nil
    ) throws -> AOSOperationRecord {
        let now = clock()
        return try mutateDurably { state in
            guard let index = state.operations.firstIndex(where: { $0.identity == identity }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            let old = state.operations[index].state
            guard Self.permitsTransition(from: old, to: .terminal) else {
                throw AOSOperationCoreError.invalidTransition
            }
            guard !Self.hasNonterminalChildren(in: state, operation: identity) else {
                throw AOSOperationCoreError.residualsPresent
            }
            state.operations[index].state = .terminal
            if let stopIntent { state.operations[index].stopIntent = stopIntent }
            state.operations[index].outcome = outcome
            state.operations[index].failureCode = failureCode
            state.operations[index].residualDigest = nil
            state.operations[index].updatedAtNanoseconds = now
            return state.operations[index]
        }
    }

    func inspect(_ identity: AOSOperationIdentity) throws -> AOSOperationRecord {
        let value = snapshot().operations.first { $0.identity == identity }
        guard let value else { throw AOSOperationCoreError.operationNotFound }
        return value
    }

    /// One registry-owned predicate closes every path that can publish a
    /// terminal operation parent. Recovery and control code use this same
    /// durable-state view instead of maintaining partial child inventories.
    static func hasNonterminalChildren(
        in state: AOSOperationDurableState,
        operation identity: AOSOperationIdentity
    ) -> Bool {
        state.streams.contains {
            $0.parentOperation == identity && $0.state != .terminal
        } || state.taps.contains {
            $0.parentOperation == identity && $0.state != .terminal
        } || state.artifacts.contains {
            $0.parentOperation == identity
                && ![.offered, .released, .retained, .removed].contains($0.state)
        } || state.resourceTransactions.contains {
            $0.operation == identity && $0.state != .terminal
        } || state.resourceClaims.contains {
            $0.operation == identity && $0.state != .terminal
        } || state.resourceBrokers.contains { broker in
            broker.state != .terminal
                && broker.subscribers.contains { $0.operation == identity }
        } || state.pendingExternalSpawnIntents.contains {
            $0.operationID == identity.id && $0.operationGeneration == identity.generation
        } || state.finalizedExternalSpawnRecords.contains {
            $0.skipRecord.operationID == identity.id
                && $0.skipRecord.operationGeneration == identity.generation
        }
    }

    func list(ownerRoot: AOSMechanicalOwnerRoot, filter: AOSOperationFilter = .init()) -> [AOSOperationRecord] {
        snapshot().operations
            .filter { $0.ownerRoot == ownerRoot && filter.matches($0) }
            .sorted { $0.identity < $1.identity }
    }

    func registeredNonterminalOperations(in state: AOSOperationDurableState) -> [AOSOperationRecord] {
        state.operations.filter { operation in
            operation.state != .terminal
                && state.adapterRegistry.registration(
                    id: operation.adapterRegistrationID,
                    revision: operation.adapterRegistrationRevision
                ) != nil
        }.sorted { $0.identity < $1.identity }
    }

    @discardableResult
    func installPendingExternalSpawnIntent(
        _ intent: AOSExternalDispatchSpawnIntent
    ) throws -> AOSExternalDispatchSpawnIntent {
        try mutateDurably { state in
            try Self.validatePendingExternalSpawnIntent(intent, in: state)
            if let existing = state.pendingExternalSpawnIntents.first(where: {
                $0.spawnRecordID == intent.spawnRecordID
            }) {
                guard existing == intent else { throw AOSOperationCoreError.idempotencyConflict }
                return existing
            }
            guard state.pendingExternalSpawnIntents.count < Self.pendingExternalSpawnIntentLimit,
                  !state.pendingExternalSpawnIntents.contains(where: {
                      $0.oneTimeBindingTokenDigest == intent.oneTimeBindingTokenDigest
                  }),
                  !state.finalizedExternalSpawnRecords.contains(where: {
                      $0.skipRecord.spawnRecordID == intent.spawnRecordID
                          || $0.oneTimeBindingTokenDigest == intent.oneTimeBindingTokenDigest
                  }),
                  !state.closedExternalSpawnIntents.contains(where: {
                      $0.spawnRecordID == intent.spawnRecordID
                          || $0.oneTimeBindingTokenDigest == intent.oneTimeBindingTokenDigest
                  }) else {
                throw AOSOperationCoreError.spawnRecordCapacity
            }
            state.pendingExternalSpawnIntents.append(intent)
            state.pendingExternalSpawnIntents.sort { $0.spawnRecordID < $1.spawnRecordID }
            return intent
        }
    }

    func pendingExternalSpawnIntent(
        bindingTokenDigest: AOSSHA256Digest
    ) throws -> AOSExternalDispatchSpawnIntent {
        guard let intent = snapshot().pendingExternalSpawnIntents.first(where: {
            $0.oneTimeBindingTokenDigest == bindingTokenDigest
        }) else {
            throw AOSOperationCoreError.operationNotFound
        }
        return intent
    }

    func pendingExternalSpawnIntent(
        admittedChild: AOSProcessGenerationIdentity
    ) throws -> AOSExternalDispatchSpawnIntent {
        let matches = snapshot().pendingExternalSpawnIntents.filter {
            $0.admittedChild?.child == admittedChild
        }
        guard matches.count == 1, let intent = matches.first else {
            throw matches.isEmpty
                ? AOSOperationCoreError.operationNotFound
                : AOSOperationCoreError.idempotencyConflict
        }
        return intent
    }

    @discardableResult
    func admitPendingExternalSpawnIntent(
        bindingTokenDigest: AOSSHA256Digest,
        oneTimeBindingToken: Data,
        authenticatedParent: AOSProcessGenerationIdentity,
        childEdge: AOSStableProcessEdge,
        runningExecutable: AOSExternalRunningExecutableEvidence,
        admittedAtMonotonicNanoseconds: UInt64
    ) throws -> AOSExternalDispatchSpawnIntent {
        try mutateDurably { state in
            guard let index = state.pendingExternalSpawnIntents.firstIndex(where: {
                $0.oneTimeBindingTokenDigest == bindingTokenDigest
            }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            let current = state.pendingExternalSpawnIntents[index]
            try Self.validatePendingExternalSpawnIntent(current, in: state)
            guard !state.pendingExternalSpawnIntents.contains(where: {
                $0.spawnRecordID != current.spawnRecordID
                    && $0.admittedChild?.child == childEdge.child.generation
            }), !state.finalizedExternalSpawnRecords.contains(where: {
                $0.skipRecord.child == childEdge.child.generation
            }) else {
                throw AOSOperationCoreError.generationConflict
            }
            let admitted = try AOSExternalDispatchSpawnBinder.admit(
                intent: current,
                oneTimeBindingToken: oneTimeBindingToken,
                authenticatedParent: authenticatedParent,
                childEdge: childEdge,
                runningExecutable: runningExecutable,
                admittedAtMonotonicNanoseconds: admittedAtMonotonicNanoseconds
            )
            state.pendingExternalSpawnIntents[index] = admitted
            return admitted
        }
    }

    @discardableResult
    func abandonPendingExternalSpawnIntent(
        bindingTokenDigest: AOSSHA256Digest,
        authenticatedParent: AOSProcessGenerationIdentity,
        closedAtMonotonicNanoseconds: UInt64
    ) throws -> AOSClosedExternalDispatchSpawnIntent {
        try mutateDurably { state in
            if let existing = state.closedExternalSpawnIntents.first(where: {
                $0.oneTimeBindingTokenDigest == bindingTokenDigest
            }) {
                guard existing.parent == authenticatedParent,
                      existing.reason == .abandoned else {
                    throw AOSOperationCoreError.idempotencyConflict
                }
                return existing
            }
            guard !state.finalizedExternalSpawnRecords.contains(where: {
                $0.oneTimeBindingTokenDigest == bindingTokenDigest
            }) else {
                throw AOSOperationCoreError.idempotencyConflict
            }
            guard let index = state.pendingExternalSpawnIntents.firstIndex(where: {
                $0.oneTimeBindingTokenDigest == bindingTokenDigest
            }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            let intent = state.pendingExternalSpawnIntents[index]
            try Self.validatePendingExternalSpawnIntent(intent, in: state)
            guard intent.parent == authenticatedParent else {
                throw AOSOperationCoreError.ownerMismatch
            }
            guard closedAtMonotonicNanoseconds >= intent.createdAtMonotonicNanoseconds else {
                throw AOSOperationCoreError.generationConflict
            }
            state.pendingExternalSpawnIntents.remove(at: index)
            let closed = AOSClosedExternalDispatchSpawnIntent(
                spawnRecordID: intent.spawnRecordID,
                oneTimeBindingTokenDigest: intent.oneTimeBindingTokenDigest,
                parent: intent.parent,
                operationID: intent.operationID,
                operationGeneration: intent.operationGeneration,
                daemonGeneration: intent.daemonGeneration,
                closedAtMonotonicNanoseconds: closedAtMonotonicNanoseconds,
                reason: .abandoned
            )
            state.closedExternalSpawnIntents.append(closed)
            Self.pruneClosedExternalSpawnIntents(&state)
            return closed
        }
    }

    @discardableResult
    func expirePendingExternalSpawnIntents(
        daemonGeneration: UInt64,
        nowMonotonicNanoseconds: UInt64
    ) throws -> [AOSExternalDispatchSpawnIntent] {
        try mutateDurably { state in
            guard daemonGeneration == state.daemonGeneration else {
                throw AOSOperationCoreError.generationConflict
            }
            var expired: [AOSExternalDispatchSpawnIntent] = []
            state.pendingExternalSpawnIntents.removeAll { intent in
                let shouldExpire = intent.daemonGeneration != daemonGeneration
                    || intent.expiresAtMonotonicNanoseconds <= nowMonotonicNanoseconds
                if shouldExpire { expired.append(intent) }
                return shouldExpire
            }
            state.closedExternalSpawnIntents.append(contentsOf: expired.map { intent in
                AOSClosedExternalDispatchSpawnIntent(
                    spawnRecordID: intent.spawnRecordID,
                    oneTimeBindingTokenDigest: intent.oneTimeBindingTokenDigest,
                    parent: intent.parent,
                    operationID: intent.operationID,
                    operationGeneration: intent.operationGeneration,
                    daemonGeneration: intent.daemonGeneration,
                    closedAtMonotonicNanoseconds: nowMonotonicNanoseconds,
                    reason: .expired
                )
            })
            Self.pruneClosedExternalSpawnIntents(&state)
            return expired.sorted { $0.spawnRecordID < $1.spawnRecordID }
        }
    }

    @discardableResult
    func finalizePendingExternalSpawnIntent(
        observation: AOSExternalDispatchFinalizationObservation
    ) throws -> AOSFinalizedExternalDispatchSpawnRecord {
        try mutateDurably { state in
            if state.finalizedExternalSpawnRecords.contains(where: {
                $0.skipRecord.spawnRecordID == observation.spawnRecordID
            }) {
                throw AOSOperationCoreError.idempotencyConflict
            }
            guard let intentIndex = state.pendingExternalSpawnIntents.firstIndex(where: {
                $0.spawnRecordID == observation.spawnRecordID
            }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            let intent = state.pendingExternalSpawnIntents[intentIndex]
            try Self.validatePendingExternalSpawnIntent(intent, in: state)
            let finalized = try AOSExternalDispatchSpawnBinder.finalize(
                intent: intent,
                observation: observation
            )
            try Self.validateFinalizedExternalSpawnRecord(
                finalized,
                in: state,
                requireCurrentOperation: true
            )
            guard state.finalizedExternalSpawnRecords.count
                    < Self.finalizedExternalSpawnRecordLimit,
                  !state.finalizedExternalSpawnRecords.contains(where: {
                      $0.skipRecord.child == finalized.skipRecord.child
                          || ($0.skipRecord.child.pid == finalized.skipRecord.child.pid
                              && $0.skipRecord.child != finalized.skipRecord.child)
                  }) else {
                throw AOSOperationCoreError.spawnRecordCapacity
            }
            state.pendingExternalSpawnIntents.remove(at: intentIndex)
            state.finalizedExternalSpawnRecords.append(finalized)
            state.finalizedExternalSpawnRecords.sort {
                $0.skipRecord.spawnRecordID < $1.skipRecord.spawnRecordID
            }
            return finalized
        }
    }

    @discardableResult
    func rejectPendingExternalSpawnIntent(
        spawnRecordID: String,
        operation: AOSOperationIdentity,
        closedAtMonotonicNanoseconds: UInt64
    ) throws -> AOSClosedExternalDispatchSpawnIntent {
        try mutateDurably { state in
            guard let index = state.pendingExternalSpawnIntents.firstIndex(where: {
                $0.spawnRecordID == spawnRecordID
                    && $0.operationID == operation.id
                    && $0.operationGeneration == operation.generation
            }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            let intent = state.pendingExternalSpawnIntents[index]
            guard closedAtMonotonicNanoseconds >= intent.createdAtMonotonicNanoseconds else {
                throw AOSOperationCoreError.generationConflict
            }
            state.pendingExternalSpawnIntents.remove(at: index)
            let closed = AOSClosedExternalDispatchSpawnIntent(
                spawnRecordID: intent.spawnRecordID,
                oneTimeBindingTokenDigest: intent.oneTimeBindingTokenDigest,
                parent: intent.parent,
                operationID: intent.operationID,
                operationGeneration: intent.operationGeneration,
                daemonGeneration: intent.daemonGeneration,
                closedAtMonotonicNanoseconds: closedAtMonotonicNanoseconds,
                reason: .finalizeRejected
            )
            state.closedExternalSpawnIntents.append(closed)
            Self.pruneClosedExternalSpawnIntents(&state)
            return closed
        }
    }

    @discardableResult
    func installFinalizedExternalSpawnRecord(
        _ record: AOSFinalizedExternalDispatchSpawnRecord
    ) throws -> AOSFinalizedExternalDispatchSpawnRecord {
        try mutateDurably { state in
            try Self.validateFinalizedExternalSpawnRecord(record, in: state, requireCurrentOperation: true)
            if let existing = state.finalizedExternalSpawnRecords.first(where: {
                $0.skipRecord.spawnRecordID == record.skipRecord.spawnRecordID
            }) {
                guard existing == record else {
                    throw AOSOperationCoreError.idempotencyConflict
                }
                return existing
            }
            guard let intentIndex = state.pendingExternalSpawnIntents.firstIndex(where: {
                $0.spawnRecordID == record.skipRecord.spawnRecordID
                    && $0.oneTimeBindingTokenDigest == record.oneTimeBindingTokenDigest
                    && $0.operationID == record.skipRecord.operationID
                    && $0.operationGeneration == record.skipRecord.operationGeneration
                    && $0.adapterID == record.skipRecord.adapterID
                    && $0.adapterRegistrationRevision == record.skipRecord.adapterRegistrationRevision
                    && $0.parent == record.skipRecord.parent
                    && $0.reviewedDependencySetDigest
                        == record.reviewedDependencySetDigest
            }) else {
                throw AOSOperationCoreError.invalidRecord("missing_external_spawn_intent")
            }
            guard state.finalizedExternalSpawnRecords.count
                    < Self.finalizedExternalSpawnRecordLimit else {
                throw AOSOperationCoreError.spawnRecordCapacity
            }
            guard !state.finalizedExternalSpawnRecords.contains(where: {
                $0.skipRecord.child == record.skipRecord.child
                    || ($0.skipRecord.child.pid == record.skipRecord.child.pid
                        && $0.skipRecord.child != record.skipRecord.child)
            }) else {
                throw AOSOperationCoreError.generationConflict
            }
            state.pendingExternalSpawnIntents.remove(at: intentIndex)
            state.finalizedExternalSpawnRecords.append(record)
            state.finalizedExternalSpawnRecords.sort {
                $0.skipRecord.spawnRecordID < $1.skipRecord.spawnRecordID
            }
            return record
        }
    }

    func finalizedExternalSpawnRecord(
        spawnRecordID: String,
        operation: AOSOperationIdentity,
        child: AOSProcessGenerationIdentity
    ) throws -> AOSFinalizedExternalDispatchSpawnRecord {
        let state = snapshot()
        guard let record = state.finalizedExternalSpawnRecords.first(where: {
            $0.skipRecord.spawnRecordID == spawnRecordID
                && $0.skipRecord.operationID == operation.id
                && $0.skipRecord.operationGeneration == operation.generation
                && $0.skipRecord.child == child
        }) else {
            throw AOSOperationCoreError.operationNotFound
        }
        try Self.validateFinalizedExternalSpawnRecord(record, in: state, requireCurrentOperation: false)
        return record
    }

    func exactExternalSpawnSkipRecord(
        child: AOSProcessGenerationIdentity,
        parent: AOSProcessGenerationIdentity,
        parentEdgeReceipt: AOSParentEdgeReceipt,
        executableIdentityDigest: AOSSHA256Digest,
        executableDigest: AOSSHA256Digest
    ) -> AOSGenerationBoundSpawnRecord? {
        let state = snapshot()
        return state.finalizedExternalSpawnRecords.lazy.map(\.skipRecord).first {
            $0.child == child
                && $0.parent == parent
                && $0.parentEdgeReceipt == parentEdgeReceipt
                && $0.executableIdentityDigest == executableIdentityDigest
                && $0.executableDigest == executableDigest
        }
    }

    func exactExternalSpawnSkipRecord(
        observation: AOSProcessObservation
    ) -> AOSGenerationBoundSpawnRecord? {
        snapshot().finalizedExternalSpawnRecords.lazy.map(\.skipRecord).first {
            $0.child == observation.generation
                && $0.executableIdentityDigest == observation.image.executableIdentityDigest
                && $0.executableDigest == observation.image.executableDigest
        }
    }

    @discardableResult
    func retireFinalizedExternalSpawnRecord(
        spawnRecordID: String,
        operation: AOSOperationIdentity,
        child: AOSProcessGenerationIdentity,
        mechanicalAbsenceVerified: Bool
    ) throws -> AOSFinalizedExternalDispatchSpawnRecord {
        try mutateDurably { state in
            guard mechanicalAbsenceVerified,
                  let operationRecord = state.operations.first(where: { $0.identity == operation }),
                  [.cleanupRequired, .recovering, .terminal].contains(operationRecord.state),
                  let index = state.finalizedExternalSpawnRecords.firstIndex(where: {
                      $0.skipRecord.spawnRecordID == spawnRecordID
                          && $0.skipRecord.operationID == operation.id
                          && $0.skipRecord.operationGeneration == operation.generation
                          && $0.skipRecord.child == child
                  }) else {
                throw AOSOperationCoreError.generationConflict
            }
            return state.finalizedExternalSpawnRecords.remove(at: index)
        }
    }

    func makeID() -> String { idFactory() }
    func now() -> UInt64 { clock() }

    private static func validateFinalizedExternalSpawnRecord(
        _ record: AOSFinalizedExternalDispatchSpawnRecord,
        in state: AOSOperationDurableState,
        requireCurrentOperation: Bool
    ) throws {
        let skip = record.skipRecord
        let receipt = record.receipt
        let expectedCodeIdentity = AOSSHA256Digest.hashing(
            domain: .executableCodeIdentity,
            data: Data(record.executableFileDigest.value.utf8)
        )
        let expectedExecutableIdentity = AOSSHA256Digest.hashing(
            domain: .executableIdentity,
            data: Data([
                String(record.executableDevice), String(record.executableInode),
                expectedCodeIdentity.value, record.executableFileDigest.value,
            ].joined(separator: "\u{1f}").utf8)
        )
        guard !skip.spawnRecordID.isEmpty,
              skip.evidenceScope == .immediateSocketPeer,
              skip.childAuditToken != nil,
              skip.childAuditToken?.pid == skip.child.pid,
              skip.childAuditToken?.effectiveUID == skip.child.effectiveUID,
              skip.parentEdgeReceipt == .make(child: skip.child, parent: skip.parent),
              !skip.operationID.isEmpty,
              skip.operationGeneration > 0,
              !skip.adapterID.isEmpty,
              skip.adapterRegistrationRevision > 0,
              record.oneTimeBindingTokenDigest.value.count == 64,
              record.executableInode > 0,
              record.executableCodeIdentityDigest == expectedCodeIdentity,
              skip.executableIdentityDigest == expectedExecutableIdentity,
              record.resolvedExecutablePathDigest == receipt.resolvedExecutablePathDigest,
              record.executableFileDigest == skip.executableDigest,
              record.executableFileDigest == receipt.executableFileDigest,
              skip.executableIdentityDigest == receipt.executableIdentityDigest,
              record.expectedScriptIdentityDigest == receipt.expectedScriptIdentityDigest,
              record.scriptIdentityDigest == receipt.scriptIdentityDigest,
              record.scriptDigest == receipt.scriptDigest,
              record.canonicalArgvShapeDigest == receipt.canonicalArgvShapeDigest,
              record.reviewedDependencySetDigest == skip.reviewedDependencySetDigest,
              record.reviewedDependencySetDigest == receipt.reviewedDependencySetDigest,
              receipt.spawnRecordID == skip.spawnRecordID,
              receipt.operationID == skip.operationID,
              receipt.operationGeneration == skip.operationGeneration,
              receipt.adapterID == skip.adapterID,
              receipt.adapterRegistrationRevision == skip.adapterRegistrationRevision,
              receipt.outcome == .finalized,
              receipt.platformCodeDirectoryHash == record.platformCodeDirectoryHash,
              receipt.platformCodeDirectoryHashAlgorithm
                == AOSPlatformCodeDirectoryHash.algorithm,
              record.platformCodeDirectoryHash == record.receipt.platformCodeDirectoryHash,
              record.signingIdentifier == "node",
              record.signingTeamIdentifier == "HX7739G8FX",
              let operation = state.operations.first(where: {
                  $0.identity.id == skip.operationID
                      && $0.identity.generation == skip.operationGeneration
              }),
              (!requireCurrentOperation || operation.daemonGeneration == state.daemonGeneration),
              operation.ownerRoot.effectiveUID == skip.child.effectiveUID,
              operation.adapterRegistrationID == skip.adapterID,
              operation.adapterRegistrationRevision == skip.adapterRegistrationRevision,
              (!requireCurrentOperation || operation.state != .terminal),
              state.adapterRegistry.registration(
                  id: skip.adapterID,
                  revision: skip.adapterRegistrationRevision
              ) != nil else {
            throw AOSOperationCoreError.invalidRecord("finalized_external_spawn_record")
        }
    }

    private static func validatePendingExternalSpawnIntent(
        _ intent: AOSExternalDispatchSpawnIntent,
        in state: AOSOperationDurableState
    ) throws {
        let expectedCodeIdentity = AOSSHA256Digest.hashing(
            domain: .executableCodeIdentity,
            data: Data(intent.executable.fileDigest.value.utf8)
        )
        let expectedExecutableIdentity = AOSSHA256Digest.hashing(
            domain: .executableIdentity,
            data: Data([
                String(intent.executable.device), String(intent.executable.inode),
                expectedCodeIdentity.value, intent.executable.fileDigest.value,
            ].joined(separator: "\u{1f}").utf8)
        )
        guard !intent.spawnRecordID.isEmpty,
              !intent.operationID.isEmpty,
              intent.operationGeneration > 0,
              !intent.adapterID.isEmpty,
              intent.adapterRegistrationRevision > 0,
              intent.executable.inode > 0,
              intent.executable.codeIdentityDigest == expectedCodeIdentity,
              intent.executable.executableIdentityDigest == expectedExecutableIdentity,
              intent.executable.platformCodeDirectoryHash != nil,
              intent.executable.signingIdentifier == "node",
              intent.executable.signingTeamIdentifier == "HX7739G8FX",
              intent.daemonGeneration == state.daemonGeneration,
              intent.createdAtMonotonicNanoseconds > 0,
              intent.expiresAtMonotonicNanoseconds
                > intent.createdAtMonotonicNanoseconds,
              let operation = state.operations.first(where: {
                  $0.identity.id == intent.operationID
                      && $0.identity.generation == intent.operationGeneration
              }),
              operation.daemonGeneration == state.daemonGeneration,
              operation.state == .starting,
              operation.ownerRoot.effectiveUID == intent.parent.effectiveUID,
              operation.adapterRegistrationID == intent.adapterID,
              operation.adapterRegistrationRevision == intent.adapterRegistrationRevision,
              state.adapterRegistry.registration(
                  id: intent.adapterID,
                  revision: intent.adapterRegistrationRevision
              ) != nil,
              intent.admittedChild.map({ admission in
                  admission.child.parentPID == intent.parent.pid
                      && admission.child.effectiveUID == intent.parent.effectiveUID
                      && admission.parentEdgeReceipt.child == admission.child
                      && admission.parentEdgeReceipt.parent == intent.parent
                      && admission.parentEdgeReceipt == .make(
                          child: admission.child,
                          parent: intent.parent
                      )
                      && admission.runningExecutable.resolvedPathDigest
                        == intent.executable.resolvedPathDigest
                      && admission.runningExecutable.device == intent.executable.device
                      && admission.runningExecutable.inode == intent.executable.inode
                      && Optional(admission.runningExecutable.platformCodeDirectoryHash)
                        == intent.executable.platformCodeDirectoryHash
                      && Optional(admission.runningExecutable.signingIdentifier)
                        == intent.executable.signingIdentifier
                      && Optional(admission.runningExecutable.signingTeamIdentifier)
                        == intent.executable.signingTeamIdentifier
              }) ?? true else {
            throw AOSOperationCoreError.invalidRecord("pending_external_spawn_intent")
        }
    }

    private static func pruneClosedExternalSpawnIntents(
        _ state: inout AOSOperationDurableState
    ) {
        state.closedExternalSpawnIntents.sort {
            if $0.closedAtMonotonicNanoseconds != $1.closedAtMonotonicNanoseconds {
                return $0.closedAtMonotonicNanoseconds < $1.closedAtMonotonicNanoseconds
            }
            return $0.spawnRecordID < $1.spawnRecordID
        }
        if state.closedExternalSpawnIntents.count > closedExternalSpawnIntentLimit {
            state.closedExternalSpawnIntents.removeFirst(
                state.closedExternalSpawnIntents.count - closedExternalSpawnIntentLimit
            )
        }
    }

    private static func permitsTransition(
        from: AOSOperationLifecycleState,
        to: AOSOperationLifecycleState
    ) -> Bool {
        switch (from, to) {
        case (.prepared, .starting), (.prepared, .terminal), (.prepared, .cleanupRequired),
             (.starting, .active), (.starting, .stopping), (.starting, .terminal),
             (.starting, .cleanupRequired), (.active, .stopping), (.active, .cleanupRequired),
             (.stopping, .terminal), (.stopping, .cleanupRequired),
             (.cleanupRequired, .recovering), (.cleanupRequired, .cleanupRequired),
             (.recovering, .terminal), (.recovering, .cleanupRequired):
            return true
        default:
            return false
        }
    }

    private static func permitsStreamTransition(
        from: AOSStreamLifecycleState,
        to: AOSStreamLifecycleState
    ) -> Bool {
        switch (from, to) {
        case (.prepared, .starting), (.prepared, .terminal), (.prepared, .cleanupRequired),
             (.starting, .active), (.starting, .stopping), (.starting, .terminal),
             (.starting, .cleanupRequired), (.active, .active), (.active, .stopping),
             (.active, .cleanupRequired), (.stopping, .terminal),
             (.stopping, .cleanupRequired), (.cleanupRequired, .recovering),
             (.recovering, .terminal), (.recovering, .cleanupRequired):
            return true
        default:
            return false
        }
    }

    private static func permitsArtifactTransition(
        from: AOSArtifactLifecycleState,
        to: AOSArtifactLifecycleState
    ) -> Bool {
        switch (from, to) {
        case (.transient, .offered), (.transient, .removing),
             (.transient, .cleanupRequired), (.offered, .offered),
             (.offered, .removing), (.offered, .released),
             (.offered, .cleanupRequired), (.removing, .removed),
             (.removing, .cleanupRequired), (.cleanupRequired, .recovering),
             (.recovering, .removed), (.recovering, .released),
             (.recovering, .cleanupRequired):
            return true
        default:
            return false
        }
    }
}
