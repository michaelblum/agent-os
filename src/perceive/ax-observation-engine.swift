import Foundation

public enum AOSAXObservationError: Error, Equatable, Sendable {
    case invalidBounds
    case invalidRetention
    case invalidRoot
    case identityExhausted
    case stateCollision
    case digestEncodingFailed
    case retentionLimit
}

public enum AOSAXPlatformErrorKind: String, Codable, Equatable, Sendable {
    case unsupported
    case unavailable
    case platformError = "platform_error"
}

public struct AOSAXPlatformError: Codable, Equatable, Sendable {
    public let kind: AOSAXPlatformErrorKind
    public let code: String
    public let detail: String

    public init(
        kind: AOSAXPlatformErrorKind = .platformError,
        code: String,
        detail: String
    ) {
        self.kind = kind
        self.code = code
        self.detail = detail
    }

    public func classified(as kind: AOSAXPlatformErrorKind) -> AOSAXPlatformError {
        AOSAXPlatformError(kind: kind, code: code, detail: detail)
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

public struct AOSAXPlatformRelationshipFrontier: Sendable, Equatable {
    public let name: String
    public let nextChildPosition: Int
    public let remainingCount: Int

    public init(name: String, nextChildPosition: Int, remainingCount: Int) {
        self.name = name
        self.nextChildPosition = nextChildPosition
        self.remainingCount = remainingCount
    }
}

public struct AOSAXPlatformRelationshipBatch<Handle: Hashable & Sendable>: Sendable {
    public let relationships: [AOSAXPlatformRelationship<Handle>]
    public let frontier: [AOSAXPlatformRelationshipFrontier]

    public init(
        relationships: [AOSAXPlatformRelationship<Handle>],
        frontier: [AOSAXPlatformRelationshipFrontier] = []
    ) {
        self.relationships = relationships
        self.frontier = frontier
    }
}

public enum AOSAXPlatformSettableResult: Sendable {
    case value(Bool)
    case unsupported
    case unavailable(AOSAXPlatformError)
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
        deadlineNanoseconds: UInt64,
        maximumNames: Int,
        maximumResultItems: Int
    ) -> AOSAXPlatformResult<AOSAXPlatformRelationshipBatch<Handle>>
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
        guard (1...AOSAXObservationLimits.schemaMaxDepth).contains(maxDepth),
              (1...AOSAXObservationLimits.schemaMaxVisited).contains(maxVisited),
              (1...AOSAXObservationLimits.schemaMaxEmitted).contains(maxEmitted),
              maxEmitted <= maxVisited,
              (1...AOSAXObservationLimits.schemaMaxDeadlineNanoseconds).contains(deadlineNanoseconds),
              (1...AOSAXObservationLimits.schemaMaxArrayDepth).contains(maxArrayDepth),
              (1...AOSAXObservationLimits.schemaMaxArrayItems).contains(maxArrayItems),
              (1...AOSAXObservationLimits.schemaMaxValueCost).contains(maxValueCost) else {
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
        attributeOutcomes: [String: AOSAXAttributeOutcomeKind],
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
            guard attributeOutcomes[expected.name] == expected.outcome else {
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
        guard (1...AOSAXObservationLimits.schemaMaxPageSize).contains(pageSize),
              pageSize <= bounds.maxEmitted,
              filters.count <= AOSAXObservationLimits.schemaMaxFilters,
              filters.reduce(0, { $0 + $1.rawAttributeOutcomes.count }) <= AOSAXObservationLimits.schemaMaxArrayItems else {
            throw AOSAXObservationError.invalidBounds
        }
        if case .displayComposite(let identity, let applications) = root {
            guard !identity.isEmpty,
                  !applications.isEmpty,
                  applications.count <= AOSAXObservationLimits.schemaMaxCompositeApplications else {
                throw AOSAXObservationError.invalidRoot
            }
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
    case arrayBound = "array_bound"
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
    public let error: AOSAXPlatformError?

    public init(kind: AOSAXStopKind, detail: String, error: AOSAXPlatformError? = nil) {
        self.kind = kind
        self.detail = detail
        self.error = error
    }
}

public enum AOSAXFrontierReason: String, Codable, Sendable {
    case depthBound = "depth_bound"
    case visitedBound = "visited_bound"
    case emittedBound = "emitted_bound"
    case deadline
    case valueCostBound = "value_cost_bound"
    case arrayBound = "array_bound"
    case platformUnsupported = "platform_unsupported"
    case platformUnavailable = "platform_unavailable"
    case platformError = "platform_error"
    case generationMismatch = "generation_mismatch"
    case retentionLimit = "retention_limit"
}

public struct AOSAXFrontierEntry: Codable, Equatable, Sendable {
    public let parentRef: String?
    public let relationshipName: String?
    public let childPosition: Int?
    public let depth: Int
    public let ref: String?
    public let constituentID: String?
    public let reason: AOSAXFrontierReason
    public let remainingCount: Int?

    public init(
        parentRef: String?,
        relationshipName: String?,
        childPosition: Int?,
        depth: Int,
        ref: String?,
        constituentID: String?,
        reason: AOSAXFrontierReason,
        remainingCount: Int? = nil
    ) {
        self.parentRef = parentRef
        self.relationshipName = relationshipName
        self.childPosition = childPosition
        self.depth = depth
        self.ref = ref
        self.constituentID = constituentID
        self.reason = reason
        self.remainingCount = remainingCount
    }
}

public enum AOSAXProviderReadOutcomeKind: String, Codable, Sendable {
    case value
    case unsupported
    case unavailable
    case platformError = "platform_error"
    case deadlineExceeded = "deadline_exceeded"
    case notAttempted = "not_attempted"
}

public struct AOSAXProviderReadOutcome: Codable, Equatable, Sendable {
    public let kind: AOSAXProviderReadOutcomeKind
    public let error: AOSAXPlatformError?

    public init(kind: AOSAXProviderReadOutcomeKind, error: AOSAXPlatformError? = nil) {
        self.kind = kind
        self.error = error
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
    public let attributes: [AOSAXAttributeProjection]?
    public let attributeNamesRead: AOSAXProviderReadOutcome?
    public let parameterizedAttributeNames: [String]?
    public let parameterizedAttributeNamesRead: AOSAXProviderReadOutcome?
    public let settableFacts: [AOSAXSettableFact]?
    public let supportedActionNames: [String]?
    public let supportedActionNamesRead: AOSAXProviderReadOutcome?
    public let relationshipNames: [String]?
    public let relationshipRead: AOSAXProviderReadOutcome
    public let referenceEdges: [AOSAXReferenceEdge]

    public init(
        ref: String,
        parentRef: String?,
        incomingRelationship: String?,
        childPosition: Int?,
        depth: Int,
        constituentID: String?,
        facts: AOSAXElementFacts,
        attributes: [AOSAXAttributeProjection]?,
        attributeNamesRead: AOSAXProviderReadOutcome?,
        parameterizedAttributeNames: [String]?,
        parameterizedAttributeNamesRead: AOSAXProviderReadOutcome?,
        settableFacts: [AOSAXSettableFact]?,
        supportedActionNames: [String]?,
        supportedActionNamesRead: AOSAXProviderReadOutcome?,
        relationshipNames: [String]?,
        relationshipRead: AOSAXProviderReadOutcome,
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
        self.attributeNamesRead = attributeNamesRead
        self.parameterizedAttributeNames = parameterizedAttributeNames
        self.parameterizedAttributeNamesRead = parameterizedAttributeNamesRead
        self.settableFacts = settableFacts
        self.supportedActionNames = supportedActionNames
        self.supportedActionNamesRead = supportedActionNamesRead
        self.relationshipNames = relationshipNames
        self.relationshipRead = relationshipRead
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
    public let effectiveLimits: AOSAXSnapshotStoreConfiguration
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
        self.effectiveLimits = snapshot.effectiveLimits
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
            effectiveLimits: snapshot.effectiveLimits,
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
        effectiveLimits: AOSAXSnapshotStoreConfiguration,
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
        self.effectiveLimits = effectiveLimits
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
    let constituentID: String?
}

private struct AOSAXGenerationBinding {
    let generation: AOSAXProcessGeneration
    let constituentID: String?
}

private enum AOSAXGenerationCheck {
    case matched
    case mismatched(AOSAXPlatformError)
    case unavailable(AOSAXPlatformError)
    case deadline
}

public final class AOSAXObservationEngine<Provider: AOSAXPlatformProvider>: @unchecked Sendable {
    public typealias IdentityFactory = @Sendable () -> String

    private let provider: Provider
    private let generationObserver: any AOSAXProcessGenerationObserving
    private let store: AOSAXSnapshotStore<Provider.Handle>
    private let stateIDFactory: IdentityFactory
    private let refIDFactory: IdentityFactory

    public init(
        provider: Provider,
        generationObserver: any AOSAXProcessGenerationObserving,
        store: AOSAXSnapshotStore<Provider.Handle>,
        stateIDFactory: @escaping IdentityFactory,
        refIDFactory: @escaping IdentityFactory
    ) {
        self.provider = provider
        self.generationObserver = generationObserver
        self.store = store
        self.stateIDFactory = stateIDFactory
        self.refIDFactory = refIDFactory
    }

    public func observe(_ request: AOSAXObservationRequest) throws -> AOSAXObservationResponse {
        let admission = try store.beginObservation(request)
        let stateID = try store.allocateStateID(factory: stateIDFactory)
        var published = false
        var borrowLeases: [AOSAXHandleBorrowLease<Provider.Handle>] = []
        defer {
            borrowLeases.forEach { $0.release() }
            if !published { store.abandonStateID(stateID) }
        }

        let start = admission.startMonotonicNanoseconds
        let deadline = admission.deadlineMonotonicNanoseconds
        let requestDigest = try Self.digest(request)
        let projectionDigest = try Self.digest(request.projection)

        var boxesByHandle: [Provider.Handle: AOSAXRetainedHandle<Provider.Handle>] = [:]
        var refsByHandle: [Provider.Handle: String] = [:]
        var usedRefIDs = Set<String>()
        var refConstituent: [String: String] = [:]
        var ancestorJumps: [String: [String]] = [:]
        var depthsByRef: [String: Int] = [:]
        var discoveredHandles = Set<Provider.Handle>()
        var visitedHandles = Set<Provider.Handle>()
        var queue: [AOSAXQueueEntry<Provider.Handle>] = []
        var queueIndex = 0
        var generationBindings: [AOSAXGenerationBinding] = []
        var constituents: [AOSAXCompositeConstituentResult] = []
        var forcedOutcome: AOSAXObservationOutcome?
        var stopCondition = AOSAXStopCondition(kind: .complete, detail: "all admitted traversal completed")
        var visited = 0
        var matched = 0
        var emitted = 0
        var cycleEdges = 0
        var duplicateEdges = 0
        var valueCost = 0
        var remainingRelationshipItems = 0
        var nodes: [AOSAXNodeProjection] = []
        var frontier: [AOSAXFrontierEntry] = []
        var rootStopped = false

        func deadlineReached() -> Bool {
            store.monotonicNow() >= deadline
        }

        func classified(_ error: AOSAXPlatformError, as kind: AOSAXPlatformErrorKind) -> AOSAXPlatformError {
            error.classified(as: kind)
        }

        func stopKind(for kind: AOSAXPlatformErrorKind) -> AOSAXStopKind {
            switch kind {
            case .unsupported: return .platformUnsupported
            case .unavailable: return .platformUnavailable
            case .platformError: return .platformError
            }
        }

        func frontierReason(for kind: AOSAXPlatformErrorKind) -> AOSAXFrontierReason {
            switch kind {
            case .unsupported: return .platformUnsupported
            case .unavailable: return .platformUnavailable
            case .platformError: return .platformError
            }
        }

        func recordProviderStop(_ error: AOSAXPlatformError) {
            if stopCondition.kind == .complete {
                stopCondition = .init(kind: stopKind(for: error.kind), detail: error.code, error: error)
            }
        }

        func appendRemainingQueue(reason: AOSAXFrontierReason) {
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
            queueIndex = queue.count
        }

        func assignedRef(_ handle: Provider.Handle, constituentID: String?) throws -> String {
            if let existing = refsByHandle[handle] { return existing }
            for _ in 0..<admission.identityAttempts {
                let candidate = refIDFactory()
                guard Self.validIdentity(candidate), usedRefIDs.insert(candidate).inserted else { continue }
                refsByHandle[handle] = candidate
                if let constituentID { refConstituent[candidate] = constituentID }
                return candidate
            }
            throw AOSAXObservationError.identityExhausted
        }

        func retainedBox(_ handle: Provider.Handle) throws -> AOSAXRetainedHandle<Provider.Handle> {
            if let existing = boxesByHandle[handle] { return existing }
            guard boxesByHandle.count < admission.maxRetainedRefs else {
                throw AOSAXObservationError.retentionLimit
            }
            provider.retain(handle: handle)
            let box = AOSAXRetainedHandle(value: handle) { [provider] handle in
                provider.release(handle: handle)
            }
            boxesByHandle[handle] = box
            return box
        }

        func admitRef(_ handle: Provider.Handle, constituentID: String?) throws -> (String, AOSAXRetainedHandle<Provider.Handle>) {
            let box = try retainedBox(handle)
            let ref = try assignedRef(handle, constituentID: constituentID)
            return (ref, box)
        }

        func enqueueRoot(_ handle: Provider.Handle, constituentID: String?) throws {
            guard !discoveredHandles.contains(handle) else { return }
            guard discoveredHandles.count < request.bounds.maxVisited else {
                throw AOSAXObservationError.retentionLimit
            }
            let admitted = try admitRef(handle, constituentID: constituentID)
            discoveredHandles.insert(handle)
            queue.append(.init(
                handle: admitted.1,
                ref: admitted.0,
                parentRef: nil,
                incomingRelationship: nil,
                childPosition: nil,
                depth: 0,
                constituentID: constituentID
            ))
            ancestorJumps[admitted.0] = []
            depthsByRef[admitted.0] = 0
        }

        func recordParent(childRef: String, parentRef: String, depth: Int) {
            var jumps = [parentRef]
            var level = 1
            while level - 1 < jumps.count {
                let prior = jumps[level - 1]
                guard let priorJumps = ancestorJumps[prior], level - 1 < priorJumps.count else { break }
                jumps.append(priorJumps[level - 1])
                level += 1
            }
            ancestorJumps[childRef] = jumps
            depthsByRef[childRef] = depth
        }

        func isAncestor(_ candidateRef: String, of ref: String) -> Bool {
            guard let candidateDepth = depthsByRef[candidateRef],
                  let depth = depthsByRef[ref],
                  candidateDepth <= depth else { return false }
            var cursor = ref
            var difference = depth - candidateDepth
            var level = 0
            while difference > 0 {
                if difference & 1 == 1 {
                    guard let jumps = ancestorJumps[cursor], level < jumps.count else { return false }
                    cursor = jumps[level]
                }
                difference >>= 1
                level += 1
            }
            return cursor == candidateRef
        }

        func generationCheck(_ generation: AOSAXProcessGeneration) -> AOSAXGenerationCheck {
            guard !deadlineReached() else { return .deadline }
            switch generationObserver.observeGeneration(pid: generation.pid) {
            case .value(let actual):
                guard actual == generation else {
                    return .mismatched(.init(
                        kind: .unavailable,
                        code: "AX_PROCESS_GENERATION_MISMATCH",
                        detail: "observed process generation differs from requested generation"
                    ))
                }
                return .matched
            case .unavailable(let error):
                return .unavailable(classified(error, as: .unavailable))
            }
        }

        func providerRootFailure(
            generation: AOSAXProcessGeneration,
            constituentID: String?,
            error: AOSAXPlatformError
        ) -> AOSAXCompositeConstituentResult {
            recordProviderStop(error)
            return .init(
                id: constituentID ?? "root",
                generation: generation,
                outcome: error.kind == .unsupported ? .unsupported : .unavailable,
                error: error
            )
        }

        func admitGenerationRoot(
            _ generation: AOSAXProcessGeneration,
            constituentID: String?,
            resolve: () -> AOSAXPlatformResult<Provider.Handle>
        ) throws -> AOSAXCompositeConstituentResult? {
            switch generationCheck(generation) {
            case .matched:
                break
            case .mismatched(let error):
                stopCondition = .init(kind: .generationMismatch, detail: error.code, error: error)
                return .init(id: constituentID ?? "root", generation: generation, outcome: .unavailable, error: error)
            case .unavailable(let error):
                return providerRootFailure(generation: generation, constituentID: constituentID, error: error)
            case .deadline:
                stopCondition = .init(kind: .deadline, detail: "deadline reached before process-generation observation")
                return .init(
                    id: constituentID ?? "root",
                    generation: generation,
                    outcome: .unavailable,
                    error: .init(kind: .unavailable, code: "AX_DEADLINE_EXCEEDED", detail: "root generation was not observed")
                )
            }
            guard !deadlineReached() else {
                stopCondition = .init(kind: .deadline, detail: "deadline reached before root-provider access")
                return .init(
                    id: constituentID ?? "root",
                    generation: generation,
                    outcome: .unavailable,
                    error: .init(kind: .unavailable, code: "AX_DEADLINE_EXCEEDED", detail: "root was not resolved")
                )
            }
            switch resolve() {
            case .value(let handle):
                try enqueueRoot(handle, constituentID: constituentID)
                generationBindings.append(.init(generation: generation, constituentID: constituentID))
                return nil
            case .unsupported(let error):
                return providerRootFailure(
                    generation: generation,
                    constituentID: constituentID,
                    error: classified(error, as: .unsupported)
                )
            case .unavailable(let error):
                return providerRootFailure(
                    generation: generation,
                    constituentID: constituentID,
                    error: classified(error, as: .unavailable)
                )
            case .platformError(let error):
                return providerRootFailure(
                    generation: generation,
                    constituentID: constituentID,
                    error: classified(error, as: .platformError)
                )
            }
        }

        let rootIdentity: AOSAXRootIdentity
        switch request.root {
        case .systemWide:
            rootIdentity = .init(kind: .systemWide)
            guard !deadlineReached() else {
                stopCondition = .init(kind: .deadline, detail: "deadline reached before system-root access")
                frontier.append(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: nil, constituentID: nil, reason: .deadline))
                rootStopped = true
                break
            }
            switch provider.systemWideRoot(deadlineNanoseconds: deadline) {
            case .value(let handle): try enqueueRoot(handle, constituentID: nil)
            case .unsupported(let error):
                let exact = classified(error, as: .unsupported)
                forcedOutcome = .unsupported
                stopCondition = .init(kind: .platformUnsupported, detail: exact.code, error: exact)
            case .unavailable(let error):
                let exact = classified(error, as: .unavailable)
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .platformUnavailable, detail: exact.code, error: exact)
            case .platformError(let error):
                let exact = classified(error, as: .platformError)
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .platformError, detail: exact.code, error: exact)
            }
        case .application(let generation):
            rootIdentity = .init(kind: .application, generation: generation)
            if let result = try admitGenerationRoot(generation, constituentID: nil, resolve: {
                provider.applicationRoot(generation: generation, deadlineNanoseconds: deadline)
            }) {
                forcedOutcome = stopCondition.kind == .deadline ? nil : result.outcome
                if stopCondition.kind == .deadline {
                    frontier.append(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: nil, constituentID: nil, reason: .deadline))
                    rootStopped = true
                }
            }
        case .window(let generation, let windowID):
            rootIdentity = .init(kind: .window, generation: generation, windowID: windowID)
            if let result = try admitGenerationRoot(generation, constituentID: nil, resolve: {
                provider.windowRoot(generation: generation, windowID: windowID, deadlineNanoseconds: deadline)
            }) {
                forcedOutcome = stopCondition.kind == .deadline ? nil : result.outcome
                if stopCondition.kind == .deadline {
                    frontier.append(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: nil, constituentID: nil, reason: .deadline))
                    rootStopped = true
                }
            }
        case .element(let sourceStateID, let sourceRef):
            rootIdentity = .init(kind: .element, sourceStateID: sourceStateID, sourceRef: sourceRef)
            guard !deadlineReached() else {
                stopCondition = .init(kind: .deadline, detail: "deadline reached before Observation Ref borrow")
                frontier.append(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: sourceRef, constituentID: nil, reason: .deadline))
                rootStopped = true
                break
            }
            switch store.resolveElement(stateID: sourceStateID, ref: sourceRef) {
            case .value(let lease):
                borrowLeases.append(lease)
                try enqueueRoot(lease.value, constituentID: nil)
            case .expired:
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .sourceSnapshotExpired, detail: "source snapshot expired")
            case .evicted:
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .sourceSnapshotEvicted, detail: "source snapshot was evicted")
            case .missing, .incompatible:
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .sourceRefMissing, detail: "source observation ref is missing or incompatible")
            case .borrowLimit:
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .retentionLimit, detail: "active Observation Ref borrow limit reached")
            }
        case .displayComposite(let topologyIdentity, let applications):
            rootIdentity = .init(kind: .displayComposite, topologyIdentity: topologyIdentity, constituentCount: applications.count)
            for (index, generation) in applications.enumerated() {
                let constituentID = "application-\(index)-pid-\(generation.pid)"
                if deadlineReached() {
                    stopCondition = .init(kind: .deadline, detail: "deadline reached during composite-root admission")
                    frontier.append(.init(
                        parentRef: nil,
                        relationshipName: nil,
                        childPosition: index,
                        depth: 0,
                        ref: nil,
                        constituentID: constituentID,
                        reason: .deadline,
                        remainingCount: applications.count - index
                    ))
                    rootStopped = true
                    break
                }
                if let result = try admitGenerationRoot(generation, constituentID: constituentID, resolve: {
                    provider.applicationRoot(generation: generation, deadlineNanoseconds: deadline)
                }) {
                    constituents.append(result)
                } else {
                    constituents.append(.init(id: constituentID, generation: generation, outcome: .complete))
                }
            }
            if queue.isEmpty, !rootStopped {
                forcedOutcome = constituents.contains(where: { $0.outcome == .unavailable }) ? .unavailable : .unsupported
                if stopCondition.kind == .complete {
                    stopCondition = .init(kind: .platformUnavailable, detail: "no composite constituent root was available")
                }
            }
        }

        var traversalStopped = forcedOutcome != nil || rootStopped
        remainingRelationshipItems = min(
            request.bounds.maxVisited + request.bounds.maxArrayItems,
            max(0, admission.effectiveLimits.observationLimits.maxFrontier - queue.count)
        )

        func stopAtDeadline(expanding entry: AOSAXQueueEntry<Provider.Handle>?) {
            stopCondition = .init(kind: .deadline, detail: "monotonic observation deadline reached")
            if let entry {
                frontier.append(.init(
                    parentRef: entry.ref,
                    relationshipName: nil,
                    childPosition: nil,
                    depth: entry.depth + 1,
                    ref: nil,
                    constituentID: entry.constituentID,
                    reason: .deadline
                ))
            }
            appendRemainingQueue(reason: .deadline)
            traversalStopped = true
        }

        func appendRelationshipRemainder(
            _ relationships: [AOSAXPlatformRelationship<Provider.Handle>],
            relationshipIndex: Int,
            childPosition: Int,
            entry: AOSAXQueueEntry<Provider.Handle>,
            reason: AOSAXFrontierReason
        ) {
            for index in relationshipIndex..<relationships.count {
                let relationship = relationships[index]
                let start = index == relationshipIndex ? childPosition : 0
                guard start < relationship.elements.count else { continue }
                frontier.append(.init(
                    parentRef: entry.ref,
                    relationshipName: relationship.name,
                    childPosition: start,
                    depth: entry.depth + 1,
                    ref: nil,
                    constituentID: entry.constituentID,
                    reason: reason,
                    remainingCount: relationship.elements.count - start
                ))
            }
        }

        func readNames(
            _ body: () -> AOSAXPlatformResult<[String]>
        ) -> ([String], AOSAXProviderReadOutcome) {
            guard !deadlineReached() else { return ([], .init(kind: .deadlineExceeded)) }
            switch body() {
            case .value(let names):
                guard names.count <= request.bounds.maxArrayItems,
                      names.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 }) else {
                    let error = AOSAXPlatformError(
                        kind: .platformError,
                        code: "AX_PROVIDER_RESULT_BOUND_EXCEEDED",
                        detail: "provider name list exceeded the admitted array-item bound"
                    )
                    return ([], .init(kind: .platformError, error: error))
                }
                return (names.sorted(by: AOSAXValueCodec<Provider.Handle>.unicodeScalarLess), .init(kind: .value))
            case .unsupported(let error):
                let exact = classified(error, as: .unsupported)
                return ([], .init(kind: .unsupported, error: exact))
            case .unavailable(let error):
                let exact = classified(error, as: .unavailable)
                return ([], .init(kind: .unavailable, error: exact))
            case .platformError(let error):
                let exact = classified(error, as: .platformError)
                return ([], .init(kind: .platformError, error: exact))
            }
        }

        while !traversalStopped, queueIndex < queue.count {
            if visited >= request.bounds.maxVisited {
                stopCondition = .init(kind: .visitedBound, detail: "visited-node breadth bound reached")
                appendRemainingQueue(reason: .visitedBound)
                break
            }
            guard !deadlineReached() else {
                stopAtDeadline(expanding: nil)
                break
            }

            let entry = queue[queueIndex]
            queueIndex += 1
            visited += 1
            visitedHandles.insert(entry.handle.value)

            guard !deadlineReached() else {
                frontier.append(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .deadline))
                stopAtDeadline(expanding: nil)
                break
            }
            let facts: AOSAXElementFacts
            switch provider.facts(for: entry.handle.value, deadlineNanoseconds: deadline) {
            case .value(let value): facts = value
            case .unsupported(let error):
                let exact = classified(error, as: .unsupported)
                recordProviderStop(exact)
                frontier.append(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .platformUnsupported))
                appendRemainingQueue(reason: .platformUnsupported)
                traversalStopped = true
                continue
            case .unavailable(let error):
                let exact = classified(error, as: .unavailable)
                recordProviderStop(exact)
                frontier.append(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .platformUnavailable))
                appendRemainingQueue(reason: .platformUnavailable)
                traversalStopped = true
                continue
            case .platformError(let error):
                let exact = classified(error, as: .platformError)
                recordProviderStop(exact)
                frontier.append(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .platformError))
                appendRemainingQueue(reason: .platformError)
                traversalStopped = true
                continue
            }

            let needsAttributeNames = request.projection.attributes || request.projection.settableFacts
            var attributeNameRead: ([String], AOSAXProviderReadOutcome)? = needsAttributeNames
                ? readNames { provider.attributeNames(for: entry.handle.value, deadlineNanoseconds: deadline) }
                : nil
            var readNamesSet = Set<String>()
            for filter in request.filters {
                for expected in filter.rawAttributeOutcomes { readNamesSet.insert(expected.name) }
            }
            if let projectedNames = attributeNameRead?.0 {
                let combined = readNamesSet.union(projectedNames)
                if combined.count <= request.bounds.maxArrayItems {
                    readNamesSet = combined
                } else {
                    let error = AOSAXPlatformError(kind: .platformError, code: "AX_PROVIDER_RESULT_BOUND_EXCEEDED", detail: "attribute and filter names exceeded the admitted item bound")
                    attributeNameRead = ([], .init(kind: .platformError, error: error))
                }
            }
            let namesToRead = readNamesSet.sorted(by: AOSAXValueCodec<Provider.Handle>.unicodeScalarLess)
            var internalAttributes: [AOSAXAttributeProjection] = []
            internalAttributes.reserveCapacity(namesToRead.count)
            var valueBoundHit = false
            var retentionBoundHit = false
            let codec = AOSAXValueCodec<Provider.Handle>(
                bounds: try AOSAXValueCodecBounds(
                    maxArrayDepth: request.bounds.maxArrayDepth,
                    maxArrayItems: request.bounds.maxArrayItems,
                    maxAggregateCost: request.bounds.maxValueCost
                ),
                resolveElementRef: { handle in
                    try admitRef(handle, constituentID: entry.constituentID).0
                }
            )
            for name in namesToRead {
                guard !deadlineReached() else {
                    internalAttributes.append(.init(name: name, outcome: .deadlineExceeded, detail: "monotonic deadline"))
                    continue
                }
                switch provider.attribute(name, for: entry.handle.value, deadlineNanoseconds: deadline) {
                case .noValue:
                    internalAttributes.append(.init(name: name, outcome: .noValue))
                case .unsupported:
                    internalAttributes.append(.init(name: name, outcome: .unsupported))
                case .unavailable(let error):
                    internalAttributes.append(.init(name: name, outcome: .platformError, error: classified(error, as: .unavailable)))
                case .platformError(let error):
                    internalAttributes.append(.init(name: name, outcome: .platformError, error: classified(error, as: .platformError)))
                case .value(let platformValue):
                    let encoded = try codec.encode(platformValue, consumed: valueCost)
                    if let value = encoded.value {
                        valueCost += encoded.cost
                        internalAttributes.append(.init(name: name, outcome: .value, value: value))
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
                        case .retainedRefs:
                            outcome = .unrepresentableType
                            detail = "retained Observation Ref bound"
                            retentionBoundHit = true
                        case .unrepresentable, nil:
                            outcome = .unrepresentableType
                            detail = "platform value has no closed representation"
                        }
                        internalAttributes.append(.init(name: name, outcome: outcome, detail: detail))
                    }
                }
            }

            let attributeOutcomes = Dictionary(
                uniqueKeysWithValues: internalAttributes.map { ($0.name, $0.outcome) }
            )
            var settableFacts: [AOSAXSettableFact]? = request.projection.settableFacts ? [] : nil
            if request.projection.settableFacts {
                for name in attributeNameRead?.0 ?? [] {
                    guard !deadlineReached() else {
                        settableFacts?.append(.init(name: name, outcome: .deadlineExceeded))
                        continue
                    }
                    switch provider.isAttributeSettable(name, for: entry.handle.value, deadlineNanoseconds: deadline) {
                    case .value(true): settableFacts?.append(.init(name: name, outcome: .settable))
                    case .value(false): settableFacts?.append(.init(name: name, outcome: .notSettable))
                    case .unsupported: settableFacts?.append(.init(name: name, outcome: .unsupported))
                    case .unavailable(let error):
                        settableFacts?.append(.init(name: name, outcome: .platformError, error: classified(error, as: .unavailable)))
                    case .platformError(let error):
                        settableFacts?.append(.init(name: name, outcome: .platformError, error: classified(error, as: .platformError)))
                    }
                }
            }

            let parameterizedRead: ([String], AOSAXProviderReadOutcome)? = request.projection.parameterizedAttributeNames
                ? readNames { provider.parameterizedAttributeNames(for: entry.handle.value, deadlineNanoseconds: deadline) }
                : nil
            let actionRead: ([String], AOSAXProviderReadOutcome)? = request.projection.supportedActionNames
                ? readNames { provider.supportedActionNames(for: entry.handle.value, deadlineNanoseconds: deadline) }
                : nil

            if deadlineReached() {
                stopAtDeadline(expanding: entry)
            } else if valueBoundHit || retentionBoundHit {
                let reason: AOSAXFrontierReason = valueBoundHit ? .valueCostBound : .retentionLimit
                stopCondition = .init(
                    kind: valueBoundHit ? .valueCostBound : .retentionLimit,
                    detail: valueBoundHit ? "aggregate representable-value cost bound reached" : "retained Observation Ref capacity reached"
                )
                frontier.append(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: reason))
                appendRemainingQueue(reason: reason)
                traversalStopped = true
            }

            var relationships: [AOSAXPlatformRelationship<Provider.Handle>] = []
            var relationshipRead = AOSAXProviderReadOutcome(
                kind: stopCondition.kind == .deadline ? .deadlineExceeded : .notAttempted
            )
            var providerRelationshipFrontier: [AOSAXPlatformRelationshipFrontier] = []
            if !traversalStopped {
                guard remainingRelationshipItems > 0 else {
                    stopCondition = .init(kind: .arrayBound, detail: "relationship-element resource bound reached")
                    frontier.append(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .arrayBound))
                    appendRemainingQueue(reason: .arrayBound)
                    traversalStopped = true
                    continue
                }
                guard !deadlineReached() else {
                    stopAtDeadline(expanding: entry)
                    continue
                }
                let relationshipAdmission = min(request.bounds.maxArrayItems, remainingRelationshipItems)
                switch provider.relationships(
                    for: entry.handle.value,
                    deadlineNanoseconds: deadline,
                    maximumNames: request.bounds.maxArrayItems,
                    maximumResultItems: relationshipAdmission + request.bounds.maxArrayItems
                ) {
                case .value(let batch):
                    let total = batch.relationships.reduce(into: 0) { partial, relationship in
                        let next = partial.addingReportingOverflow(relationship.elements.count)
                        partial = next.overflow ? Int.max : next.partialValue
                    }
                    let validFrontier = batch.frontier.count <= request.bounds.maxArrayItems && batch.frontier.allSatisfy {
                        !$0.name.isEmpty && $0.name.utf8.count <= 512 && $0.nextChildPosition >= 0 && $0.remainingCount > 0
                    }
                    let namedCost = batch.relationships.count.addingReportingOverflow(total)
                    guard !namedCost.overflow,
                          batch.relationships.count <= request.bounds.maxArrayItems,
                          batch.relationships.allSatisfy({ !$0.name.isEmpty && $0.name.utf8.count <= 512 }),
                          namedCost.partialValue <= relationshipAdmission,
                          validFrontier else {
                        let error = AOSAXPlatformError(kind: .platformError, code: "AX_PROVIDER_RESULT_BOUND_EXCEEDED", detail: "relationship provider violated the admitted bounded batch")
                        relationshipRead = .init(kind: .platformError, error: error)
                        recordProviderStop(error)
                        frontier.append(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .platformError))
                        traversalStopped = true
                        continue
                    }
                    remainingRelationshipItems -= namedCost.partialValue
                    relationships = batch.relationships.sorted { AOSAXValueCodec<Provider.Handle>.unicodeScalarLess($0.name, $1.name) }
                    providerRelationshipFrontier = batch.frontier.sorted {
                        if $0.name == $1.name { return $0.nextChildPosition < $1.nextChildPosition }
                        return AOSAXValueCodec<Provider.Handle>.unicodeScalarLess($0.name, $1.name)
                    }
                    relationshipRead = .init(kind: .value)
                case .unsupported(let error):
                    let exact = classified(error, as: .unsupported)
                    relationshipRead = .init(kind: .unsupported, error: exact)
                    recordProviderStop(exact)
                    frontier.append(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .platformUnsupported))
                case .unavailable(let error):
                    let exact = classified(error, as: .unavailable)
                    relationshipRead = .init(kind: .unavailable, error: exact)
                    recordProviderStop(exact)
                    frontier.append(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .platformUnavailable))
                case .platformError(let error):
                    let exact = classified(error, as: .platformError)
                    relationshipRead = .init(kind: .platformError, error: exact)
                    recordProviderStop(exact)
                    frontier.append(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .platformError))
                }
            }

            var referenceEdges: [AOSAXReferenceEdge] = []
            relationshipLoop: for (relationshipIndex, relationship) in relationships.enumerated() {
                for (position, child) in relationship.elements.enumerated() {
                    guard !deadlineReached() else {
                        appendRelationshipRemainder(relationships, relationshipIndex: relationshipIndex, childPosition: position, entry: entry, reason: .deadline)
                        stopAtDeadline(expanding: nil)
                        break relationshipLoop
                    }
                    if child == entry.handle.value || refsByHandle[child].map({ isAncestor($0, of: entry.ref) }) == true {
                        let childRef = child == entry.handle.value ? entry.ref : refsByHandle[child]!
                        cycleEdges += 1
                        referenceEdges.append(.init(relationshipName: relationship.name, childPosition: position, ref: childRef, kind: .cycle))
                        continue
                    }
                    if visitedHandles.contains(child) {
                        guard let childRef = refsByHandle[child] else { throw AOSAXObservationError.stateCollision }
                        duplicateEdges += 1
                        referenceEdges.append(.init(relationshipName: relationship.name, childPosition: position, ref: childRef, kind: .duplicate))
                        continue
                    }
                    if discoveredHandles.contains(child) {
                        continue
                    }
                    if entry.depth >= request.bounds.maxDepth {
                        frontier.append(.init(parentRef: entry.ref, relationshipName: relationship.name, childPosition: position, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .depthBound))
                        if stopCondition.kind == .complete {
                            stopCondition = .init(kind: .depthBound, detail: "maximum traversal depth reached")
                        }
                        continue
                    }
                    guard discoveredHandles.count < request.bounds.maxVisited,
                          boxesByHandle.count < admission.maxRetainedRefs else {
                        appendRelationshipRemainder(relationships, relationshipIndex: relationshipIndex, childPosition: position, entry: entry, reason: .visitedBound)
                        stopCondition = .init(kind: .visitedBound, detail: "traversal resources exhausted before relationship retention")
                        appendRemainingQueue(reason: .visitedBound)
                        traversalStopped = true
                        break relationshipLoop
                    }
                    let admitted = try admitRef(child, constituentID: entry.constituentID)
                    discoveredHandles.insert(child)
                    recordParent(childRef: admitted.0, parentRef: entry.ref, depth: entry.depth + 1)
                    queue.append(.init(
                        handle: admitted.1,
                        ref: admitted.0,
                        parentRef: entry.ref,
                        incomingRelationship: relationship.name,
                        childPosition: position,
                        depth: entry.depth + 1,
                        constituentID: entry.constituentID
                    ))
                }
            }

            if !providerRelationshipFrontier.isEmpty {
                for remainder in providerRelationshipFrontier {
                    frontier.append(.init(
                        parentRef: entry.ref,
                        relationshipName: remainder.name,
                        childPosition: remainder.nextChildPosition,
                        depth: entry.depth + 1,
                        ref: nil,
                        constituentID: entry.constituentID,
                        reason: .arrayBound,
                        remainingCount: remainder.remainingCount
                    ))
                }
                stopCondition = .init(kind: .arrayBound, detail: "relationship provider reported an exact bounded remainder")
                appendRemainingQueue(reason: .arrayBound)
                traversalStopped = true
            }

            let matches = request.filters.allSatisfy {
                $0.matches(facts: facts, attributeOutcomes: attributeOutcomes, incomingRelationship: entry.incomingRelationship)
            }
            if matches {
                matched += 1
                if emitted >= request.bounds.maxEmitted {
                    frontier.append(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .emittedBound))
                    stopCondition = .init(kind: .emittedBound, detail: "emitted-node bound reached")
                    appendRemainingQueue(reason: .emittedBound)
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
                        attributes: request.projection.attributes ? internalAttributes : nil,
                        attributeNamesRead: request.projection.attributes || request.projection.settableFacts ? attributeNameRead?.1 : nil,
                        parameterizedAttributeNames: request.projection.parameterizedAttributeNames ? parameterizedRead?.0 : nil,
                        parameterizedAttributeNamesRead: parameterizedRead?.1,
                        settableFacts: settableFacts,
                        supportedActionNames: request.projection.supportedActionNames ? actionRead?.0 : nil,
                        supportedActionNamesRead: actionRead?.1,
                        relationshipNames: request.projection.relationshipNames ? relationships.map(\.name) : nil,
                        relationshipRead: relationshipRead,
                        referenceEdges: referenceEdges
                    ))
                }
            }

        }

        var invalidConstituents = Set<String?>()
        var invalidReasons: [String?: AOSAXFrontierReason] = [:]
        for binding in generationBindings {
            switch generationCheck(binding.generation) {
            case .matched:
                continue
            case .mismatched(let error):
                invalidConstituents.insert(binding.constituentID)
                invalidReasons[binding.constituentID] = .generationMismatch
                stopCondition = .init(kind: .generationMismatch, detail: error.code, error: error)
            case .unavailable(let error):
                invalidConstituents.insert(binding.constituentID)
                invalidReasons[binding.constituentID] = .platformUnavailable
                stopCondition = .init(kind: .platformUnavailable, detail: error.code, error: error)
            case .deadline:
                invalidConstituents.insert(binding.constituentID)
                invalidReasons[binding.constituentID] = .deadline
                stopCondition = .init(kind: .deadline, detail: "deadline prevented the required pre-commit generation sample")
            }
        }
        if !invalidConstituents.isEmpty {
            forcedOutcome = .unavailable
            nodes.removeAll { invalidConstituents.contains($0.constituentID) }
            frontier.removeAll { invalidConstituents.contains($0.constituentID) }
            for constituentID in invalidConstituents {
                frontier.append(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: nil, constituentID: constituentID, reason: invalidReasons[constituentID] ?? .generationMismatch))
            }
            constituents = constituents.map { item in
                guard invalidConstituents.contains(item.id) else { return item }
                return .init(id: item.id, generation: item.generation, outcome: .unavailable, error: stopCondition.error)
            }
        }

        if case .displayComposite = request.root, invalidConstituents.isEmpty {
            if constituents.contains(where: { $0.outcome == .unavailable }) {
                forcedOutcome = .unavailable
            } else if constituents.contains(where: { $0.outcome == .unsupported }) {
                forcedOutcome = .unsupported
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
                item.outcome == .complete ? .init(id: item.id, generation: item.generation, outcome: .truncated, error: item.error) : item
            }
        }

        let finished = store.monotonicNow()
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
        if !invalidConstituents.contains(nil) {
            for (handle, ref) in refsByHandle {
                if let constituent = refConstituent[ref], invalidConstituents.contains(constituent) { continue }
                if let box = boxesByHandle[handle] { retainedRefs[ref] = box }
            }
        }
        let snapshot = AOSAXStoredSnapshot<Provider.Handle>(
            stateID: stateID,
            requestDigest: requestDigest,
            projectionDigest: projectionDigest,
            root: rootIdentity,
            bounds: request.bounds,
            effectiveLimits: admission.effectiveLimits,
            filters: request.filters,
            pageSize: request.pageSize,
            createdAt: admission.createdAt,
            expiresAt: admission.expiresAt,
            createdMonotonicNanoseconds: start,
            expiresMonotonicNanoseconds: admission.expiresMonotonicNanoseconds,
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
