import Foundation

struct AOSRecoverySummary: Codable, Equatable {
    let daemonGeneration: UInt64
    let recoveryGeneration: UInt64
    let state: AOSRecoveryLifecycleState
    let residualCount: UInt64
    let residualDigest: String
    let barrierState: AOSHostBarrierLifecycleState
    let barrierSnapshotDigest: String?
}

enum AOSOperationRecovery {
    static func beginBootRecovery(
        registry: AOSOperationRegistry,
        newDaemonGeneration: UInt64,
        claimTokenDigest: String
    ) throws -> AOSRecoverySummary {
        guard newDaemonGeneration > 0, !claimTokenDigest.isEmpty else {
            throw AOSOperationCoreError.invalidRecord("recovery_identity")
        }
        return try registry.mutateDurably { state in
            guard newDaemonGeneration >= state.daemonGeneration else {
                throw AOSOperationCoreError.generationConflict
            }
            state.daemonGeneration = newDaemonGeneration
            state.recovery.daemonGeneration = newDaemonGeneration
            state.recovery.generation = state.allocateGeneration()
            state.recovery.state = .scanning
            state.recovery.claimTokenDigest = claimTokenDigest

            for index in state.operations.indices where state.operations[index].state != .terminal {
                state.operations[index].state = .cleanupRequired
                state.operations[index].outcome = state.operations[index].outcome ?? .orphaned
                if var geometry = state.operations[index].screenRecordingGeometry,
                   geometry.accepted.mode == .callerFollowed {
                    let prior = geometry
                    if geometry.pendingUpdate != nil {
                        state.operations[index].failureCode =
                            AOSOperationCoreError.recordingFollowUpdateFailed.code
                    }
                    geometry.deadlineState = .stopped
                    geometry.nextUpdateNotBeforeNanoseconds = nil
                    geometry.nextDeadlineNanoseconds = nil
                    if geometry != prior {
                        geometry.eventSequence = try aosNextScreenRecordingGeometryEventSequence(
                            geometry.eventSequence
                        )
                    }
                    state.operations[index].screenRecordingGeometry = geometry
                }
            }
            for index in state.streams.indices where state.streams[index].state != .terminal {
                state.streams[index].state = .cleanupRequired
            }
            for index in state.taps.indices where state.taps[index].state != .terminal {
                state.taps[index].state = .cleanupRequired
            }
            for index in state.artifacts.indices {
                let origin = state.artifacts[index].recoveryOriginState ?? state.artifacts[index].state
                state.artifacts[index].recoveryOriginState = origin
                if state.artifacts[index].release != nil {
                    state.artifacts[index].recoveryOriginState = .offered
                    state.artifacts[index].recoveryDisposition = .releaseVerification
                } else { switch origin {
                case .retained:
                    state.artifacts[index].recoveryDisposition = .retentionVerification
                case .released:
                    state.artifacts[index].recoveryDisposition = .releaseVerification
                default:
                    state.artifacts[index].recoveryDisposition = .removalVerification
                }
                }
                state.artifacts[index].state = .cleanupRequired
            }
            for index in state.resourceTransactions.indices where
                state.resourceTransactions[index].state != .terminal {
                let origin = state.resourceTransactions[index].state
                state.resourceTransactions[index].recoveryOriginState = origin
                state.resourceTransactions[index].recoveryDisposition = origin == .committed
                    ? .commitPendingHandoff : .rollbackPending
                state.resourceTransactions[index].state = .cleanupRequired
            }
            for index in state.resourceClaims.indices where state.resourceClaims[index].state != .terminal {
                state.resourceClaims[index].state = .cleanupRequired
            }
            for index in state.resourceBrokers.indices where state.resourceBrokers[index].state != .terminal {
                state.resourceBrokers[index].state = .cleanupRequired
            }
            state.closedExternalSpawnIntents.append(contentsOf:
                state.pendingExternalSpawnIntents.map { intent in
                    AOSClosedExternalDispatchSpawnIntent(
                        spawnRecordID: intent.spawnRecordID,
                        oneTimeBindingTokenDigest: intent.oneTimeBindingTokenDigest,
                        parent: intent.parent,
                        operationID: intent.operationID,
                        operationGeneration: intent.operationGeneration,
                        daemonGeneration: intent.daemonGeneration,
                        closedAtMonotonicNanoseconds: max(
                            intent.createdAtMonotonicNanoseconds,
                            intent.expiresAtMonotonicNanoseconds
                        ),
                        reason: .bootRecovery
                    )
                }
            )
            state.closedExternalSpawnIntents.sort {
                if $0.closedAtMonotonicNanoseconds != $1.closedAtMonotonicNanoseconds {
                    return $0.closedAtMonotonicNanoseconds
                        < $1.closedAtMonotonicNanoseconds
                }
                return $0.spawnRecordID < $1.spawnRecordID
            }
            if state.closedExternalSpawnIntents.count
                > AOSOperationRegistry.closedExternalSpawnIntentLimit {
                state.closedExternalSpawnIntents.removeFirst(
                    state.closedExternalSpawnIntents.count
                        - AOSOperationRegistry.closedExternalSpawnIntentLimit
                )
            }
            state.pendingExternalSpawnIntents.removeAll()

            switch state.barrier.state {
            case .open, .closed:
                state.barrier.state = .bootReconciling
            case .bootReconciling:
                break
            case .closing, .cleanupRequired, .recovering:
                state.barrier.state = .cleanupRequired
            }
            state.barrier.daemonGeneration = newDaemonGeneration
            state.barrier.cleanupResult = .recoveryActive
            state.barrier.reconciliationState = "scanning"

            let residualIDs = residualIdentities(state)
            state.recovery.residualCount = UInt64(residualIDs.count)
            state.recovery.residualDigest = try AOSOperationDigest.sha256(domain: .residualSet, residualIDs)
            state.recovery.state = residualIDs.isEmpty ? .terminal : .recovering
            state.barrier.residualCount = state.recovery.residualCount
            state.barrier.residualDigest = state.recovery.residualDigest
            if residualIDs.isEmpty {
                state.barrier.cleanupResult = .zeroResiduals
                state.barrier.reconciliationState = "complete"
            }
            return summary(state)
        }
    }

    static func retry(
        registry: AOSOperationRegistry,
        recoveryGeneration: UInt64,
        claimTokenDigest: String
    ) throws -> AOSRecoverySummary {
        try registry.mutateDurably { state in
            try validateClaim(
                state,
                recoveryGeneration: recoveryGeneration,
                claimTokenDigest: claimTokenDigest
            )
            guard [.cleanupRequired, .blockedUnresolved, .recovering].contains(state.recovery.state) else {
                throw AOSOperationCoreError.invalidTransition
            }
            state.recovery.state = .recovering
            state.barrier.state = .recovering
            state.barrier.cleanupResult = .recoveryActive
            state.barrier.reconciliationState = "recovering"
            return summary(state)
        }
    }

    static func reconcile(
        registry: AOSOperationRegistry,
        recoveryGeneration: UInt64,
        claimTokenDigest: String,
        mechanicallyAbsentOperationIDs: Set<AOSOperationIdentity>,
        mechanicallyAbsentStreamIDs: Set<AOSOperationIdentity> = [],
        mechanicallyAbsentTapIDs: Set<AOSOperationIdentity> = [],
        mechanicallyAbsentTransactionIDs: Set<String> = [],
        mechanicallyAbsentClaimIDs: Set<String>,
        mechanicallyAbsentBrokerIDs: Set<String>,
        mechanicallyAbsentSpawnRecordIDs: Set<String> = [],
        mechanicallyRemovedArtifactIDs: Set<AOSOperationIdentity> = [],
        mechanicallyReleasedArtifactIDs: Set<AOSOperationIdentity> = [],
        mechanicallyRetainedArtifactIDs: Set<AOSOperationIdentity> = []
    ) throws -> AOSRecoverySummary {
        try registry.mutateDurably { state in
            try validateClaim(
                state,
                recoveryGeneration: recoveryGeneration,
                claimTokenDigest: claimTokenDigest
            )
            for index in state.streams.indices where
                mechanicallyAbsentStreamIDs.contains(state.streams[index].identity)
                    && [.cleanupRequired, .recovering].contains(state.streams[index].state) {
                state.streams[index].state = .terminal
            }
            for index in state.taps.indices where
                mechanicallyAbsentTapIDs.contains(state.taps[index].identity)
                    && [.cleanupRequired, .recovering].contains(state.taps[index].state) {
                state.taps[index].state = .terminal
            }
            for index in state.resourceTransactions.indices where
                mechanicallyAbsentTransactionIDs.contains(state.resourceTransactions[index].transactionID)
                    && [.cleanupRequired, .recovering].contains(state.resourceTransactions[index].state) {
                state.resourceTransactions[index].state = .terminal
            }
            for index in state.resourceClaims.indices where
                mechanicallyAbsentClaimIDs.contains(state.resourceClaims[index].claimID)
                    && [.cleanupRequired, .recovering, .releasing].contains(state.resourceClaims[index].state) {
                state.resourceClaims[index].state = .terminal
            }
            for index in state.resourceBrokers.indices where
                mechanicallyAbsentBrokerIDs.contains(state.resourceBrokers[index].brokerID)
                    && [.cleanupRequired, .recovering, .stopping].contains(state.resourceBrokers[index].state) {
                state.resourceBrokers[index].state = .terminal
            }
            for index in state.artifacts.indices where
                [.cleanupRequired, .recovering].contains(state.artifacts[index].state) {
                let identity = state.artifacts[index].identity
                if mechanicallyRemovedArtifactIDs.contains(identity) {
                    state.artifacts[index].state = .removed
                } else if mechanicallyReleasedArtifactIDs.contains(identity),
                          state.artifacts[index].recoveryDisposition == .releaseVerification {
                    state.artifacts[index].state = .released
                } else if mechanicallyRetainedArtifactIDs.contains(identity),
                          state.artifacts[index].recoveryDisposition == .retentionVerification {
                    state.artifacts[index].state = .retained
                }
            }
            state.finalizedExternalSpawnRecords.removeAll {
                mechanicallyAbsentSpawnRecordIDs.contains($0.skipRecord.spawnRecordID)
            }
            for index in state.operations.indices where
                mechanicallyAbsentOperationIDs.contains(state.operations[index].identity)
                    && [.cleanupRequired, .recovering].contains(state.operations[index].state) {
                guard !AOSOperationRegistry.hasNonterminalChildren(
                    in: state,
                    operation: state.operations[index].identity
                ) else {
                    throw AOSOperationCoreError.residualsPresent
                }
                state.operations[index].state = .terminal
                state.operations[index].residualDigest = nil
            }
            let residualIDs = residualIdentities(state)
            state.recovery.residualCount = UInt64(residualIDs.count)
            state.recovery.residualDigest = try AOSOperationDigest.sha256(domain: .residualSet, residualIDs)
            state.barrier.residualCount = state.recovery.residualCount
            state.barrier.residualDigest = state.recovery.residualDigest
            if residualIDs.isEmpty {
                state.recovery.state = .terminal
                state.barrier.state = state.barrier.stopSnapshot == nil ? .bootReconciling : .closed
                state.barrier.cleanupResult = .zeroResiduals
                state.barrier.reconciliationState = "complete"
            } else {
                state.recovery.state = .cleanupRequired
                state.barrier.state = .cleanupRequired
                state.barrier.cleanupResult = .residualsPresent
                state.barrier.reconciliationState = "residuals_present"
            }
            return summary(state)
        }
    }

    static func acknowledgeUnresolved(
        registry: AOSOperationRegistry,
        recoveryGeneration: UInt64,
        claimTokenDigest: String
    ) throws -> AOSRecoverySummary {
        try registry.mutateDurably { state in
            try validateClaim(
                state,
                recoveryGeneration: recoveryGeneration,
                claimTokenDigest: claimTokenDigest
            )
            guard state.recovery.residualCount > 0 else { throw AOSOperationCoreError.invalidTransition }
            state.recovery.state = .blockedUnresolved
            state.barrier.state = .cleanupRequired
            state.barrier.cleanupResult = .residualsPresent
            state.barrier.reconciliationState = "blocked_unresolved"
            return summary(state)
        }
    }

    private static func validateClaim(
        _ state: AOSOperationDurableState,
        recoveryGeneration: UInt64,
        claimTokenDigest: String
    ) throws {
        guard state.recovery.generation == recoveryGeneration,
              state.recovery.claimTokenDigest == claimTokenDigest else {
            throw AOSOperationCoreError.staleRecoveryClaim
        }
    }

    private static func residualIdentities(_ state: AOSOperationDurableState) -> [String] {
        var values: [String] = []
        values += state.operations.filter { $0.state != .terminal }.map {
            "operation:\($0.identity.id):\($0.identity.generation)"
        }
        values += state.streams.filter { $0.state != .terminal }.map {
            "stream:\($0.identity.id):\($0.identity.generation)"
        }
        values += state.taps.filter { $0.state != .terminal }.map {
            "tap:\($0.identity.id):\($0.identity.generation)"
        }
        values += state.artifacts.filter {
            [.cleanupRequired, .recovering, .removing, .transient, .offered].contains($0.state)
        }.map { "artifact:\($0.identity.id):\($0.identity.generation)" }
        values += state.resourceTransactions.filter { $0.state != .terminal }.map {
            "claim-set:\($0.transactionID)"
        }
        values += state.resourceClaims.filter { $0.state != .terminal }.map {
            "claim:\($0.claimID):\($0.resourceGeneration)"
        }
        values += state.resourceBrokers.filter { $0.state != .terminal }.map {
            "broker:\($0.brokerID):\($0.brokerGeneration)"
        }
        values += state.finalizedExternalSpawnRecords.map {
            "external-spawn:\($0.skipRecord.spawnRecordID):\($0.skipRecord.child.pid):\($0.skipRecord.child.startTimeSeconds):\($0.skipRecord.child.startTimeMicroseconds)"
        }
        return values.sorted()
    }

    private static func summary(_ state: AOSOperationDurableState) -> AOSRecoverySummary {
        AOSRecoverySummary(
            daemonGeneration: state.daemonGeneration,
            recoveryGeneration: state.recovery.generation,
            state: state.recovery.state,
            residualCount: state.recovery.residualCount,
            residualDigest: state.recovery.residualDigest,
            barrierState: state.barrier.state,
            barrierSnapshotDigest: state.barrier.stopSnapshot?.barrierSnapshotDigest
        )
    }
}
