import Foundation

struct AOSResourceClaimBinding: Equatable {
    let claimID: String
    let operation: AOSOperationIdentity
    let resourceKey: String
    let resourceGeneration: UInt64
}

struct AOSResourceClaimReleaseReceipt: Codable, Equatable {
    let claimID: String
    let operation: AOSOperationIdentity
    let resourceKey: String
    let resourceGeneration: UInt64
    let state: AOSResourceClaimLifecycleState
    let absenceVerified: Bool
}

enum AOSOperationResourceClaim {
    static func reattach(
        registry: AOSOperationRegistry,
        binding: AOSResourceClaimBinding,
        tokenDigest: String
    ) throws -> AOSResourceClaimRecord {
        let state = registry.snapshot()
        guard let claim = state.resourceClaims.first(where: {
            $0.claimID == binding.claimID
                && $0.operation == binding.operation
                && $0.resourceKey == binding.resourceKey
                && $0.resourceGeneration == binding.resourceGeneration
        }), claim.state == .active,
        claim.reattachTokenDigest == tokenDigest else {
            throw AOSOperationCoreError.resourceCASConflict
        }
        return claim
    }

    static func beginExclusiveRelease(
        registry: AOSOperationRegistry,
        binding: AOSResourceClaimBinding
    ) throws -> AOSResourceClaimRecord {
        try registry.mutateDurably { state in
            guard let index = exactClaimIndex(binding, in: state),
                  state.resourceClaims[index].admissionMode == .exclusive,
                  state.resourceClaims[index].state == .active else {
                throw AOSOperationCoreError.resourceCASConflict
            }
            state.resourceClaims[index].state = .releasing
            return state.resourceClaims[index]
        }
    }

    static func finishExclusiveRelease(
        registry: AOSOperationRegistry,
        binding: AOSResourceClaimBinding,
        absenceVerified: Bool
    ) throws -> AOSResourceClaimReleaseReceipt {
        try registry.mutateDurably { state in
            guard let index = exactClaimIndex(binding, in: state),
                  state.resourceClaims[index].admissionMode == .exclusive,
                  [.releasing, .recovering].contains(state.resourceClaims[index].state) else {
                throw AOSOperationCoreError.resourceCASConflict
            }
            let successorExists = state.resourceClaims.contains {
                $0.claimID != binding.claimID
                    && $0.resourceKey == binding.resourceKey
                    && $0.resourceGeneration > binding.resourceGeneration
            } || state.resourceBrokers.contains {
                $0.resourceKey == binding.resourceKey
                    && $0.resourceGeneration > binding.resourceGeneration
            }
            if successorExists {
                throw AOSOperationCoreError.resourceCASConflict
            }
            state.resourceClaims[index].state = absenceVerified ? .terminal : .cleanupRequired
            return AOSResourceClaimReleaseReceipt(
                claimID: binding.claimID,
                operation: binding.operation,
                resourceKey: binding.resourceKey,
                resourceGeneration: binding.resourceGeneration,
                state: state.resourceClaims[index].state,
                absenceVerified: absenceVerified
            )
        }
    }

    static func detachMultiplexSubscriber(
        registry: AOSOperationRegistry,
        cas: AOSResourceBrokerCAS
    ) throws -> AOSResourceDetachReceipt {
        try AOSOperationResourceBroker.detach(registry: registry, cas: cas)
    }

    static func recover(
        registry: AOSOperationRegistry,
        binding: AOSResourceClaimBinding,
        exactResourceAbsence: Bool,
        survivingBroker: AOSResourceBrokerCAS? = nil
    ) throws -> AOSResourceClaimRecord {
        try registry.mutateDurably { state in
            guard let index = exactClaimIndex(binding, in: state),
                  [.cleanupRequired, .recovering].contains(state.resourceClaims[index].state) else {
                throw AOSOperationCoreError.resourceCASConflict
            }
            state.resourceClaims[index].state = .recovering
            if exactResourceAbsence {
                state.resourceClaims[index].state = .terminal
                return state.resourceClaims[index]
            }
            if let survivingBroker,
               let broker = state.resourceBrokers.first(where: { $0.brokerID == survivingBroker.brokerID }) {
                try AOSOperationResourceBroker.validateCAS(survivingBroker, broker: broker)
                guard broker.subscribers.contains(where: {
                    $0.claimID == binding.claimID && $0.operation == binding.operation
                }) else {
                    state.resourceClaims[index].state = .cleanupRequired
                    throw AOSOperationCoreError.resourceCASConflict
                }
                state.resourceClaims[index].state = .active
                return state.resourceClaims[index]
            }
            state.resourceClaims[index].state = .cleanupRequired
            return state.resourceClaims[index]
        }
    }

    private static func exactClaimIndex(
        _ binding: AOSResourceClaimBinding,
        in state: AOSOperationDurableState
    ) -> Int? {
        state.resourceClaims.firstIndex {
            $0.claimID == binding.claimID
                && $0.operation == binding.operation
                && $0.resourceKey == binding.resourceKey
                && $0.resourceGeneration == binding.resourceGeneration
        }
    }
}
