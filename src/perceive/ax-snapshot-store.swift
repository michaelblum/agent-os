import Foundation

public struct AOSAXObservationLimits: Codable, Equatable, Sendable {
    public static let schemaMaxDepth = 4_096
    public static let schemaMaxVisited = 65_536
    public static let schemaMaxEmitted = 65_536
    public static let schemaMaxDeadlineNanoseconds: UInt64 = 9_007_199_254_740_991
    public static let schemaMaxArrayDepth = 64
    public static let schemaMaxArrayItems = 4_096
    public static let schemaMaxValueCost = 16_777_216
    public static let schemaMaxPageSize = 4_096
    public static let schemaMaxFilters = 4_096
    public static let schemaMaxCompositeApplications = 4_096
    public static let schemaMaxFrontier = schemaMaxVisited + schemaMaxArrayItems

    public let maxDepth: Int
    public let maxVisited: Int
    public let maxEmitted: Int
    public let maxDeadlineNanoseconds: UInt64
    public let maxArrayDepth: Int
    public let maxArrayItems: Int
    public let maxValueCost: Int
    public let maxPageSize: Int
    public let maxFilters: Int
    public let maxCompositeApplications: Int
    public let maxFrontier: Int

    public init(
        maxDepth: Int,
        maxVisited: Int,
        maxEmitted: Int,
        maxDeadlineNanoseconds: UInt64,
        maxArrayDepth: Int,
        maxArrayItems: Int,
        maxValueCost: Int,
        maxPageSize: Int,
        maxFilters: Int,
        maxCompositeApplications: Int
    ) throws {
        guard (1...Self.schemaMaxDepth).contains(maxDepth),
              (1...Self.schemaMaxVisited).contains(maxVisited),
              (1...Self.schemaMaxEmitted).contains(maxEmitted),
              (1...Self.schemaMaxDeadlineNanoseconds).contains(maxDeadlineNanoseconds),
              (1...Self.schemaMaxArrayDepth).contains(maxArrayDepth),
              (1...Self.schemaMaxArrayItems).contains(maxArrayItems),
              (1...Self.schemaMaxValueCost).contains(maxValueCost),
              (1...Self.schemaMaxPageSize).contains(maxPageSize),
              (1...Self.schemaMaxFilters).contains(maxFilters),
              (1...Self.schemaMaxCompositeApplications).contains(maxCompositeApplications),
              maxEmitted <= maxVisited,
              maxPageSize <= maxEmitted else {
            throw AOSAXObservationError.invalidBounds
        }
        self.maxDepth = maxDepth
        self.maxVisited = maxVisited
        self.maxEmitted = maxEmitted
        self.maxDeadlineNanoseconds = maxDeadlineNanoseconds
        self.maxArrayDepth = maxArrayDepth
        self.maxArrayItems = maxArrayItems
        self.maxValueCost = maxValueCost
        self.maxPageSize = maxPageSize
        self.maxFilters = maxFilters
        self.maxCompositeApplications = maxCompositeApplications
        self.maxFrontier = maxVisited + maxArrayItems
    }
}

public struct AOSAXRetentionConfiguration: Codable, Equatable, Sendable {
    public let snapshotTTLNanoseconds: UInt64
    public let maxSnapshots: Int
    public let maxRetainedRefs: Int
    public let maxRetainedValueCost: Int
    public let maxPageTokens: Int
    public let maxTombstones: Int
    public let maxActiveBorrows: Int
    public let identityAttempts: Int

    public init(
        snapshotTTLNanoseconds: UInt64,
        maxSnapshots: Int,
        maxRetainedRefs: Int,
        maxRetainedValueCost: Int,
        maxPageTokens: Int,
        maxTombstones: Int,
        maxActiveBorrows: Int,
        identityAttempts: Int = 8
    ) throws {
        guard (1...AOSAXObservationLimits.schemaMaxDeadlineNanoseconds).contains(snapshotTTLNanoseconds),
              maxSnapshots > 0,
              maxRetainedRefs > 0,
              maxRetainedValueCost > 0,
              maxPageTokens > 0,
              maxTombstones > 0,
              maxActiveBorrows > 0,
              identityAttempts > 0 else {
            throw AOSAXObservationError.invalidRetention
        }
        self.snapshotTTLNanoseconds = snapshotTTLNanoseconds
        self.maxSnapshots = maxSnapshots
        self.maxRetainedRefs = maxRetainedRefs
        self.maxRetainedValueCost = maxRetainedValueCost
        self.maxPageTokens = maxPageTokens
        self.maxTombstones = maxTombstones
        self.maxActiveBorrows = maxActiveBorrows
        self.identityAttempts = identityAttempts
    }
}

public struct AOSAXSnapshotStoreConfiguration: Codable, Equatable, Sendable {
    public let retention: AOSAXRetentionConfiguration
    public let observationLimits: AOSAXObservationLimits

    public init(
        retention: AOSAXRetentionConfiguration,
        observationLimits: AOSAXObservationLimits
    ) throws {
        guard observationLimits.maxVisited <= retention.maxRetainedRefs,
              observationLimits.maxValueCost <= retention.maxRetainedValueCost else {
            throw AOSAXObservationError.invalidRetention
        }
        self.retention = retention
        self.observationLimits = observationLimits
    }
}

public struct AOSAXObservationAdmission: Sendable {
    public let startMonotonicNanoseconds: UInt64
    public let deadlineMonotonicNanoseconds: UInt64
    public let expiresMonotonicNanoseconds: UInt64
    public let createdAt: String
    public let expiresAt: String
    public let effectiveLimits: AOSAXSnapshotStoreConfiguration
    public let snapshotTTLNanoseconds: UInt64
    public let maxRetainedRefs: Int
    public let maxRetainedValueCost: Int
    public let maxActiveBorrows: Int
    public let identityAttempts: Int
}

public final class AOSAXRetainedHandle<Handle: Hashable & Sendable>: @unchecked Sendable {
    public let value: Handle
    private let releaseBody: @Sendable (Handle) -> Void
    private let lock = NSLock()
    private var released = false

    public init(value: Handle, release: @escaping @Sendable (Handle) -> Void) {
        self.value = value
        self.releaseBody = release
    }

    deinit {
        releaseOnce()
    }

    public func releaseOnce() {
        let shouldRelease = lock.withLock { () -> Bool in
            guard !released else { return false }
            released = true
            return true
        }
        if shouldRelease {
            releaseBody(value)
        }
    }
}

public final class AOSAXHandleBorrowLease<Handle: Hashable & Sendable>: @unchecked Sendable {
    private var retainedHandle: AOSAXRetainedHandle<Handle>?
    private let settleBody: @Sendable () -> Void
    private let lock = NSLock()
    private var settled = false

    public var value: Handle {
        lock.withLock {
            precondition(!settled, "settled Observation Ref borrow has no lookup authority")
            return retainedHandle!.value
        }
    }

    fileprivate init(
        retainedHandle: AOSAXRetainedHandle<Handle>,
        settle: @escaping @Sendable () -> Void
    ) {
        self.retainedHandle = retainedHandle
        self.settleBody = settle
    }

    deinit {
        release()
    }

    public func release() {
        var releasedHandle = lock.withLock { () -> AOSAXRetainedHandle<Handle>? in
            guard !settled else { return nil }
            settled = true
            defer { retainedHandle = nil }
            return retainedHandle
        }
        guard releasedHandle != nil else { return }
        settleBody()
        releasedHandle = nil
    }
}

public struct AOSAXPageTokenIdentity: Equatable, Sendable {
    public let lookupID: String
    public let publicToken: String

    public init(lookupID: String, publicToken: String) {
        self.lookupID = lookupID
        self.publicToken = publicToken
    }
}

public enum AOSAXTombstoneReason: String, Codable, Sendable {
    case expired
    case evicted
    case consumed
    case retentionLimit = "retention_limit"
}

public enum AOSAXPageErrorKind: String, Codable, Sendable {
    case tokenTampered = "token_tampered"
    case requestDigestMismatch = "request_digest_mismatch"
    case projectionDigestMismatch = "projection_digest_mismatch"
    case stateMismatch = "state_mismatch"
    case pageSizeMismatch = "page_size_mismatch"
    case snapshotExpired = "snapshot_expired"
    case snapshotEvicted = "snapshot_evicted"
    case tokenExpired = "token_expired"
    case tokenEvicted = "token_evicted"
    case tokenConsumed = "token_consumed"
    case unknownIdentity = "unknown_identity"
}

public struct AOSAXPageError: Codable, Equatable, Sendable {
    public let kind: AOSAXPageErrorKind
    public let detail: String

    public init(kind: AOSAXPageErrorKind, detail: String) {
        self.kind = kind
        self.detail = detail
    }
}

public struct AOSAXPageRequest: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let kind: String
    public let token: String
    public let expectedStateID: String
    public let requestDigest: String
    public let projectionDigest: String
    public let pageSize: Int

    public init(
        token: String,
        expectedStateID: String,
        requestDigest: String,
        projectionDigest: String,
        pageSize: Int
    ) throws {
        guard AOSAXContractAdmission.pageRequest(
            token: token,
            stateID: expectedStateID,
            requestDigest: requestDigest,
            projectionDigest: projectionDigest,
            pageSize: pageSize
        ) else {
            throw AOSAXObservationError.invalidBounds
        }
        self.schemaVersion = "aos.ax-observation.v1"
        self.kind = "page_request"
        self.token = token
        self.expectedStateID = expectedStateID
        self.requestDigest = requestDigest
        self.projectionDigest = projectionDigest
        self.pageSize = pageSize
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(String.self, forKey: .schemaVersion) == "aos.ax-observation.v1",
              try container.decode(String.self, forKey: .kind) == "page_request" else {
            throw AOSAXObservationError.invalidRoot
        }
        try self.init(
            token: container.decode(String.self, forKey: .token),
            expectedStateID: container.decode(String.self, forKey: .expectedStateID),
            requestDigest: container.decode(String.self, forKey: .requestDigest),
            projectionDigest: container.decode(String.self, forKey: .projectionDigest),
            pageSize: container.decode(Int.self, forKey: .pageSize)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, kind, token, expectedStateID, requestDigest, projectionDigest, pageSize
    }
}

public struct AOSAXPageResponse: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let kind: String
    public let status: String
    public let stateID: String?
    public let requestDigest: String?
    public let projectionDigest: String?
    public let effectiveLimits: AOSAXSnapshotStoreConfiguration?
    public let position: Int?
    public let nodes: [AOSAXNodeProjection]
    public let nextPageToken: String?
    public let nextPosition: Int?
    public let snapshotOutcome: AOSAXObservationOutcome?
    public let accounting: AOSAXTraversalAccounting?
    public let frontier: [AOSAXFrontierEntry]?
    public let error: AOSAXPageError?

    public init(
        stateID: String,
        requestDigest: String,
        projectionDigest: String,
        effectiveLimits: AOSAXSnapshotStoreConfiguration,
        position: Int,
        nodes: [AOSAXNodeProjection],
        nextPageToken: String?,
        nextPosition: Int?,
        snapshotOutcome: AOSAXObservationOutcome,
        accounting: AOSAXTraversalAccounting,
        frontier: [AOSAXFrontierEntry]
    ) {
        self.schemaVersion = "aos.ax-observation.v1"
        self.kind = "page"
        self.status = "ok"
        self.stateID = stateID
        self.requestDigest = requestDigest
        self.projectionDigest = projectionDigest
        self.effectiveLimits = effectiveLimits
        self.position = position
        self.nodes = nodes
        self.nextPageToken = nextPageToken
        self.nextPosition = nextPosition
        self.snapshotOutcome = snapshotOutcome
        self.accounting = accounting
        self.frontier = frontier
        self.error = nil
    }

    public init(error: AOSAXPageError) {
        self.schemaVersion = "aos.ax-observation.v1"
        self.kind = "page"
        self.status = "error"
        self.stateID = nil
        self.requestDigest = nil
        self.projectionDigest = nil
        self.effectiveLimits = nil
        self.position = nil
        self.nodes = []
        self.nextPageToken = nil
        self.nextPosition = nil
        self.snapshotOutcome = nil
        self.accounting = nil
        self.frontier = nil
        self.error = error
    }
}

public struct AOSAXStoredSnapshot<Handle: Hashable & Sendable>: Sendable {
    public let stateID: String
    public let requestDigest: String
    public let projectionDigest: String
    public let root: AOSAXRootIdentity
    public let bounds: AOSAXObservationBounds
    public let effectiveLimits: AOSAXSnapshotStoreConfiguration
    public let filters: [AOSAXObservationFilter]
    public let pageSize: Int
    public let createdAt: String
    public let expiresAt: String
    public let createdMonotonicNanoseconds: UInt64
    public let expiresMonotonicNanoseconds: UInt64
    public let outcome: AOSAXObservationOutcome
    public let stopCondition: AOSAXStopCondition
    public let accounting: AOSAXTraversalAccounting
    public let frontier: [AOSAXFrontierEntry]
    public let constituents: [AOSAXCompositeConstituentResult]
    public let nodes: [AOSAXNodeProjection]
    public let handlesByRef: [String: AOSAXRetainedHandle<Handle>]
    public let retainedValueCost: Int

    public init(
        stateID: String,
        requestDigest: String,
        projectionDigest: String,
        root: AOSAXRootIdentity,
        bounds: AOSAXObservationBounds,
        effectiveLimits: AOSAXSnapshotStoreConfiguration,
        filters: [AOSAXObservationFilter],
        pageSize: Int,
        createdAt: String,
        expiresAt: String,
        createdMonotonicNanoseconds: UInt64,
        expiresMonotonicNanoseconds: UInt64,
        outcome: AOSAXObservationOutcome,
        stopCondition: AOSAXStopCondition,
        accounting: AOSAXTraversalAccounting,
        frontier: [AOSAXFrontierEntry],
        constituents: [AOSAXCompositeConstituentResult],
        nodes: [AOSAXNodeProjection],
        handlesByRef: [String: AOSAXRetainedHandle<Handle>],
        retainedValueCost: Int
    ) {
        self.stateID = stateID
        self.requestDigest = requestDigest
        self.projectionDigest = projectionDigest
        self.root = root
        self.bounds = bounds
        self.effectiveLimits = effectiveLimits
        self.filters = filters
        self.pageSize = pageSize
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.createdMonotonicNanoseconds = createdMonotonicNanoseconds
        self.expiresMonotonicNanoseconds = expiresMonotonicNanoseconds
        self.outcome = outcome
        self.stopCondition = stopCondition
        self.accounting = accounting
        self.frontier = frontier
        self.constituents = constituents
        self.nodes = nodes
        self.handlesByRef = handlesByRef
        self.retainedValueCost = retainedValueCost
    }
}

public enum AOSAXSnapshotLookup<Handle: Hashable & Sendable>: Sendable {
    case value(AOSAXHandleBorrowLease<Handle>)
    case expired
    case evicted
    case missing
    case incompatible
    case borrowLimit
}

public final class AOSAXSnapshotStore<Handle: Hashable & Sendable>: @unchecked Sendable {
    public typealias MonotonicClock = @Sendable () -> UInt64
    public typealias WallClock = @Sendable () -> Date
    public typealias TokenFactory = @Sendable () -> AOSAXPageTokenIdentity

    private struct SnapshotEntry: Sendable {
        let snapshot: AOSAXStoredSnapshot<Handle>
        let sequence: UInt64
    }

    private struct TokenEntry: Sendable {
        let lookupID: String
        let publicToken: String
        let stateID: String
        let requestDigest: String
        let projectionDigest: String
        let nextPosition: Int
        let pageSize: Int
        let expiresMonotonicNanoseconds: UInt64
        let sequence: UInt64
    }

    private let configuration: AOSAXSnapshotStoreConfiguration
    private let monotonicClock: MonotonicClock
    private let wallClock: WallClock
    private let tokenFactory: TokenFactory
    private let lock = NSLock()
    private var snapshots: [String: SnapshotEntry] = [:]
    private var snapshotOrder: [String] = []
    private var reservedStateIDs = Set<String>()
    private var tokens: [String: TokenEntry] = [:]
    private var tokenOrder: [String] = []
    private var snapshotTombstones: [String: AOSAXTombstoneReason] = [:]
    private var snapshotTombstoneOrder: [String] = []
    private var tokenTombstones: [String: AOSAXTombstoneReason] = [:]
    private var tokenTombstoneOrder: [String] = []
    private var sequence: UInt64 = 0
    private var retainedRefCount = 0
    private var retainedValueCost = 0
    private var activeBorrowCount = 0

    public init(
        configuration: AOSAXSnapshotStoreConfiguration,
        monotonicClock: @escaping MonotonicClock,
        wallClock: @escaping WallClock,
        tokenFactory: @escaping TokenFactory
    ) {
        self.configuration = configuration
        self.monotonicClock = monotonicClock
        self.wallClock = wallClock
        self.tokenFactory = tokenFactory
    }

    public func beginObservation(_ request: AOSAXObservationRequest) throws -> AOSAXObservationAdmission {
        let limits = configuration.observationLimits
        guard AOSAXContractAdmission.request(request),
              request.bounds.maxDepth <= limits.maxDepth,
              request.bounds.maxVisited <= limits.maxVisited,
              request.bounds.maxEmitted <= limits.maxEmitted,
              request.bounds.maxEmitted <= request.bounds.maxVisited,
              request.bounds.deadlineNanoseconds <= limits.maxDeadlineNanoseconds,
              request.bounds.maxArrayDepth <= limits.maxArrayDepth,
              request.bounds.maxArrayItems <= limits.maxArrayItems,
              request.bounds.maxValueCost <= limits.maxValueCost,
              request.pageSize <= limits.maxPageSize,
              request.pageSize <= request.bounds.maxEmitted,
              request.filters.count <= limits.maxFilters else {
            throw AOSAXObservationError.invalidBounds
        }
        var totalFilterAttributeOutcomes = 0
        for filter in request.filters {
            let total = totalFilterAttributeOutcomes.addingReportingOverflow(filter.rawAttributeOutcomes.count)
            guard !total.overflow,
                  total.partialValue <= limits.maxArrayItems,
                  total.partialValue <= request.bounds.maxArrayItems else {
                throw AOSAXObservationError.invalidBounds
            }
            totalFilterAttributeOutcomes = total.partialValue
        }
        if case .displayComposite(_, let applications) = request.root,
           (applications.count > limits.maxCompositeApplications || applications.count > request.bounds.maxVisited) {
            throw AOSAXObservationError.invalidBounds
        }

        let start = monotonicClock()
        let deadline = start.addingReportingOverflow(request.bounds.deadlineNanoseconds)
        guard !deadline.overflow else { throw AOSAXObservationError.invalidBounds }
        let retention = configuration.retention
        let expiry = start.addingReportingOverflow(retention.snapshotTTLNanoseconds)
        guard !expiry.overflow else { throw AOSAXObservationError.invalidRetention }
        let createdDate = wallClock()
        let expiryDate = createdDate.addingTimeInterval(
            Double(retention.snapshotTTLNanoseconds) / 1_000_000_000
        )
        return AOSAXObservationAdmission(
            startMonotonicNanoseconds: start,
            deadlineMonotonicNanoseconds: deadline.partialValue,
            expiresMonotonicNanoseconds: expiry.partialValue,
            createdAt: Self.iso8601(createdDate),
            expiresAt: Self.iso8601(expiryDate),
            effectiveLimits: configuration,
            snapshotTTLNanoseconds: retention.snapshotTTLNanoseconds,
            maxRetainedRefs: retention.maxRetainedRefs,
            maxRetainedValueCost: retention.maxRetainedValueCost,
            maxActiveBorrows: retention.maxActiveBorrows,
            identityAttempts: retention.identityAttempts
        )
    }

    public func monotonicNow() -> UInt64 {
        monotonicClock()
    }

    public func allocateStateID(factory: @Sendable () -> String) throws -> String {
        try lock.withLock {
            expireLocked(now: monotonicClock())
            for _ in 0..<configuration.retention.identityAttempts {
                let candidate = factory()
                guard Self.validIdentity(candidate) else { continue }
                if snapshots[candidate] == nil,
                   !reservedStateIDs.contains(candidate),
                   snapshotTombstones[candidate] == nil {
                    reservedStateIDs.insert(candidate)
                    return candidate
                }
            }
            throw AOSAXObservationError.identityExhausted
        }
    }

    public func abandonStateID(_ stateID: String) {
        lock.withLock {
            _ = reservedStateIDs.remove(stateID)
        }
    }

    public func resolveElement(stateID: String, ref: String) -> AOSAXSnapshotLookup<Handle> {
        lock.withLock {
            expireLocked(now: monotonicClock())
            guard let entry = snapshots[stateID] else {
                switch snapshotTombstones[stateID] {
                case .expired: return .expired
                case .evicted, .retentionLimit: return .evicted
                default: return .missing
                }
            }
            guard let handle = entry.snapshot.handlesByRef[ref] else {
                return .incompatible
            }
            guard activeBorrowCount < configuration.retention.maxActiveBorrows else {
                return .borrowLimit
            }
            activeBorrowCount += 1
            return .value(AOSAXHandleBorrowLease(retainedHandle: handle) { [weak self] in
                self?.completeBorrow()
            })
        }
    }

    public func publish(
        _ snapshot: AOSAXStoredSnapshot<Handle>,
        pageSize: Int
    ) throws -> AOSAXObservationResponse {
        try lock.withLock {
            let now = monotonicClock()
            expireLocked(now: now)
            guard pageSize > 0,
                  pageSize <= configuration.observationLimits.maxPageSize,
                  pageSize <= snapshot.bounds.maxEmitted,
                  snapshot.nodes.count <= snapshot.bounds.maxEmitted,
                  snapshot.frontier.count <= AOSAXObservationLimits.schemaMaxFrontier else {
                throw AOSAXObservationError.invalidBounds
            }
            guard reservedStateIDs.remove(snapshot.stateID) != nil,
                  snapshots[snapshot.stateID] == nil else {
                throw AOSAXObservationError.stateCollision
            }
            let retention = configuration.retention
            guard snapshot.handlesByRef.count <= retention.maxRetainedRefs,
                  snapshot.retainedValueCost <= retention.maxRetainedValueCost else {
                addSnapshotTombstoneLocked(snapshot.stateID, reason: .retentionLimit)
                return AOSAXObservationResponse.retentionUnavailable(from: snapshot)
            }
            while snapshots.count >= retention.maxSnapshots ||
                    retainedRefCount + snapshot.handlesByRef.count > retention.maxRetainedRefs ||
                    retainedValueCost + snapshot.retainedValueCost > retention.maxRetainedValueCost {
                guard let oldest = snapshotOrder.first else {
                    addSnapshotTombstoneLocked(snapshot.stateID, reason: .retentionLimit)
                    return AOSAXObservationResponse.retentionUnavailable(from: snapshot)
                }
                removeSnapshotLocked(oldest, reason: .evicted)
            }
            sequence &+= 1
            snapshots[snapshot.stateID] = SnapshotEntry(snapshot: snapshot, sequence: sequence)
            snapshotOrder.append(snapshot.stateID)
            retainedRefCount += snapshot.handlesByRef.count
            retainedValueCost += snapshot.retainedValueCost

            let end = min(pageSize, snapshot.nodes.count)
            let pageNodes = Array(snapshot.nodes[..<end])
            let nextToken: String?
            do {
                nextToken = end < snapshot.nodes.count
                    ? try makeTokenLocked(snapshot: snapshot, nextPosition: end, pageSize: pageSize)
                    : nil
            } catch {
                rollbackSnapshotLocked(snapshot.stateID)
                throw error
            }
            return AOSAXObservationResponse(
                snapshot: snapshot,
                nodes: pageNodes,
                nextPageToken: nextToken,
                nextPosition: nextToken == nil ? nil : end
            )
        }
    }

    public func page(
        token publicToken: String,
        expectedStateID: String,
        requestDigest: String,
        projectionDigest: String,
        pageSize: Int
    ) -> AOSAXPageResponse {
        lock.withLock {
            let now = monotonicClock()
            expireLocked(now: now)
            guard AOSAXContractAdmission.pageToken(publicToken) else {
                return .init(error: .init(kind: .tokenTampered, detail: "token shape is invalid"))
            }
            guard AOSAXContractAdmission.identifier(expectedStateID) else {
                return .init(error: .init(kind: .stateMismatch, detail: "expected state identity is invalid"))
            }
            guard AOSAXContractAdmission.digest(requestDigest) else {
                return .init(error: .init(kind: .requestDigestMismatch, detail: "request digest shape is invalid"))
            }
            guard AOSAXContractAdmission.digest(projectionDigest) else {
                return .init(error: .init(kind: .projectionDigestMismatch, detail: "projection digest shape is invalid"))
            }
            guard (1...configuration.observationLimits.maxPageSize).contains(pageSize) else {
                return .init(error: .init(kind: .pageSizeMismatch, detail: "page size is outside the admitted bound"))
            }
            guard let lookupID = Self.lookupID(from: publicToken) else {
                return .init(error: .init(kind: .tokenTampered, detail: "token shape is invalid"))
            }
            guard let token = tokens[lookupID] else {
                return .init(error: pageErrorForMissingToken(lookupID))
            }
            guard token.publicToken == publicToken else {
                return .init(error: .init(kind: .tokenTampered, detail: "token authenticator does not match retained identity"))
            }
            guard token.stateID == expectedStateID else {
                return .init(error: .init(kind: .stateMismatch, detail: "token belongs to another snapshot"))
            }
            guard token.requestDigest == requestDigest else {
                return .init(error: .init(kind: .requestDigestMismatch, detail: "request digest differs from retained cursor"))
            }
            guard token.projectionDigest == projectionDigest else {
                return .init(error: .init(kind: .projectionDigestMismatch, detail: "projection digest differs from retained cursor"))
            }
            guard token.pageSize == pageSize else {
                return .init(error: .init(kind: .pageSizeMismatch, detail: "page size differs from retained cursor"))
            }
            guard let entry = snapshots[token.stateID] else {
                removeTokenLocked(lookupID, reason: snapshotTombstones[token.stateID] ?? .evicted)
                return .init(error: pageErrorForMissingSnapshot(token.stateID))
            }

            removeTokenLocked(lookupID, reason: .consumed)
            let start = token.nextPosition
            let end = min(start + pageSize, entry.snapshot.nodes.count)
            let pageNodes = start < end ? Array(entry.snapshot.nodes[start..<end]) : []
            let nextToken = end < entry.snapshot.nodes.count
                ? try? makeTokenLocked(snapshot: entry.snapshot, nextPosition: end, pageSize: pageSize)
                : nil
            if end < entry.snapshot.nodes.count, nextToken == nil {
                return .init(error: .init(kind: .tokenEvicted, detail: "unable to allocate the next bounded cursor"))
            }
            return AOSAXPageResponse(
                stateID: entry.snapshot.stateID,
                requestDigest: entry.snapshot.requestDigest,
                projectionDigest: entry.snapshot.projectionDigest,
                effectiveLimits: entry.snapshot.effectiveLimits,
                position: start,
                nodes: pageNodes,
                nextPageToken: nextToken,
                nextPosition: nextToken == nil ? nil : end,
                snapshotOutcome: entry.snapshot.outcome,
                accounting: entry.snapshot.accounting,
                frontier: entry.snapshot.frontier
            )
        }
    }

    @discardableResult
    public func removeAll() -> Int {
        lock.withLock {
            let count = snapshots.count
            let ids = snapshotOrder
            for id in ids {
                removeSnapshotLocked(id, reason: .evicted)
            }
            tokens.removeAll()
            tokenOrder.removeAll()
            reservedStateIDs.removeAll()
            return count
        }
    }

    public func retainedCounts() -> (snapshots: Int, refs: Int, valueCost: Int, tokens: Int) {
        lock.withLock {
            expireLocked(now: monotonicClock())
            return (snapshots.count, retainedRefCount, retainedValueCost, tokens.count)
        }
    }

    public func activeBorrows() -> Int {
        lock.withLock { activeBorrowCount }
    }

    private func makeTokenLocked(
        snapshot: AOSAXStoredSnapshot<Handle>,
        nextPosition: Int,
        pageSize: Int
    ) throws -> String {
        let retention = configuration.retention
        for _ in 0..<retention.identityAttempts {
            let identity = tokenFactory()
            guard Self.validIdentity(identity.lookupID),
                  Self.lookupID(from: identity.publicToken) == identity.lookupID,
                  tokens[identity.lookupID] == nil,
                  tokenTombstones[identity.lookupID] == nil else {
                continue
            }
            while tokens.count >= retention.maxPageTokens, let oldest = tokenOrder.first {
                removeTokenLocked(oldest, reason: .evicted)
            }
            sequence &+= 1
            tokens[identity.lookupID] = TokenEntry(
                lookupID: identity.lookupID,
                publicToken: identity.publicToken,
                stateID: snapshot.stateID,
                requestDigest: snapshot.requestDigest,
                projectionDigest: snapshot.projectionDigest,
                nextPosition: nextPosition,
                pageSize: pageSize,
                expiresMonotonicNanoseconds: snapshot.expiresMonotonicNanoseconds,
                sequence: sequence
            )
            tokenOrder.append(identity.lookupID)
            return identity.publicToken
        }
        throw AOSAXObservationError.identityExhausted
    }

    private func expireLocked(now: UInt64) {
        let expiredSnapshots = snapshotOrder.filter {
            guard let entry = snapshots[$0] else { return false }
            return now >= entry.snapshot.expiresMonotonicNanoseconds
        }
        for id in expiredSnapshots {
            removeSnapshotLocked(id, reason: .expired)
        }
        let expiredTokens = tokenOrder.filter {
            guard let entry = tokens[$0] else { return false }
            return now >= entry.expiresMonotonicNanoseconds
        }
        for id in expiredTokens {
            removeTokenLocked(id, reason: .expired)
        }
    }

    private func removeSnapshotLocked(_ stateID: String, reason: AOSAXTombstoneReason) {
        guard let entry = snapshots.removeValue(forKey: stateID) else { return }
        snapshotOrder.removeAll { $0 == stateID }
        retainedRefCount -= entry.snapshot.handlesByRef.count
        retainedValueCost -= entry.snapshot.retainedValueCost
        addSnapshotTombstoneLocked(stateID, reason: reason)
        let relatedTokens = tokenOrder.filter { tokens[$0]?.stateID == stateID }
        for tokenID in relatedTokens {
            removeTokenLocked(tokenID, reason: reason)
        }
    }

    private func rollbackSnapshotLocked(_ stateID: String) {
        guard let entry = snapshots.removeValue(forKey: stateID) else { return }
        snapshotOrder.removeAll { $0 == stateID }
        retainedRefCount -= entry.snapshot.handlesByRef.count
        retainedValueCost -= entry.snapshot.retainedValueCost
        let relatedTokens = tokenOrder.filter { tokens[$0]?.stateID == stateID }
        for tokenID in relatedTokens {
            tokens.removeValue(forKey: tokenID)
            tokenOrder.removeAll { $0 == tokenID }
        }
    }

    private func removeTokenLocked(_ lookupID: String, reason: AOSAXTombstoneReason) {
        guard tokens.removeValue(forKey: lookupID) != nil else { return }
        tokenOrder.removeAll { $0 == lookupID }
        addTokenTombstoneLocked(lookupID, reason: reason)
    }

    private func addSnapshotTombstoneLocked(_ stateID: String, reason: AOSAXTombstoneReason) {
        if snapshotTombstones[stateID] == nil { snapshotTombstoneOrder.append(stateID) }
        snapshotTombstones[stateID] = reason
        while snapshotTombstoneOrder.count > configuration.retention.maxTombstones {
            snapshotTombstones.removeValue(forKey: snapshotTombstoneOrder.removeFirst())
        }
    }

    private func addTokenTombstoneLocked(_ lookupID: String, reason: AOSAXTombstoneReason) {
        if tokenTombstones[lookupID] == nil { tokenTombstoneOrder.append(lookupID) }
        tokenTombstones[lookupID] = reason
        while tokenTombstoneOrder.count > configuration.retention.maxTombstones {
            tokenTombstones.removeValue(forKey: tokenTombstoneOrder.removeFirst())
        }
    }

    private func pageErrorForMissingToken(_ lookupID: String) -> AOSAXPageError {
        switch tokenTombstones[lookupID] {
        case .expired:
            return .init(kind: .tokenExpired, detail: "page token expired")
        case .evicted, .retentionLimit:
            return .init(kind: .tokenEvicted, detail: "page token was evicted")
        case .consumed:
            return .init(kind: .tokenConsumed, detail: "page token was already consumed")
        case nil:
            return .init(kind: .unknownIdentity, detail: "page token identity is unknown")
        }
    }

    private func pageErrorForMissingSnapshot(_ stateID: String) -> AOSAXPageError {
        switch snapshotTombstones[stateID] {
        case .expired:
            return .init(kind: .snapshotExpired, detail: "snapshot expired")
        case .evicted, .retentionLimit, .consumed:
            return .init(kind: .snapshotEvicted, detail: "snapshot was evicted")
        case nil:
            return .init(kind: .unknownIdentity, detail: "snapshot identity is unknown")
        }
    }

    private func completeBorrow() {
        lock.withLock {
            precondition(activeBorrowCount > 0, "AX borrow settlement underflow")
            activeBorrowCount -= 1
        }
    }

    private static func validIdentity(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 256 &&
            value.unicodeScalars.allSatisfy { scalar in
                (48...57).contains(scalar.value) ||
                    (65...90).contains(scalar.value) ||
                    (97...122).contains(scalar.value) ||
                    scalar == "-" || scalar == "_"
            }
    }

    private static func lookupID(from publicToken: String) -> String? {
        guard AOSAXContractAdmission.pageToken(publicToken),
              let separator = publicToken.firstIndex(of: "."),
              separator != publicToken.startIndex else { return nil }
        let lookupID = String(publicToken[..<separator])
        let authenticator = publicToken[publicToken.index(after: separator)...]
        guard !authenticator.isEmpty, !authenticator.contains(".") else { return nil }
        return validIdentity(lookupID) ? lookupID : nil
    }

    private static func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

private extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
