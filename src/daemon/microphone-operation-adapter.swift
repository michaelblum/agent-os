import Foundation

struct AOSMicrophoneOperationContext {
    let ownerRoot: AOSMechanicalOwnerRoot
    let attribution: AOSOperationAttribution
}

private struct AOSMicrophoneOperationAdmission {
    let operation: AOSOperationIdentity
    let claim: AOSResourceClaimBinding
}

private final class AOSMicrophoneOperationClaimLeaseImpl: AOSMicrophoneOperationClaimLease {
    private let adapter: AOSMicrophoneOperationAdapter
    fileprivate let admission: AOSMicrophoneOperationAdmission

    init(adapter: AOSMicrophoneOperationAdapter, admission: AOSMicrophoneOperationAdmission) {
        self.adapter = adapter
        self.admission = admission
    }

    func bindAuthority(
        stop: @escaping (_ force: Bool) -> Void,
        residualDigest: @escaping () -> String?
    ) throws {
        try adapter.bindAuthority(admission, stop: stop, residualDigest: residualDigest)
    }

    func markAuthorityStarted() throws {
        try adapter.markAuthorityStarted(admission)
    }

    func noteStop(trigger: AOSMicrophoneCaptureTerminalTrigger) throws {
        try adapter.noteStop(admission, trigger: trigger)
    }

    func authorityDidTerminate(_ termination: AOSMicrophoneCaptureTermination) {
        adapter.authorityDidTerminate(admission, termination: termination)
    }
}

final class AOSMicrophoneOperationAdapter: AOSOperationControlAdapter, AOSMicrophoneOperationClaiming {
    typealias ContextResolver = (UUID) throws -> AOSMicrophoneOperationContext

    static let registrationID = "microphone-capture-adapter"
    static let registrationRevision: UInt64 = 1
    static let capabilityID = "microphone-capture-adapter"
    static let operationClass = "audio-capture"
    static let resourceKey = "voice_io_native_session"

    private struct RuntimeBinding {
        let stop: (_ force: Bool) -> Void
        let residualDigest: () -> String?
    }

    let registration: AOSOperationAdapterRegistration

    private let registry: AOSOperationRegistry
    private let contextResolver: ContextResolver
    private let reconcileHostBarrier: () -> Void
    private let lock = NSLock()
    private var runtimeBindings: [AOSOperationIdentity: RuntimeBinding] = [:]
    private var prepreparedCaptures: [UUID: AOSMicrophoneOperationAdmission] = [:]

    static func makeRegistration() throws -> AOSOperationAdapterRegistration {
        let declaration = try AOSResourceDeclaration.make(
            adapterRegistrationID: registrationID,
            adapterRegistrationRevision: registrationRevision,
            resourceKey: resourceKey,
            admissionMode: .exclusive
        )
        return AOSOperationAdapterRegistration(
            id: registrationID,
            revision: registrationRevision,
            operationClass: operationClass,
            capabilityIDs: [capabilityID],
            resourceDeclarations: [declaration]
        )
    }

    init(
        registry: AOSOperationRegistry,
        registration: AOSOperationAdapterRegistration,
        contextResolver: @escaping ContextResolver,
        reconcileHostBarrier: @escaping () -> Void = {}
    ) throws {
        guard registration == (try Self.makeRegistration()) else {
            throw AOSOperationCoreError.adapterRegistryConflict
        }
        self.registry = registry
        self.registration = registration
        self.contextResolver = contextResolver
        self.reconcileHostBarrier = reconcileHostBarrier
    }

    func prepareCapture(owner: UUID) throws -> any AOSMicrophoneOperationClaimLease {
        lock.lock()
        let preprepared = prepreparedCaptures.removeValue(forKey: owner)
        lock.unlock()
        if let preprepared {
            return AOSMicrophoneOperationClaimLeaseImpl(adapter: self, admission: preprepared)
        }
        return try prepareCapture(context: contextResolver(owner))
    }

    func prepareExternalCapture(
        context: AOSMicrophoneOperationContext
    ) throws -> AOSOperationIdentity {
        let lease = try prepareCapture(context: context)
        return lease.admission.operation
    }

    func bindPrepreparedCapture(
        owner: UUID,
        operation: AOSOperationIdentity
    ) throws {
        guard let admission = admissionForOperation(operation),
              (try registry.inspect(operation)).state == .starting else {
            throw AOSOperationCoreError.invalidTransition
        }
        lock.lock()
        defer { lock.unlock() }
        guard prepreparedCaptures[owner] == nil else {
            throw AOSOperationCoreError.resourceBusy
        }
        prepreparedCaptures[owner] = admission
    }

    func abandonPreparedCapture(
        operation: AOSOperationIdentity,
        trigger: AOSMicrophoneCaptureTerminalTrigger = .adapterFailed
    ) {
        guard let admission = admissionForOperation(operation) else {
            closeFailedPreparation(operation: operation)
            return
        }
        finish(admission, trigger: trigger, authorityAbsent: true)
    }

    func connectionClosedBeforeAuthority(owner: UUID) {
        lock.lock()
        let admission = prepreparedCaptures.removeValue(forKey: owner)
        lock.unlock()
        if let admission {
            finish(admission, trigger: .ownerDisconnected, authorityAbsent: true)
        }
    }

    private func prepareCapture(
        context: AOSMicrophoneOperationContext
    ) throws -> AOSMicrophoneOperationClaimLeaseImpl {
        let initial = registry.snapshot()
        guard initial.barrier.state == .open,
              initial.barrier.openSnapshot?.barrierGeneration == initial.barrier.generation else {
            throw AOSOperationCoreError.barrierClosed
        }
        guard initial.adapterRegistry.registration(
                  id: registration.id,
                  revision: registration.revision
              ) == registration,
              let declaration = initial.adapterRegistry.declaration(resourceKey: Self.resourceKey),
              declaration.adapterRegistrationID == registration.id,
              declaration.adapterRegistrationRevision == registration.revision,
              declaration.admissionMode == .exclusive else {
            throw AOSOperationCoreError.adapterRegistryConflict
        }

        let operation = try registry.prepareOperation(
            ownerRoot: context.ownerRoot,
            attribution: context.attribution,
            capabilityID: Self.capabilityID,
            adapterRegistrationID: registration.id,
            adapterRegistrationRevision: registration.revision
        )

        do {
            let expectedResourceGeneration = Self.maximumResourceGeneration(
                resourceKey: Self.resourceKey,
                in: initial
            )
            let transaction = try AOSOperationResourceTransaction.prepare(
                registry: registry,
                operation: operation.identity,
                expectedBarrierGeneration: initial.barrier.generation,
                expectedAdapterRegistry: initial.adapterRegistry,
                requests: [AOSResourceClaimRequest(
                    adapterRegistrationID: registration.id,
                    adapterRegistrationRevision: registration.revision,
                    resourceKey: Self.resourceKey,
                    admissionMode: .exclusive,
                    resourceDeclarationDigest: declaration.declarationDigest,
                    expectedResourceGeneration: expectedResourceGeneration,
                    expectedBrokerGeneration: nil,
                    expectedSubscriberSetRevision: nil,
                    expectedSubscriberSetCount: nil,
                    expectedSubscriberSetDigest: nil
                )]
            )
            _ = try AOSOperationResourceTransaction.beginReservation(
                registry: registry,
                transactionID: transaction.transactionID
            )
            let receipt = try AOSOperationResourceTransaction.commit(
                registry: registry,
                transactionID: transaction.transactionID
            )
            _ = try AOSOperationResourceTransaction.completeHandoff(
                registry: registry,
                transactionID: transaction.transactionID
            )
            guard receipt.claims.count == 1,
                  let claim = registry.snapshot().resourceClaims.first(where: {
                      $0.claimID == receipt.claims[0]
                          && $0.operation == operation.identity
                          && $0.resourceKey == Self.resourceKey
                          && $0.admissionMode == .exclusive
                          && $0.state == .active
                  }) else {
                throw AOSOperationCoreError.resourceDeclarationConflict
            }
            let admission = AOSMicrophoneOperationAdmission(
                operation: operation.identity,
                claim: AOSResourceClaimBinding(
                    claimID: claim.claimID,
                    operation: claim.operation,
                    resourceKey: claim.resourceKey,
                    resourceGeneration: claim.resourceGeneration
                )
            )
            _ = try registry.transitionOperation(operation.identity, to: .starting)
            return AOSMicrophoneOperationClaimLeaseImpl(adapter: self, admission: admission)
        } catch {
            closeFailedPreparation(operation: operation.identity)
            throw error
        }
    }

    func requestStop(operation: AOSOperationIdentity, force: Bool) -> AOSAdapterStopResult {
        let record: AOSOperationRecord
        do {
            record = try registry.inspect(operation)
        } catch {
            return AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
        }
        guard record.adapterRegistrationID == registration.id,
              record.adapterRegistrationRevision == registration.revision else {
            return AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
        }
        switch record.state {
        case .terminal:
            return AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
        case .stopping:
            lock.lock()
            let binding = runtimeBindings[operation]
            lock.unlock()
            if let binding {
                binding.stop(force)
            } else if let admission = admissionForOperation(operation) {
                // Authority cannot start before bindAuthority succeeds. A stopping
                // operation with no binding therefore has an exact absence proof.
                finish(
                    admission,
                    trigger: force ? .killed : .cancelled,
                    authorityAbsent: true
                )
            }
            return AOSAdapterStopResult(
                disposition: .alreadyStopping,
                residualDigest: residualDigest(operation: operation)
            )
        case .cleanupRequired, .recovering:
            return AOSAdapterStopResult(
                disposition: .residual,
                residualDigest: residualDigest(operation: operation)
            )
        case .prepared:
            let admission = admissionForOperation(operation)
            if let admission {
                finish(admission, trigger: force ? .killed : .cancelled, authorityAbsent: true)
                return AOSAdapterStopResult(disposition: .accepted, residualDigest: nil)
            }
            do {
                guard closeTransactionsBeforeAuthority(operation: operation) else {
                    return AOSAdapterStopResult(
                        disposition: .residual,
                        residualDigest: residualDigest(operation: operation)
                    )
                }
                let current = try registry.inspect(operation)
                if current.state == .terminal {
                    return AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
                }
                let intent = current.stopIntent ?? (force ? .kill : .cancel)
                _ = try registry.terminalizeOperationAfterVerifiedCleanup(
                    operation,
                    stopIntent: intent,
                    outcome: Self.outcome(
                        for: intent,
                        fallback: force ? .killed : .cancelled
                    )
                )
                return AOSAdapterStopResult(disposition: .accepted, residualDigest: nil)
            } catch {
                return AOSAdapterStopResult(disposition: .residual, residualDigest: nil)
            }
        case .starting, .active:
            do {
                _ = try registry.transitionOperation(
                    operation,
                    to: .stopping,
                    stopIntent: force ? .kill : .cancel
                )
            } catch {
                return AOSAdapterStopResult(
                    disposition: .residual,
                    residualDigest: residualDigest(operation: operation)
                )
            }
            lock.lock()
            let binding = runtimeBindings[operation]
            lock.unlock()
            binding?.stop(force)
            return AOSAdapterStopResult(
                disposition: .accepted,
                residualDigest: binding == nil ? residualDigest(operation: operation) : nil
            )
        }
    }

    func residualDigest(operation: AOSOperationIdentity) -> String? {
        lock.lock()
        let runtime = runtimeBindings[operation]
        lock.unlock()
        if let value = runtime?.residualDigest() { return value }
        return registry.snapshot().resourceClaims.first(where: {
            $0.operation == operation && $0.resourceKey == Self.resourceKey && $0.state != .terminal
        })?.reattachTokenDigest
    }

    fileprivate func bindAuthority(
        _ admission: AOSMicrophoneOperationAdmission,
        stop: @escaping (_ force: Bool) -> Void,
        residualDigest: @escaping () -> String?
    ) throws {
        lock.lock()
        defer { lock.unlock() }
        let state = registry.snapshot()
        guard state.operations.contains(where: {
            $0.identity == admission.operation && $0.state == .starting
        }), state.resourceClaims.contains(where: {
            Self.matches($0, admission.claim) && $0.state == .active
        }), runtimeBindings[admission.operation] == nil else {
            throw AOSOperationCoreError.invalidTransition
        }
        runtimeBindings[admission.operation] = RuntimeBinding(
            stop: stop,
            residualDigest: residualDigest
        )
    }

    fileprivate func markAuthorityStarted(_ admission: AOSMicrophoneOperationAdmission) throws {
        let state = registry.snapshot()
        guard state.resourceClaims.contains(where: {
            Self.matches($0, admission.claim) && $0.state == .active
        }) else {
            throw AOSOperationCoreError.resourceCASConflict
        }
        _ = try registry.transitionOperation(admission.operation, to: .active)
    }

    fileprivate func noteStop(
        _ admission: AOSMicrophoneOperationAdmission,
        trigger: AOSMicrophoneCaptureTerminalTrigger
    ) throws {
        let record = try registry.inspect(admission.operation)
        switch record.state {
        case .starting, .active:
            _ = try registry.transitionOperation(
                admission.operation,
                to: .stopping,
                stopIntent: Self.stopIntent(for: trigger)
            )
        case .stopping, .cleanupRequired, .recovering, .terminal:
            return
        case .prepared:
            throw AOSOperationCoreError.invalidTransition
        }
    }

    fileprivate func authorityDidTerminate(
        _ admission: AOSMicrophoneOperationAdmission,
        termination: AOSMicrophoneCaptureTermination
    ) {
        finish(
            admission,
            trigger: termination.trigger,
            authorityAbsent: termination.authorityAbsent
        )
    }

    private func finish(
        _ admission: AOSMicrophoneOperationAdmission,
        trigger: AOSMicrophoneCaptureTerminalTrigger,
        authorityAbsent: Bool
    ) {
        defer {
            removeRuntimeBinding(admission.operation)
            reconcileHostBarrier()
        }
        do {
            let initialOperation = try registry.inspect(admission.operation)
            if initialOperation.state != .prepared && initialOperation.state != .terminal {
                try noteStop(admission, trigger: trigger)
            }

            var state = registry.snapshot()
            if state.resourceClaims.contains(where: {
                Self.matches($0, admission.claim) && $0.state == .active
            }) {
                _ = try AOSOperationResourceClaim.beginExclusiveRelease(
                    registry: registry,
                    binding: admission.claim
                )
                state = registry.snapshot()
            }
            let claimState = state.resourceClaims.first(where: {
                Self.matches($0, admission.claim)
            })?.state
            let claimIsTerminal: Bool
            if claimState == .terminal {
                claimIsTerminal = true
            } else if claimState == .releasing || claimState == .recovering {
                let release = try AOSOperationResourceClaim.finishExclusiveRelease(
                    registry: registry,
                    binding: admission.claim,
                    absenceVerified: authorityAbsent
                )
                claimIsTerminal = release.state == .terminal && release.absenceVerified
            } else {
                claimIsTerminal = false
            }
            guard claimIsTerminal else {
                markCleanupRequired(admission)
                return
            }
            guard closeTransactionsBeforeAuthority(operation: admission.operation) else {
                markCleanupRequired(admission)
                return
            }
            try finalizeParentAfterVerifiedCleanup(
                operation: admission.operation,
                fallbackTrigger: trigger,
                outcomeWithoutStopIntent: Self.outcome(for: nil, fallback: trigger)
            )
        } catch {
            markCleanupRequired(admission)
        }
    }

    private func closeFailedPreparation(operation: AOSOperationIdentity) {
        defer { reconcileHostBarrier() }
        var state = registry.snapshot()
        _ = closeTransactionsBeforeAuthority(operation: operation)
        state = registry.snapshot()
        let claims = state.resourceClaims.filter {
            $0.operation == operation && $0.resourceKey == Self.resourceKey && $0.state != .terminal
        }
        if let claim = claims.first {
            let admission = AOSMicrophoneOperationAdmission(
                operation: operation,
                claim: AOSResourceClaimBinding(
                    claimID: claim.claimID,
                    operation: claim.operation,
                    resourceKey: claim.resourceKey,
                    resourceGeneration: claim.resourceGeneration
                )
            )
            finish(admission, trigger: .adapterFailed, authorityAbsent: true)
            return
        }
        guard let record = state.operations.first(where: { $0.identity == operation }),
              record.state != .terminal else { return }
        if state.resourceTransactions.contains(where: {
            $0.operation == operation && $0.state != .terminal
        }) {
            _ = try? registry.transitionOperation(
                operation,
                to: .cleanupRequired,
                residualDigest: state.resourceTransactions.first(where: {
                    $0.operation == operation && $0.state != .terminal
                })?.claimSetDigest
            )
            return
        }
        try? finalizeParentAfterVerifiedCleanup(
            operation: operation,
            fallbackTrigger: .adapterFailed,
            outcomeWithoutStopIntent: .rejected
        )
    }

    private func closeTransactionsBeforeAuthority(operation: AOSOperationIdentity) -> Bool {
        for _ in 0..<8 {
            let transactions = registry.snapshot().resourceTransactions.filter {
                $0.operation == operation && $0.state != .terminal
            }
            if transactions.isEmpty { return true }
            for transaction in transactions {
                do {
                    switch transaction.state {
                    case .prepared, .reserving, .rollingBack:
                        try AOSOperationResourceTransaction.reject(
                            registry: registry,
                            transactionID: transaction.transactionID
                        )
                    case .committed:
                        _ = try AOSOperationResourceTransaction.completeHandoff(
                            registry: registry,
                            transactionID: transaction.transactionID
                        )
                    case .cleanupRequired, .recovering:
                        return false
                    case .terminal:
                        break
                    }
                } catch {
                    // A concurrent reservation/commit/handoff may have won this
                    // observation. Re-read the durable phase before deciding.
                }
            }
        }
        return !registry.snapshot().resourceTransactions.contains {
            $0.operation == operation && $0.state != .terminal
        }
    }

    private func finalizeParentAfterVerifiedCleanup(
        operation: AOSOperationIdentity,
        fallbackTrigger: AOSMicrophoneCaptureTerminalTrigger,
        outcomeWithoutStopIntent: AOSOperationOutcome
    ) throws {
        guard closeTransactionsBeforeAuthority(operation: operation) else {
            throw AOSOperationCoreError.residualsPresent
        }
        var current = try registry.inspect(operation)
        let stopIntent = current.stopIntent
        let outcome = stopIntent.map {
            Self.outcome(for: $0, fallback: fallbackTrigger)
        } ?? outcomeWithoutStopIntent
        let externalSpawnResiduals = registry.snapshot().finalizedExternalSpawnRecords.filter {
            $0.skipRecord.operationID == operation.id
                && $0.skipRecord.operationGeneration == operation.generation
        }.map { "external-spawn:\($0.skipRecord.spawnRecordID)" }.sorted()
        if !externalSpawnResiduals.isEmpty {
            let residualDigest = try AOSOperationDigest.sha256(
                domain: .residualSet,
                externalSpawnResiduals
            )
            guard current.state != .terminal else {
                throw AOSOperationCoreError.residualsPresent
            }
            _ = try registry.transitionOperation(
                operation,
                to: .cleanupRequired,
                stopIntent: stopIntent ?? Self.stopIntent(for: fallbackTrigger),
                outcome: outcome,
                residualDigest: residualDigest
            )
            return
        }
        if current.state == .cleanupRequired {
            _ = try registry.transitionOperation(operation, to: .recovering)
            current = try registry.inspect(operation)
        }
        switch current.state {
        case .prepared, .starting, .stopping, .recovering:
            _ = try registry.terminalizeOperationAfterVerifiedCleanup(
                operation,
                stopIntent: stopIntent,
                outcome: outcome
            )
        case .terminal:
            return
        case .active, .cleanupRequired:
            throw AOSOperationCoreError.invalidTransition
        }
    }

    private func admissionForOperation(_ operation: AOSOperationIdentity) -> AOSMicrophoneOperationAdmission? {
        guard let claim = registry.snapshot().resourceClaims.first(where: {
            $0.operation == operation && $0.resourceKey == Self.resourceKey && $0.state != .terminal
        }) else { return nil }
        return AOSMicrophoneOperationAdmission(
            operation: operation,
            claim: AOSResourceClaimBinding(
                claimID: claim.claimID,
                operation: claim.operation,
                resourceKey: claim.resourceKey,
                resourceGeneration: claim.resourceGeneration
            )
        )
    }

    private func markCleanupRequired(_ admission: AOSMicrophoneOperationAdmission) {
        guard let record = try? registry.inspect(admission.operation) else { return }
        switch record.state {
        case .prepared, .starting, .active, .stopping:
            _ = try? registry.transitionOperation(
                admission.operation,
                to: .cleanupRequired,
                residualDigest: residualDigest(operation: admission.operation)
            )
        case .cleanupRequired, .recovering, .terminal:
            break
        }
    }

    private func removeRuntimeBinding(_ operation: AOSOperationIdentity) {
        lock.lock()
        runtimeBindings.removeValue(forKey: operation)
        lock.unlock()
    }

    private static func maximumResourceGeneration(
        resourceKey: String,
        in state: AOSOperationDurableState
    ) -> UInt64 {
        max(
            state.resourceClaims
                .filter { $0.resourceKey == resourceKey }
                .map(\.resourceGeneration)
                .max() ?? 0,
            state.resourceBrokers
                .filter { $0.resourceKey == resourceKey }
                .map(\.resourceGeneration)
                .max() ?? 0
        )
    }

    private static func matches(
        _ claim: AOSResourceClaimRecord,
        _ binding: AOSResourceClaimBinding
    ) -> Bool {
        claim.claimID == binding.claimID
            && claim.operation == binding.operation
            && claim.resourceKey == binding.resourceKey
            && claim.resourceGeneration == binding.resourceGeneration
    }

    private static func stopIntent(for trigger: AOSMicrophoneCaptureTerminalTrigger) -> AOSStopIntent {
        switch trigger {
        case .completed: return .complete
        case .cancelled: return .cancel
        case .killed: return .kill
        case .ownerDisconnected: return .peerLost
        case .daemonShutdown: return .hostStop
        case .deadline: return .deadline
        case .permissionRevoked: return .permissionRevoked
        case .adapterFailed: return .adapterFailed
        }
    }

    private static func outcome(
        for intent: AOSStopIntent?,
        fallback trigger: AOSMicrophoneCaptureTerminalTrigger
    ) -> AOSOperationOutcome {
        switch intent ?? stopIntent(for: trigger) {
        case .complete: return .succeeded
        case .cancel, .peerLost, .transportLost: return .cancelled
        case .kill, .ownerKill, .hostStop: return .killed
        case .deadline: return .timedOut
        case .permissionRevoked, .adapterFailed: return .failed
        }
    }
}
