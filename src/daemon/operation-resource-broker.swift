import Foundation

struct AOSResourceBrokerCAS: Equatable {
    let brokerID: String
    let expectedBrokerGeneration: UInt64
    let resourceKey: String
    let expectedResourceGeneration: UInt64
    let expectedAdapterRegistrationID: String
    let expectedAdapterRegistrationRevision: UInt64
    let expectedResourceDeclarationDigest: String
    let expectedAdapterRegistryRevision: UInt64
    let expectedResourceDeclarationSetCount: UInt64
    let expectedResourceDeclarationSetDigest: String
    let expectedSubscriberSetRevision: UInt64
    let expectedSubscriberSetCount: UInt64
    let expectedSubscriberSetDigest: String
    let committedClaimSetTransactionID: String
    let committedClaimSetDigest: String
    let claimID: String
    let subscriberID: String
}

enum AOSResourceDetachDisposition: String, Codable {
    case nonlast, last
}

struct AOSResourceDetachReceipt: Codable, Equatable {
    let claimID: String
    let brokerID: String
    let brokerGeneration: UInt64
    let disposition: AOSResourceDetachDisposition
    let resultingSubscriberSetRevision: UInt64
    let resultingSubscriberSetCount: UInt64
    let resultingSubscriberSetDigest: String
    let resultingBrokerState: AOSResourceBrokerLifecycleState
    let resultingClaimState: AOSResourceClaimLifecycleState
}

enum AOSOperationResourceBroker {
    private struct SubscriberDigestMember: Codable {
        let claimID: String
        let subscriberID: String
        let operationID: String
        let operationGeneration: UInt64
        let resourceKey: String
        let resourceGeneration: UInt64

        enum CodingKeys: String, CodingKey {
            case claimID = "claim_id"
            case subscriberID = "subscriber_id"
            case operationID = "operation_id"
            case operationGeneration = "operation_generation"
            case resourceKey = "resource_key"
            case resourceGeneration = "resource_generation"
        }
    }

    static func subscriberSetDigest(_ subscribers: [AOSResourceSubscriber]) throws -> String {
        let members = subscribers.sorted().map {
            SubscriberDigestMember(
                claimID: $0.claimID,
                subscriberID: $0.subscriberID,
                operationID: $0.operation.id,
                operationGeneration: $0.operation.generation,
                resourceKey: $0.resourceKey,
                resourceGeneration: $0.resourceGeneration
            )
        }
        return try AOSOperationDigest.sha256(domain: .subscriberSet, members)
    }

    static func validateCAS(_ cas: AOSResourceBrokerCAS, broker: AOSResourceBrokerRecord) throws {
        guard broker.brokerID == cas.brokerID,
              broker.brokerGeneration == cas.expectedBrokerGeneration,
              broker.resourceKey == cas.resourceKey,
              broker.resourceGeneration == cas.expectedResourceGeneration,
              broker.adapterRegistrationID == cas.expectedAdapterRegistrationID,
              broker.adapterRegistrationRevision == cas.expectedAdapterRegistrationRevision,
              broker.resourceDeclarationDigest == cas.expectedResourceDeclarationDigest,
              broker.adapterRegistryRevision == cas.expectedAdapterRegistryRevision,
              broker.resourceDeclarationSetCount == cas.expectedResourceDeclarationSetCount,
              broker.resourceDeclarationSetDigest == cas.expectedResourceDeclarationSetDigest,
              broker.subscriberSetRevision == cas.expectedSubscriberSetRevision,
              UInt64(broker.subscribers.count) == cas.expectedSubscriberSetCount,
              broker.subscriberSetDigest == cas.expectedSubscriberSetDigest,
              broker.committedClaimSetTransactionID == cas.committedClaimSetTransactionID,
              broker.committedClaimSetDigest == cas.committedClaimSetDigest,
              try subscriberSetDigest(broker.subscribers) == broker.subscriberSetDigest else {
            throw AOSOperationCoreError.resourceCASConflict
        }
    }

    static func detach(
        registry: AOSOperationRegistry,
        cas: AOSResourceBrokerCAS
    ) throws -> AOSResourceDetachReceipt {
        try registry.mutateDurably { state in
            guard let claimIndex = state.resourceClaims.firstIndex(where: {
                $0.claimID == cas.claimID && $0.subscriberID == cas.subscriberID
            }), state.resourceClaims[claimIndex].state == .active,
            let brokerIndex = state.resourceBrokers.firstIndex(where: { $0.brokerID == cas.brokerID }) else {
                throw AOSOperationCoreError.resourceCASConflict
            }
            var broker = state.resourceBrokers[brokerIndex]
            try validateCAS(cas, broker: broker)
            let claim = state.resourceClaims[claimIndex]
            guard claim.brokerID == broker.brokerID,
                  claim.brokerGeneration == broker.brokerGeneration,
                  claim.resourceKey == broker.resourceKey,
                  claim.resourceGeneration == broker.resourceGeneration,
                  claim.adapterRegistrationID == broker.adapterRegistrationID,
                  claim.adapterRegistrationRevision == broker.adapterRegistrationRevision,
                  claim.resourceDeclarationDigest == broker.resourceDeclarationDigest,
                  claim.adapterRegistryRevision == broker.adapterRegistryRevision,
                  claim.resourceDeclarationSetCount == broker.resourceDeclarationSetCount,
                  claim.resourceDeclarationSetDigest == broker.resourceDeclarationSetDigest else {
                throw AOSOperationCoreError.resourceCASConflict
            }
            guard let memberIndex = broker.subscribers.firstIndex(where: {
                $0.claimID == cas.claimID && $0.subscriberID == cas.subscriberID
            }) else {
                throw AOSOperationCoreError.resourceCASConflict
            }

            let disposition: AOSResourceDetachDisposition
            let claimState: AOSResourceClaimLifecycleState
            if broker.subscribers.count == 1 {
                disposition = .last
                claimState = .terminal
                broker.state = .stopping
            } else {
                disposition = .nonlast
                claimState = .terminal
                guard broker.state == .active else { throw AOSOperationCoreError.resourceCASConflict }
            }
            broker.subscribers.remove(at: memberIndex)
            broker.subscriberSetRevision &+= 1
            broker.subscriberSetDigest = try subscriberSetDigest(broker.subscribers)
            state.resourceClaims[claimIndex].state = claimState
            state.resourceBrokers[brokerIndex] = broker
            return AOSResourceDetachReceipt(
                claimID: cas.claimID,
                brokerID: broker.brokerID,
                brokerGeneration: broker.brokerGeneration,
                disposition: disposition,
                resultingSubscriberSetRevision: broker.subscriberSetRevision,
                resultingSubscriberSetCount: UInt64(broker.subscribers.count),
                resultingSubscriberSetDigest: broker.subscriberSetDigest,
                resultingBrokerState: broker.state,
                resultingClaimState: claimState
            )
        }
    }

    static func markStarted(
        registry: AOSOperationRegistry,
        brokerID: String,
        generation: UInt64
    ) throws -> AOSResourceBrokerRecord {
        try registry.mutateDurably { state in
            guard let index = state.resourceBrokers.firstIndex(where: {
                $0.brokerID == brokerID && $0.brokerGeneration == generation
            }), state.resourceBrokers[index].state == .starting else {
                throw AOSOperationCoreError.resourceCASConflict
            }
            state.resourceBrokers[index].state = .active
            return state.resourceBrokers[index]
        }
    }

    static func completeStop(
        registry: AOSOperationRegistry,
        brokerID: String,
        generation: UInt64,
        absenceVerified: Bool
    ) throws -> AOSResourceBrokerRecord {
        try registry.mutateDurably { state in
            guard let index = state.resourceBrokers.firstIndex(where: {
                $0.brokerID == brokerID && $0.brokerGeneration == generation
            }), [.stopping, .recovering].contains(state.resourceBrokers[index].state) else {
                throw AOSOperationCoreError.resourceCASConflict
            }
            guard absenceVerified, state.resourceBrokers[index].subscribers.isEmpty else {
                state.resourceBrokers[index].state = .cleanupRequired
                return state.resourceBrokers[index]
            }
            state.resourceBrokers[index].state = .terminal
            for claimIndex in state.resourceClaims.indices where
                state.resourceClaims[claimIndex].brokerID == brokerID
                    && state.resourceClaims[claimIndex].brokerGeneration == generation
                    && state.resourceClaims[claimIndex].state == .releasing {
                state.resourceClaims[claimIndex].state = .terminal
            }
            return state.resourceBrokers[index]
        }
    }
}
