import Foundation

let aosDesktopWorldDevToolsStageContract = "aos.desktop-world.devtools.stage.v2"
let aosDesktopWorldDevToolsSnapshotContract = "aos.desktop-world.devtools.snapshot.v2"

enum AOSDesktopWorldDevToolsTab: String, Codable, CaseIterable {
    case world
    case resources
    case interactions
    case performance
    case events
}

enum AOSDesktopWorldDevToolsHostKind: String, Codable, CaseIterable {
    case compatibility
    case external
    case panel
}

struct AOSDesktopWorldDevToolsHost: Equatable {
    let kind: AOSDesktopWorldDevToolsHostKind
    let id: String

    var key: String { id }
}

struct AOSDesktopWorldDevToolsFilters: Equatable {
    var query = ""
    var eventKinds: [String] = []
    var errorsOnly = false
}

enum AOSDesktopWorldDevToolsFieldPatch<Value> {
    case unchanged
    case clear
    case set(Value)
}

struct AOSDesktopWorldDevToolsUpdateRequest {
    let selectedResource: AOSDesktopWorldDevToolsFieldPatch<String>
    let activeTab: AOSDesktopWorldDevToolsTab?
    let filters: AOSDesktopWorldDevToolsFilters?
    let recording: Bool?

    static func parse(_ payload: [String: Any]) -> AOSDesktopWorldDevToolsUpdateRequest? {
        let selectedResource: AOSDesktopWorldDevToolsFieldPatch<String>
        if !payload.keys.contains("selected_resource") {
            selectedResource = .unchanged
        } else if payload["selected_resource"] is NSNull {
            selectedResource = .clear
        } else if let value = payload["selected_resource"] as? String {
            selectedResource = .set(value)
        } else {
            return nil
        }

        let activeTab: AOSDesktopWorldDevToolsTab?
        if payload.keys.contains("active_tab") {
            guard let value = payload["active_tab"] as? String,
                  let parsed = AOSDesktopWorldDevToolsTab(rawValue: value) else { return nil }
            activeTab = parsed
        } else {
            activeTab = nil
        }

        let filters: AOSDesktopWorldDevToolsFilters?
        if payload.keys.contains("filters") {
            guard let input = payload["filters"] as? [String: Any] else { return nil }
            guard Set(input.keys).isSubset(of: ["query", "event_kinds", "errors_only"]),
                  !input.keys.contains("query") || input["query"] is String,
                  !input.keys.contains("event_kinds") || input["event_kinds"] is [String],
                  !input.keys.contains("errors_only") || input["errors_only"] is Bool else { return nil }
            filters = AOSDesktopWorldDevToolsFilters(
                query: input["query"] as? String ?? "",
                eventKinds: input["event_kinds"] as? [String] ?? [],
                errorsOnly: input["errors_only"] as? Bool ?? false
            )
        } else {
            filters = nil
        }

        let recording: Bool?
        if payload.keys.contains("recording") {
            guard let value = payload["recording"] as? Bool else { return nil }
            recording = value
        } else {
            recording = nil
        }
        return AOSDesktopWorldDevToolsUpdateRequest(
            selectedResource: selectedResource,
            activeTab: activeTab,
            filters: filters,
            recording: recording
        )
    }
}

struct AOSDesktopWorldDevToolsSessionState: Equatable {
    let id: String
    let stageRequestID: String?
    var stageRequestCompletedRevision: Int?
    var revision: Int
    var selectedResource: String?
    var activeTab: AOSDesktopWorldDevToolsTab
    var filters: AOSDesktopWorldDevToolsFilters
    var recording: Bool
    var host: AOSDesktopWorldDevToolsHost?
    var ownedPanelIDs: Set<String>
}

struct AOSDesktopWorldDevToolsTransferPlan: Equatable {
    let token: UUID
    let sessionID: String
    let expectedRevision: Int
    let previous: AOSDesktopWorldDevToolsHost?
    let next: AOSDesktopWorldDevToolsHost
}

struct AOSDesktopWorldDevToolsStageSegmentIdentity: Equatable {
    let canvasGeneration: UInt64
    let topologyGeneration: UInt64
    let displayID: UInt32
    let index: Int
    let expectedIndexes: Set<Int>
}

enum AOSDesktopWorldDevToolsMutationResult {
    case success(AOSDesktopWorldDevToolsSessionState)
    case notFound
    case conflict(currentRevision: Int)
    case busy
    case invalid
    case capacity
}

enum AOSDesktopWorldDevToolsTransferResult {
    case prepared(AOSDesktopWorldDevToolsTransferPlan)
    case notFound
    case conflict(currentRevision: Int)
    case busy
    case invalid
}

@propertyWrapper
private struct AOSDesktopWorldRequiredNullable<Value: Codable>: Codable {
    var wrappedValue: Value?

    init(wrappedValue: Value?) {
        self.wrappedValue = wrappedValue
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        wrappedValue = container.decodeNil() ? nil : try container.decode(Value.self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let wrappedValue {
            try container.encode(wrappedValue)
        } else {
            try container.encodeNil()
        }
    }
}

private struct AOSDesktopWorldDevToolsStageSnapshot: Codable {
    struct Display: Codable, Equatable {
        let id: String
        let index: Int
        let bounds: [Double]
        let scaleFactor: Double
        let nativeBounds: [Double]?
    }

    struct Node: Codable {
        let id: String
        let resourceId: String
        @AOSDesktopWorldRequiredNullable var parentId: String?
        let kind: String
        @AOSDesktopWorldRequiredNullable var implementation: String?
        let position: [Double]
        let visible: Bool
    }

    struct HitRegion: Codable {
        let id: String
        let resourceId: String
        let affordanceId: String
        let frame: [Double]
        let registered: Bool
    }

    struct Affordance: Codable {
        let id: String
        let resourceId: String
        let objectId: String
        let enabled: Bool
        let priority: Int
    }

    struct Gesture: Codable {
        let id: String
        let resourceId: String
        let affordanceId: String
        let interactionId: String
        let kind: String
        let phase: String
        @AOSDesktopWorldRequiredNullable var pointerSessionId: String?
    }

    struct Route: Codable {
        let resourceId: String
        let kind: String
        let active: Bool
        let progress: Double
        let origin: [Double]
        let destination: [Double]
    }

    struct World: Codable {
        let displays: [Display]
        let nodes: [Node]
        let hitRegions: [HitRegion]
        let affordances: [Affordance]
        let gestures: [Gesture]
        let routes: [Route]
    }

    struct Allocations: Codable {
        let geometries: Int
        let materials: Int
        let textures: Int
        let programs: Int
    }

    struct Resource: Codable {
        let id: String
        let owner: String
        let sceneId: String
        let revision: Int
        let suspended: Bool
        let objectCount: Int
        let descriptorCount: Int
        let animationCount: Int
        let signalCount: Int
        let interactionCount: Int
        let implementations: [String]
        let allocations: Allocations
        let lifecycle: String
        @AOSDesktopWorldRequiredNullable var errorCode: String?
    }

    struct Interaction: Codable {
        let id: String
        let resourceId: String
        let owner: String
        let active: Bool
        let suspended: Bool
        let recognizers: [String]
        let regionCount: Int
        @AOSDesktopWorldRequiredNullable var errorCode: String?
    }

    struct Performance: Codable {
        let enabled: Bool
        let recording: Bool
        let sampleCount: Int
        @AOSDesktopWorldRequiredNullable var targetFps: Double?
        @AOSDesktopWorldRequiredNullable var budgetMs: Double?
        @AOSDesktopWorldRequiredNullable var currentFps: Double?
        @AOSDesktopWorldRequiredNullable var p95FrameMs: Double?
        @AOSDesktopWorldRequiredNullable var maxFrameMs: Double?
        @AOSDesktopWorldRequiredNullable var avgFrameMs: Double?
        @AOSDesktopWorldRequiredNullable var avgRenderMs: Double?
        @AOSDesktopWorldRequiredNullable var avgUpdateMs: Double?
        @AOSDesktopWorldRequiredNullable var avgGpuMs: Double?
        @AOSDesktopWorldRequiredNullable var drawCalls: Double?
        @AOSDesktopWorldRequiredNullable var triangles: Double?
        @AOSDesktopWorldRequiredNullable var geometries: Double?
        @AOSDesktopWorldRequiredNullable var textures: Double?
        @AOSDesktopWorldRequiredNullable var programs: Double?
        @AOSDesktopWorldRequiredNullable var backingPixels: Double?
        @AOSDesktopWorldRequiredNullable var backingWidth: Double?
        @AOSDesktopWorldRequiredNullable var backingHeight: Double?
        @AOSDesktopWorldRequiredNullable var damagedPixelPercentage: Double?
        @AOSDesktopWorldRequiredNullable var avgDamagedPixelPercentage: Double?
        @AOSDesktopWorldRequiredNullable var effectiveDevicePixelRatio: Double?
        @AOSDesktopWorldRequiredNullable var estimatedBackingBytes: Double?
        @AOSDesktopWorldRequiredNullable var msaaSamples: Double?
        @AOSDesktopWorldRequiredNullable var requestedDevicePixelRatio: Double?
        let state: String
    }

    struct DisplayPerformance: Codable {
        let displayId: String
        let displayIndex: Int
        let scope: String
        let performance: Performance
    }

    struct Event: Codable {
        let sequence: Int
        let kind: String
        @AOSDesktopWorldRequiredNullable var resourceId: String?
        @AOSDesktopWorldRequiredNullable var code: String?
        let at: Double
    }

    struct LastError: Codable {
        let code: String
        let at: Double
    }

    let contract: String
    let canvasGeneration: UInt64
    let topologyGeneration: UInt64
    let sequence: Int
    let status: String
    let world: World
    let resources: [Resource]
    let interactions: [Interaction]
    var displayPerformance: [DisplayPerformance]
    let counters: [String: Int]
    let events: [Event]
    @AOSDesktopWorldRequiredNullable var lastError: LastError?

    func isValid() -> Bool {
        guard contract == aosDesktopWorldDevToolsStageContract,
              (status == "unavailable" || (canvasGeneration > 0 && topologyGeneration > 0)),
              sequence >= 0,
              ["available", "unavailable", "unknown"].contains(status),
              world.displays.count <= 16,
              world.nodes.count <= 1_024,
              world.hitRegions.count <= 256,
              world.affordances.count <= 256,
              world.gestures.count <= 256,
              world.routes.count <= 32,
              resources.count <= 32,
              interactions.count <= 256,
              events.count <= 256,
              displayPerformance.count <= 16,
              counters.keys.allSatisfy({ Self.counterKeys.contains($0) }),
              counters.values.allSatisfy({ $0 >= 0 && $0 <= 100_000 }),
              displayPerformance.allSatisfy({ Self.performanceIsValid($0.performance) }),
              lastError == nil || (Self.validString(lastError!.code, limit: 64)
                && lastError!.at.isFinite && lastError!.at >= 0) else { return false }
        guard world.displays.allSatisfy({
            Self.validString($0.id) && $0.bounds.count == 4 && $0.bounds.allSatisfy({ $0.isFinite })
                && $0.bounds[2] > 0 && $0.bounds[3] > 0 && $0.index >= 0 && $0.index <= 31
                && $0.scaleFactor.isFinite && $0.scaleFactor > 0 && $0.scaleFactor <= 4
                && ($0.nativeBounds.map({ bounds in
                    bounds.count == 4 && bounds.allSatisfy({ $0.isFinite })
                        && bounds[2] > 0 && bounds[3] > 0
                }) ?? true)
        }), world.nodes.allSatisfy({
            Self.validString($0.id) && Self.validString($0.resourceId)
                && $0.position.count == 3 && $0.position.allSatisfy({ $0.isFinite })
                && ($0.parentId == nil || Self.validString($0.parentId!))
                && Self.validString($0.kind, limit: 64)
                && ($0.implementation == nil || Self.validString($0.implementation!))
        }), world.hitRegions.allSatisfy({
            Self.validString($0.id) && Self.validString($0.resourceId)
                && Self.validString($0.affordanceId) && $0.frame.count == 4
                && $0.frame.allSatisfy({ $0.isFinite }) && $0.frame[2] > 0 && $0.frame[3] > 0
        }), world.affordances.allSatisfy({
            Self.validString($0.id) && Self.validString($0.resourceId)
                && Self.validString($0.objectId) && $0.priority >= 0 && $0.priority <= 1_000
        }), world.gestures.allSatisfy({
            Self.validString($0.id) && Self.validString($0.resourceId)
                && Self.validString($0.affordanceId) && Self.validString($0.interactionId)
                && Self.validString($0.kind, limit: 64) && Self.validString($0.phase, limit: 64)
                && ($0.pointerSessionId == nil || Self.validString($0.pointerSessionId!))
        }), world.routes.allSatisfy({
            Self.validString($0.resourceId) && ["line", "wormhole"].contains($0.kind)
                && $0.progress.isFinite && $0.progress >= 0 && $0.progress <= 1
                && $0.origin.count == 2 && $0.destination.count == 2
                && $0.origin.allSatisfy({ $0.isFinite }) && $0.destination.allSatisfy({ $0.isFinite })
        }) else { return false }
        guard Set(world.displays.map(\.index)).count == world.displays.count,
              Set(displayPerformance.map(\.displayIndex)).count == displayPerformance.count else { return false }
        let displayByIndex = Dictionary(uniqueKeysWithValues: world.displays.map { ($0.index, $0) })
        guard
              displayPerformance.allSatisfy({ entry in
                  guard let display = displayByIndex[entry.displayIndex],
                        display.id == entry.displayId,
                        entry.scope == "stage-segment" else { return false }
                  return Self.performance(entry.performance, matches: display)
              }), resources.allSatisfy({ resource in
            Self.validString(resource.id) && Self.validString(resource.owner)
                && Self.validString(resource.sceneId) && resource.revision >= 0
                && resource.implementations.count <= 128
                && resource.implementations.allSatisfy({ Self.validString($0) })
                && Self.validString(resource.lifecycle, limit: 32)
                && (resource.errorCode == nil || Self.validString(resource.errorCode!, limit: 64))
                && [resource.allocations.geometries, resource.allocations.materials,
                    resource.allocations.textures, resource.allocations.programs].allSatisfy({
                        $0 >= 0 && $0 <= 100_000
                    })
                && [resource.objectCount, resource.descriptorCount, resource.animationCount,
                    resource.signalCount, resource.interactionCount].allSatisfy({ $0 >= 0 && $0 <= 100_000 })
        }), interactions.allSatisfy({ interaction in
            Self.validString(interaction.id) && Self.validString(interaction.resourceId)
                && Self.validString(interaction.owner) && interaction.recognizers.count <= 32
                && interaction.recognizers.allSatisfy({ Self.validString($0) })
                && interaction.regionCount >= 0 && interaction.regionCount <= 256
                && (interaction.errorCode == nil || Self.validString(interaction.errorCode!, limit: 64))
        }), events.allSatisfy({ event in
            event.sequence >= 0 && Self.validString(event.kind, limit: 64)
                && (event.resourceId == nil || Self.validString(event.resourceId!))
                && (event.code == nil || Self.validString(event.code!, limit: 64))
                && event.at.isFinite && event.at >= 0
        }) else { return false }
        return true
    }

    private static let counterKeys = Set([
        "displays", "resources", "nodes", "hitRegions", "affordances",
        "activeGestures", "activeRoutes", "errors",
    ])

    private static func validString(_ value: String, limit: Int = 256) -> Bool {
        !value.isEmpty && value.utf8.count <= limit
    }

    private static func validMetric(_ value: Double?, maximum: Double = 1_000_000_000) -> Bool {
        value == nil || (value!.isFinite && value! >= 0 && value! <= maximum)
    }

    private static func validPositiveMetric(_ value: Double?, maximum: Double) -> Bool {
        value == nil || (value!.isFinite && value! > 0 && value! <= maximum)
    }

    private static func performanceIsValid(_ performance: Performance) -> Bool {
        performance.sampleCount >= 0
            && performance.sampleCount <= 240
            && ["hot", "idle", "stable", "warn"].contains(performance.state)
            && validMetric(performance.currentFps, maximum: 1_000)
            && validMetric(performance.targetFps, maximum: 1_000)
            && validMetric(performance.budgetMs)
            && validMetric(performance.p95FrameMs)
            && validMetric(performance.maxFrameMs)
            && validMetric(performance.avgFrameMs)
            && validMetric(performance.avgRenderMs)
            && validMetric(performance.avgUpdateMs)
            && validMetric(performance.avgGpuMs)
            && validMetric(performance.drawCalls)
            && validMetric(performance.triangles)
            && validMetric(performance.geometries)
            && validMetric(performance.textures)
            && validMetric(performance.programs)
            && validMetric(performance.backingPixels)
            && validMetric(performance.backingWidth)
            && validMetric(performance.backingHeight)
            && validMetric(performance.damagedPixelPercentage, maximum: 100)
            && validMetric(performance.avgDamagedPixelPercentage, maximum: 100)
            && validPositiveMetric(performance.effectiveDevicePixelRatio, maximum: 4)
            && validMetric(performance.estimatedBackingBytes, maximum: 1_000_000_000_000)
            && validMetric(performance.msaaSamples, maximum: 64)
            && validPositiveMetric(performance.requestedDevicePixelRatio, maximum: 4)
    }

    private static func performance(_ performance: Performance, matches display: Display) -> Bool {
        guard performance.sampleCount > 0 else { return true }
        guard let backingHeight = performance.backingHeight,
              let backingPixels = performance.backingPixels,
              let backingWidth = performance.backingWidth,
              let effectiveDPR = performance.effectiveDevicePixelRatio,
              let estimatedBackingBytes = performance.estimatedBackingBytes,
              let msaaSamples = performance.msaaSamples,
              let requestedDPR = performance.requestedDevicePixelRatio else { return false }
        let expectedWidth = (display.bounds[2] * display.scaleFactor).rounded()
        let expectedHeight = (display.bounds[3] * display.scaleFactor).rounded()
        let expectedPixels = expectedWidth * expectedHeight
        let resolvedBytes = expectedPixels * 8
        let expectedBytes = resolvedBytes + (msaaSamples > 1 ? resolvedBytes * msaaSamples : 0)
        return abs(requestedDPR - display.scaleFactor) <= 0.000_001
            && abs(effectiveDPR - display.scaleFactor) <= 0.000_001
            && backingWidth == expectedWidth
            && backingHeight == expectedHeight
            && backingPixels == expectedPixels
            && estimatedBackingBytes == expectedBytes
    }
}

final class AOSDesktopWorldDevToolsSessionRegistry {
    private struct PendingTransfer {
        let plan: AOSDesktopWorldDevToolsTransferPlan
    }

    private struct StageReceipt {
        let canvasGeneration: UInt64
        let displays: [AOSDesktopWorldDevToolsStageSnapshot.Display]
        let expectedIndexes: Set<Int>
        let topologyGeneration: UInt64
        var primary: AOSDesktopWorldDevToolsStageSnapshot?
        var performanceByIndex: [Int: AOSDesktopWorldDevToolsStageSnapshot.DisplayPerformance] = [:]

        init(
            _ snapshot: AOSDesktopWorldDevToolsStageSnapshot,
            identity: AOSDesktopWorldDevToolsStageSegmentIdentity
        ) {
            canvasGeneration = identity.canvasGeneration
            displays = snapshot.world.displays
            expectedIndexes = identity.expectedIndexes
            topologyGeneration = identity.topologyGeneration
        }

        mutating func record(
            _ snapshot: AOSDesktopWorldDevToolsStageSnapshot,
            identity: AOSDesktopWorldDevToolsStageSegmentIdentity,
            rejectDuplicate: Bool
        ) -> Bool {
            guard identity.canvasGeneration == canvasGeneration,
                  identity.topologyGeneration == topologyGeneration,
                  identity.expectedIndexes == expectedIndexes,
                  snapshot.canvasGeneration == canvasGeneration,
                  snapshot.topologyGeneration == topologyGeneration,
                  Set(snapshot.world.displays.map(\.index)) == expectedIndexes,
                  snapshot.world.displays == displays,
                  snapshot.displayPerformance.count == 1,
                  let entry = snapshot.displayPerformance.first,
                  entry.displayIndex == identity.index,
                  displays.contains(where: {
                      $0.index == identity.index && $0.id == entry.displayId
                  }),
                  !rejectDuplicate || performanceByIndex[identity.index] == nil else { return false }
            performanceByIndex[identity.index] = entry
            if identity.index == 0 { primary = snapshot }
            return true
        }

        func aggregate() -> AOSDesktopWorldDevToolsStageSnapshot? {
            guard var result = primary else { return nil }
            guard expectedIndexes.count == displays.count,
                  Set(performanceByIndex.keys) == expectedIndexes else { return nil }
            result.displayPerformance = performanceByIndex.values.sorted {
                $0.displayIndex < $1.displayIndex
            }
            return result
        }
    }

    private let lock = NSLock()
    private let maximumSessions = 8
    private var sessions: [String: AOSDesktopWorldDevToolsSessionState] = [:]
    private let nativeStageFacts: () -> AOSDesktopWorldDevToolsNativeStageFacts
    private var hostOwners: [String: String] = [:]
    private var pendingBySession: [String: PendingTransfer] = [:]
    private var pendingByToken: [UUID: PendingTransfer] = [:]
    private var currentStageReceipt: StageReceipt?
    private var stageReceiptsByRequest: [String: StageReceipt] = [:]
    private var stageSnapshot: [String: Any] = AOSDesktopWorldDevToolsSessionRegistry.unavailableStageSnapshot()
    private var stageSnapshotRevision = 0

    init(
        nativeStageFacts: @escaping () -> AOSDesktopWorldDevToolsNativeStageFacts = {
            .idle
        }
    ) {
        self.nativeStageFacts = nativeStageFacts
    }

    func create(
        selectedResource: String? = nil,
        stageRequestID: String? = nil
    ) -> AOSDesktopWorldDevToolsMutationResult {
        lock.lock()
        defer { lock.unlock() }
        guard sessions.count < maximumSessions else { return .capacity }
        guard selectedResource == nil || Self.validIdentifier(selectedResource!),
              stageRequestID == nil || Self.validToken(stageRequestID!, limit: 128) else { return .invalid }
        let id = "devtools-\(UUID().uuidString.lowercased())"
        let state = AOSDesktopWorldDevToolsSessionState(
            id: id,
            stageRequestID: stageRequestID,
            stageRequestCompletedRevision: nil,
            revision: 1,
            selectedResource: selectedResource,
            activeTab: .world,
            filters: AOSDesktopWorldDevToolsFilters(),
            recording: false,
            host: nil,
            ownedPanelIDs: []
        )
        sessions[id] = state
        return .success(state)
    }

    func update(
        sessionID: String,
        expectedRevision: Int,
        selectedResource: AOSDesktopWorldDevToolsFieldPatch<String> = .unchanged,
        activeTab: AOSDesktopWorldDevToolsTab? = nil,
        filters: AOSDesktopWorldDevToolsFilters? = nil,
        recording: Bool? = nil
    ) -> AOSDesktopWorldDevToolsMutationResult {
        lock.lock()
        defer { lock.unlock() }
        guard var state = sessions[sessionID] else { return .notFound }
        guard state.revision == expectedRevision else { return .conflict(currentRevision: state.revision) }
        guard pendingBySession[sessionID] == nil else { return .busy }
        switch selectedResource {
        case .unchanged:
            break
        case .clear:
            state.selectedResource = nil
        case .set(let value):
            guard Self.validIdentifier(value) else { return .invalid }
            state.selectedResource = value
        }
        if let activeTab { state.activeTab = activeTab }
        if let filters {
            guard filters.query.utf8.count <= 128,
                  filters.eventKinds.count <= 16,
                  filters.eventKinds.allSatisfy({ Self.validToken($0, limit: 64) }) else { return .invalid }
            state.filters = AOSDesktopWorldDevToolsFilters(
                query: filters.query,
                eventKinds: Array(Set(filters.eventKinds)).sorted(),
                errorsOnly: filters.errorsOnly
            )
        }
        if let recording { state.recording = recording }
        state.revision += 1
        sessions[sessionID] = state
        return .success(state)
    }

    func prepareHostTransfer(
        sessionID: String,
        expectedRevision: Int,
        next: AOSDesktopWorldDevToolsHost
    ) -> AOSDesktopWorldDevToolsTransferResult {
        lock.lock()
        defer { lock.unlock() }
        guard let state = sessions[sessionID] else { return .notFound }
        guard state.revision == expectedRevision else { return .conflict(currentRevision: state.revision) }
        guard pendingBySession[sessionID] == nil else { return .busy }
        guard Self.validHost(next) else { return .invalid }
        if let owner = hostOwners[next.key], owner != sessionID { return .busy }
        hostOwners[next.key] = sessionID
        let plan = AOSDesktopWorldDevToolsTransferPlan(
            token: UUID(), sessionID: sessionID, expectedRevision: state.revision,
            previous: state.host, next: next
        )
        let pending = PendingTransfer(plan: plan)
        pendingBySession[sessionID] = pending
        pendingByToken[plan.token] = pending
        return .prepared(plan)
    }

    func commitHostTransfer(token: UUID) -> AOSDesktopWorldDevToolsMutationResult {
        lock.lock()
        defer { lock.unlock() }
        guard let pending = pendingByToken.removeValue(forKey: token),
              pendingBySession.removeValue(forKey: pending.plan.sessionID) != nil,
              var state = sessions[pending.plan.sessionID],
              state.revision == pending.plan.expectedRevision else { return .notFound }
        if let previous = pending.plan.previous, previous != pending.plan.next {
            hostOwners.removeValue(forKey: previous.key)
        }
        state.host = pending.plan.next
        if pending.plan.next.kind == .panel {
            state.ownedPanelIDs.insert(pending.plan.next.id)
        }
        state.revision += 1
        sessions[state.id] = state
        return .success(state)
    }

    @discardableResult
    func abortHostTransfer(token: UUID) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let pending = pendingByToken.removeValue(forKey: token) else { return false }
        pendingBySession.removeValue(forKey: pending.plan.sessionID)
        if pending.plan.previous != pending.plan.next {
            hostOwners.removeValue(forKey: pending.plan.next.key)
        }
        return true
    }

    func close(sessionID: String, expectedRevision: Int? = nil) -> AOSDesktopWorldDevToolsMutationResult {
        lock.lock()
        defer { lock.unlock() }
        guard let state = sessions[sessionID] else { return .notFound }
        if let expectedRevision, state.revision != expectedRevision {
            return .conflict(currentRevision: state.revision)
        }
        if let pending = pendingBySession.removeValue(forKey: sessionID) {
            pendingByToken.removeValue(forKey: pending.plan.token)
            if pending.plan.previous != pending.plan.next {
                hostOwners.removeValue(forKey: pending.plan.next.key)
            }
        }
        if let host = state.host { hostOwners.removeValue(forKey: host.key) }
        sessions.removeValue(forKey: sessionID)
        if let requestID = state.stageRequestID,
           !sessions.values.contains(where: {
               $0.stageRequestID == requestID && $0.stageRequestCompletedRevision == nil
           }) {
            stageReceiptsByRequest.removeValue(forKey: requestID)
        }
        return .success(state)
    }

    func recordStageSnapshot(
        _ raw: [String: Any],
        requestID: String? = nil,
        segment: AOSDesktopWorldDevToolsStageSegmentIdentity? = nil
    ) -> Bool {
        guard requestID == nil || Self.validToken(requestID!, limit: 128),
              JSONSerialization.isValidJSONObject(raw),
              let input = try? JSONSerialization.data(withJSONObject: raw),
              input.count <= 512 * 1_024,
              let decoded = try? JSONDecoder().decode(AOSDesktopWorldDevToolsStageSnapshot.self, from: input),
              decoded.isValid() else { return false }
        lock.lock()
        defer { lock.unlock() }

        let aggregate: AOSDesktopWorldDevToolsStageSnapshot?
        if let segment {
            if let requestID {
                let hasPendingSession = sessions.values.contains(where: {
                    $0.stageRequestID == requestID && $0.stageRequestCompletedRevision == nil
                })
                guard hasPendingSession else { return false }
                var receipt = stageReceiptsByRequest[requestID] ?? StageReceipt(
                    decoded,
                    identity: segment
                )
                guard receipt.record(decoded, identity: segment, rejectDuplicate: true) else {
                    stageReceiptsByRequest.removeValue(forKey: requestID)
                    return false
                }
                stageReceiptsByRequest[requestID] = receipt
                aggregate = receipt.aggregate()
                if aggregate != nil {
                    stageReceiptsByRequest.removeValue(forKey: requestID)
                    currentStageReceipt = receipt
                }
            } else {
                var receipt: StageReceipt
                if let currentStageReceipt,
                   currentStageReceipt.canvasGeneration == segment.canvasGeneration,
                   currentStageReceipt.topologyGeneration == segment.topologyGeneration,
                   currentStageReceipt.expectedIndexes == segment.expectedIndexes,
                   currentStageReceipt.displays == decoded.world.displays {
                    receipt = currentStageReceipt
                } else {
                    receipt = StageReceipt(decoded, identity: segment)
                }
                guard receipt.record(decoded, identity: segment, rejectDuplicate: false) else { return false }
                currentStageReceipt = receipt
                aggregate = receipt.aggregate()
            }
        } else {
            let expected = Set(decoded.world.displays.map(\.index))
            guard decoded.displayPerformance.count == decoded.world.displays.count,
                  Set(decoded.displayPerformance.map(\.displayIndex)) == expected else { return false }
            aggregate = decoded
        }

        guard let aggregate,
              let canonical = Self.canonicalDictionary(aggregate) else { return true }
        stageSnapshot = canonical
        stageSnapshotRevision += 1
        if let requestID {
            for sessionID in sessions.compactMap({ sessionID, state in
                state.stageRequestID == requestID ? sessionID : nil
            }) {
                guard var state = sessions[sessionID] else { continue }
                state.stageRequestCompletedRevision = stageSnapshotRevision
                sessions[sessionID] = state
            }
        }
        return true
    }

    private static func canonicalDictionary(
        _ snapshot: AOSDesktopWorldDevToolsStageSnapshot
    ) -> [String: Any]? {
        guard let data = try? JSONEncoder().encode(snapshot),
              data.count <= 512 * 1_024,
              let dictionary = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return dictionary
    }

    func snapshot(sessionID: String) -> [String: Any]? {
        lock.lock()
        guard let state = sessions[sessionID] else {
            lock.unlock()
            return nil
        }
        let snapshot = Self.snapshotDictionary(
            state: state,
            stage: stageSnapshot,
            stageSnapshotRevision: stageSnapshotRevision
        )
        lock.unlock()
        return decorateSnapshot(snapshot, native: nativeStageFacts())
    }

    func snapshots() -> [[String: Any]] {
        lock.lock()
        let snapshots = sessions.values.sorted(by: { $0.id < $1.id }).map {
            Self.snapshotDictionary(
                state: $0,
                stage: stageSnapshot,
                stageSnapshotRevision: stageSnapshotRevision
            )
        }
        lock.unlock()
        let native = nativeStageFacts()
        return snapshots.map { decorateSnapshot($0, native: native) }
    }

    func stageSnapshot(resourceID: String? = nil) -> [String: Any]? {
        lock.lock()
        let snapshot: [String: Any]?
        if let resourceID {
            snapshot = Self.validIdentifier(resourceID)
                ? Self.filteredStageSnapshot(stageSnapshot, resourceID: resourceID)
                : nil
        } else {
            snapshot = stageSnapshot
        }
        lock.unlock()
        guard let snapshot else { return nil }
        return decorateStage(snapshot, native: nativeStageFacts())
    }

    func activeHostSnapshots() -> [(host: AOSDesktopWorldDevToolsHost, snapshot: [String: Any])] {
        lock.lock()
        let snapshots: [(host: AOSDesktopWorldDevToolsHost, snapshot: [String: Any])] =
            sessions.values.compactMap { state in
            guard let host = state.host else { return nil }
            return (host: host, snapshot: Self.snapshotDictionary(
                state: state,
                stage: stageSnapshot,
                stageSnapshotRevision: stageSnapshotRevision
            ))
        }
        lock.unlock()
        let native = nativeStageFacts()
        return snapshots.map {
            (
                host: $0.host,
                snapshot: decorateSnapshot($0.snapshot, native: native)
            )
        }
    }

    func detachHost(id: String) -> [AOSDesktopWorldDevToolsSessionState] {
        lock.lock()
        defer { lock.unlock() }
        var changed: [AOSDesktopWorldDevToolsSessionState] = []
        let pendingSessionIDs = pendingBySession.compactMap { sessionID, pending in
            pending.plan.next.id == id ? sessionID : nil
        }
        for sessionID in pendingSessionIDs {
            guard let pending = pendingBySession[sessionID] else { continue }
            pendingBySession.removeValue(forKey: sessionID)
            pendingByToken.removeValue(forKey: pending.plan.token)
            hostOwners.removeValue(forKey: pending.plan.next.key)
        }
        let hostedSessionIDs = sessions.compactMap { sessionID, state in
            state.host?.id == id ? sessionID : nil
        }
        for sessionID in hostedSessionIDs {
            guard var state = sessions[sessionID] else { continue }
            if let host = state.host { hostOwners.removeValue(forKey: host.key) }
            state.ownedPanelIDs.remove(id)
            state.host = nil
            state.revision += 1
            sessions[sessionID] = state
            changed.append(state)
        }
        return changed
    }

    func state(sessionID: String) -> AOSDesktopWorldDevToolsSessionState? {
        lock.lock()
        defer { lock.unlock() }
        return sessions[sessionID]
    }

    func state(hostID: String) -> AOSDesktopWorldDevToolsSessionState? {
        lock.lock()
        defer { lock.unlock() }
        let matches = sessions.values.filter { $0.host?.id == hostID }
        return matches.count == 1 ? matches[0] : nil
    }

    func instrumentationConfiguration() -> (enabled: Bool, recording: Bool) {
        lock.lock()
        defer { lock.unlock() }
        return (!sessions.isEmpty, sessions.values.contains(where: { $0.recording }))
    }

    private static func snapshotDictionary(
        state: AOSDesktopWorldDevToolsSessionState,
        stage: [String: Any],
        stageSnapshotRevision: Int
    ) -> [String: Any] {
        var session: [String: Any] = [
            "id": state.id,
            "revision": state.revision,
            "activeTab": state.activeTab.rawValue,
            "selectedResource": state.selectedResource ?? NSNull(),
            "filters": [
                "query": state.filters.query,
                "eventKinds": state.filters.eventKinds,
                "errorsOnly": state.filters.errorsOnly,
            ],
            "recording": state.recording,
            "stageSnapshotReady": state.stageRequestID == nil || state.stageRequestCompletedRevision != nil,
        ]
        if let host = state.host {
            session["host"] = ["kind": host.kind.rawValue, "id": host.id, "state": "active"]
        } else {
            session["host"] = NSNull()
        }
        return [
            "contract": aosDesktopWorldDevToolsSnapshotContract,
            "schemaVersion": 2,
            "stageSnapshotRevision": stageSnapshotRevision,
            "session": session,
            "stage": stage,
        ]
    }

    private func decorateSnapshot(
        _ input: [String: Any],
        native: AOSDesktopWorldDevToolsNativeStageFacts
    ) -> [String: Any] {
        guard let stage = input["stage"] as? [String: Any] else { return input }
        var output = input
        output["stage"] = decorateStage(stage, native: native)
        return output
    }

    private func decorateStage(
        _ input: [String: Any],
        native: AOSDesktopWorldDevToolsNativeStageFacts
    ) -> [String: Any] {
        var output = input
        output["native"] = native.dictionary
        return output
    }

    private static func unavailableStageSnapshot() -> [String: Any] {
        [
            "contract": aosDesktopWorldDevToolsStageContract,
            "canvasGeneration": 0,
            "topologyGeneration": 0,
            "sequence": 0,
            "status": "unavailable",
            "world": [
                "displays": [], "nodes": [], "hitRegions": [],
                "affordances": [], "gestures": [], "routes": [],
            ],
            "resources": [],
            "interactions": [],
            "displayPerformance": [],
            "counters": [
                "displays": 0, "resources": 0, "nodes": 0, "hitRegions": 0,
                "affordances": 0, "activeGestures": 0, "activeRoutes": 0, "errors": 0,
            ],
            "events": [],
            "lastError": NSNull(),
        ]
    }

    private static func filteredStageSnapshot(_ stage: [String: Any], resourceID: String) -> [String: Any]? {
        guard var world = stage["world"] as? [String: Any],
              let allResources = stage["resources"] as? [[String: Any]],
              let interactions = stage["interactions"] as? [[String: Any]],
              let events = stage["events"] as? [[String: Any]] else { return nil }
        let resources = allResources.filter { $0["id"] as? String == resourceID }
        guard resources.count == 1 else { return nil }
        func filtered(_ key: String) -> [[String: Any]] {
            (world[key] as? [[String: Any]] ?? []).filter { $0["resourceId"] as? String == resourceID }
        }
        let nodes = filtered("nodes")
        let hitRegions = filtered("hitRegions")
        let affordances = filtered("affordances")
        let gestures = filtered("gestures")
        let routes = filtered("routes")
        let selectedInteractions = interactions.filter { $0["resourceId"] as? String == resourceID }
        let selectedEvents = events.filter {
            guard let eventResource = $0["resourceId"] else { return true }
            return eventResource is NSNull || eventResource as? String == resourceID
        }
        world["nodes"] = nodes
        world["hitRegions"] = hitRegions
        world["affordances"] = affordances
        world["gestures"] = gestures
        world["routes"] = routes
        var selected = stage
        selected["world"] = world
        selected["resources"] = resources
        selected["interactions"] = selectedInteractions
        selected["events"] = selectedEvents
        let resourceErrors = resources.filter { value in
            guard let error = value["errorCode"] else { return false }
            return !(error is NSNull)
        }.count
        let interactionErrors = selectedInteractions.filter { value in
            guard let error = value["errorCode"] else { return false }
            return !(error is NSNull)
        }.count
        selected["counters"] = [
            "displays": (world["displays"] as? [Any])?.count ?? 0,
            "resources": resources.count,
            "nodes": nodes.count,
            "hitRegions": hitRegions.count,
            "affordances": affordances.count,
            "activeGestures": gestures.filter {
                guard let phase = $0["phase"] as? String else { return false }
                return phase != "end" && phase != "cancel"
            }.count,
            "activeRoutes": routes.filter { $0["active"] as? Bool == true }.count,
            "errors": resourceErrors + interactionErrors,
        ]
        return selected
    }

    private static func validToken(_ value: String, limit: Int) -> Bool {
        !value.isEmpty && value.utf8.count <= limit
            && value.unicodeScalars.allSatisfy({ scalar in
                CharacterSet.alphanumerics.contains(scalar) || "._/-".unicodeScalars.contains(scalar)
            })
    }

    private static func validIdentifier(_ value: String) -> Bool {
        validToken(value, limit: 128) && !value.contains("//")
            && !value.split(separator: "/", omittingEmptySubsequences: false).contains(where: {
                $0.isEmpty || $0 == "." || $0 == ".."
            })
    }

    private static func validHost(_ host: AOSDesktopWorldDevToolsHost) -> Bool {
        validIdentifier(host.id)
    }
}
