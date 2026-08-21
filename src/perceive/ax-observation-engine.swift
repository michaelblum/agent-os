import Foundation

private struct AOSAXJSONCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = String(intValue)
        self.intValue = intValue
    }
}

func aosAXRejectSurplusKeys(_ decoder: Decoder, allowed: Set<String>) throws {
    let keys = try decoder.container(keyedBy: AOSAXJSONCodingKey.self).allKeys
    guard keys.allSatisfy({ allowed.contains($0.stringValue) }) else {
        throw AOSAXObservationError.invalidRoot
    }
}

public enum AOSAXObservationError: Error, Equatable, Sendable {
    case invalidBounds
    case invalidRetention
    case invalidRoot
    case identityExhausted
    case stateCollision
    case digestEncodingFailed
    case retentionLimit
    case cancelled
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

    public init(pid: Int32, startTimeSeconds: UInt64, startTimeMicroseconds: UInt32) throws {
        guard pid > 0, startTimeMicroseconds <= 999_999 else {
            throw AOSAXObservationError.invalidRoot
        }
        self.pid = pid
        self.startTimeSeconds = startTimeSeconds
        self.startTimeMicroseconds = startTimeMicroseconds
    }

    public init(from decoder: Decoder) throws {
        try aosAXRejectSurplusKeys(decoder, allowed: ["pid", "startTimeSeconds", "startTimeMicroseconds"])
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            pid: container.decode(Int32.self, forKey: .pid),
            startTimeSeconds: container.decode(UInt64.self, forKey: .startTimeSeconds),
            startTimeMicroseconds: container.decode(UInt32.self, forKey: .startTimeMicroseconds)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case pid, startTimeSeconds, startTimeMicroseconds
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
        case windowID = "windowId"
        case stateID = "stateId"
        case ref
        case topologyIdentity
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
        let kind = try container.decode(AOSAXRootKind.self, forKey: .kind)
        let allowed: Set<String>
        switch kind {
        case .systemWide: allowed = ["kind"]
        case .application: allowed = ["kind", "generation"]
        case .window: allowed = ["kind", "generation", "windowId"]
        case .element: allowed = ["kind", "stateId", "ref"]
        case .displayComposite: allowed = ["kind", "topologyIdentity", "applications"]
        }
        try aosAXRejectSurplusKeys(decoder, allowed: allowed)
        switch kind {
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
    ) throws {
        let valid: Bool
        switch kind {
        case .systemWide:
            valid = generation == nil && windowID == nil && sourceStateID == nil &&
                sourceRef == nil && topologyIdentity == nil && constituentCount == nil
        case .application:
            valid = generation.map(AOSAXContractAdmission.generation) == true &&
                windowID == nil && sourceStateID == nil && sourceRef == nil &&
                topologyIdentity == nil && constituentCount == nil
        case .window:
            valid = generation.map(AOSAXContractAdmission.generation) == true &&
                windowID != nil && sourceStateID == nil && sourceRef == nil &&
                topologyIdentity == nil && constituentCount == nil
        case .element:
            valid = generation == nil && windowID == nil &&
                sourceStateID.map(AOSAXContractAdmission.identifier) == true &&
                sourceRef.map(AOSAXContractAdmission.identifier) == true &&
                topologyIdentity == nil && constituentCount == nil
        case .displayComposite:
            valid = generation == nil && windowID == nil && sourceStateID == nil && sourceRef == nil &&
                topologyIdentity.map(AOSAXContractAdmission.identifier) == true &&
                constituentCount.map { (1...AOSAXObservationLimits.schemaMaxCompositeApplications).contains($0) } == true
        }
        guard valid else { throw AOSAXObservationError.invalidRoot }
        self.kind = kind
        self.generation = generation
        self.windowID = windowID
        self.sourceStateID = sourceStateID
        self.sourceRef = sourceRef
        self.topologyIdentity = topologyIdentity
        self.constituentCount = constituentCount
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            kind: container.decode(AOSAXRootKind.self, forKey: .kind),
            generation: container.decodeIfPresent(AOSAXProcessGeneration.self, forKey: .generation),
            windowID: container.decodeIfPresent(UInt64.self, forKey: .windowID),
            sourceStateID: container.decodeIfPresent(String.self, forKey: .sourceStateID),
            sourceRef: container.decodeIfPresent(String.self, forKey: .sourceRef),
            topologyIdentity: container.decodeIfPresent(String.self, forKey: .topologyIdentity),
            constituentCount: container.decodeIfPresent(Int.self, forKey: .constituentCount)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case kind, generation, sourceRef, topologyIdentity, constituentCount
        case windowID = "windowId"
        case sourceStateID = "sourceStateId"
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

    public init(from decoder: Decoder) throws {
        try aosAXRejectSurplusKeys(decoder, allowed: ["maxDepth", "maxVisited", "maxEmitted", "deadlineNanoseconds", "maxArrayDepth", "maxArrayItems", "maxValueCost"])
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            maxDepth: container.decode(Int.self, forKey: .maxDepth),
            maxVisited: container.decode(Int.self, forKey: .maxVisited),
            maxEmitted: container.decode(Int.self, forKey: .maxEmitted),
            deadlineNanoseconds: container.decode(UInt64.self, forKey: .deadlineNanoseconds),
            maxArrayDepth: container.decode(Int.self, forKey: .maxArrayDepth),
            maxArrayItems: container.decode(Int.self, forKey: .maxArrayItems),
            maxValueCost: container.decode(Int.self, forKey: .maxValueCost)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case maxDepth, maxVisited, maxEmitted, deadlineNanoseconds, maxArrayDepth, maxArrayItems, maxValueCost
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

    public init(from decoder: Decoder) throws {
        try aosAXRejectSurplusKeys(decoder, allowed: ["attributes", "parameterizedAttributeNames", "settableFacts", "supportedActionNames", "relationshipNames"])
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            attributes: try container.decode(Bool.self, forKey: .attributes),
            parameterizedAttributeNames: try container.decode(Bool.self, forKey: .parameterizedAttributeNames),
            settableFacts: try container.decode(Bool.self, forKey: .settableFacts),
            supportedActionNames: try container.decode(Bool.self, forKey: .supportedActionNames),
            relationshipNames: try container.decode(Bool.self, forKey: .relationshipNames)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case attributes, parameterizedAttributeNames, settableFacts, supportedActionNames, relationshipNames
    }
}

public struct AOSAXGeometryFilter: Codable, Equatable, Sendable {
    public let intersects: AOSAXRect

    public init(intersects: AOSAXRect) {
        self.intersects = intersects
    }

    public init(from decoder: Decoder) throws {
        try aosAXRejectSurplusKeys(decoder, allowed: ["intersects"])
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(intersects: try container.decode(AOSAXRect.self, forKey: .intersects))
    }

    private enum CodingKeys: String, CodingKey { case intersects }

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

    public init(from decoder: Decoder) throws {
        try aosAXRejectSurplusKeys(decoder, allowed: ["name", "outcome"])
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(name: try container.decode(String.self, forKey: .name), outcome: try container.decode(AOSAXAttributeOutcomeKind.self, forKey: .outcome))
    }

    private enum CodingKeys: String, CodingKey { case name, outcome }
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

    public init(from decoder: Decoder) throws {
        try aosAXRejectSurplusKeys(decoder, allowed: ["role", "subrole", "identifier", "title", "geometry", "enabled", "focused", "selected", "rawAttributeOutcomes", "relationshipMembership"])
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            role: container.decodeIfPresent(String.self, forKey: .role),
            subrole: container.decodeIfPresent(String.self, forKey: .subrole),
            identifier: container.decodeIfPresent(String.self, forKey: .identifier),
            title: container.decodeIfPresent(String.self, forKey: .title),
            geometry: container.decodeIfPresent(AOSAXGeometryFilter.self, forKey: .geometry),
            enabled: container.decodeIfPresent(Bool.self, forKey: .enabled),
            focused: container.decodeIfPresent(Bool.self, forKey: .focused),
            selected: container.decodeIfPresent(Bool.self, forKey: .selected),
            rawAttributeOutcomes: container.contains(.rawAttributeOutcomes)
                ? container.decode([AOSAXAttributeOutcomeFilter].self, forKey: .rawAttributeOutcomes)
                : [],
            relationshipMembership: container.decodeIfPresent(String.self, forKey: .relationshipMembership)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case role, subrole, identifier, title, geometry, enabled, focused, selected
        case rawAttributeOutcomes, relationshipMembership
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
        guard AOSAXContractAdmission.request(root: root, bounds: bounds, filters: filters, pageSize: pageSize) else {
            throw AOSAXObservationError.invalidRoot
        }
        self.schemaVersion = "aos.ax-observation.v1"
        self.kind = "request"
        self.root = root
        self.bounds = bounds
        self.filters = filters
        self.projection = projection
        self.pageSize = pageSize
    }

    public init(from decoder: Decoder) throws {
        try aosAXRejectSurplusKeys(
            decoder,
            allowed: ["schemaVersion", "kind", "root", "bounds", "filters", "projection", "pageSize"]
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(String.self, forKey: .schemaVersion) == "aos.ax-observation.v1",
              try container.decode(String.self, forKey: .kind) == "request" else {
            throw AOSAXObservationError.invalidRoot
        }
        try self.init(
            root: container.decode(AOSAXObservationRoot.self, forKey: .root),
            bounds: container.decode(AOSAXObservationBounds.self, forKey: .bounds),
            filters: container.decode([AOSAXObservationFilter].self, forKey: .filters),
            projection: container.decode(AOSAXProjectionSelection.self, forKey: .projection),
            pageSize: container.decode(Int.self, forKey: .pageSize)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, kind, root, bounds, filters, projection, pageSize
    }
}

enum AOSAXContractAdmission {
    static func identifier(_ value: String) -> Bool {
        unicodeScalarCount(value, minimum: 1, maximum: 512)
    }

    static func boundedString(_ value: String) -> Bool {
        unicodeScalarCount(value, minimum: 0, maximum: 512)
    }

    static func generation(_ value: AOSAXProcessGeneration) -> Bool {
        value.pid > 0 && value.startTimeMicroseconds <= 999_999
    }

    static func platformError(_ value: AOSAXPlatformError) -> Bool {
        identifier(value.code) && unicodeScalarCount(value.detail, minimum: 1, maximum: 2_048)
    }

    static func facts(_ value: AOSAXElementFacts) -> Bool {
        guard [value.role, value.subrole, value.identifier, value.title]
            .compactMap({ $0 })
            .allSatisfy({ boundedString($0) }) else {
            return false
        }
        guard let frame = value.frame else { return true }
        return frame.x.isFinite && frame.y.isFinite && frame.width.isFinite && frame.height.isFinite
    }

    static func pageToken(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        return parts.count == 2 && !parts[0].isEmpty && !parts[1].isEmpty &&
            value.utf8.count <= 512 && value.utf8.count >= 3 && value.unicodeScalars.allSatisfy {
            (48...57).contains($0.value) || (65...90).contains($0.value) ||
                (97...122).contains($0.value) || $0 == "-" || $0 == "_" || $0 == "."
        }
    }

    static func digest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.unicodeScalars.allSatisfy {
            (48...57).contains($0.value) || (97...102).contains($0.value)
        }
    }

    private static func unicodeScalarCount(
        _ value: String,
        minimum: Int,
        maximum: Int
    ) -> Bool {
        var count = 0
        for _ in value.unicodeScalars {
            count += 1
            if count > maximum { return false }
        }
        return count >= minimum
    }

    static func request(_ value: AOSAXObservationRequest) -> Bool {
        value.schemaVersion == "aos.ax-observation.v1" && value.kind == "request" &&
            request(root: value.root, bounds: value.bounds, filters: value.filters, pageSize: value.pageSize)
    }

    static func pageRequest(token: String, stateID: String, requestDigest: String, projectionDigest: String, pageSize: Int) -> Bool {
        pageToken(token) && identifier(stateID) && digest(requestDigest) && digest(projectionDigest) &&
            (1...AOSAXObservationLimits.schemaMaxPageSize).contains(pageSize)
    }

    static func request(
        root: AOSAXObservationRoot,
        bounds: AOSAXObservationBounds,
        filters: [AOSAXObservationFilter],
        pageSize: Int
    ) -> Bool {
        guard (1...AOSAXObservationLimits.schemaMaxDepth).contains(bounds.maxDepth),
              (1...AOSAXObservationLimits.schemaMaxVisited).contains(bounds.maxVisited),
              (1...AOSAXObservationLimits.schemaMaxEmitted).contains(bounds.maxEmitted),
              (1...AOSAXObservationLimits.schemaMaxDeadlineNanoseconds).contains(bounds.deadlineNanoseconds),
              (1...AOSAXObservationLimits.schemaMaxArrayDepth).contains(bounds.maxArrayDepth),
              (1...AOSAXObservationLimits.schemaMaxArrayItems).contains(bounds.maxArrayItems),
              (1...AOSAXObservationLimits.schemaMaxValueCost).contains(bounds.maxValueCost),
              (1...AOSAXObservationLimits.schemaMaxPageSize).contains(pageSize),
              filters.count <= AOSAXObservationLimits.schemaMaxFilters,
              filters.allSatisfy({ filter in
                  filter.rawAttributeOutcomes.count <= AOSAXObservationLimits.schemaMaxArrayItems &&
                  [filter.role, filter.subrole, filter.identifier, filter.title, filter.relationshipMembership]
                      .compactMap({ $0 })
                      .allSatisfy({ boundedString($0) }) &&
                      filter.rawAttributeOutcomes.allSatisfy { identifier($0.name) }
              }) else {
            return false
        }
        switch root {
        case .systemWide: return true
        case .application(let generation), .window(let generation, _): return self.generation(generation)
        case .element(let stateID, let ref): return identifier(stateID) && identifier(ref)
        case .displayComposite(let topology, let applications):
            return identifier(topology) && !applications.isEmpty &&
                applications.count <= AOSAXObservationLimits.schemaMaxCompositeApplications &&
                applications.allSatisfy(generation)
        }
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
    case snapshotExpired = "snapshot_expired"
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
    public var referenceEdges: [AOSAXReferenceEdge]

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
        unavailableBeforePublication(
            from: snapshot,
            stopCondition: .init(kind: .retentionLimit, detail: "snapshot exceeds finite retention capacity"),
            clearRetainedOutput: false
        )
    }

    public static func expiredBeforePublication<Handle: Hashable & Sendable>(
        from snapshot: AOSAXStoredSnapshot<Handle>
    ) -> AOSAXObservationResponse {
        unavailableBeforePublication(
            from: snapshot,
            stopCondition: .init(kind: .snapshotExpired, detail: "snapshot expired before publication"),
            clearRetainedOutput: true
        )
    }

    private static func unavailableBeforePublication<Handle: Hashable & Sendable>(
        from snapshot: AOSAXStoredSnapshot<Handle>,
        stopCondition: AOSAXStopCondition,
        clearRetainedOutput: Bool
    ) -> AOSAXObservationResponse {
        let clearedAccounting = AOSAXTraversalAccounting(
            visited: snapshot.accounting.visited,
            matched: snapshot.accounting.matched,
            emitted: 0,
            cycleEdges: snapshot.accounting.cycleEdges,
            duplicateEdges: snapshot.accounting.duplicateEdges,
            elapsedNanoseconds: snapshot.accounting.elapsedNanoseconds,
            retainedValueCost: 0
        )
        return AOSAXObservationResponse(
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
            stopCondition: stopCondition,
            accounting: clearRetainedOutput ? clearedAccounting : snapshot.accounting,
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

    public static func frontierLimitExceeded<Handle: Hashable & Sendable>(
        from snapshot: AOSAXStoredSnapshot<Handle>
    ) -> AOSAXObservationResponse {
        let limit = snapshot.effectiveLimits.observationLimits.maxFrontier
        let unresolvedConstituentIDs = Set(snapshot.frontier.compactMap(\.constituentID))
        return AOSAXObservationResponse(
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
            outcome: .truncated,
            stopCondition: .init(
                kind: .retentionLimit,
                detail: "snapshot frontier exceeds the effective retained-frontier bound"
            ),
            accounting: snapshot.accounting,
            frontier: Array(snapshot.frontier.prefix(limit)),
            constituents: snapshot.constituents.map { constituent in
                constituent.outcome == .complete && unresolvedConstituentIDs.contains(constituent.id)
                    ? .init(
                        id: constituent.id,
                        generation: constituent.generation,
                        outcome: .truncated,
                        error: constituent.error
                    )
                    : constituent
            },
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
    let parentRef: String?
    let incomingRelationship: String?
    let childPosition: Int?
    let depth: Int
    let constituentID: String?
}

private struct AOSAXVisitEntry<Handle: Hashable & Sendable> {
    let queued: AOSAXQueueEntry<Handle>
    let ref: String

    var handle: AOSAXRetainedHandle<Handle> { queued.handle }
    var parentRef: String? { queued.parentRef }
    var incomingRelationship: String? { queued.incomingRelationship }
    var childPosition: Int? { queued.childPosition }
    var depth: Int { queued.depth }
    var constituentID: String? { queued.constituentID }
}

private struct AOSAXPendingEdge<Handle: Hashable & Sendable> {
    let sequence: Int
    let child: Handle
    let parentRef: String
    let relationshipName: String
    let childPosition: Int
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

private enum AOSAXHandleAdmissionError: Error {
    case deadline
}

public final class AOSAXObservationEngine<Provider: AOSAXPlatformProvider>: @unchecked Sendable {
    public typealias IdentityFactory = @Sendable () -> String
    public typealias CancellationObserver = @Sendable () -> Bool

    private let provider: Provider
    private let generationObserver: any AOSAXProcessGenerationObserving
    private let store: AOSAXSnapshotStore<Provider.Handle>
    private let stateIDFactory: IdentityFactory
    private let refIDFactory: IdentityFactory
    private let cancellationObserver: CancellationObserver

    public init(
        provider: Provider,
        generationObserver: any AOSAXProcessGenerationObserving,
        store: AOSAXSnapshotStore<Provider.Handle>,
        stateIDFactory: @escaping IdentityFactory,
        refIDFactory: @escaping IdentityFactory,
        cancellationObserver: @escaping CancellationObserver
    ) {
        self.provider = provider
        self.generationObserver = generationObserver
        self.store = store
        self.stateIDFactory = stateIDFactory
        self.refIDFactory = refIDFactory
        self.cancellationObserver = cancellationObserver
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

        func checkCancellation() throws {
            guard !cancellationObserver() else { throw AOSAXObservationError.cancelled }
        }

        func providerCall<Value>(_ body: () -> Value) throws -> Value {
            try checkCancellation()
            let value = body()
            try checkCancellation()
            return value
        }

        try checkCancellation()
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
        var pendingEdgesByHandle: [Provider.Handle: [AOSAXPendingEdge<Provider.Handle>]] = [:]
        var pendingEdgeCount = 0
        var nextPendingEdgeSequence = 0
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
        var valueCostByConstituent: [String?: Int] = [:]
        var remainingRelationshipItems = 0
        var nodes: [AOSAXNodeProjection] = []
        var frontier: [AOSAXFrontierEntry] = []
        var rootStopped = false
        var traversalStopped = false
        let maxFrontier = admission.effectiveLimits.observationLimits.maxFrontier

        func deadlineReached() -> Bool {
            store.monotonicNow() >= deadline
        }

        func classified(_ error: AOSAXPlatformError, as kind: AOSAXPlatformErrorKind) throws -> AOSAXPlatformError {
            let exact = error.classified(as: kind)
            guard AOSAXContractAdmission.platformError(exact) else {
                throw AOSAXObservationError.invalidRoot
            }
            return exact
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

        func frontierReason(for kind: AOSAXStopKind) -> AOSAXFrontierReason {
            switch kind {
            case .depthBound: return .depthBound
            case .visitedBound: return .visitedBound
            case .emittedBound: return .emittedBound
            case .deadline: return .deadline
            case .valueCostBound: return .valueCostBound
            case .arrayBound: return .arrayBound
            case .platformUnsupported: return .platformUnsupported
            case .platformUnavailable: return .platformUnavailable
            case .platformError: return .platformError
            case .generationMismatch: return .generationMismatch
            case .retentionLimit, .snapshotExpired, .sourceSnapshotExpired, .sourceSnapshotEvicted, .sourceRefMissing, .complete:
                return .retentionLimit
            }
        }

        func recordProviderStop(_ error: AOSAXPlatformError) {
            if stopCondition.kind == .complete {
                stopCondition = .init(kind: stopKind(for: error.kind), detail: error.code, error: error)
            }
        }

        func queuedFrontierDebt() -> Int {
            max(0, queue.count - queueIndex)
        }

        func canGrowFrontierDebt(by amount: Int) -> Bool {
            guard amount >= 0 else { return false }
            let base = frontier.count.addingReportingOverflow(queuedFrontierDebt())
            guard !base.overflow else { return false }
            let pending = base.partialValue.addingReportingOverflow(pendingEdgeCount)
            guard !pending.overflow else { return false }
            let total = pending.partialValue.addingReportingOverflow(amount)
            return !total.overflow && total.partialValue <= maxFrontier
        }

        @discardableResult
        func appendFrontier(_ entry: AOSAXFrontierEntry) -> Bool {
            guard canGrowFrontierDebt(by: 1) else { return false }
            frontier.append(entry)
            return true
        }

        func appendRemainingQueue(reason: AOSAXFrontierReason) {
            guard queueIndex < queue.count else { return }
            let remaining = Array(queue[queueIndex...])
            queueIndex = queue.count
            for entry in remaining {
                _ = appendFrontier(.init(
                    parentRef: entry.parentRef,
                    relationshipName: entry.incomingRelationship,
                    childPosition: entry.childPosition,
                    depth: entry.depth,
                    ref: nil,
                    constituentID: entry.constituentID,
                    reason: reason
                ))
            }
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
            guard !deadlineReached() else { throw AOSAXHandleAdmissionError.deadline }
            try checkCancellation()
            provider.retain(handle: handle)
            do { try checkCancellation() } catch {
                provider.release(handle: handle)
                throw error
            }
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
            guard !deadlineReached() else { throw AOSAXHandleAdmissionError.deadline }
            guard discoveredHandles.count < request.bounds.maxVisited,
                  canGrowFrontierDebt(by: 1) else {
                throw AOSAXObservationError.retentionLimit
            }
            let box = try retainedBox(handle)
            discoveredHandles.insert(handle)
            queue.append(.init(
                handle: box,
                parentRef: nil,
                incomingRelationship: nil,
                childPosition: nil,
                depth: 0,
                constituentID: constituentID
            ))
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

        func generationCheck(_ generation: AOSAXProcessGeneration) throws -> AOSAXGenerationCheck {
            guard AOSAXContractAdmission.generation(generation) else { throw AOSAXObservationError.invalidRoot }
            guard !deadlineReached() else { return .deadline }
            let observation = try providerCall { generationObserver.observeGeneration(pid: generation.pid) }
            guard !deadlineReached() else { return .deadline }
            switch observation {
            case .value(let actual):
                guard AOSAXContractAdmission.generation(actual) else { throw AOSAXObservationError.invalidRoot }
                guard actual == generation else {
                    return .mismatched(.init(
                        kind: .unavailable,
                        code: "AX_PROCESS_GENERATION_MISMATCH",
                        detail: "observed process generation differs from requested generation"
                    ))
                }
                return .matched
            case .unavailable(let error):
                return .unavailable(try classified(error, as: .unavailable))
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

        func generationRootDeadline(
            generation: AOSAXProcessGeneration,
            constituentID: String?,
            detail: String
        ) -> AOSAXCompositeConstituentResult {
            let error = AOSAXPlatformError(
                kind: .unavailable,
                code: "AX_DEADLINE_EXCEEDED",
                detail: detail
            )
            stopCondition = .init(kind: .deadline, detail: detail, error: error)
            return .init(
                id: constituentID ?? "root",
                generation: generation,
                outcome: .unavailable,
                error: error
            )
        }

        func admitGenerationRoot(
            _ generation: AOSAXProcessGeneration,
            constituentID: String?,
            resolve: () -> AOSAXPlatformResult<Provider.Handle>
        ) throws -> AOSAXCompositeConstituentResult? {
            switch try generationCheck(generation) {
            case .matched:
                break
            case .mismatched(let error):
                stopCondition = .init(kind: .generationMismatch, detail: error.code, error: error)
                return .init(id: constituentID ?? "root", generation: generation, outcome: .unavailable, error: error)
            case .unavailable(let error):
                return providerRootFailure(generation: generation, constituentID: constituentID, error: error)
            case .deadline:
                return generationRootDeadline(
                    generation: generation,
                    constituentID: constituentID,
                    detail: "root generation was not observed before the monotonic deadline"
                )
            }
            guard !deadlineReached() else {
                return generationRootDeadline(
                    generation: generation,
                    constituentID: constituentID,
                    detail: "root provider was not called before the monotonic deadline"
                )
            }
            let resolution = try providerCall(resolve)
            guard !deadlineReached() else {
                return generationRootDeadline(
                    generation: generation,
                    constituentID: constituentID,
                    detail: "root provider returned after the monotonic deadline"
                )
            }
            switch resolution {
            case .value(let handle):
                do {
                    try enqueueRoot(handle, constituentID: constituentID)
                } catch AOSAXHandleAdmissionError.deadline {
                    return generationRootDeadline(
                        generation: generation,
                        constituentID: constituentID,
                        detail: "root handle retention reached the monotonic deadline"
                    )
                }
                generationBindings.append(.init(generation: generation, constituentID: constituentID))
                return nil
            case .unsupported(let error):
                return providerRootFailure(
                    generation: generation,
                    constituentID: constituentID,
                    error: try classified(error, as: .unsupported)
                )
            case .unavailable(let error):
                return providerRootFailure(
                    generation: generation,
                    constituentID: constituentID,
                    error: try classified(error, as: .unavailable)
                )
            case .platformError(let error):
                return providerRootFailure(
                    generation: generation,
                    constituentID: constituentID,
                    error: try classified(error, as: .platformError)
                )
            }
        }

        func settleCompositeAdmissionDeadline(
            applications: [AOSAXProcessGeneration],
            remainingStart: Int
        ) {
            let error = AOSAXPlatformError(
                kind: .unavailable,
                code: "AX_DEADLINE_EXCEEDED",
                detail: "composite constituent was not traversed before the monotonic deadline"
            )
            stopCondition = .init(kind: .deadline, detail: "deadline reached during composite-root admission", error: error)
            queue.removeAll(keepingCapacity: true)
            queueIndex = 0
            generationBindings.removeAll(keepingCapacity: true)
            for priorIndex in constituents.indices {
                let prior = constituents[priorIndex]
                if prior.outcome == .complete {
                    constituents[priorIndex] = .init(
                        id: prior.id,
                        generation: prior.generation,
                        outcome: .unavailable,
                        error: error
                    )
                }
                if constituents[priorIndex].error?.code == "AX_DEADLINE_EXCEEDED",
                   !frontier.contains(where: { $0.constituentID == prior.id }) {
                    _ = appendFrontier(.init(
                        parentRef: nil,
                        relationshipName: nil,
                        childPosition: priorIndex,
                        depth: 0,
                        ref: nil,
                        constituentID: prior.id,
                        reason: .deadline
                    ))
                }
            }
            if remainingStart < applications.count {
                for remainingIndex in remainingStart..<applications.count {
                    let remainingGeneration = applications[remainingIndex]
                    let remainingID = "application-\(remainingIndex)-pid-\(remainingGeneration.pid)"
                    constituents.append(.init(
                        id: remainingID,
                        generation: remainingGeneration,
                        outcome: .unavailable,
                        error: error
                    ))
                    _ = appendFrontier(.init(
                        parentRef: nil,
                        relationshipName: nil,
                        childPosition: remainingIndex,
                        depth: 0,
                        ref: nil,
                        constituentID: remainingID,
                        reason: .deadline
                    ))
                }
            }
            rootStopped = true
        }

        func settleCompositeAdmissionBound(
            applications: [AOSAXProcessGeneration],
            remainingStart: Int
        ) {
            guard remainingStart < applications.count else { return }
            stopCondition = .init(
                kind: .visitedBound,
                detail: "display-composite constituent admission reached maxVisited"
            )
            for remainingIndex in remainingStart..<applications.count {
                let generation = applications[remainingIndex]
                constituents.append(.init(
                    id: "application-\(remainingIndex)-pid-\(generation.pid)",
                    generation: generation,
                    outcome: .truncated
                ))
            }
            let generation = applications[remainingStart]
            _ = appendFrontier(.init(
                parentRef: nil,
                relationshipName: nil,
                childPosition: remainingStart,
                depth: 0,
                ref: nil,
                constituentID: "application-\(remainingStart)-pid-\(generation.pid)",
                reason: .visitedBound,
                remainingCount: applications.count - remainingStart
            ))
        }

        let rootIdentity: AOSAXRootIdentity
        switch request.root {
        case .systemWide:
            rootIdentity = try .init(kind: .systemWide)
            guard !deadlineReached() else {
                stopCondition = .init(kind: .deadline, detail: "deadline reached before system-root access")
                _ = appendFrontier(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: nil, constituentID: nil, reason: .deadline))
                rootStopped = true
                break
            }
            let resolution = try providerCall { provider.systemWideRoot(deadlineNanoseconds: deadline) }
            if deadlineReached() {
                stopCondition = .init(kind: .deadline, detail: "system-root provider returned after the monotonic deadline")
                _ = appendFrontier(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: nil, constituentID: nil, reason: .deadline))
                rootStopped = true
                break
            }
            switch resolution {
            case .value(let handle):
                do {
                    try enqueueRoot(handle, constituentID: nil)
                } catch AOSAXHandleAdmissionError.deadline {
                    stopCondition = .init(kind: .deadline, detail: "system-root retention reached the monotonic deadline")
                    _ = appendFrontier(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: nil, constituentID: nil, reason: .deadline))
                    rootStopped = true
                }
            case .unsupported(let error):
                let exact = try classified(error, as: .unsupported)
                forcedOutcome = .unsupported
                stopCondition = .init(kind: .platformUnsupported, detail: exact.code, error: exact)
            case .unavailable(let error):
                let exact = try classified(error, as: .unavailable)
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .platformUnavailable, detail: exact.code, error: exact)
            case .platformError(let error):
                let exact = try classified(error, as: .platformError)
                forcedOutcome = .unavailable
                stopCondition = .init(kind: .platformError, detail: exact.code, error: exact)
            }
        case .application(let generation):
            rootIdentity = try .init(kind: .application, generation: generation)
            if let result = try admitGenerationRoot(generation, constituentID: nil, resolve: {
                provider.applicationRoot(generation: generation, deadlineNanoseconds: deadline)
            }) {
                forcedOutcome = stopCondition.kind == .deadline ? nil : result.outcome
                if stopCondition.kind == .deadline {
                    _ = appendFrontier(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: nil, constituentID: nil, reason: .deadline))
                    rootStopped = true
                }
            }
        case .window(let generation, let windowID):
            rootIdentity = try .init(kind: .window, generation: generation, windowID: windowID)
            if let result = try admitGenerationRoot(generation, constituentID: nil, resolve: {
                provider.windowRoot(generation: generation, windowID: windowID, deadlineNanoseconds: deadline)
            }) {
                forcedOutcome = stopCondition.kind == .deadline ? nil : result.outcome
                if stopCondition.kind == .deadline {
                    _ = appendFrontier(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: nil, constituentID: nil, reason: .deadline))
                    rootStopped = true
                }
            }
        case .element(let sourceStateID, let sourceRef):
            rootIdentity = try .init(kind: .element, sourceStateID: sourceStateID, sourceRef: sourceRef)
            guard !deadlineReached() else {
                stopCondition = .init(kind: .deadline, detail: "deadline reached before Observation Ref borrow")
                _ = appendFrontier(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: sourceRef, constituentID: nil, reason: .deadline))
                rootStopped = true
                break
            }
            switch store.resolveElement(stateID: sourceStateID, ref: sourceRef) {
            case .value(let lease):
                borrowLeases.append(lease)
                try checkCancellation()
                do {
                    try enqueueRoot(lease.value, constituentID: nil)
                } catch AOSAXHandleAdmissionError.deadline {
                    stopCondition = .init(kind: .deadline, detail: "Observation Ref retention reached the monotonic deadline")
                    _ = appendFrontier(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: sourceRef, constituentID: nil, reason: .deadline))
                    rootStopped = true
                }
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
            rootIdentity = try .init(
                kind: .displayComposite,
                topologyIdentity: topologyIdentity,
                constituentCount: applications.count
            )
            for (index, generation) in applications.enumerated() {
                try checkCancellation()
                if discoveredHandles.count >= request.bounds.maxVisited {
                    settleCompositeAdmissionBound(applications: applications, remainingStart: index)
                    break
                }
                let constituentID = "application-\(index)-pid-\(generation.pid)"
                if deadlineReached() {
                    settleCompositeAdmissionDeadline(applications: applications, remainingStart: index)
                    break
                }
                if let result = try admitGenerationRoot(generation, constituentID: constituentID, resolve: {
                    provider.applicationRoot(generation: generation, deadlineNanoseconds: deadline)
                }) {
                    constituents.append(result)
                    if stopCondition.kind == .deadline {
                        settleCompositeAdmissionDeadline(applications: applications, remainingStart: index + 1)
                        break
                    }
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

        traversalStopped = forcedOutcome != nil || rootStopped
        remainingRelationshipItems = min(
            request.bounds.maxVisited + request.bounds.maxArrayItems,
            max(0, admission.effectiveLimits.observationLimits.maxFrontier - queue.count)
        )

        func stopAtDeadline(expanding entry: AOSAXVisitEntry<Provider.Handle>?) {
            stopCondition = .init(kind: .deadline, detail: "monotonic observation deadline reached")
            if let entry {
                _ = appendFrontier(.init(
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
            entry: AOSAXVisitEntry<Provider.Handle>,
            reason: AOSAXFrontierReason
        ) {
            for index in relationshipIndex..<relationships.count {
                let relationship = relationships[index]
                let start = index == relationshipIndex ? childPosition : 0
                guard start < relationship.elements.count else { continue }
                _ = appendFrontier(.init(
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
        ) throws -> ([String], AOSAXProviderReadOutcome) {
            guard !deadlineReached() else { return ([], .init(kind: .deadlineExceeded)) }
            let result = try providerCall(body)
            guard !deadlineReached() else { return ([], .init(kind: .deadlineExceeded)) }
            switch result {
            case .value(let names):
                guard names.count <= request.bounds.maxArrayItems,
                      Set(names).count == names.count,
                      names.allSatisfy({ AOSAXContractAdmission.identifier($0) }) else {
                    let error = AOSAXPlatformError(
                        kind: .platformError,
                        code: "AX_PROVIDER_RESULT_INVALID",
                        detail: "provider name list violated uniqueness, identity, or item bounds"
                    )
                    return ([], .init(kind: .platformError, error: error))
                }
                return (names.sorted(by: AOSAXValueCodec<Provider.Handle>.unicodeScalarLess), .init(kind: .value))
            case .unsupported(let error):
                let exact = try classified(error, as: .unsupported)
                return ([], .init(kind: .unsupported, error: exact))
            case .unavailable(let error):
                let exact = try classified(error, as: .unavailable)
                return ([], .init(kind: .unavailable, error: exact))
            case .platformError(let error):
                let exact = try classified(error, as: .platformError)
                return ([], .init(kind: .platformError, error: exact))
            }
        }

        while !traversalStopped, queueIndex < queue.count {
            try checkCancellation()
            if visited >= request.bounds.maxVisited {
                stopCondition = .init(kind: .visitedBound, detail: "visited-node breadth bound reached")
                appendRemainingQueue(reason: .visitedBound)
                break
            }
            guard !deadlineReached() else {
                stopAtDeadline(expanding: nil)
                break
            }

            let queued = queue[queueIndex]
            queueIndex += 1
            let entry = AOSAXVisitEntry(queued: queued, ref: try assignedRef(queued.handle.value, constituentID: queued.constituentID))
            if entry.parentRef == nil {
                ancestorJumps[entry.ref] = []
                depthsByRef[entry.ref] = 0
            } else {
                recordParent(childRef: entry.ref, parentRef: entry.parentRef!, depth: entry.depth)
            }
            visited += 1
            visitedHandles.insert(entry.handle.value)
            if let pending = pendingEdgesByHandle.removeValue(forKey: entry.handle.value) {
                pendingEdgeCount -= pending.count
                duplicateEdges += pending.count
                for edge in pending {
                    guard let parentIndex = nodes.firstIndex(where: { $0.ref == edge.parentRef }) else { continue }
                    nodes[parentIndex].referenceEdges.append(.init(
                        relationshipName: edge.relationshipName,
                        childPosition: edge.childPosition,
                        ref: entry.ref,
                        kind: .duplicate
                    ))
                    nodes[parentIndex].referenceEdges.sort { lhs, rhs in
                        if lhs.relationshipName == rhs.relationshipName {
                            return lhs.childPosition < rhs.childPosition
                        }
                        return AOSAXValueCodec<Provider.Handle>.unicodeScalarLess(
                            lhs.relationshipName,
                            rhs.relationshipName
                        )
                    }
                }
            }

            guard !deadlineReached() else {
                _ = appendFrontier(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .deadline))
                stopAtDeadline(expanding: nil)
                break
            }
            let facts: AOSAXElementFacts
            let factsResult = try providerCall { provider.facts(for: entry.handle.value, deadlineNanoseconds: deadline) }
            guard !deadlineReached() else {
                _ = appendFrontier(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .deadline))
                stopAtDeadline(expanding: nil)
                break
            }
            switch factsResult {
            case .value(let value):
                guard AOSAXContractAdmission.facts(value) else {
                    let error = AOSAXPlatformError(
                        kind: .platformError,
                        code: "AX_PROVIDER_RESULT_BOUND_EXCEEDED",
                        detail: "provider element facts exceeded the admitted string or geometry bound"
                    )
                    recordProviderStop(error)
                    _ = appendFrontier(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .platformError))
                    appendRemainingQueue(reason: .platformError)
                    traversalStopped = true
                    continue
                }
                facts = value
            case .unsupported(let error):
                let exact = try classified(error, as: .unsupported)
                recordProviderStop(exact)
                _ = appendFrontier(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .platformUnsupported))
                appendRemainingQueue(reason: .platformUnsupported)
                traversalStopped = true
                continue
            case .unavailable(let error):
                let exact = try classified(error, as: .unavailable)
                recordProviderStop(exact)
                _ = appendFrontier(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .platformUnavailable))
                appendRemainingQueue(reason: .platformUnavailable)
                traversalStopped = true
                continue
            case .platformError(let error):
                let exact = try classified(error, as: .platformError)
                recordProviderStop(exact)
                _ = appendFrontier(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .platformError))
                appendRemainingQueue(reason: .platformError)
                traversalStopped = true
                continue
            }

            let needsAttributeNames = request.projection.attributes || request.projection.settableFacts
            var attributeNameRead: ([String], AOSAXProviderReadOutcome)? = needsAttributeNames
                ? try readNames { provider.attributeNames(for: entry.handle.value, deadlineNanoseconds: deadline) }
                : nil
            var filterAttributeNames = Set<String>()
            for filter in request.filters {
                for expected in filter.rawAttributeOutcomes { filterAttributeNames.insert(expected.name) }
            }
            var readNamesSet = filterAttributeNames
            let projectedAttributeNames = Set(attributeNameRead?.0 ?? [])
            if !projectedAttributeNames.isEmpty {
                let combined = readNamesSet.union(projectedAttributeNames)
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
            var providerDeadlineHit = false

            func appendDeadlineAttributes(from startIndex: Int, detail: String) {
                guard startIndex < namesToRead.count else { return }
                internalAttributes.append(contentsOf: namesToRead[startIndex...].map {
                    .init(name: $0, outcome: .deadlineExceeded, detail: detail)
                })
                providerDeadlineHit = true
            }

            var transactionRefs: [Provider.Handle: String] = [:]
            var transactionBoxes = Set<Provider.Handle>()
            var nodeValueRefs: [Provider.Handle: String] = [:]
            var nodeValueBoxes = Set<Provider.Handle>()
            var nodeValueCost = 0
            var nodeValuesCommitted = false
            func rollbackValueRefs(
                _ refs: inout [Provider.Handle: String],
                _ boxes: inout Set<Provider.Handle>
            ) {
                for (handle, ref) in refs where refsByHandle[handle] == ref && !visitedHandles.contains(handle) {
                    refsByHandle.removeValue(forKey: handle)
                    usedRefIDs.remove(ref)
                    refConstituent.removeValue(forKey: ref)
                }
                for handle in boxes where refsByHandle[handle] == nil && !discoveredHandles.contains(handle) {
                    boxesByHandle.removeValue(forKey: handle)?.releaseOnce()
                }
                refs.removeAll(keepingCapacity: true)
                boxes.removeAll(keepingCapacity: true)
            }
            defer {
                if !nodeValuesCommitted {
                    rollbackValueRefs(&nodeValueRefs, &nodeValueBoxes)
                }
            }
            let codec = AOSAXValueCodec<Provider.Handle>(
                bounds: try AOSAXValueCodecBounds(
                    maxArrayDepth: request.bounds.maxArrayDepth,
                    maxArrayItems: request.bounds.maxArrayItems,
                    maxAggregateCost: request.bounds.maxValueCost
                ),
                resolveElementRef: { handle in
                    let hadRef = refsByHandle[handle] != nil
                    let hadBox = boxesByHandle[handle] != nil
                    let admitted = try admitRef(handle, constituentID: entry.constituentID)
                    if !hadRef { transactionRefs[handle] = admitted.0 }
                    if !hadBox { transactionBoxes.insert(handle) }
                    return admitted.0
                }
            )
            attributeLoop: for (nameIndex, name) in namesToRead.enumerated() {
                guard !deadlineReached() else {
                    appendDeadlineAttributes(from: nameIndex, detail: "monotonic deadline")
                    break
                }
                let attributeResult = try providerCall {
                    provider.attribute(name, for: entry.handle.value, deadlineNanoseconds: deadline)
                }
                guard !deadlineReached() else {
                    appendDeadlineAttributes(
                        from: nameIndex,
                        detail: "provider returned after monotonic deadline"
                    )
                    break
                }
                switch attributeResult {
                case .noValue:
                    internalAttributes.append(.init(name: name, outcome: .noValue))
                case .unsupported:
                    internalAttributes.append(.init(name: name, outcome: .unsupported))
                case .unavailable(let error):
                    internalAttributes.append(.init(name: name, outcome: .platformError, error: try classified(error, as: .unavailable)))
                case .platformError(let error):
                    internalAttributes.append(.init(name: name, outcome: .platformError, error: try classified(error, as: .platformError)))
                case .value(let platformValue):
                    let projectsValue = request.projection.attributes && projectedAttributeNames.contains(name)
                    guard projectsValue || filterAttributeNames.contains(name) else {
                        internalAttributes.append(.init(name: name, outcome: .value))
                        continue
                    }
                    transactionRefs.removeAll(keepingCapacity: true)
                    transactionBoxes.removeAll(keepingCapacity: true)
                    let encoded: AOSAXValueEncoding
                    do {
                        let consumedValueCost = projectsValue ? valueCost + nodeValueCost : 0
                        encoded = try codec.encode(platformValue, consumed: consumedValueCost)
                    } catch AOSAXHandleAdmissionError.deadline {
                        rollbackValueRefs(&transactionRefs, &transactionBoxes)
                        appendDeadlineAttributes(
                            from: nameIndex,
                            detail: "value retention reached monotonic deadline"
                        )
                        break attributeLoop
                    } catch {
                        rollbackValueRefs(&transactionRefs, &transactionBoxes)
                        throw error
                    }
                    if let value = encoded.value {
                        if projectsValue {
                            nodeValueCost += encoded.cost
                            for (handle, ref) in transactionRefs { nodeValueRefs[handle] = ref }
                            nodeValueBoxes.formUnion(transactionBoxes)
                            transactionRefs.removeAll(keepingCapacity: true)
                            transactionBoxes.removeAll(keepingCapacity: true)
                            internalAttributes.append(.init(name: name, outcome: .value, value: value))
                        } else {
                            rollbackValueRefs(&transactionRefs, &transactionBoxes)
                            internalAttributes.append(.init(name: name, outcome: .value))
                        }
                    } else {
                        rollbackValueRefs(&transactionRefs, &transactionBoxes)
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
                            if projectsValue { valueBoundHit = true }
                        case .retainedRefs:
                            outcome = .unrepresentableType
                            detail = "retained Observation Ref bound"
                            if projectsValue { retentionBoundHit = true }
                        case .unrepresentable, nil:
                            outcome = .unrepresentableType
                            detail = "platform value has no closed representation"
                        }
                        internalAttributes.append(.init(name: name, outcome: outcome, detail: detail))
                    }
                }
            }

            if providerDeadlineHit {
                stopAtDeadline(expanding: entry)
            }

            let attributeOutcomes = Dictionary(
                uniqueKeysWithValues: internalAttributes.map { ($0.name, $0.outcome) }
            )
            var settableFacts: [AOSAXSettableFact]? = request.projection.settableFacts ? [] : nil
            if request.projection.settableFacts {
                let settableNames = attributeNameRead?.0 ?? []
                func appendDeadlineSettableFacts(from startIndex: Int) {
                    guard startIndex < settableNames.count else { return }
                    settableFacts?.append(contentsOf: settableNames[startIndex...].map {
                        .init(name: $0, outcome: .deadlineExceeded)
                    })
                }
                for (nameIndex, name) in settableNames.enumerated() {
                    guard !deadlineReached() else {
                        appendDeadlineSettableFacts(from: nameIndex)
                        if !traversalStopped { stopAtDeadline(expanding: entry) }
                        break
                    }
                    let settableResult = try providerCall {
                        provider.isAttributeSettable(name, for: entry.handle.value, deadlineNanoseconds: deadline)
                    }
                    guard !deadlineReached() else {
                        appendDeadlineSettableFacts(from: nameIndex)
                        if !traversalStopped { stopAtDeadline(expanding: entry) }
                        break
                    }
                    switch settableResult {
                    case .value(true): settableFacts?.append(.init(name: name, outcome: .settable))
                    case .value(false): settableFacts?.append(.init(name: name, outcome: .notSettable))
                    case .unsupported: settableFacts?.append(.init(name: name, outcome: .unsupported))
                    case .unavailable(let error):
                        settableFacts?.append(.init(name: name, outcome: .platformError, error: try classified(error, as: .unavailable)))
                    case .platformError(let error):
                        settableFacts?.append(.init(name: name, outcome: .platformError, error: try classified(error, as: .platformError)))
                    }
                }
            }

            let parameterizedRead: ([String], AOSAXProviderReadOutcome)? = request.projection.parameterizedAttributeNames
                ? try readNames { provider.parameterizedAttributeNames(for: entry.handle.value, deadlineNanoseconds: deadline) }
                : nil
            let actionRead: ([String], AOSAXProviderReadOutcome)? = request.projection.supportedActionNames
                ? try readNames { provider.supportedActionNames(for: entry.handle.value, deadlineNanoseconds: deadline) }
                : nil

            if !traversalStopped && deadlineReached() {
                stopAtDeadline(expanding: entry)
            } else if valueBoundHit || retentionBoundHit {
                let reason: AOSAXFrontierReason = valueBoundHit ? .valueCostBound : .retentionLimit
                stopCondition = .init(
                    kind: valueBoundHit ? .valueCostBound : .retentionLimit,
                    detail: valueBoundHit ? "aggregate representable-value cost bound reached" : "retained Observation Ref capacity reached"
                )
                _ = appendFrontier(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: reason))
                appendRemainingQueue(reason: reason)
                traversalStopped = true
            }

            var relationships: [AOSAXPlatformRelationship<Provider.Handle>] = []
            var relationshipRead = AOSAXProviderReadOutcome(
                kind: stopCondition.kind == .deadline ? .deadlineExceeded : .notAttempted
            )
            var providerRelationshipFrontier: [AOSAXPlatformRelationshipFrontier] = []
            if !traversalStopped {
                let availableFrontierCapacity = max(
                    0,
                    maxFrontier - frontier.count - queuedFrontierDebt() - pendingEdgeCount
                )
                let relationshipFrontierCapacity = max(0, availableFrontierCapacity - 1)
                guard remainingRelationshipItems > 0, relationshipFrontierCapacity > 0 else {
                    stopCondition = .init(kind: .arrayBound, detail: "relationship-element resource bound reached")
                    _ = appendFrontier(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .arrayBound))
                    appendRemainingQueue(reason: .arrayBound)
                    traversalStopped = true
                    continue
                }
                guard !deadlineReached() else {
                    stopAtDeadline(expanding: entry)
                    continue
                }
                let relationshipAdmission = min(
                    request.bounds.maxArrayItems,
                    remainingRelationshipItems,
                    relationshipFrontierCapacity
                )
                let relationshipResult = try providerCall {
                    provider.relationships(
                        for: entry.handle.value,
                        deadlineNanoseconds: deadline,
                        maximumNames: request.bounds.maxArrayItems,
                        maximumResultItems: relationshipAdmission + request.bounds.maxArrayItems
                    )
                }
                if deadlineReached() {
                    relationshipRead = .init(kind: .deadlineExceeded)
                    stopAtDeadline(expanding: entry)
                } else {
                    switch relationshipResult {
                case .value(let batch):
                    let relationshipNames = batch.relationships.map(\.name)
                    let relationshipNameIdentities = relationshipNames.map {
                        $0.unicodeScalars.map(\.value)
                    }
                    guard Set(relationshipNameIdentities).count == relationshipNames.count else {
                        let error = AOSAXPlatformError(
                            kind: .platformError,
                            code: "AX_PROVIDER_RESULT_INVALID",
                            detail: "relationship provider returned duplicate group names"
                        )
                        relationshipRead = .init(kind: .platformError, error: error)
                        recordProviderStop(error)
                        _ = appendFrontier(.init(
                            parentRef: entry.ref,
                            relationshipName: nil,
                            childPosition: nil,
                            depth: entry.depth + 1,
                            ref: nil,
                            constituentID: entry.constituentID,
                            reason: .platformError
                        ))
                        appendRemainingQueue(reason: .platformError)
                        traversalStopped = true
                        break
                    }
                    let total = batch.relationships.reduce(into: 0) { partial, relationship in
                        let next = partial.addingReportingOverflow(relationship.elements.count)
                        partial = next.overflow ? Int.max : next.partialValue
                    }
                    let validFrontier = batch.frontier.count <= request.bounds.maxArrayItems && batch.frontier.allSatisfy {
                        AOSAXContractAdmission.identifier($0.name) && $0.nextChildPosition >= 0 && $0.remainingCount > 0
                    }
                    let namedCost = batch.relationships.count.addingReportingOverflow(total)
                    let combinedCost = namedCost.partialValue.addingReportingOverflow(batch.frontier.count)
                    guard !namedCost.overflow,
                          !combinedCost.overflow,
                          batch.relationships.count <= request.bounds.maxArrayItems,
                          batch.relationships.allSatisfy({ AOSAXContractAdmission.identifier($0.name) }),
                          combinedCost.partialValue <= relationshipAdmission,
                          validFrontier else {
                        let error = AOSAXPlatformError(kind: .platformError, code: "AX_PROVIDER_RESULT_BOUND_EXCEEDED", detail: "relationship provider violated the admitted bounded batch")
                        relationshipRead = .init(kind: .platformError, error: error)
                        recordProviderStop(error)
                        _ = appendFrontier(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .platformError))
                        traversalStopped = true
                        continue
                    }
                    remainingRelationshipItems -= combinedCost.partialValue
                    relationships = batch.relationships.sorted { AOSAXValueCodec<Provider.Handle>.unicodeScalarLess($0.name, $1.name) }
                    providerRelationshipFrontier = batch.frontier.sorted {
                        if $0.name == $1.name { return $0.nextChildPosition < $1.nextChildPosition }
                        return AOSAXValueCodec<Provider.Handle>.unicodeScalarLess($0.name, $1.name)
                    }
                    relationshipRead = .init(kind: .value)
                case .unsupported(let error):
                    let exact = try classified(error, as: .unsupported)
                    relationshipRead = .init(kind: .unsupported, error: exact)
                    recordProviderStop(exact)
                    _ = appendFrontier(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .platformUnsupported))
                case .unavailable(let error):
                    let exact = try classified(error, as: .unavailable)
                    relationshipRead = .init(kind: .unavailable, error: exact)
                    recordProviderStop(exact)
                    _ = appendFrontier(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .platformUnavailable))
                case .platformError(let error):
                    let exact = try classified(error, as: .platformError)
                    relationshipRead = .init(kind: .platformError, error: exact)
                    recordProviderStop(exact)
                    _ = appendFrontier(.init(parentRef: entry.ref, relationshipName: nil, childPosition: nil, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .platformError))
                    }
                }
            }

            var referenceEdges: [AOSAXReferenceEdge] = []
            relationshipLoop: for (relationshipIndex, relationship) in relationships.enumerated() {
                for (position, child) in relationship.elements.enumerated() {
                    try checkCancellation()
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
                        guard canGrowFrontierDebt(by: 1) else {
                            stopCondition = .init(
                                kind: .retentionLimit,
                                detail: "effective frontier capacity reached before pending-edge admission"
                            )
                            appendRelationshipRemainder(
                                relationships,
                                relationshipIndex: relationshipIndex,
                                childPosition: position,
                                entry: entry,
                                reason: .retentionLimit
                            )
                            appendRemainingQueue(reason: .retentionLimit)
                            traversalStopped = true
                            break relationshipLoop
                        }
                        pendingEdgesByHandle[child, default: []].append(.init(
                            sequence: nextPendingEdgeSequence,
                            child: child,
                            parentRef: entry.ref,
                            relationshipName: relationship.name,
                            childPosition: position,
                            depth: entry.depth + 1,
                            constituentID: entry.constituentID
                        ))
                        nextPendingEdgeSequence += 1
                        pendingEdgeCount += 1
                        continue
                    }
                    if entry.depth >= request.bounds.maxDepth {
                        _ = appendFrontier(.init(parentRef: entry.ref, relationshipName: relationship.name, childPosition: position, depth: entry.depth + 1, ref: nil, constituentID: entry.constituentID, reason: .depthBound))
                        if stopCondition.kind == .complete {
                            stopCondition = .init(kind: .depthBound, detail: "maximum traversal depth reached")
                        }
                        continue
                    }
                    let traversalCapacityAvailable = discoveredHandles.count < request.bounds.maxVisited &&
                        boxesByHandle.count < admission.maxRetainedRefs
                    let frontierCapacityAvailable = canGrowFrontierDebt(by: 1)
                    guard traversalCapacityAvailable, frontierCapacityAvailable else {
                        let reason: AOSAXFrontierReason = frontierCapacityAvailable ? .visitedBound : .retentionLimit
                        appendRelationshipRemainder(
                            relationships,
                            relationshipIndex: relationshipIndex,
                            childPosition: position,
                            entry: entry,
                            reason: reason
                        )
                        stopCondition = .init(
                            kind: frontierCapacityAvailable ? .visitedBound : .retentionLimit,
                            detail: frontierCapacityAvailable
                                ? "traversal resources exhausted before relationship retention"
                                : "effective frontier capacity reached before relationship retention"
                        )
                        appendRemainingQueue(reason: reason)
                        traversalStopped = true
                        break relationshipLoop
                    }
                    let box: AOSAXRetainedHandle<Provider.Handle>
                    do {
                        box = try retainedBox(child)
                    } catch AOSAXHandleAdmissionError.deadline {
                        appendRelationshipRemainder(
                            relationships,
                            relationshipIndex: relationshipIndex,
                            childPosition: position,
                            entry: entry,
                            reason: .deadline
                        )
                        stopAtDeadline(expanding: nil)
                        traversalStopped = true
                        break relationshipLoop
                    }
                    discoveredHandles.insert(child)
                    queue.append(.init(
                        handle: box,
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
                    _ = appendFrontier(.init(
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
                    _ = appendFrontier(.init(parentRef: entry.parentRef, relationshipName: entry.incomingRelationship, childPosition: entry.childPosition, depth: entry.depth, ref: entry.ref, constituentID: entry.constituentID, reason: .emittedBound))
                    stopCondition = .init(kind: .emittedBound, detail: "emitted-node bound reached")
                    appendRemainingQueue(reason: .emittedBound)
                    traversalStopped = true
                } else {
                    if request.projection.attributes {
                        valueCost += nodeValueCost
                        valueCostByConstituent[entry.constituentID, default: 0] += nodeValueCost
                        nodeValuesCommitted = true
                    }
                    emitted += 1
                    nodes.append(.init(
                        ref: entry.ref,
                        parentRef: entry.parentRef,
                        incomingRelationship: entry.incomingRelationship,
                        childPosition: entry.childPosition,
                        depth: entry.depth,
                        constituentID: entry.constituentID,
                        facts: facts,
                        attributes: request.projection.attributes
                            ? internalAttributes.filter { projectedAttributeNames.contains($0.name) }
                            : nil,
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

        if pendingEdgeCount > 0 {
            let unsettled = pendingEdgesByHandle.values
                .flatMap { $0 }
                .sorted { $0.sequence < $1.sequence }
            pendingEdgesByHandle.removeAll(keepingCapacity: true)
            pendingEdgeCount = 0
            if stopCondition.kind == .complete {
                stopCondition = .init(
                    kind: .retentionLimit,
                    detail: "traversal ended before pending relationship edges could settle"
                )
            }
            let reason = frontierReason(for: stopCondition.kind)
            for edge in unsettled {
                _ = appendFrontier(.init(
                    parentRef: edge.parentRef,
                    relationshipName: edge.relationshipName,
                    childPosition: edge.childPosition,
                    depth: edge.depth,
                    ref: nil,
                    constituentID: edge.constituentID,
                    reason: reason
                ))
            }
        }

        var generationFailures: [(id: String?, reason: AOSAXFrontierReason, stop: AOSAXStopCondition, error: AOSAXPlatformError)] = []
        for binding in generationBindings {
            switch try generationCheck(binding.generation) {
            case .matched:
                continue
            case .mismatched(let error):
                generationFailures.append((binding.constituentID, .generationMismatch, .init(kind: .generationMismatch, detail: error.code, error: error), error))
            case .unavailable(let error):
                generationFailures.append((binding.constituentID, .platformUnavailable, .init(kind: .platformUnavailable, detail: error.code, error: error), error))
            case .deadline:
                let error = AOSAXPlatformError(kind: .unavailable, code: "AX_DEADLINE_EXCEEDED", detail: "deadline prevented the required pre-commit generation sample")
                generationFailures.append((binding.constituentID, .deadline, .init(kind: .deadline, detail: error.detail, error: error), error))
            }
        }
        let invalidConstituents = Set(generationFailures.map(\.id))
        if !invalidConstituents.isEmpty {
            forcedOutcome = generationFailures.allSatisfy { $0.reason == .deadline }
                ? nil
                : .unavailable
            stopCondition = generationFailures[0].stop
            nodes.removeAll { invalidConstituents.contains($0.constituentID) }
            frontier.removeAll { invalidConstituents.contains($0.constituentID) }
            for failure in generationFailures {
                _ = appendFrontier(.init(parentRef: nil, relationshipName: nil, childPosition: nil, depth: 0, ref: nil, constituentID: failure.id, reason: failure.reason))
                valueCost -= valueCostByConstituent[failure.id, default: 0]
            }
            constituents = constituents.map { item in
                guard let failure = generationFailures.first(where: { $0.id == item.id }) else { return item }
                return .init(id: item.id, generation: item.generation, outcome: .unavailable, error: failure.error)
            }
        }

        if case .displayComposite = request.root, invalidConstituents.isEmpty {
            if constituents.contains(where: {
                $0.outcome == .unavailable && $0.error?.code != "AX_DEADLINE_EXCEEDED"
            }) {
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
            let unresolvedConstituentIDs = Set(frontier.compactMap(\.constituentID))
            constituents = constituents.map { item in
                item.outcome == .complete && unresolvedConstituentIDs.contains(item.id)
                    ? .init(id: item.id, generation: item.generation, outcome: .truncated, error: item.error)
                    : item
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
        try checkCancellation()
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
        try checkCancellation()
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
