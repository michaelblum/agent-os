import Foundation

public enum AOSAXObservationError: Error, Equatable, Sendable {
    case invalidBounds
    case invalidRetention
    case invalidRoot
    case identityExhausted
    case stateCollision
    case digestEncodingFailed
}

public struct AOSAXPlatformError: Codable, Equatable, Sendable {
    public let code: String
    public let detail: String

    public init(code: String, detail: String) {
        self.code = code
        self.detail = detail
    }
}

public enum AOSAXPlatformResult<Value: Sendable>: Sendable {
    case value(Value)
    case unsupported(AOSAXPlatformError)
    case unavailable(AOSAXPlatformError)
    case platformError(AOSAXPlatformError)
}

public struct AOSAXProcessGeneration: Codable, Hashable, Sendable {
    public let pid: Int32
    public let startTimeSeconds: UInt64
    public let startTimeMicroseconds: UInt32

    public init(pid: Int32, startTimeSeconds: UInt64, startTimeMicroseconds: UInt32) {
        self.pid = pid
        self.startTimeSeconds = startTimeSeconds
        self.startTimeMicroseconds = startTimeMicroseconds
    }
}

public enum AOSAXGenerationObservation: Sendable {
    case value(AOSAXProcessGeneration)
    case unavailable(AOSAXPlatformError)
}

public protocol AOSAXProcessGenerationObserving: Sendable {
    func observeGeneration(pid: Int32) -> AOSAXGenerationObservation
}

public struct AOSAXElementFacts: Codable, Equatable, Sendable {
    public let role: String?
    public let subrole: String?
    public let identifier: String?
    public let title: String?
    public let frame: AOSAXRect?
    public let enabled: Bool?
    public let focused: Bool?
    public let selected: Bool?

    public init(
        role: String? = nil,
        subrole: String? = nil,
        identifier: String? = nil,
        title: String? = nil,
        frame: AOSAXRect? = nil,
        enabled: Bool? = nil,
        focused: Bool? = nil,
        selected: Bool? = nil
    ) {
        self.role = role
        self.subrole = subrole
        self.identifier = identifier
        self.title = title
        self.frame = frame
        self.enabled = enabled
        self.focused = focused
        self.selected = selected
    }
}

public struct AOSAXPlatformRelationship<Handle: Hashable & Sendable>: Sendable {
    public let name: String
    public let elements: [Handle]

    public init(name: String, elements: [Handle]) {
        self.name = name
        self.elements = elements
    }
}

public enum AOSAXPlatformSettableResult: Sendable {
    case value(Bool)
    case unsupported
    case platformError(AOSAXPlatformError)
}

public protocol AOSAXPlatformProvider: Sendable {
    associatedtype Handle: Hashable & Sendable

    func systemWideRoot(deadlineNanoseconds: UInt64) -> AOSAXPlatformResult<Handle>
    func applicationRoot(
        generation: AOSAXProcessGeneration,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<Handle>
    func windowRoot(
        generation: AOSAXProcessGeneration,
        windowID: UInt64,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<Handle>
    func facts(for handle: Handle, deadlineNanoseconds: UInt64) -> AOSAXPlatformResult<AOSAXElementFacts>
    func relationships(
        for handle: Handle,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<[AOSAXPlatformRelationship<Handle>]>
    func attributeNames(for handle: Handle, deadlineNanoseconds: UInt64) -> AOSAXPlatformResult<[String]>
    func attribute(
        _ name: String,
        for handle: Handle,
        deadlineNanoseconds: UInt64
    ) -> AOSAXAttributeRead<Handle>
    func parameterizedAttributeNames(
        for handle: Handle,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<[String]>
    func isAttributeSettable(
        _ name: String,
        for handle: Handle,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformSettableResult
    func supportedActionNames(
        for handle: Handle,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<[String]>
    func retain(handle: Handle)
    func release(handle: Handle)
}

public enum AOSAXRootKind: String, Codable, Sendable {
    case systemWide = "system_wide"
    case application
    case window
    case element
    case displayComposite = "display_composite"
}

public enum AOSAXObservationRoot: Codable, Equatable, Sendable {
    case systemWide
    case application(AOSAXProcessGeneration)
    case window(generation: AOSAXProcessGeneration, windowID: UInt64)
    case element(stateID: String, ref: String)
    case displayComposite(topologyIdentity: String, applications: [AOSAXProcessGeneration])

    private enum CodingKeys: String, CodingKey {
        case kind
        case generation
        case windowID = "window_id"
        case stateID = "state_id"
        case ref
        case topologyIdentity = "topology_identity"
        case applications
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .systemWide:
            try container.encode(AOSAXRootKind.systemWide, forKey: .kind)
        case .application(let generation):
            try container.encode(AOSAXRootKind.application, forKey: .kind)
            try container.encode(generation, forKey: .generation)
        case .window(let generation, let windowID):
            try container.encode(AOSAXRootKind.window, forKey: .kind)
            try container.encode(generation, forKey: .generation)
            try container.encode(windowID, forKey: .windowID)
        case .element(let stateID, let ref):
            try container.encode(AOSAXRootKind.element, forKey: .kind)
            try container.encode(stateID, forKey: .stateID)
            try container.encode(ref, forKey: .ref)
        case .displayComposite(let topologyIdentity, let applications):
            try container.encode(AOSAXRootKind.displayComposite, forKey: .kind)
            try container.encode(topologyIdentity, forKey: .topologyIdentity)
            try container.encode(applications, forKey: .applications)
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(AOSAXRootKind.self, forKey: .kind) {
        case .systemWide:
            self = .systemWide
        case .application:
            self = .application(try container.decode(AOSAXProcessGeneration.self, forKey: .generation))
        case .window:
            self = .window(
                generation: try container.decode(AOSAXProcessGeneration.self, forKey: .generation),
                windowID: try container.decode(UInt64.self, forKey: .windowID)
            )
        case .element:
            self = .element(
                stateID: try container.decode(String.self, forKey: .stateID),
                ref: try container.decode(String.self, forKey: .ref)
            )
        case .displayComposite:
            self = .displayComposite(
                topologyIdentity: try container.decode(String.self, forKey: .topologyIdentity),
                applications: try container.decode([AOSAXProcessGeneration].self, forKey: .applications)
            )
        }
    }
}

public struct AOSAXRootIdentity: Codable, Equatable, Sendable {
    public let kind: AOSAXRootKind
    public let generation: AOSAXProcessGeneration?
    public let windowID: UInt64?
    public let sourceStateID: String?
    public let sourceRef: String?
    public let topologyIdentity: String?
    public let constituentCount: Int?

    public init(
        kind: AOSAXRootKind,
        generation: AOSAXProcessGeneration? = nil,
        windowID: UInt64? = nil,
        sourceStateID: String? = nil,
        sourceRef: String? = nil,
        topologyIdentity: String? = nil,
        constituentCount: Int? = nil
    ) {
        self.kind = kind
        self.generation = generation
        self.windowID = windowID
        self.sourceStateID = sourceStateID
        self.sourceRef = sourceRef
        self.topologyIdentity = topologyIdentity
        self.constituentCount = constituentCount
    }
}

public struct AOSAXObservationBounds: Codable, Equatable, Sendable {
    public let maxDepth: Int
    public let maxVisited: Int
    public let maxEmitted: Int
    public let deadlineNanoseconds: UInt64
    public let maxArrayDepth: Int
    public let maxArrayItems: Int
    public let maxValueCost: Int

    public init(
        maxDepth: Int,
        maxVisited: Int,
        maxEmitted: Int,
        deadlineNanoseconds: UInt64,
        maxArrayDepth: Int,
        maxArrayItems: Int,
        maxValueCost: Int
    ) throws {
        guard maxDepth > 0,
              maxVisited > 0,
              maxEmitted > 0,
              deadlineNanoseconds > 0,
              maxArrayDepth > 0,
              maxArrayItems > 0,
              maxValueCost > 0 else {
            throw AOSAXObservationError.invalidBounds
        }
        self.maxDepth = maxDepth
        self.maxVisited = maxVisited
        self.maxEmitted = maxEmitted
        self.deadlineNanoseconds = deadlineNanoseconds
        self.maxArrayDepth = maxArrayDepth
        self.maxArrayItems = maxArrayItems
        self.maxValueCost = maxValueCost
    }
}

public struct AOSAXProjectionSelection: Codable, Equatable, Sendable {
    public let attributes: Bool
    public let parameterizedAttributeNames: Bool
    public let settableFacts: Bool
    public let supportedActionNames: Bool
    public let relationshipNames: Bool

    public init(
        attributes: Bool = true,
        parameterizedAttributeNames: Bool = true,
        settableFacts: Bool = true,
        supportedActionNames: Bool = true,
        relationshipNames: Bool = true
    ) {
        self.attributes = attributes
        self.parameterizedAttributeNames = parameterizedAttributeNames
        self.settableFacts = settableFacts
        self.supportedActionNames = supportedActionNames
        self.relationshipNames = relationshipNames
    }
}

public struct AOSAXGeometryFilter: Codable, Equatable, Sendable {
    public let intersects: AOSAXRect

    public init(intersects: AOSAXRect) {
        self.intersects = intersects
    }

    fileprivate func matches(_ frame: AOSAXRect?) -> Bool {
        guard let frame else { return false }
        return frame.x < intersects.x + intersects.width &&
            frame.x + frame.width > intersects.x &&
            frame.y < intersects.y + intersects.height &&
            frame.y + frame.height > intersects.y
    }
}

public struct AOSAXAttributeOutcomeFilter: Codable, Equatable, Sendable {
    public let name: String
    public let outcome: AOSAXAttributeOutcomeKind

    public init(name: String, outcome: AOSAXAttributeOutcomeKind) {
        self.name = name
        self.outcome = outcome
    }
}

public struct AOSAXObservationFilter: Codable, Equatable, Sendable {
    public let role: String?
    public let subrole: String?
    public let identifier: String?
    public let title: String?
    public let geometry: AOSAXGeometryFilter?
    public let enabled: Bool?
    public let focused: Bool?
    public let selected: Bool?
    public let rawAttributeOutcomes: [AOSAXAttributeOutcomeFilter]
    public let relationshipMembership: String?

    public init(
        role: String? = nil,
        subrole: String? = nil,
        identifier: String? = nil,
        title: String? = nil,
        geometry: AOSAXGeometryFilter? = nil,
        enabled: Bool? = nil,
        focused: Bool? = nil,
        selected: Bool? = nil,
        rawAttributeOutcomes: [AOSAXAttributeOutcomeFilter] = [],
        relationshipMembership: String? = nil
    ) {
        self.role = role
        self.subrole = subrole
        self.identifier = identifier
        self.title = title
        self.geometry = geometry
        self.enabled = enabled
        self.focused = focused
        self.selected = selected
        self.rawAttributeOutcomes = rawAttributeOutcomes
        self.relationshipMembership = relationshipMembership
    }

    fileprivate func matches(
        facts: AOSAXElementFacts,
        attributes: [AOSAXAttributeProjection],
        incomingRelationship: String?
    ) -> Bool {
        if let role, facts.role != role { return false }
        if let subrole, facts.subrole != subrole { return false }
        if let identifier, facts.identifier != identifier { return false }
        if let title, facts.title != title { return false }
        if let geometry, !geometry.matches(facts.frame) { return false }
        if let enabled, facts.enabled != enabled { return false }
        if let focused, facts.focused != focused { return false }
        if let selected, facts.selected != selected { return false }
        if let relationshipMembership, incomingRelationship != relationshipMembership { return false }
        for expected in rawAttributeOutcomes {
            guard attributes.contains(where: { $0.name == expected.name && $0.outcome == expected.outcome }) else {
                return false
            }
        }
        return true
    }
}

public struct AOSAXObservationRequest: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let kind: String
    public let root: AOSAXObservationRoot
    public let bounds: AOSAXObservationBounds
    public let filters: [AOSAXObservationFilter]
    public let projection: AOSAXProjectionSelection
    public let pageSize: Int

    public init(
        root: AOSAXObservationRoot,
        bounds: AOSAXObservationBounds,
        filters: [AOSAXObservationFilter] = [],
        projection: AOSAXProjectionSelection = .init(),
        pageSize: Int
    ) throws {
        guard pageSize > 0 else { throw AOSAXObservationError.invalidBounds }
        if case .displayComposite(let identity, let applications) = root {
            guard !identity.isEmpty, !applications.isEmpty else { throw AOSAXObservationError.invalidRoot }
        }
        self.schemaVersion = "aos.ax-observation.v1"
        self.kind = "request"
        self.root = root
        self.bounds = bounds
        self.filters = filters
        self.projection = projection
        self.pageSize = pageSize
    }
}

public enum AOSAXObservationOutcome: String, Codable, Sendable {
    case complete
    case truncated
    case unsupported
    case unavailable
}

public enum AOSAXStopKind: String, Codable, Sendable {
    case complete
    case depthBound = "depth_bound"
    case visitedBound = "visited_bound"
    case emittedBound = "emitted_bound"
    case deadline
    case valueCostBound = "value_cost_bound"
    case platformUnsupported = "platform_unsupported"
    case platformUnavailable = "platform_unavailable"
    case platformError = "platform_error"
    case generationMismatch = "generation_mismatch"
    case sourceSnapshotExpired = "source_snapshot_expired"
    case sourceSnapshotEvicted = "source_snapshot_evicted"
    case sourceRefMissing = "source_ref_missing"
    case retentionLimit = "retention_limit"
}

public struct AOSAXStopCondition: Codable, Equatable, Sendable {
    public let kind: AOSAXStopKind
    public let detail: String

    public init(kind: AOSAXStopKind, detail: String) {
        self.kind = kind
        self.detail = detail
    }
}

public enum AOSAXFrontierReason: String, Codable, Sendable {
    case depthBound = "depth_bound"
    case visitedBound = "visited_bound"
    case emittedBound = "emitted_bound"
    case deadline
    case valueCostBound = "value_cost_bound"
    case platformError = "platform_error"
    case generationMismatch = "generation_mismatch"
}

public struct AOSAXFrontierEntry: Codable, Equatable, Sendable {
    public let parentRef: String?
    public let relationshipName: String?
    public let childPosition: Int?
    public let depth: Int
    public let ref: String?
    public let constituentID: String?
    public let reason: AOSAXFrontierReason

    public init(
        parentRef: String?,
        relationshipName: String?,
        childPosition: Int?,
        depth: Int,
        ref: String?,
        constituentID: String?,
        reason: AOSAXFrontierReason
    ) {
        self.parentRef = parentRef
        self.relationshipName = relationshipName
        self.childPosition = childPosition
        self.depth = depth
        self.ref = ref
        self.constituentID = constituentID
        self.reason = reason
    }
}

public enum AOSAXReferenceEdgeKind: String, Codable, Sendable {
    case cycle
    case duplicate
}

public struct AOSAXReferenceEdge: Codable, Equatable, Sendable {
    public let relationshipName: String
    public let childPosition: Int
    public let ref: String
    public let kind: AOSAXReferenceEdgeKind

    public init(relationshipName: String, childPosition: Int, ref: String, kind: AOSAXReferenceEdgeKind) {
        self.relationshipName = relationshipName
        self.childPosition = childPosition
        self.ref = ref
        self.kind = kind
    }
}

public struct AOSAXNodeProjection: Codable, Equatable, Sendable {
    public let ref: String
    public let parentRef: String?
    public let incomingRelationship: String?
    public let childPosition: Int?
    public let depth: Int
    public let constituentID: String?
    public let facts: AOSAXElementFacts
    public let attributes: [AOSAXAttributeProjection]
    public let parameterizedAttributeNames: [String]
    public let settableFacts: [AOSAXSettableFact]
    public let supportedActionNames: [String]
    public let relationshipNames: [String]
    public let referenceEdges: [AOSAXReferenceEdge]

    public init(
        ref: String,
        parentRef: String?,
        incomingRelationship: String?,
        childPosition: Int?,
        depth: Int,
        constituentID: String?,
        facts: AOSAXElementFacts,
        attributes: [AOSAXAttributeProjection],
        parameterizedAttributeNames: [String],
        settableFacts: [AOSAXSettableFact],
        supportedActionNames: [String],
        relationshipNames: [String],
        referenceEdges: [AOSAXReferenceEdge]
    ) {
        self.ref = ref
        self.parentRef = parentRef
        self.incomingRelationship = incomingRelationship
        self.childPosition = childPosition
        self.depth = depth
        self.constituentID = constituentID
        self.facts = facts
        self.attributes = attributes
        self.parameterizedAttributeNames = parameterizedAttributeNames
        self.settableFacts = settableFacts
        self.supportedActionNames = supportedActionNames
        self.relationshipNames = relationshipNames
        self.referenceEdges = referenceEdges
    }
}

public struct AOSAXTraversalAccounting: Codable, Equatable, Sendable {
    public let visited: Int
    public let matched: Int
    public let emitted: Int
    public let cycleEdges: Int
    public let duplicateEdges: Int
    public let elapsedNanoseconds: UInt64
    public let retainedValueCost: Int

    public init(
        visited: Int,
        matched: Int,
        emitted: Int,
        cycleEdges: Int,
        duplicateEdges: Int,
        elapsedNanoseconds: UInt64,
        retainedValueCost: Int
    ) {
        self.visited = visited
        self.matched = matched
        self.emitted = emitted
        self.cycleEdges = cycleEdges
        self.duplicateEdges = duplicateEdges
        self.elapsedNanoseconds = elapsedNanoseconds
        self.retainedValueCost = retainedValueCost
    }
}

public struct AOSAXCompositeConstituentResult: Codable, Equatable, Sendable {
    public let id: String
    public let generation: AOSAXProcessGeneration
    public let outcome: AOSAXObservationOutcome
    public let error: AOSAXPlatformError?

    public init(
        id: String,
        generation: AOSAXProcessGeneration,
        outcome: AOSAXObservationOutcome,
        error: AOSAXPlatformError? = nil
    ) {
        self.id = id
        self.generation = generation
        self.outcome = outcome
        self.error = error
    }
}

public struct AOSAXRetentionFacts: Codable, Equatable, Sendable {
    public let snapshotTTLNanoseconds: UInt64
    public let retainedRefCount: Int
    public let retainedValueCost: Int
    public let pageSize: Int

    public init(snapshotTTLNanoseconds: UInt64, retainedRefCount: Int, retainedValueCost: Int, pageSize: Int) {
        self.snapshotTTLNanoseconds = snapshotTTLNanoseconds
        self.retainedRefCount = retainedRefCount
        self.retainedValueCost = retainedValueCost
        self.pageSize = pageSize
    }
}

public struct AOSAXObservationResponse: Codable, Equatable, Sendable {
    public let schemaVersion: String
    public let kind: String
    public let stateID: String
    public let root: AOSAXRootIdentity
    public let requestDigest: String
    public let projectionDigest: String
    public let bounds: AOSAXObservationBounds
    public let filters: [AOSAXObservationFilter]
    public let createdAt: String
    public let expiresAt: String
    public let outcome: AOSAXObservationOutcome
    public let stopCondition: AOSAXStopCondition
    public let accounting: AOSAXTraversalAccounting
    public let frontier: [AOSAXFrontierEntry]
    public let constituents: [AOSAXCompositeConstituentResult]
    public let nodes: [AOSAXNodeProjection]
    public let nextPageToken: String?
    public let nextPosition: Int?
    public let retention: AOSAXRetentionFacts

    public init<Handle: Hashable & Sendable>(
        snapshot: AOSAXStoredSnapshot<Handle>,
        nodes: [AOSAXNodeProjection],
        nextPageToken: String?,
        nextPosition: Int?
    ) {
        self.schemaVersion = "aos.ax-observation.v1"
        self.kind = "observation"
        self.stateID = snapshot.stateID
        self.root = snapshot.root
        self.requestDigest = snapshot.requestDigest
        self.projectionDigest = snapshot.projectionDigest
        self.bounds = snapshot.bounds
        self.filters = snapshot.filters
        self.createdAt = snapshot.createdAt
        self.expiresAt = snapshot.expiresAt
        self.outcome = snapshot.outcome
        self.stopCondition = snapshot.stopCondition
        self.accounting = snapshot.accounting
        self.frontier = snapshot.frontier
        self.constituents = snapshot.constituents
        self.nodes = nodes
        self.nextPageToken = nextPageToken
        self.nextPosition = nextPosition
        self.retention = .init(
            snapshotTTLNanoseconds: snapshot.expiresMonotonicNanoseconds - snapshot.createdMonotonicNanoseconds,
            retainedRefCount: snapshot.handlesByRef.count,
            retainedValueCost: snapshot.retainedValueCost,
            pageSize: snapshot.pageSize
        )
    }

    public static func retentionUnavailable<Handle: Hashable & Sendable>(
        from snapshot: AOSAXStoredSnapshot<Handle>
    ) -> AOSAXObservationResponse {
        AOSAXObservationResponse(
            schemaVersion: "aos.ax-observation.v1",
            kind: "observation",
            stateID: snapshot.stateID,
            root: snapshot.root,
            requestDigest: snapshot.requestDigest,
            projectionDigest: snapshot.projectionDigest,
            bounds: snapshot.bounds,
            filters: snapshot.filters,
            createdAt: snapshot.createdAt,
            expiresAt: snapshot.expiresAt,
            outcome: .unavailable,
            stopCondition: .init(kind: .retentionLimit, detail: "snapshot exceeds finite retention capacity"),
            accounting: snapshot.accounting,
            frontier: snapshot.frontier,
            constituents: snapshot.constituents,
            nodes: [],
            nextPageToken: nil,
            nextPosition: nil,
            retention: .init(
                snapshotTTLNanoseconds: snapshot.expiresMonotonicNanoseconds - snapshot.createdMonotonicNanoseconds,
                retainedRefCount: 0,
                retainedValueCost: 0,
                pageSize: snapshot.pageSize
            )
        )
    }

    private init(
        schemaVersion: String,
        kind: String,
        stateID: String,
        root: AOSAXRootIdentity,
        requestDigest: String,
        projectionDigest: String,
        bounds: AOSAXObservationBounds,
        filters: [AOSAXObservationFilter],
        createdAt: String,
        expiresAt: String,
        outcome: AOSAXObservationOutcome,
        stopCondition: AOSAXStopCondition,
        accounting: AOSAXTraversalAccounting,
        frontier: [AOSAXFrontierEntry],
        constituents: [AOSAXCompositeConstituentResult],
        nodes: [AOSAXNodeProjection],
        nextPageToken: String?,
        nextPosition: Int?,
        retention: AOSAXRetentionFacts
    ) {
        self.schemaVersion = schemaVersion
        self.kind = kind
        self.stateID = stateID
        self.root = root
        self.requestDigest = requestDigest
        self.projectionDigest = projectionDigest
        self.bounds = bounds
        self.filters = filters
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.outcome = outcome
        self.stopCondition = stopCondition
        self.accounting = accounting
        self.frontier = frontier
        self.constituents = constituents
        self.nodes = nodes
        self.nextPageToken = nextPageToken
        self.nextPosition = nextPosition
        self.retention = retention
    }
}

private struct AOSAXQueueEntry<Handle: Hashable & Sendable> {
    let handle: AOSAXRetainedHandle<Handle>
    let ref: String
    let parentRef: String?
    let incomingRelationship: String?
    let childPosition: Int?
    let depth: Int
    let ancestors: Set<Handle>
    let constituentID: String?
}

private struct AOSAXGenerationBinding {
    let generation: AOSAXProcessGeneration
    let constituentID: String?
}

public final class AOSAXObservationEngine<Provider: AOSAXPlatformProvider>: @unchecked Sendable {
    public typealias MonotonicClock = @Sendable () -> UInt64
    public typealias WallClock = @Sendable () -> Date
    public typealias IdentityFactory = @Sendable () -> String

    private let provider: Provider
    private let generationObserver: any AOSAXProcessGenerationObserving
    private let store: AOSAXSnapshotStore<Provider.Handle>
    private let retention: AOSAXRetentionConfiguration
    private let monotonicClock: MonotonicClock
    private let wallClock: WallClock
    private let stateIDFactory: IdentityFactory
    private let refIDFactory: IdentityFactory

    public init(
        provider: Provider,
        generationObserver: any AOSAXProcessGenerationObserving,
        store: AOSAXSnapshotStore<Provider.Handle>,
        retention: AOSAXRetentionConfiguration,
        monotonicClock: @escaping MonotonicClock,
        wallClock: @escaping WallClock,
        stateIDFactory: @escaping IdentityFactory,
        refIDFactory: @escaping IdentityFactory
    ) {
        self.provider = provider
        self.generationObserver = generationObserver
        self.store = store
        self.retention = retention
        self.monotonicClock = monotonicClock
        self.wallClock = wallClock
        self.stateIDFactory = stateIDFactory
        self.refIDFactory = refIDFactory
    }

    public func observe(_ request: AOSAXObservationRequest) throws -> AOSAXObservationResponse {
        let stateID = try store.allocateStateID(factory: stateIDFactory)
        var published = false
        defer {
            if !published { store.abandonStateID(stateID) }
        }

        let start = monotonicClock()
        let deadline = start.addingReportingOverflow(request.bounds.deadlineNanoseconds)
        guard !deadline.overflow else { throw AOSAXObservationError.invalidBounds }
        let expiryMonotonic = start.addingReportingOverflow(retention.snapshotTTLNanoseconds)
        guard !expiryMonotonic.overflow else { throw AOSAXObservationError.invalidRetention }
        let createdDate = wallClock()
        let expiryDate = createdDate.addingTimeInterval(Double(retention.snapshotTTLNanoseconds) / 1_000_000_000)
        let createdAt = Self.iso8601(createdDate)
        let expiresAt = Self.iso8601(expiryDate)
        let requestDigest = try Self.digest(request)
        let projectionDigest = try Self.digest(request.projection)

        var boxesByHandle: [Provider.Handle: AOSAXRetainedHandle<Provider.Handle>] = [:]
        var refsByHandle: [Provider.Handle: String] = [:]
        var refConstituent: [String: String] = [:]
        var queue: [AOSAXQueueEntry<Provider.Handle>] = []
        var generationBindings: [AOSAXGenerationBinding] = []
        var constituents: [AOSAXCompositeConstituentResult] = []
        var forcedOutcome: AOSAXObservationOutcome?
        var stopCondition = AOSAXStopCondition(kind: .complete, detail: "all admitted traversal completed")

        func retainedBox(_ handle: Provider.Handle) -> AOSAXRetainedHandle<Provider.Handle> {
            if let existing = boxesByHandle[handle] { return existing }
            provider.retain(handle: handle)
            let box = AOSAXRetainedHandle(value: handle) { [provider] handle in
                provider.release(handle: handle)
            }
            boxesByHandle[handle] = box
            return box
        }

        func assignedRef(_ handle: Provider.Handle, constituentID: String?) throws -> String {
            if let existing = refsByHandle[handle] { return existing }
            for _ in 0..<retention.identityAttempts {
                let candidate = refIDFactory()
                guard Self.validIdentity(candidate), !refsByHandle.values.contains(candidate) else { continue }
                refsByHandle[handle] = candidate
                if let constituentID { refConstituent[candidate] = constituentID }
                _ = retainedBox(handle)
                return candidate
            }
            throw AOSAXObservationError.identityExhausted
        }

        func enqueueRoot(_ handle: Provider.Handle, constituentID: String?) throws {
            let ref = try assignedRef(handle, constituentID: constituentID)
            queue.append(AOSAXQueueEntry(
                handle: retainedBox(handle),
                ref: ref,
                parentRef: nil,
                incomingRelationship: nil,
                childPosition: nil,
                depth: 0,
                ancestors: [],
                constituentID: constituentID
            ))
        }

        func generationMatches(_ generation: AOSAXProcessGeneration) -> (Bool, AOSAXPlatformError?) {
            switch generationObserver.observeGeneration(pid: generation.pid) {
            case .value(let actual):
                return (actual == generation, actual == generation ? nil : .init(
                    code: "AX_PROCESS_GENERATION_MISMATCH",
                    detail: "observed process generation differs from requested generation"
                ))
            case .unavailable(let error):
                return (false, error)
            }
        }

        func admitGenerationRoot(
            _ generation: AOSAXProcessGeneration,
            constituentID: String?,
            resolve: () -> AOSAXPlatformResult<Provider.Handle>
        ) throws -> AOSAXCompositeConstituentResult? {
            let before = generationMatches(generation)
            guard before.0 else {
                return AOSAXCompositeConstituentResult(
                    id: constituentID ?? "root",
                    generation: generation,
                    outcome: .unavailable,
                    error: before.1
                )
            }
            switch resolve() {
            case .value(let handle):
                try enqueueRoot(handle, constituentID: constituentID)
                generationBindings.append(.init(generation: generation, constituentID: constituentID))
                return nil
            case .unsupported(let error):
                return .init(id: constituentID ?? "root", generation: generation, outcome: .unsupported, error: error)
            case .unavailable(let error), .platformError(let error):
                return .init(id: constituentID ?? "root", generation: generation, outcome: .unavailable, error: error)
            }
        }

        let rootIdentity: AOSAXRootIdentity
        switch request.root {
        case .systemWide:
            rootIdentity = .init(kind: .systemWide)
            switch provider.systemWideRoot(deadlineNanoseconds: deadline.partialValue) {
            case .value(let handle): try enqueueRoot(handle, constituentID: nil)
            case .unsupported(let error):
                forcedOutcome = .unsupported
                stopCondition = .init(kind: .platformUnsupported, detail: error.code)
            case .unavailable(let error), .platformError(let error):
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .platformUnavailable, detail: error.code)
            }
        case .application(let generation):
            rootIdentity = .init(kind: .application, generation: generation)
            if let result = try admitGenerationRoot(generation, constituentID: nil, resolve: {
                provider.applicationRoot(generation: generation, deadlineNanoseconds: deadline.partialValue)
            }) {
                forcedOutcome = result.outcome
                stopCondition = .init(
                    kind: result.outcome == .unsupported ? .platformUnsupported : .generationMismatch,
                    detail: result.error?.code ?? "AX_ROOT_UNAVAILABLE"
                )
            }
        case .window(let generation, let windowID):
            rootIdentity = .init(kind: .window, generation: generation, windowID: windowID)
            if let result = try admitGenerationRoot(generation, constituentID: nil, resolve: {
                provider.windowRoot(
                    generation: generation,
                    windowID: windowID,
                    deadlineNanoseconds: deadline.partialValue
                )
            }) {
                forcedOutcome = result.outcome
                stopCondition = .init(
                    kind: result.outcome == .unsupported ? .platformUnsupported : .generationMismatch,
                    detail: result.error?.code ?? "AX_ROOT_UNAVAILABLE"
                )
            }
        case .element(let sourceStateID, let sourceRef):
            rootIdentity = .init(kind: .element, sourceStateID: sourceStateID, sourceRef: sourceRef)
            switch store.resolveElement(stateID: sourceStateID, ref: sourceRef) {
            case .value(let handle):
                boxesByHandle[handle.value] = handle
                try enqueueRoot(handle.value, constituentID: nil)
            case .expired:
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .sourceSnapshotExpired, detail: "source snapshot expired")
            case .evicted:
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .sourceSnapshotEvicted, detail: "source snapshot was evicted")
            case .missing, .incompatible:
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .sourceRefMissing, detail: "source observation ref is missing or incompatible")
            }
        case .displayComposite(let topologyIdentity, let applications):
            rootIdentity = .init(
                kind: .displayComposite,
                topologyIdentity: topologyIdentity,
                constituentCount: applications.count
            )
            for (index, generation) in applications.enumerated() {
                let constituentID = "application-\(index)-pid-\(generation.pid)"
                if let result = try admitGenerationRoot(generation, constituentID: constituentID, resolve: {
                    provider.applicationRoot(generation: generation, deadlineNanoseconds: deadline.partialValue)
                }) {
                    constituents.append(result)
                } else {
                    constituents.append(.init(id: constituentID, generation: generation, outcome: .complete))
                }
            }
            if queue.isEmpty {
                forcedOutcome = constituents.contains(where: { $0.outcome == .unavailable }) ? .unavailable : .unsupported
                stopCondition = .init(kind: .platformUnavailable, detail: "no composite constituent root was available")
            }
        }

        var visited = 0
        var matched = 0
        var emitted = 0
        var cycleEdges = 0
        var duplicateEdges = 0
        var valueCost = 0
        var nodes: [AOSAXNodeProjection] = []
        var frontier: [AOSAXFrontierEntry] = []
        var queueIndex = 0
        var traversalStopped = forcedOutcome != nil

        func appendRemainingFrontier(reason: AOSAXFrontierReason) {
            guard queueIndex < queue.count else { return }
            for entry in queue[queueIndex...] {
                frontier.append(.init(
                    parentRef: entry.parentRef,
                    relationshipName: entry.incomingRelationship,
                    childPosition: entry.childPosition,
                    depth: entry.depth,
                    ref: entry.ref,
                    constituentID: entry.constituentID,
                    reason: reason
                ))
            }
        }

        while !traversalStopped, queueIndex < queue.count {
            if visited >= request.bounds.maxVisited {
                stopCondition = .init(kind: .visitedBound, detail: "visited-node breadth bound reached")
                appendRemainingFrontier(reason: .visitedBound)
                break
            }
            if monotonicClock() >= deadline.partialValue {
                stopCondition = .init(kind: .deadline, detail: "monotonic observation deadline reached")
                appendRemainingFrontier(reason: .deadline)
                break
            }

            let entry = queue[queueIndex]
            queueIndex += 1
            visited += 1
            let factsResult = provider.facts(
                for: entry.handle.value,
                deadlineNanoseconds: deadline.partialValue
            )
            let facts: AOSAXElementFacts
            switch factsResult {
            case .value(let value):
                facts = value
            case .unsupported(let error), .unavailable(let error), .platformError(let error):
                stopCondition = .init(kind: .platformError, detail: error.code)
                frontier.append(.init(
                    parentRef: entry.parentRef,
                    relationshipName: entry.incomingRelationship,
                    childPosition: entry.childPosition,
                    depth: entry.depth,
                    ref: entry.ref,
                    constituentID: entry.constituentID,
                    reason: .platformError
                ))
                traversalStopped = true
                continue
            }

            var attributes: [AOSAXAttributeProjection] = []
            var settableFacts: [AOSAXSettableFact] = []
            var valueBoundHit = false
            let attributeNames: [String]
            switch provider.attributeNames(for: entry.handle.value, deadlineNanoseconds: deadline.partialValue) {
            case .value(let names): attributeNames = names.sorted(by: AOSAXValueCodec<Provider.Handle>.unicodeScalarLess)
            case .unsupported: attributeNames = []
            case .unavailable(let error), .platformError(let error):
                attributeNames = []
                stopCondition = .init(kind: .platformError, detail: error.code)
                frontier.append(.init(
                    parentRef: entry.ref,
                    relationshipName: "attributes",
                    childPosition: nil,
                    depth: entry.depth,
                    ref: entry.ref,
                    constituentID: entry.constituentID,
                    reason: .platformError
                ))
            }

            let codec = AOSAXValueCodec<Provider.Handle>(
                bounds: try AOSAXValueCodecBounds(
                    maxArrayDepth: request.bounds.maxArrayDepth,
                    maxArrayItems: request.bounds.maxArrayItems,
                    maxAggregateCost: request.bounds.maxValueCost
                ),
                resolveElementRef: { handle in
                    try assignedRef(handle, constituentID: entry.constituentID)
                }
            )
            if !request.projection.attributes {
                attributes = []
            } else {
                for name in attributeNames {
                    if monotonicClock() >= deadline.partialValue {
                        attributes.append(.init(name: name, outcome: .deadlineExceeded, detail: "monotonic deadline"))
                        continue
                    }
                    switch provider.attribute(name, for: entry.handle.value, deadlineNanoseconds: deadline.partialValue) {
                    case .noValue:
                        attributes.append(.init(name: name, outcome: .noValue))
                    case .unsupported:
                        attributes.append(.init(name: name, outcome: .unsupported))
                    case .platformError(let error):
                        attributes.append(.init(name: name, outcome: .platformError, error: error))
                    case .value(let platformValue):
                        let encoded = try codec.encode(platformValue, consumed: valueCost)
                        if let value = encoded.value {
                            valueCost += encoded.cost
                            attributes.append(.init(name: name, outcome: .value, value: value))
                        } else {
                            let outcome: AOSAXAttributeOutcomeKind
                            let detail: String
                            switch encoded.limit {
                            case .recursion:
                                outcome = .recursionBound
                                detail = "recursive array/dictionary depth bound"
                            case .arrayItems:
                                outcome = .arrayBound
                                detail = "array/dictionary item bound"
                            case .aggregateCost:
                                outcome = .unrepresentableType
                                detail = "aggregate representable-value cost bound"
                                valueBoundHit = true
                            case .unrepresentable, nil:
                                outcome = .unrepresentableType
                                detail = "platform value has no closed representation"
                            }
                            attributes.append(.init(name: name, outcome: outcome, detail: detail))
                        }
                    }
                }
            }

            if request.projection.settableFacts {
                for name in attributeNames {
                    if monotonicClock() >= deadline.partialValue {
                        settableFacts.append(.init(name: name, outcome: .deadlineExceeded))
                        continue
                    }
                    switch provider.isAttributeSettable(
                        name,
                        for: entry.handle.value,
                        deadlineNanoseconds: deadline.partialValue
                    ) {
                    case .value(true): settableFacts.append(.init(name: name, outcome: .settable))
                    case .value(false): settableFacts.append(.init(name: name, outcome: .notSettable))
                    case .unsupported: settableFacts.append(.init(name: name, outcome: .unsupported))
                    case .platformError(let error):
                        settableFacts.append(.init(name: name, outcome: .platformError, error: error))
                    }
                }
            }

            let parameterizedNames = request.projection.parameterizedAttributeNames
                ? names(from: provider.parameterizedAttributeNames(
                    for: entry.handle.value,
                    deadlineNanoseconds: deadline.partialValue
                ))
                : []
            let actionNames = request.projection.supportedActionNames
                ? names(from: provider.supportedActionNames(
                    for: entry.handle.value,
                    deadlineNanoseconds: deadline.partialValue
                ))
                : []

            var relationships: [AOSAXPlatformRelationship<Provider.Handle>] = []
            switch provider.relationships(for: entry.handle.value, deadlineNanoseconds: deadline.partialValue) {
            case .value(let value):
                relationships = value.sorted { AOSAXValueCodec<Provider.Handle>.unicodeScalarLess($0.name, $1.name) }
            case .unsupported:
                relationships = []
            case .unavailable(let error), .platformError(let error):
                stopCondition = .init(kind: .platformError, detail: error.code)
                frontier.append(.init(
                    parentRef: entry.ref,
                    relationshipName: nil,
                    childPosition: nil,
                    depth: entry.depth + 1,
                    ref: nil,
                    constituentID: entry.constituentID,
                    reason: .platformError
                ))
            }

            var referenceEdges: [AOSAXReferenceEdge] = []
            for relationship in relationships {
                for (position, child) in relationship.elements.enumerated() {
                    let childRef = try assignedRef(child, constituentID: entry.constituentID)
                    if child == entry.handle.value || entry.ancestors.contains(child) {
                        cycleEdges += 1
                        referenceEdges.append(.init(
                            relationshipName: relationship.name,
                            childPosition: position,
                            ref: childRef,
                            kind: .cycle
                        ))
                        continue
                    }
                    if let existing = refsByHandle[child], queue.contains(where: { $0.ref == existing }) ||
                        nodes.contains(where: { $0.ref == existing }) {
                        duplicateEdges += 1
                        referenceEdges.append(.init(
                            relationshipName: relationship.name,
                            childPosition: position,
                            ref: childRef,
                            kind: .duplicate
                        ))
                        continue
                    }
                    if entry.depth >= request.bounds.maxDepth {
                        frontier.append(.init(
                            parentRef: entry.ref,
                            relationshipName: relationship.name,
                            childPosition: position,
                            depth: entry.depth + 1,
                            ref: childRef,
                            constituentID: entry.constituentID,
                            reason: .depthBound
                        ))
                        if stopCondition.kind == .complete {
                            stopCondition = .init(kind: .depthBound, detail: "maximum traversal depth reached")
                        }
                        continue
                    }
                    var ancestors = entry.ancestors
                    ancestors.insert(entry.handle.value)
                    queue.append(.init(
                        handle: retainedBox(child),
                        ref: childRef,
                        parentRef: entry.ref,
                        incomingRelationship: relationship.name,
                        childPosition: position,
                        depth: entry.depth + 1,
                        ancestors: ancestors,
                        constituentID: entry.constituentID
                    ))
                }
            }

            let matches = request.filters.allSatisfy {
                $0.matches(facts: facts, attributes: attributes, incomingRelationship: entry.incomingRelationship)
            }
            if matches {
                matched += 1
                if emitted >= request.bounds.maxEmitted {
                    frontier.append(.init(
                        parentRef: entry.parentRef,
                        relationshipName: entry.incomingRelationship,
                        childPosition: entry.childPosition,
                        depth: entry.depth,
                        ref: entry.ref,
                        constituentID: entry.constituentID,
                        reason: .emittedBound
                    ))
                    stopCondition = .init(kind: .emittedBound, detail: "emitted-node bound reached")
                    appendRemainingFrontier(reason: .emittedBound)
                    traversalStopped = true
                } else {
                    emitted += 1
                    nodes.append(.init(
                        ref: entry.ref,
                        parentRef: entry.parentRef,
                        incomingRelationship: entry.incomingRelationship,
                        childPosition: entry.childPosition,
                        depth: entry.depth,
                        constituentID: entry.constituentID,
                        facts: facts,
                        attributes: attributes,
                        parameterizedAttributeNames: parameterizedNames,
                        settableFacts: settableFacts,
                        supportedActionNames: actionNames,
                        relationshipNames: request.projection.relationshipNames ? relationships.map(\.name) : [],
                        referenceEdges: referenceEdges
                    ))
                }
            }

            if valueBoundHit {
                stopCondition = .init(kind: .valueCostBound, detail: "aggregate representable-value cost bound reached")
                appendRemainingFrontier(reason: .valueCostBound)
                traversalStopped = true
            }
        }

        if !traversalStopped, queueIndex < queue.count {
            appendRemainingFrontier(reason: .visitedBound)
        }

        var mismatchedConstituents = Set<String?>()
        for binding in generationBindings {
            let after = generationMatches(binding.generation)
            if !after.0 {
                mismatchedConstituents.insert(binding.constituentID)
                stopCondition = .init(
                    kind: .generationMismatch,
                    detail: after.1?.code ?? "AX_PROCESS_GENERATION_MISMATCH"
                )
            }
        }
        if !mismatchedConstituents.isEmpty {
            forcedOutcome = .unavailable
            nodes.removeAll { mismatchedConstituents.contains($0.constituentID) }
            frontier.removeAll { mismatchedConstituents.contains($0.constituentID) }
            for constituentID in mismatchedConstituents {
                frontier.append(.init(
                    parentRef: nil,
                    relationshipName: nil,
                    childPosition: nil,
                    depth: 0,
                    ref: nil,
                    constituentID: constituentID,
                    reason: .generationMismatch
                ))
            }
            constituents = constituents.map { item in
                guard mismatchedConstituents.contains(item.id) else { return item }
                return .init(
                    id: item.id,
                    generation: item.generation,
                    outcome: .unavailable,
                    error: .init(code: "AX_PROCESS_GENERATION_MISMATCH", detail: "generation changed before snapshot commit")
                )
            }
        }

        if case .displayComposite = request.root, mismatchedConstituents.isEmpty {
            if constituents.contains(where: { $0.outcome == .unavailable }) {
                forcedOutcome = .unavailable
                if stopCondition.kind == .complete {
                    stopCondition = .init(
                        kind: .platformUnavailable,
                        detail: "one or more display-composite constituents were unavailable"
                    )
                }
            } else if constituents.contains(where: { $0.outcome == .unsupported }) {
                forcedOutcome = .unsupported
                if stopCondition.kind == .complete {
                    stopCondition = .init(
                        kind: .platformUnsupported,
                        detail: "one or more display-composite constituents were unsupported"
                    )
                }
            }
        }

        let outcome: AOSAXObservationOutcome
        if let forcedOutcome {
            outcome = forcedOutcome
        } else if !frontier.isEmpty || stopCondition.kind != .complete {
            outcome = .truncated
        } else {
            outcome = .complete
        }
        if !constituents.isEmpty, outcome == .truncated {
            constituents = constituents.map { item in
                item.outcome == .complete
                    ? .init(id: item.id, generation: item.generation, outcome: .truncated, error: item.error)
                    : item
            }
        }
        let finished = monotonicClock()
        let elapsed = finished >= start ? finished - start : 0
        let accounting = AOSAXTraversalAccounting(
            visited: visited,
            matched: matched,
            emitted: nodes.count,
            cycleEdges: cycleEdges,
            duplicateEdges: duplicateEdges,
            elapsedNanoseconds: elapsed,
            retainedValueCost: valueCost
        )
        var retainedRefs: [String: AOSAXRetainedHandle<Provider.Handle>] = [:]
        if !mismatchedConstituents.contains(nil) {
            for (handle, ref) in refsByHandle {
                if let constituent = refConstituent[ref], mismatchedConstituents.contains(constituent) {
                    continue
                }
                if let box = boxesByHandle[handle] { retainedRefs[ref] = box }
            }
        }
        let snapshot = AOSAXStoredSnapshot<Provider.Handle>(
            stateID: stateID,
            requestDigest: requestDigest,
            projectionDigest: projectionDigest,
            root: rootIdentity,
            bounds: request.bounds,
            filters: request.filters,
            pageSize: request.pageSize,
            createdAt: createdAt,
            expiresAt: expiresAt,
            createdMonotonicNanoseconds: start,
            expiresMonotonicNanoseconds: expiryMonotonic.partialValue,
            outcome: outcome,
            stopCondition: stopCondition,
            accounting: accounting,
            frontier: frontier,
            constituents: constituents,
            nodes: nodes,
            handlesByRef: retainedRefs,
            retainedValueCost: valueCost
        )
        let response = try store.publish(snapshot, pageSize: request.pageSize)
        published = true
        return response
    }

    public func page(
        token: String,
        expectedStateID: String,
        requestDigest: String,
        projectionDigest: String,
        pageSize: Int
    ) -> AOSAXPageResponse {
        store.page(
            token: token,
            expectedStateID: expectedStateID,
            requestDigest: requestDigest,
            projectionDigest: projectionDigest,
            pageSize: pageSize
        )
    }

    public func page(_ request: AOSAXPageRequest) -> AOSAXPageResponse {
        page(
            token: request.token,
            expectedStateID: request.expectedStateID,
            requestDigest: request.requestDigest,
            projectionDigest: request.projectionDigest,
            pageSize: request.pageSize
        )
    }

    private func names(from result: AOSAXPlatformResult<[String]>) -> [String] {
        guard case .value(let names) = result else { return [] }
        return names.sorted(by: AOSAXValueCodec<Provider.Handle>.unicodeScalarLess)
    }

    private static func digest<Value: Encodable>(_ value: Value) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value) else { throw AOSAXObservationError.digestEncodingFailed }
        return AOSAXSHA256.hex(data)
    }

    private static func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
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
}

public enum AOSAXObservationJSON {
    public static func encode<Value: Encodable>(_ value: Value) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return try encoder.encode(value)
    }
}

private enum AOSAXSHA256 {
    private static let initial: [UInt32] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]
    private static let constants: [UInt32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]

    static func hex(_ data: Data) -> String {
        var message = [UInt8](data)
        let bitLength = UInt64(message.count) * 8
        message.append(0x80)
        while message.count % 64 != 56 { message.append(0) }
        message.append(contentsOf: withUnsafeBytes(of: bitLength.bigEndian, Array.init))
        var hash = initial
        for offset in stride(from: 0, to: message.count, by: 64) {
            var words = [UInt32](repeating: 0, count: 64)
            for index in 0..<16 {
                let base = offset + index * 4
                words[index] = UInt32(message[base]) << 24 |
                    UInt32(message[base + 1]) << 16 |
                    UInt32(message[base + 2]) << 8 |
                    UInt32(message[base + 3])
            }
            for index in 16..<64 {
                let s0 = rotate(words[index - 15], by: 7) ^ rotate(words[index - 15], by: 18) ^ (words[index - 15] >> 3)
                let s1 = rotate(words[index - 2], by: 17) ^ rotate(words[index - 2], by: 19) ^ (words[index - 2] >> 10)
                words[index] = words[index - 16] &+ s0 &+ words[index - 7] &+ s1
            }
            var a = hash[0], b = hash[1], c = hash[2], d = hash[3]
            var e = hash[4], f = hash[5], g = hash[6], h = hash[7]
            for index in 0..<64 {
                let s1 = rotate(e, by: 6) ^ rotate(e, by: 11) ^ rotate(e, by: 25)
                let choice = (e & f) ^ ((~e) & g)
                let temp1 = h &+ s1 &+ choice &+ constants[index] &+ words[index]
                let s0 = rotate(a, by: 2) ^ rotate(a, by: 13) ^ rotate(a, by: 22)
                let majority = (a & b) ^ (a & c) ^ (b & c)
                let temp2 = s0 &+ majority
                h = g; g = f; f = e; e = d &+ temp1
                d = c; c = b; b = a; a = temp1 &+ temp2
            }
            hash[0] &+= a; hash[1] &+= b; hash[2] &+= c; hash[3] &+= d
            hash[4] &+= e; hash[5] &+= f; hash[6] &+= g; hash[7] &+= h
        }
        return hash.map { String(format: "%08x", $0) }.joined()
    }

    private static func rotate(_ value: UInt32, by amount: UInt32) -> UInt32 {
        (value >> amount) | (value << (32 - amount))
    }
}
