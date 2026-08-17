import Foundation

struct AOSResourceAdmissionReceipt: Codable, Equatable {
    let transactionID: String
    let claimSetDigest: String
    let operation: AOSOperationIdentity
    let adapterRegistryRevision: UInt64
    let resourceDeclarationSetCount: UInt64
    let resourceDeclarationSetDigest: String
    let claims: [String]
    let brokerPublications: [AOSResourceBrokerPublication]
}

struct AOSResourceBrokerPublication: Codable, Equatable {
    let brokerID: String
    let brokerGeneration: UInt64
    let subscriberSetRevision: UInt64
    let subscriberSetCount: UInt64
    let subscriberSetDigest: String
}

enum AOSOperationResourceTransaction {
    private struct ClaimSetDigestMember: Codable {
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

        enum CodingKeys: String, CodingKey {
            case adapterRegistrationID = "adapter_registration_id"
            case adapterRegistrationRevision = "adapter_registration_revision"
            case resourceKey = "resource_key"
            case admissionMode = "admission_mode"
            case resourceDeclarationDigest = "resource_declaration_digest"
            case expectedResourceGeneration = "expected_resource_generation"
            case expectedBrokerGeneration = "expected_broker_generation"
            case expectedSubscriberSetRevision = "expected_subscriber_set_revision"
            case expectedSubscriberSetCount = "expected_subscriber_set_count"
            case expectedSubscriberSetDigest = "expected_subscriber_set_digest"
        }
    }

    static func prepare(
        registry: AOSOperationRegistry,
        operation: AOSOperationIdentity,
        expectedBarrierGeneration: UInt64,
        expectedAdapterRegistry: AOSAdapterRegistrySnapshot,
        requests: [AOSResourceClaimRequest]
    ) throws -> AOSResourceTransactionRecord {
        guard !requests.isEmpty else { throw AOSOperationCoreError.invalidRecord("empty_claim_set") }
        let canonical = requests.sorted { $0.resourceKey < $1.resourceKey }
        guard Set(canonical.map(\.resourceKey)).count == canonical.count else {
            throw AOSOperationCoreError.invalidRecord("duplicate_claim_resource")
        }
        let digestMembers = canonical.map {
            ClaimSetDigestMember(
                adapterRegistrationID: $0.adapterRegistrationID,
                adapterRegistrationRevision: $0.adapterRegistrationRevision,
                resourceKey: $0.resourceKey,
                admissionMode: $0.admissionMode,
                resourceDeclarationDigest: $0.resourceDeclarationDigest,
                expectedResourceGeneration: $0.expectedResourceGeneration,
                expectedBrokerGeneration: $0.expectedBrokerGeneration,
                expectedSubscriberSetRevision: $0.expectedSubscriberSetRevision,
                expectedSubscriberSetCount: $0.expectedSubscriberSetCount,
                expectedSubscriberSetDigest: $0.expectedSubscriberSetDigest
            )
        }
        let digest = try AOSOperationDigest.sha256(domain: .claimSet, digestMembers)
        return try registry.mutateDurably { state in
            guard state.barrier.state == .open,
                  state.barrier.generation == expectedBarrierGeneration else {
                throw AOSOperationCoreError.barrierGenerationConflict
            }
            guard state.adapterRegistry == expectedAdapterRegistry else {
                throw AOSOperationCoreError.adapterRegistryConflict
            }
            guard state.operations.contains(where: {
                $0.identity == operation && [.prepared, .starting].contains($0.state)
            }) else {
                throw AOSOperationCoreError.operationNotFound
            }
            try validateRequests(canonical, registry: state.adapterRegistry)
            let sequence = state.allocateGeneration()
            let record = AOSResourceTransactionRecord(
                transactionID: registry.makeID(),
                attemptSequence: sequence,
                operation: operation,
                daemonGeneration: state.daemonGeneration,
                expectedBarrierGeneration: expectedBarrierGeneration,
                expectedAdapterRegistryRevision: expectedAdapterRegistry.revision,
                expectedResourceDeclarationSetCount: expectedAdapterRegistry.resourceDeclarationSetCount,
                expectedResourceDeclarationSetDigest: expectedAdapterRegistry.resourceDeclarationSetDigest,
                canonicalRequests: canonical,
                claimSetDigest: digest,
                state: .prepared,
                recoveryOriginState: nil,
                recoveryDisposition: nil,
                outcome: nil
            )
            state.resourceTransactions.append(record)
            return record
        }
    }

    static func beginReservation(
        registry: AOSOperationRegistry,
        transactionID: String
    ) throws -> AOSResourceTransactionRecord {
        try registry.mutateDurably { state in
            guard let index = state.resourceTransactions.firstIndex(where: {
                $0.transactionID == transactionID && $0.state == .prepared
            }) else { throw AOSOperationCoreError.invalidTransition }
            guard state.barrier.state == .open,
                  state.barrier.generation == state.resourceTransactions[index].expectedBarrierGeneration else {
                throw AOSOperationCoreError.barrierClosed
            }
            state.resourceTransactions[index].state = .reserving
            return state.resourceTransactions[index]
        }
    }

    static func commit(
        registry: AOSOperationRegistry,
        transactionID: String
    ) throws -> AOSResourceAdmissionReceipt {
        do {
            return try registry.mutateDurably { state in
                guard let transactionIndex = state.resourceTransactions.firstIndex(where: {
                    $0.transactionID == transactionID && $0.state == .reserving
                }) else { throw AOSOperationCoreError.invalidTransition }
                let transaction = state.resourceTransactions[transactionIndex]
                guard state.barrier.state == .open,
                      state.barrier.generation == transaction.expectedBarrierGeneration else {
                    throw AOSOperationCoreError.barrierClosed
                }
                guard state.adapterRegistry.revision == transaction.expectedAdapterRegistryRevision,
                      state.adapterRegistry.resourceDeclarationSetCount
                        == transaction.expectedResourceDeclarationSetCount,
                      state.adapterRegistry.resourceDeclarationSetDigest
                        == transaction.expectedResourceDeclarationSetDigest else {
                    throw AOSOperationCoreError.adapterRegistryConflict
                }
                try validateRequests(transaction.canonicalRequests, registry: state.adapterRegistry)

                var claims: [AOSResourceClaimRecord] = []
                var publications: [AOSResourceBrokerPublication] = []
                for request in transaction.canonicalRequests {
                    let declaration = state.adapterRegistry.declaration(resourceKey: request.resourceKey)!
                    let currentResourceGeneration = maxResourceGeneration(request.resourceKey, state: state)
                    guard request.expectedResourceGeneration == currentResourceGeneration else {
                        throw AOSOperationCoreError.resourceCASConflict
                    }
                    switch request.admissionMode {
                    case .exclusive:
                        guard request.expectedBrokerGeneration == nil,
                              request.expectedSubscriberSetRevision == nil,
                              request.expectedSubscriberSetCount == nil,
                              request.expectedSubscriberSetDigest == nil else {
                            throw AOSOperationCoreError.resourceDeclarationConflict
                        }
                        let conflict = state.resourceClaims.contains {
                            $0.resourceKey == request.resourceKey && $0.state != .terminal
                        } || state.resourceBrokers.contains {
                            $0.resourceKey == request.resourceKey && $0.state != .terminal
                        }
                        guard !conflict else { throw AOSOperationCoreError.resourceBusy }
                        claims.append(try makeClaim(
                            registry: registry,
                            state: &state,
                            transaction: transaction,
                            request: request,
                            resourceGeneration: currentResourceGeneration &+ 1,
                            broker: nil
                        ))
                    case .multiplexable:
                        guard let fanoutBound = declaration.fanoutBound else {
                            throw AOSOperationCoreError.resourceDeclarationConflict
                        }
                        let activeBrokerIndex = state.resourceBrokers.firstIndex {
                            $0.resourceKey == request.resourceKey && [.starting, .active].contains($0.state)
                        }
                        if let activeBrokerIndex {
                            var broker = state.resourceBrokers[activeBrokerIndex]
                            try validateAttachRequest(request, broker: broker, registry: state.adapterRegistry)
                            guard UInt64(broker.subscribers.count) < fanoutBound else {
                                throw AOSOperationCoreError.fanoutExhausted
                            }
                            let claim = try makeClaim(
                                registry: registry,
                                state: &state,
                                transaction: transaction,
                                request: request,
                                resourceGeneration: broker.resourceGeneration,
                                broker: broker
                            )
                            let subscriber = AOSResourceSubscriber(
                                subscriberID: claim.subscriberID!,
                                claimID: claim.claimID,
                                operation: claim.operation,
                                resourceKey: claim.resourceKey,
                                resourceGeneration: claim.resourceGeneration
                            )
                            broker.subscribers.append(subscriber)
                            broker.subscribers.sort()
                            broker.subscriberSetRevision &+= 1
                            broker.subscriberSetDigest = try AOSOperationResourceBroker.subscriberSetDigest(
                                broker.subscribers
                            )
                            state.resourceBrokers[activeBrokerIndex] = broker
                            claims.append(claim)
                            publications.append(publication(broker))
                        } else {
                            let expectedBroker = maxBrokerGeneration(request.resourceKey, state: state)
                            guard request.expectedBrokerGeneration == expectedBroker,
                                  request.expectedSubscriberSetRevision == 0,
                                  request.expectedSubscriberSetCount == 0,
                                  request.expectedSubscriberSetDigest
                                    == AOSOperationDigest.empty(.subscriberSet) else {
                                throw AOSOperationCoreError.resourceCASConflict
                            }
                            let resourceGeneration = currentResourceGeneration &+ 1
                            let brokerGeneration = expectedBroker &+ 1
                            let provisional = AOSResourceBrokerRecord(
                                brokerID: registry.makeID(),
                                brokerGeneration: brokerGeneration,
                                daemonGeneration: state.daemonGeneration,
                                resourceKey: request.resourceKey,
                                resourceGeneration: resourceGeneration,
                                adapterRegistrationID: request.adapterRegistrationID,
                                adapterRegistrationRevision: request.adapterRegistrationRevision,
                                resourceDeclarationDigest: request.resourceDeclarationDigest,
                                adapterRegistryRevision: state.adapterRegistry.revision,
                                resourceDeclarationSetCount: state.adapterRegistry.resourceDeclarationSetCount,
                                resourceDeclarationSetDigest: state.adapterRegistry.resourceDeclarationSetDigest,
                                committedClaimSetTransactionID: transaction.transactionID,
                                committedClaimSetDigest: transaction.claimSetDigest,
                                fanoutBound: fanoutBound,
                                subscribers: [],
                                subscriberSetRevision: 0,
                                subscriberSetDigest: AOSOperationDigest.empty(.subscriberSet),
                                state: .starting
                            )
                            let claim = try makeClaim(
                                registry: registry,
                                state: &state,
                                transaction: transaction,
                                request: request,
                                resourceGeneration: resourceGeneration,
                                broker: provisional
                            )
                            var broker = provisional
                            broker.subscribers = [AOSResourceSubscriber(
                                subscriberID: claim.subscriberID!,
                                claimID: claim.claimID,
                                operation: claim.operation,
                                resourceKey: claim.resourceKey,
                                resourceGeneration: claim.resourceGeneration
                            )]
                            broker.subscriberSetRevision = 1
                            broker.subscriberSetDigest = try AOSOperationResourceBroker.subscriberSetDigest(
                                broker.subscribers
                            )
                            state.resourceBrokers.append(broker)
                            claims.append(claim)
                            publications.append(publication(broker))
                        }
                    }
                }
                state.resourceClaims.append(contentsOf: claims)
                state.resourceTransactions[transactionIndex].state = .committed
                state.resourceTransactions[transactionIndex].recoveryDisposition = .commitPendingHandoff
                return AOSResourceAdmissionReceipt(
                    transactionID: transaction.transactionID,
                    claimSetDigest: transaction.claimSetDigest,
                    operation: transaction.operation,
                    adapterRegistryRevision: state.adapterRegistry.revision,
                    resourceDeclarationSetCount: state.adapterRegistry.resourceDeclarationSetCount,
                    resourceDeclarationSetDigest: state.adapterRegistry.resourceDeclarationSetDigest,
                    claims: claims.map(\.claimID),
                    brokerPublications: publications.sorted { $0.brokerID < $1.brokerID }
                )
            }
        } catch let error as AOSOperationCoreError {
            switch error {
            case .barrierClosed, .barrierGenerationConflict, .adapterRegistryConflict,
                 .resourceDeclarationConflict, .resourceBusy, .fanoutExhausted,
                 .resourceCASConflict:
                try? reject(registry: registry, transactionID: transactionID)
            default:
                break
            }
            throw error
        }
    }

    static func completeHandoff(
        registry: AOSOperationRegistry,
        transactionID: String
    ) throws -> AOSResourceTransactionRecord {
        try registry.mutateDurably { state in
            guard let index = state.resourceTransactions.firstIndex(where: {
                $0.transactionID == transactionID && $0.state == .committed
            }) else { throw AOSOperationCoreError.invalidTransition }
            state.resourceTransactions[index].state = .terminal
            state.resourceTransactions[index].outcome = .succeeded
            return state.resourceTransactions[index]
        }
    }

    private static func reject(
        registry: AOSOperationRegistry,
        transactionID: String
    ) throws {
        try registry.mutateDurably { state in
            guard let index = state.resourceTransactions.firstIndex(where: {
                $0.transactionID == transactionID && $0.state != .terminal
            }) else { return }
            state.resourceTransactions[index].state = .rollingBack
            state.resourceTransactions[index].recoveryDisposition = .rollbackPending
        }
        try registry.mutateDurably { state in
            guard let index = state.resourceTransactions.firstIndex(where: {
                $0.transactionID == transactionID && $0.state == .rollingBack
            }) else { return }
            state.resourceTransactions[index].state = .terminal
            state.resourceTransactions[index].outcome = .rejected
        }
    }

    private static func validateRequests(
        _ requests: [AOSResourceClaimRequest],
        registry: AOSAdapterRegistrySnapshot
    ) throws {
        for request in requests {
            guard let declaration = registry.declaration(resourceKey: request.resourceKey),
                  declaration.adapterRegistrationID == request.adapterRegistrationID,
                  declaration.adapterRegistrationRevision == request.adapterRegistrationRevision,
                  declaration.admissionMode == request.admissionMode,
                  declaration.declarationDigest == request.resourceDeclarationDigest else {
                throw AOSOperationCoreError.resourceDeclarationConflict
            }
        }
    }

    private static func validateAttachRequest(
        _ request: AOSResourceClaimRequest,
        broker: AOSResourceBrokerRecord,
        registry: AOSAdapterRegistrySnapshot
    ) throws {
        guard broker.state == .active,
              request.expectedBrokerGeneration == broker.brokerGeneration,
              request.expectedResourceGeneration == broker.resourceGeneration,
              request.expectedSubscriberSetRevision == broker.subscriberSetRevision,
              request.expectedSubscriberSetCount == UInt64(broker.subscribers.count),
              request.expectedSubscriberSetDigest == broker.subscriberSetDigest,
              broker.adapterRegistryRevision == registry.revision,
              broker.resourceDeclarationSetCount == registry.resourceDeclarationSetCount,
              broker.resourceDeclarationSetDigest == registry.resourceDeclarationSetDigest,
              broker.resourceDeclarationDigest == request.resourceDeclarationDigest,
              try AOSOperationResourceBroker.subscriberSetDigest(broker.subscribers)
                == broker.subscriberSetDigest else {
            throw AOSOperationCoreError.resourceCASConflict
        }
    }

    private static func makeClaim(
        registry: AOSOperationRegistry,
        state: inout AOSOperationDurableState,
        transaction: AOSResourceTransactionRecord,
        request: AOSResourceClaimRequest,
        resourceGeneration: UInt64,
        broker: AOSResourceBrokerRecord?
    ) throws -> AOSResourceClaimRecord {
        let claimID = registry.makeID()
        let subscriberID = broker == nil ? nil : registry.makeID()
        struct ReattachInput: Codable {
            let claimID: String
            let operation: AOSOperationIdentity
            let resourceKey: String
            let resourceGeneration: UInt64
        }
        let token = try AOSOperationDigest.sha256(domain: .reattachToken, ReattachInput(
            claimID: claimID,
            operation: transaction.operation,
            resourceKey: request.resourceKey,
            resourceGeneration: resourceGeneration
        ))
        return AOSResourceClaimRecord(
            claimID: claimID,
            transactionID: transaction.transactionID,
            operation: transaction.operation,
            daemonGeneration: state.daemonGeneration,
            resourceKey: request.resourceKey,
            resourceGeneration: resourceGeneration,
            admissionMode: request.admissionMode,
            adapterRegistrationID: request.adapterRegistrationID,
            adapterRegistrationRevision: request.adapterRegistrationRevision,
            resourceDeclarationDigest: request.resourceDeclarationDigest,
            adapterRegistryRevision: state.adapterRegistry.revision,
            resourceDeclarationSetCount: state.adapterRegistry.resourceDeclarationSetCount,
            resourceDeclarationSetDigest: state.adapterRegistry.resourceDeclarationSetDigest,
            committedClaimSetDigest: transaction.claimSetDigest,
            brokerID: broker?.brokerID,
            brokerGeneration: broker?.brokerGeneration,
            subscriberID: subscriberID,
            reattachTokenDigest: token,
            state: .active
        )
    }

    private static func maxResourceGeneration(
        _ resourceKey: String,
        state: AOSOperationDurableState
    ) -> UInt64 {
        max(
            state.resourceClaims.filter { $0.resourceKey == resourceKey }.map(\.resourceGeneration).max() ?? 0,
            state.resourceBrokers.filter { $0.resourceKey == resourceKey }.map(\.resourceGeneration).max() ?? 0
        )
    }

    private static func maxBrokerGeneration(
        _ resourceKey: String,
        state: AOSOperationDurableState
    ) -> UInt64 {
        state.resourceBrokers.filter { $0.resourceKey == resourceKey }.map(\.brokerGeneration).max() ?? 0
    }

    private static func publication(_ broker: AOSResourceBrokerRecord) -> AOSResourceBrokerPublication {
        AOSResourceBrokerPublication(
            brokerID: broker.brokerID,
            brokerGeneration: broker.brokerGeneration,
            subscriberSetRevision: broker.subscriberSetRevision,
            subscriberSetCount: UInt64(broker.subscribers.count),
            subscriberSetDigest: broker.subscriberSetDigest
        )
    }
}
