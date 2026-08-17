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
        adapterRegistrationRevision: UInt64
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
                residualDigest: nil,
                createdAtNanoseconds: now,
                updatedAtNanoseconds: now
            )
            state.operations.append(record)
            return record
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
            state.operations[index].state = newState
            if let stopIntent { state.operations[index].stopIntent = stopIntent }
            if let outcome { state.operations[index].outcome = outcome }
            if let residualDigest { state.operations[index].residualDigest = residualDigest }
            state.operations[index].updatedAtNanoseconds = now
            return state.operations[index]
        }
    }

    func inspect(_ identity: AOSOperationIdentity) throws -> AOSOperationRecord {
        let value = snapshot().operations.first { $0.identity == identity }
        guard let value else { throw AOSOperationCoreError.operationNotFound }
        return value
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
}
