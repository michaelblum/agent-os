import Foundation

public struct AOSAXRetentionConfiguration: Codable, Equatable, Sendable {
    public let snapshotTTLNanoseconds: UInt64
    public let maxSnapshots: Int
    public let maxRetainedRefs: Int
    public let maxRetainedValueCost: Int
    public let maxPageTokens: Int
    public let maxTombstones: Int
    public let identityAttempts: Int

    public init(
        snapshotTTLNanoseconds: UInt64,
        maxSnapshots: Int,
        maxRetainedRefs: Int,
        maxRetainedValueCost: Int,
        maxPageTokens: Int,
        maxTombstones: Int,
        identityAttempts: Int = 8
    ) throws {
        guard snapshotTTLNanoseconds > 0,
              maxSnapshots > 0,
              maxRetainedRefs > 0,
              maxRetainedValueCost > 0,
              maxPageTokens > 0,
              maxTombstones > 0,
              identityAttempts > 0 else {
            throw AOSAXObservationError.invalidRetention
        }
        self.snapshotTTLNanoseconds = snapshotTTLNanoseconds
        self.maxSnapshots = maxSnapshots
        self.maxRetainedRefs = maxRetainedRefs
        self.maxRetainedValueCost = maxRetainedValueCost
        self.maxPageTokens = maxPageTokens
        self.maxTombstones = maxTombstones
        self.identityAttempts = identityAttempts
    }
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
        guard pageSize > 0 else { throw AOSAXObservationError.invalidBounds }
        self.schemaVersion = "aos.ax-observation.v1"
        self.kind = "page_request"
        self.token = token
        self.expectedStateID = expectedStateID
        self.requestDigest = requestDigest
        self.projectionDigest = projectionDigest
        self.pageSize = pageSize
    }
}

public struct AOSAXPageResponse: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let kind: String
    public let status: String
    public let stateID: String?
    public let requestDigest: String?
    public let projectionDigest: String?
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
    case value(AOSAXRetainedHandle<Handle>)
    case expired
    case evicted
    case missing
    case incompatible
}

public final class AOSAXSnapshotStore<Handle: Hashable & Sendable>: @unchecked Sendable {
    public typealias MonotonicClock = @Sendable () -> UInt64
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

    private let configuration: AOSAXRetentionConfiguration
    private let monotonicClock: MonotonicClock
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

    public init(
        configuration: AOSAXRetentionConfiguration,
        monotonicClock: @escaping MonotonicClock,
        tokenFactory: @escaping TokenFactory
    ) {
        self.configuration = configuration
        self.monotonicClock = monotonicClock
        self.tokenFactory = tokenFactory
    }

    public func allocateStateID(factory: @Sendable () -> String) throws -> String {
        try lock.withLock {
            expireLocked(now: monotonicClock())
            for _ in 0..<configuration.identityAttempts {
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
            return .value(handle)
        }
    }

    public func publish(
        _ snapshot: AOSAXStoredSnapshot<Handle>,
        pageSize: Int
    ) throws -> AOSAXObservationResponse {
        try lock.withLock {
            let now = monotonicClock()
            expireLocked(now: now)
            guard pageSize > 0 else { throw AOSAXObservationError.invalidBounds }
            guard reservedStateIDs.remove(snapshot.stateID) != nil,
                  snapshots[snapshot.stateID] == nil else {
                throw AOSAXObservationError.stateCollision
            }
            guard snapshot.handlesByRef.count <= configuration.maxRetainedRefs,
                  snapshot.retainedValueCost <= configuration.maxRetainedValueCost else {
                addSnapshotTombstoneLocked(snapshot.stateID, reason: .retentionLimit)
                return AOSAXObservationResponse.retentionUnavailable(from: snapshot)
            }
            while snapshots.count >= configuration.maxSnapshots ||
                    retainedRefCount + snapshot.handlesByRef.count > configuration.maxRetainedRefs ||
                    retainedValueCost + snapshot.retainedValueCost > configuration.maxRetainedValueCost {
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
                removeSnapshotLocked(snapshot.stateID, reason: .retentionLimit)
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

    private func makeTokenLocked(
        snapshot: AOSAXStoredSnapshot<Handle>,
        nextPosition: Int,
        pageSize: Int
    ) throws -> String {
        while tokens.count >= configuration.maxPageTokens, let oldest = tokenOrder.first {
            removeTokenLocked(oldest, reason: .evicted)
        }
        for _ in 0..<configuration.identityAttempts {
            let identity = tokenFactory()
            guard Self.validIdentity(identity.lookupID),
                  identity.publicToken.hasPrefix(identity.lookupID + "."),
                  identity.publicToken.count > identity.lookupID.count + 1,
                  tokens[identity.lookupID] == nil,
                  tokenTombstones[identity.lookupID] == nil else {
                continue
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

    private func removeTokenLocked(_ lookupID: String, reason: AOSAXTombstoneReason) {
        guard tokens.removeValue(forKey: lookupID) != nil else { return }
        tokenOrder.removeAll { $0 == lookupID }
        addTokenTombstoneLocked(lookupID, reason: reason)
    }

    private func addSnapshotTombstoneLocked(_ stateID: String, reason: AOSAXTombstoneReason) {
        if snapshotTombstones[stateID] == nil { snapshotTombstoneOrder.append(stateID) }
        snapshotTombstones[stateID] = reason
        while snapshotTombstoneOrder.count > configuration.maxTombstones {
            snapshotTombstones.removeValue(forKey: snapshotTombstoneOrder.removeFirst())
        }
    }

    private func addTokenTombstoneLocked(_ lookupID: String, reason: AOSAXTombstoneReason) {
        if tokenTombstones[lookupID] == nil { tokenTombstoneOrder.append(lookupID) }
        tokenTombstones[lookupID] = reason
        while tokenTombstoneOrder.count > configuration.maxTombstones {
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
        guard publicToken.utf8.count <= 512,
              let separator = publicToken.firstIndex(of: ".") else { return nil }
        let lookupID = String(publicToken[..<separator])
        return validIdentity(lookupID) ? lookupID : nil
    }
}

private extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
