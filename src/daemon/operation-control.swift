import Foundation

enum AOSOrdinaryControlAction: String, Codable {
    case cancel
    case kill
    case killOwner = "kill_owner"
}

struct AOSOrdinaryControlContext: Codable, Equatable {
    let expectedDaemonGeneration: UInt64
    let connectionEpoch: UInt64
    let caller: AOSCallerEvidence
    let authenticatedOwnerRoot: AOSMechanicalOwnerRoot
}

struct AOSOperationControlReceipt: Codable, Equatable {
    let action: AOSOrdinaryControlAction
    let ownerRootID: String
    let selectedOperations: [AOSOperationIdentity]
    let selectedOperationCount: UInt64
    let selectedOperationDigest: String
    let stopIntent: AOSStopIntent
    let terminalOutcome: AOSOperationOutcome
}

enum AOSBootBarrierReconciliationResult {
    case open
    case closed
}

final class AOSOperationControlPlane {
    static let retainedReceiptLimit = 4_096
    static let retainedReceiptMaximumAgeSeconds: UInt64 = 86_400

    private let registry: AOSOperationRegistry
    private let daemonEffectiveUID: UInt32

    init(registry: AOSOperationRegistry, daemonEffectiveUID: UInt32) {
        self.registry = registry
        self.daemonEffectiveUID = daemonEffectiveUID
    }

    func list(
        context: AOSOrdinaryControlContext,
        filter: AOSOperationFilter = .init()
    ) throws -> [AOSOperationRecord] {
        try validateOrdinaryCaller(context)
        return registry.list(ownerRoot: context.authenticatedOwnerRoot, filter: filter)
    }

    func inspect(
        context: AOSOrdinaryControlContext,
        operation: AOSOperationIdentity
    ) throws -> AOSOperationRecord {
        try validateOrdinaryCaller(context)
        let record = try registry.inspect(operation)
        guard record.ownerRoot == context.authenticatedOwnerRoot else {
            throw AOSOperationCoreError.ownerMismatch
        }
        return record
    }

    func cancel(
        context: AOSOrdinaryControlContext,
        operation: AOSOperationIdentity
    ) throws -> AOSOperationControlReceipt {
        try controlOne(context: context, operation: operation, action: .cancel)
    }

    func kill(
        context: AOSOrdinaryControlContext,
        operation: AOSOperationIdentity
    ) throws -> AOSOperationControlReceipt {
        try controlOne(context: context, operation: operation, action: .kill)
    }

    func killOwner(
        context: AOSOrdinaryControlContext,
        filter: AOSOperationFilter = .init()
    ) throws -> AOSOperationControlReceipt {
        try validateOrdinaryCaller(context)
        let state = registry.snapshot()
        guard state.daemonGeneration == context.expectedDaemonGeneration else {
            throw AOSOperationCoreError.generationConflict
        }
        let selected = state.operations.filter {
                $0.ownerRoot == context.authenticatedOwnerRoot
                    && $0.state != .terminal
                    && filter.matches($0)
            }.sorted { $0.identity < $1.identity }
        for operation in selected {
            let admission = makeStopAdmission(
                operation: operation.identity,
                expectedDaemonGeneration: context.expectedDaemonGeneration,
                expectedOwnerRoot: context.authenticatedOwnerRoot,
                stopIntent: .ownerKill,
                terminalOutcome: .killed
            )
            try applyAdapterStop(
                operation: operation,
                admission: admission,
                stopIntent: .ownerKill,
                terminalOutcome: .killed
            )
        }
        return try makeOrdinaryReceipt(
            action: .killOwner,
            ownerRootID: context.authenticatedOwnerRoot.ownerID,
            selected: selected,
            stopIntent: .ownerKill,
            terminalOutcome: .killed
        )
    }

    func stopAll(
        context: AOSHostControlContext,
        request: AOSHostControlRequest
    ) throws -> AOSStopAllReceipt {
        guard request.action == .stopAll,
              !request.requestID.isEmpty,
              !request.canonicalParameterDigest.isEmpty,
              let expectedBarrierGeneration = request.expectedBarrierGeneration else {
            throw AOSOperationCoreError.invalidRecord("stop_all_request")
        }
        try validateHostAuthentication(context, action: .stopAll)

        let result = try registry.mutateDurably {
            state -> (receipt: AOSStopAllReceipt, signal: [AOSOperationRecord]) in
            pruneReceipts(in: &state)
            if let retained = try retainedReceipt(in: state, request: request) {
                guard case let .stopAll(receipt) = retained else {
                    throw AOSOperationCoreError.idempotencyConflict
                }
                return (receipt, [])
            }
            guard state.daemonGeneration == context.expectedDaemonGeneration else {
                throw AOSOperationCoreError.generationConflict
            }
            guard state.barrier.generation == expectedBarrierGeneration else {
                throw AOSOperationCoreError.barrierGenerationConflict
            }

            let priorState = state.barrier.state
            let priorGeneration = state.barrier.generation
            var signal: [AOSOperationRecord] = []
            let snapshot: AOSHostBarrierSnapshot
            let outcome: AOSStopAllOutcome

            switch priorState {
            case .bootReconciling:
                if let durable = state.barrier.stopSnapshot {
                    snapshot = durable
                    outcome = .reconciliationInProgress
                } else {
                    let selected = registry.registeredNonterminalOperations(in: state)
                    let stopOperation = AOSOperationIdentity(
                        id: registry.makeID(),
                        generation: state.allocateGeneration()
                    )
                    snapshot = try AOSHostBarrierSnapshot.make(
                        barrierGeneration: state.barrier.generation,
                        stopOperation: stopOperation,
                        registry: state.adapterRegistry,
                        selectedOperationRecords: selected
                    )
                    state.barrier.stopSnapshot = snapshot
                    outcome = .recorded
                }
                state.barrier.reconciliationState = "stop_recorded_during_boot_reconciliation"
            case .open:
                let selected = registry.registeredNonterminalOperations(in: state)
                let stopOperation = AOSOperationIdentity(
                    id: registry.makeID(),
                    generation: state.allocateGeneration()
                )
                let closingGeneration = state.allocateGeneration()
                snapshot = try AOSHostBarrierSnapshot.make(
                    barrierGeneration: closingGeneration,
                    stopOperation: stopOperation,
                    registry: state.adapterRegistry,
                    selectedOperationRecords: selected
                )
                state.barrier.state = .closing
                state.barrier.generation = closingGeneration
                state.barrier.openSnapshot = nil
                state.barrier.stopSnapshot = snapshot
                state.barrier.cleanupResult = .pending
                state.barrier.reconciliationState = "closing"
                // Prepared records may already own committed resource claims even
                // though adapter authority has not started. Route every selected
                // record through its adapter so claims close before terminal
                // publication and barrier reconciliation.
                signal = selected
                outcome = .closingStarted
            case .closing:
                guard let durable = state.barrier.stopSnapshot else {
                    throw AOSOperationCoreError.storeCorrupt
                }
                snapshot = durable
                outcome = .alreadyClosing
            case .closed:
                guard let durable = state.barrier.stopSnapshot else {
                    throw AOSOperationCoreError.storeCorrupt
                }
                snapshot = durable
                outcome = .alreadyClosed
            case .cleanupRequired:
                guard let durable = state.barrier.stopSnapshot else {
                    throw AOSOperationCoreError.storeCorrupt
                }
                snapshot = durable
                outcome = .cleanupRequired
            case .recovering:
                guard let durable = state.barrier.stopSnapshot else {
                    throw AOSOperationCoreError.storeCorrupt
                }
                snapshot = durable
                outcome = .recoveryInProgress
            }

            let receipt = AOSStopAllReceipt(
                requestID: request.requestID,
                canonicalParameterDigest: request.canonicalParameterDigest,
                expectedBarrierGeneration: expectedBarrierGeneration,
                daemonGeneration: state.daemonGeneration,
                callerOrigin: context.caller.origin,
                callerOriginEvidence: context.caller,
                scope: "registered_operation_plane_at_adapter_registry_revision",
                priorBarrierState: priorState,
                priorBarrierGeneration: priorGeneration,
                resultingBarrierState: state.barrier.state,
                resultingBarrierGeneration: state.barrier.generation,
                snapshot: snapshot,
                outcome: outcome,
                residualCount: state.barrier.residualCount,
                residualDigest: state.barrier.residualDigest,
                cleanupResult: state.barrier.cleanupResult
            )
            retain(
                receipt: .stopAll(receipt),
                request: request,
                nowSeconds: registry.now() / 1_000_000_000,
                in: &state
            )
            return (receipt, signal)
        }

        if result.receipt.resultingBarrierState == .closing, result.signal.isEmpty {
            _ = reconcileHostBarrierWithBoundedRetry()
        } else if !result.signal.isEmpty {
            dispatchHostStop(result.signal)
        }
        return result.receipt
    }

    func barrierStatus(
        context: AOSHostControlContext,
        request: AOSHostControlRequest
    ) throws -> AOSBarrierStatusReceipt {
        guard request.action == .barrierStatus,
              !request.requestID.isEmpty,
              !request.canonicalParameterDigest.isEmpty,
              request.expectedBarrierGeneration == nil else {
            throw AOSOperationCoreError.invalidRecord("barrier_status_request")
        }
        try validateHostAuthentication(context, action: .barrierStatus)
        let state = registry.snapshot()
        guard state.daemonGeneration == context.expectedDaemonGeneration else {
            throw AOSOperationCoreError.generationConflict
        }
        return AOSBarrierStatusReceipt(
            requestID: request.requestID,
            canonicalParameterDigest: request.canonicalParameterDigest,
            daemonGeneration: state.daemonGeneration,
            callerOrigin: context.caller.origin,
            callerOriginEvidence: context.caller,
            barrierState: state.barrier.state,
            barrierGeneration: state.barrier.generation,
            admissionOpen: state.barrier.state == .open,
            stopSnapshot: state.barrier.stopSnapshot,
            openSnapshot: state.barrier.openSnapshot,
            residualCount: state.barrier.residualCount,
            residualDigest: state.barrier.residualDigest,
            reconciliationState: state.barrier.reconciliationState
        )
    }

    func reopen(
        context: AOSHostControlContext,
        request: AOSHostControlRequest
    ) throws -> AOSReopenReceipt {
        guard request.action == .reopen,
              !request.requestID.isEmpty,
              !request.canonicalParameterDigest.isEmpty,
              let expectedBarrierGeneration = request.expectedBarrierGeneration else {
            throw AOSOperationCoreError.invalidRecord("reopen_request")
        }
        try validateHostAuthentication(context, action: .reopen)
        return try registry.mutateDurably { state in
            pruneReceipts(in: &state)
            if let retained = try retainedReceipt(in: state, request: request) {
                guard case let .reopen(receipt) = retained else {
                    throw AOSOperationCoreError.idempotencyConflict
                }
                return receipt
            }
            guard state.daemonGeneration == context.expectedDaemonGeneration else {
                throw AOSOperationCoreError.generationConflict
            }
            guard state.barrier.generation == expectedBarrierGeneration else {
                throw AOSOperationCoreError.barrierGenerationConflict
            }
            guard state.barrier.state == .closed, let prior = state.barrier.stopSnapshot else {
                throw AOSOperationCoreError.barrierNotClosed
            }
            guard state.barrier.residualCount == 0,
                  state.barrier.residualDigest == AOSOperationDigest.empty(.residualSet),
                  state.barrier.cleanupResult == .zeroResiduals else {
                throw AOSOperationCoreError.residualsPresent
            }
            guard state.barrier.reconciliationState == "complete" else {
                throw AOSOperationCoreError.reconciliationIncomplete
            }
            guard candidateResidualIdentities(state).isEmpty else {
                throw AOSOperationCoreError.residualsPresent
            }

            let resultingGeneration = state.allocateGeneration()
            let openSnapshot = try AOSOpenBarrierSnapshot.make(
                barrierGeneration: resultingGeneration,
                registry: state.adapterRegistry
            )
            let receipt = AOSReopenReceipt(
                requestID: request.requestID,
                canonicalParameterDigest: request.canonicalParameterDigest,
                expectedBarrierGeneration: expectedBarrierGeneration,
                callerOrigin: context.caller.origin,
                callerOriginEvidence: context.caller,
                priorBarrierState: state.barrier.state,
                priorSnapshot: prior,
                priorResidualCount: state.barrier.residualCount,
                priorResidualDigest: state.barrier.residualDigest,
                resultingBarrierState: .open,
                resultingBarrierGeneration: resultingGeneration,
                daemonGeneration: state.daemonGeneration,
                resultingOpenSnapshot: openSnapshot,
                outcome: .reopened,
                cleanupResult: .zeroResiduals,
                reconciliationState: "complete"
            )
            state.barrier.state = .open
            state.barrier.generation = resultingGeneration
            state.barrier.openSnapshot = openSnapshot
            state.barrier.residualCount = 0
            state.barrier.residualDigest = AOSOperationDigest.empty(.residualSet)
            state.barrier.cleanupResult = .zeroResiduals
            state.barrier.reconciliationState = "complete"
            retain(
                receipt: .reopen(receipt),
                request: request,
                nowSeconds: registry.now() / 1_000_000_000,
                in: &state
            )
            return receipt
        }
    }

    func completeBootReconciliation(
        _ result: AOSBootBarrierReconciliationResult
    ) throws -> AOSHostBarrierRecord {
        try registry.mutateDurably { state in
            guard state.barrier.state == .bootReconciling else {
                throw AOSOperationCoreError.invalidTransition
            }
            guard candidateResidualIdentities(state).isEmpty,
                  state.recovery.residualCount == 0 else {
                throw AOSOperationCoreError.residualsPresent
            }
            state.barrier.residualCount = 0
            state.barrier.residualDigest = AOSOperationDigest.empty(.residualSet)
            state.barrier.cleanupResult = .zeroResiduals
            state.barrier.reconciliationState = "complete"
            switch result {
            case .open:
                let generation = state.allocateGeneration()
                state.barrier.generation = generation
                state.barrier.state = .open
                state.barrier.openSnapshot = try AOSOpenBarrierSnapshot.make(
                    barrierGeneration: generation,
                    registry: state.adapterRegistry
                )
            case .closed:
                guard let snapshot = state.barrier.stopSnapshot else {
                    throw AOSOperationCoreError.storeCorrupt
                }
                state.barrier.state = .closed
                state.barrier.generation = snapshot.barrierGeneration
                state.barrier.openSnapshot = nil
            }
            return state.barrier
        }
    }

    @discardableResult
    func reconcileHostBarrier(markIncompleteAsCleanupRequired: Bool = false) throws -> AOSHostBarrierRecord {
        try registry.mutateDurably { state in
            guard [.closing, .cleanupRequired, .recovering].contains(state.barrier.state),
                  let snapshot = state.barrier.stopSnapshot else {
                throw AOSOperationCoreError.invalidTransition
            }
            let residuals = residualIdentities(for: snapshot, in: state)
            state.barrier.residualCount = UInt64(residuals.count)
            state.barrier.residualDigest = try AOSOperationDigest.sha256(domain: .residualSet, residuals)
            if residuals.isEmpty {
                state.barrier.state = .closed
                state.barrier.cleanupResult = .zeroResiduals
                state.barrier.reconciliationState = "complete"
            } else if markIncompleteAsCleanupRequired {
                state.barrier.state = .cleanupRequired
                state.barrier.cleanupResult = .residualsPresent
                state.barrier.reconciliationState = "residuals_present"
            } else {
                state.barrier.cleanupResult = .pending
                state.barrier.reconciliationState = "draining"
            }
            return state.barrier
        }
    }

    /// A stop receipt may already have durably closed admission when a
    /// transient store save rejects reconciliation. Retry a small bounded
    /// number of times so empty and asynchronously drained planes do not rely
    /// on a later caller to settle the barrier.
    @discardableResult
    func reconcileHostBarrierWithBoundedRetry(
        markIncompleteAsCleanupRequired: Bool = false,
        maximumAttempts: Int = 3
    ) -> AOSHostBarrierRecord? {
        guard maximumAttempts > 0 else { return nil }
        for _ in 0..<maximumAttempts {
            do {
                return try reconcileHostBarrier(
                    markIncompleteAsCleanupRequired: markIncompleteAsCleanupRequired
                )
            } catch let error as AOSOperationCoreError where error == .storeUnavailable {
                continue
            } catch {
                return nil
            }
        }
        return nil
    }

    @discardableResult
    func externalSpawnRetirementDidSettle(
        operation: AOSOperationIdentity
    ) throws -> AOSHostBarrierRecord? {
        let state = registry.snapshot()
        guard !state.finalizedExternalSpawnRecords.contains(where: {
            $0.skipRecord.operationID == operation.id
                && $0.skipRecord.operationGeneration == operation.generation
        }) else {
            throw AOSOperationCoreError.residualsPresent
        }
        let record = try registry.inspect(operation)
        guard let outcome = record.outcome else {
            throw AOSOperationCoreError.storeCorrupt
        }
        switch record.state {
        case .cleanupRequired:
            _ = try registry.transitionOperation(operation, to: .recovering)
            _ = try registry.terminalizeOperationAfterVerifiedCleanup(
                operation,
                stopIntent: record.stopIntent,
                outcome: outcome
            )
        case .recovering:
            _ = try registry.terminalizeOperationAfterVerifiedCleanup(
                operation,
                stopIntent: record.stopIntent,
                outcome: outcome
            )
        case .terminal:
            break
        case .prepared, .starting, .active, .stopping:
            throw AOSOperationCoreError.invalidTransition
        }
        guard [.closing, .cleanupRequired, .recovering].contains(
            registry.snapshot().barrier.state
        ) else {
            return nil
        }
        return try reconcileHostBarrier()
    }

    private func controlOne(
        context: AOSOrdinaryControlContext,
        operation: AOSOperationIdentity,
        action: AOSOrdinaryControlAction
    ) throws -> AOSOperationControlReceipt {
        try validateOrdinaryCaller(context)
        let force = action == .kill
        let stopIntent: AOSStopIntent = force ? .kill : .cancel
        let outcome: AOSOperationOutcome = force ? .killed : .cancelled
        let selected = try selectOrdinaryOperation(
            context: context,
            operation: operation,
            stopIntent: stopIntent,
            terminalOutcome: outcome
        )
        let admission = makeStopAdmission(
            operation: operation,
            expectedDaemonGeneration: context.expectedDaemonGeneration,
            expectedOwnerRoot: context.authenticatedOwnerRoot,
            stopIntent: stopIntent,
            terminalOutcome: outcome
        )
        try applyAdapterStop(
            operation: selected,
            admission: admission,
            stopIntent: stopIntent,
            terminalOutcome: outcome
        )
        return try makeOrdinaryReceipt(
            action: action,
            ownerRootID: context.authenticatedOwnerRoot.ownerID,
            selected: [selected],
            stopIntent: stopIntent,
            terminalOutcome: outcome
        )
    }

    private func selectOrdinaryOperation(
        context: AOSOrdinaryControlContext,
        operation: AOSOperationIdentity,
        stopIntent: AOSStopIntent,
        terminalOutcome: AOSOperationOutcome
    ) throws -> AOSOperationRecord {
        let state = registry.snapshot()
        guard state.daemonGeneration == context.expectedDaemonGeneration else {
            throw AOSOperationCoreError.generationConflict
        }
        guard let selected = state.operations.first(where: { $0.identity == operation }) else {
            throw AOSOperationCoreError.operationNotFound
        }
        guard selected.ownerRoot == context.authenticatedOwnerRoot else {
            throw AOSOperationCoreError.ownerMismatch
        }
        if let existing = selected.stopIntent {
            guard existing == stopIntent,
                  selected.outcome == nil || selected.outcome == terminalOutcome else {
                throw AOSOperationCoreError.invalidTransition
            }
        } else if selected.outcome != nil {
            throw AOSOperationCoreError.invalidTransition
        }
        return selected
    }

    private func makeStopAdmission(
        operation: AOSOperationIdentity,
        expectedDaemonGeneration: UInt64,
        expectedOwnerRoot: AOSMechanicalOwnerRoot?,
        stopIntent: AOSStopIntent,
        terminalOutcome: AOSOperationOutcome
    ) -> AOSOperationStopAdmissionTransaction {
        AOSOperationStopAdmissionTransaction { [registry] in
            try registry.mutateDurably { state in
                guard state.daemonGeneration == expectedDaemonGeneration else {
                    throw AOSOperationCoreError.generationConflict
                }
                guard let index = state.operations.firstIndex(where: {
                    $0.identity == operation
                }) else {
                    throw AOSOperationCoreError.operationNotFound
                }
                if let expectedOwnerRoot,
                   state.operations[index].ownerRoot != expectedOwnerRoot {
                    throw AOSOperationCoreError.ownerMismatch
                }
                var wroteAdmission = false
                let alreadyAdmitted: Bool
                if let existing = state.operations[index].stopIntent {
                    guard existing == stopIntent,
                          state.operations[index].outcome == nil
                            || state.operations[index].outcome == terminalOutcome else {
                        throw AOSOperationCoreError.invalidTransition
                    }
                    alreadyAdmitted = state.operations[index].outcome == terminalOutcome
                } else {
                    guard state.operations[index].outcome == nil else {
                        throw AOSOperationCoreError.invalidTransition
                    }
                    state.operations[index].stopIntent = stopIntent
                    wroteAdmission = true
                    alreadyAdmitted = false
                }
                if state.operations[index].outcome == nil {
                    state.operations[index].outcome = terminalOutcome
                    wroteAdmission = true
                }
                if wroteAdmission {
                    if [.starting, .active].contains(state.operations[index].state) {
                        state.operations[index].state = .stopping
                    }
                    state.operations[index].updatedAtNanoseconds = registry.now()
                }
                return AOSOperationStopAdmissionResult(
                    operation: state.operations[index],
                    wasAlreadyAdmitted: alreadyAdmitted
                )
            }
        }
    }

    private func applyAdapterStop(
        operation: AOSOperationRecord,
        admission: AOSOperationStopAdmissionTransaction,
        stopIntent: AOSStopIntent,
        terminalOutcome: AOSOperationOutcome
    ) throws {
        guard let adapter = registry.runtimeAdapter(
            id: operation.adapterRegistrationID,
            revision: operation.adapterRegistrationRevision
        ) else {
            _ = try admission.commit()
            try updateAdapterResult(
                operation.identity,
                result: AOSAdapterStopResult(
                    disposition: .residual,
                    residualDigest: AOSOperationDigest.empty(.residualSet)
                ),
                stopIntent: stopIntent,
                terminalOutcome: terminalOutcome
            )
            return
        }
        let result = try adapter.admitStop(
            operation: operation.identity,
            admission: admission
        )
        try updateAdapterResult(
            operation.identity,
            result: result,
            stopIntent: stopIntent,
            terminalOutcome: terminalOutcome
        )
    }

    private func updateAdapterResult(
        _ operation: AOSOperationIdentity,
        result: AOSAdapterStopResult,
        stopIntent: AOSStopIntent,
        terminalOutcome: AOSOperationOutcome
    ) throws {
        try registry.mutateDurably { state in
            guard let index = state.operations.firstIndex(where: { $0.identity == operation }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            guard state.operations[index].stopIntent == stopIntent,
                  state.operations[index].outcome == terminalOutcome else {
                throw AOSOperationCoreError.invalidTransition
            }
            guard state.operations[index].state != .terminal else { return }
            switch result.disposition {
            case .absent:
                if AOSOperationRegistry.hasNonterminalChildren(
                    in: state,
                    operation: operation
                ) {
                    state.operations[index].state = .cleanupRequired
                    state.operations[index].residualDigest = result.residualDigest
                        ?? AOSOperationDigest.empty(.residualSet)
                } else {
                    state.operations[index].state = .terminal
                    state.operations[index].residualDigest = nil
                }
            case .residual:
                state.operations[index].state = .cleanupRequired
                state.operations[index].residualDigest = result.residualDigest
                    ?? AOSOperationDigest.empty(.residualSet)
            case .accepted, .alreadyStopping:
                if [.starting, .active].contains(state.operations[index].state) {
                    state.operations[index].state = .stopping
                }
            }
            state.operations[index].updatedAtNanoseconds = registry.now()
        }
    }

    private func dispatchHostStop(_ selected: [AOSOperationRecord]) {
        var hasPending = false
        var hasResidual = false
        for operation in selected {
            let admission = makeStopAdmission(
                operation: operation.identity,
                expectedDaemonGeneration: operation.daemonGeneration,
                expectedOwnerRoot: nil,
                stopIntent: .hostStop,
                terminalOutcome: .killed
            )
            guard let adapter = registry.runtimeAdapter(
                id: operation.adapterRegistrationID,
                revision: operation.adapterRegistrationRevision
            ) else {
                hasResidual = true
                guard (try? admission.commit()) != nil else { continue }
                try? updateAdapterResult(
                    operation.identity,
                    result: AOSAdapterStopResult(
                        disposition: .residual,
                        residualDigest: AOSOperationDigest.empty(.residualSet)
                    ),
                    stopIntent: .hostStop,
                    terminalOutcome: .killed
                )
                continue
            }
            let result: AOSAdapterStopResult
            do {
                result = try adapter.admitStop(
                    operation: operation.identity,
                    admission: admission
                )
            } catch {
                hasResidual = true
                continue
            }
            if [.accepted, .alreadyStopping].contains(result.disposition) { hasPending = true }
            if result.disposition == .residual { hasResidual = true }
            try? updateAdapterResult(
                operation.identity,
                result: result,
                stopIntent: .hostStop,
                terminalOutcome: .killed
            )
        }
        if hasResidual {
            _ = reconcileHostBarrierWithBoundedRetry(markIncompleteAsCleanupRequired: true)
        } else if !hasPending {
            _ = reconcileHostBarrierWithBoundedRetry()
        } else {
            _ = reconcileHostBarrierWithBoundedRetry(markIncompleteAsCleanupRequired: false)
        }
    }

    private func validateOrdinaryCaller(_ context: AOSOrdinaryControlContext) throws {
        guard context.connectionEpoch > 0,
              context.authenticatedOwnerRoot.effectiveUID == context.caller.effectiveUID else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        switch context.caller {
        case let .liveTransportPeer(value):
            guard !value.auditTokenDigest.isEmpty, value.pid > 0, value.pidGeneration > 0 else {
                throw AOSOperationCoreError.callerNotAuthenticated
            }
        case let .ordinaryCanvasCapturedPeer(value):
            guard value.captureIsLive,
                  !value.captureID.isEmpty,
                  !value.auditTokenDigest.isEmpty,
                  value.capturedConnectionEpoch == context.connectionEpoch,
                  value.pid > 0,
                  value.pidGeneration > 0 else {
                throw AOSOperationCoreError.callerNotAuthenticated
            }
        case .statusItemHost, .statusOpenedCanvasHost:
            throw AOSOperationCoreError.unsupportedControlOrigin
        }
    }

    private func validateHostAuthentication(
        _ context: AOSHostControlContext,
        action: AOSHostControlAction
    ) throws {
        guard context.connectionEpoch > 0,
              context.caller.effectiveUID == daemonEffectiveUID,
              context.caller.permitsHostAction(action) else {
            if !context.caller.permitsHostAction(action) {
                throw AOSOperationCoreError.unsupportedControlOrigin
            }
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        switch context.caller {
        case let .liveTransportPeer(value):
            guard !value.auditTokenDigest.isEmpty, value.pid > 0, value.pidGeneration > 0 else {
                throw AOSOperationCoreError.callerNotAuthenticated
            }
        case .ordinaryCanvasCapturedPeer:
            throw AOSOperationCoreError.unsupportedControlOrigin
        case let .statusItemHost(value):
            guard !value.statusHostID.isEmpty,
                  value.statusHostGeneration > 0,
                  value.daemonGeneration == context.expectedDaemonGeneration else {
                throw AOSOperationCoreError.callerNotAuthenticated
            }
        case let .statusOpenedCanvasHost(value):
            guard !value.canvasInstanceID.isEmpty,
                  value.canvasGeneration > 0,
                  !value.parentStatusHostID.isEmpty,
                  value.parentStatusHostGeneration > 0,
                  value.daemonGeneration == context.expectedDaemonGeneration else {
                throw AOSOperationCoreError.callerNotAuthenticated
            }
        }
    }

    private func makeOrdinaryReceipt(
        action: AOSOrdinaryControlAction,
        ownerRootID: String,
        selected: [AOSOperationRecord],
        stopIntent: AOSStopIntent,
        terminalOutcome: AOSOperationOutcome
    ) throws -> AOSOperationControlReceipt {
        let ordered = selected.sorted { $0.identity < $1.identity }
        struct Member: Codable {
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
        let members = ordered.map {
            Member(
                operationID: $0.identity.id,
                operationGeneration: $0.identity.generation,
                adapterRegistrationID: $0.adapterRegistrationID,
                adapterRegistrationRevision: $0.adapterRegistrationRevision,
                capabilityID: $0.capabilityID
            )
        }
        return AOSOperationControlReceipt(
            action: action,
            ownerRootID: ownerRootID,
            selectedOperations: ordered.map(\.identity),
            selectedOperationCount: UInt64(ordered.count),
            selectedOperationDigest: try AOSOperationDigest.sha256(
                domain: .selectedOperationSet,
                members
            ),
            stopIntent: stopIntent,
            terminalOutcome: terminalOutcome
        )
    }

    private func retainedReceipt(
        in state: AOSOperationDurableState,
        request: AOSHostControlRequest
    ) throws -> AOSHostReceipt? {
        guard let retained = state.retainedHostReceipts.first(where: { $0.requestID == request.requestID }) else {
            return nil
        }
        guard retained.action == request.action,
              retained.canonicalParameterDigest == request.canonicalParameterDigest else {
            throw AOSOperationCoreError.idempotencyConflict
        }
        return retained.receipt
    }

    private func retain(
        receipt: AOSHostReceipt,
        request: AOSHostControlRequest,
        nowSeconds: UInt64,
        in state: inout AOSOperationDurableState
    ) {
        state.retainedHostReceipts.append(AOSRetainedHostReceipt(
            requestID: request.requestID,
            canonicalParameterDigest: request.canonicalParameterDigest,
            action: request.action,
            retainedAtSeconds: nowSeconds,
            receipt: receipt
        ))
        if state.retainedHostReceipts.count > Self.retainedReceiptLimit {
            state.retainedHostReceipts.sort {
                if $0.retainedAtSeconds == $1.retainedAtSeconds { return $0.requestID < $1.requestID }
                return $0.retainedAtSeconds < $1.retainedAtSeconds
            }
            state.retainedHostReceipts.removeFirst(
                state.retainedHostReceipts.count - Self.retainedReceiptLimit
            )
        }
    }

    private func pruneReceipts(in state: inout AOSOperationDurableState) {
        let nowSeconds = registry.now() / 1_000_000_000
        let cutoff = nowSeconds > Self.retainedReceiptMaximumAgeSeconds
            ? nowSeconds - Self.retainedReceiptMaximumAgeSeconds
            : 0
        state.retainedHostReceipts.removeAll { $0.retainedAtSeconds < cutoff }
        if state.retainedHostReceipts.count > Self.retainedReceiptLimit {
            state.retainedHostReceipts.sort {
                if $0.retainedAtSeconds == $1.retainedAtSeconds { return $0.requestID < $1.requestID }
                return $0.retainedAtSeconds < $1.retainedAtSeconds
            }
            state.retainedHostReceipts.removeFirst(
                state.retainedHostReceipts.count - Self.retainedReceiptLimit
            )
        }
    }

    private func candidateResidualIdentities(_ state: AOSOperationDurableState) -> [String] {
        let registered = Set(state.adapterRegistry.registrations.map { "\($0.id):\($0.revision)" })
        let selected = state.operations.filter {
            registered.contains("\($0.adapterRegistrationID):\($0.adapterRegistrationRevision)")
                && $0.state != .terminal
        }
        guard !selected.isEmpty else {
            let selectedIDs = Set(state.operations.filter {
                registered.contains("\($0.adapterRegistrationID):\($0.adapterRegistrationRevision)")
            }.map(\.identity))
            return childResidualIdentities(selectedIDs: selectedIDs, state: state)
        }
        let selectedIDs = Set(selected.map(\.identity))
        return selected.map { "operation:\($0.identity.id):\($0.identity.generation)" }
            + childResidualIdentities(selectedIDs: selectedIDs, state: state)
    }

    private func residualIdentities(
        for snapshot: AOSHostBarrierSnapshot,
        in state: AOSOperationDurableState
    ) -> [String] {
        let selectedIDs = Set(snapshot.selectedOperations)
        var values = state.operations.filter {
            selectedIDs.contains($0.identity) && $0.state != .terminal
        }.map { "operation:\($0.identity.id):\($0.identity.generation)" }
        values += childResidualIdentities(selectedIDs: selectedIDs, state: state)
        return values.sorted()
    }

    private func childResidualIdentities(
        selectedIDs: Set<AOSOperationIdentity>,
        state: AOSOperationDurableState
    ) -> [String] {
        var values: [String] = []
        values += state.streams.filter {
            selectedIDs.contains($0.parentOperation) && $0.state != .terminal
        }.map { "stream:\($0.identity.id):\($0.identity.generation)" }
        values += state.taps.filter {
            selectedIDs.contains($0.parentOperation) && $0.state != .terminal
        }.map { "tap:\($0.identity.id):\($0.identity.generation)" }
        values += state.artifacts.filter {
            selectedIDs.contains($0.parentOperation)
                && ![AOSArtifactLifecycleState.released, .retained, .removed].contains($0.state)
        }.map { "artifact:\($0.identity.id):\($0.identity.generation)" }
        values += state.resourceTransactions.filter {
            selectedIDs.contains($0.operation) && $0.state != .terminal
        }.map { "claim-set:\($0.transactionID)" }
        values += state.resourceClaims.filter {
            selectedIDs.contains($0.operation) && $0.state != .terminal
        }.map { "claim:\($0.claimID):\($0.resourceGeneration)" }
        let brokerIDs = Set(state.resourceClaims.filter {
            selectedIDs.contains($0.operation)
        }.compactMap(\.brokerID))
        values += state.resourceBrokers.filter {
            brokerIDs.contains($0.brokerID) && $0.state != .terminal
        }.map { "broker:\($0.brokerID):\($0.brokerGeneration)" }
        values += state.finalizedExternalSpawnRecords.filter {
            selectedIDs.contains(AOSOperationIdentity(
                id: $0.skipRecord.operationID,
                generation: $0.skipRecord.operationGeneration
            ))
        }.map {
            "external-spawn:\($0.skipRecord.spawnRecordID):\($0.skipRecord.child.pid):\($0.skipRecord.child.startTimeSeconds):\($0.skipRecord.child.startTimeMicroseconds)"
        }
        return values.sorted()
    }
}
