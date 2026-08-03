import Foundation

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

final class AOSDesktopWorldDevToolsSessionRegistry {
    private struct PendingTransfer {
        let plan: AOSDesktopWorldDevToolsTransferPlan
    }

    private let lock = NSLock()
    private let maximumSessions = 8
    private var sessions: [String: AOSDesktopWorldDevToolsSessionState] = [:]
    private let nativeStageFacts: () -> AOSDesktopWorldDevToolsNativeStageFacts
    private var hostOwners: [String: String] = [:]
    private var pendingBySession: [String: PendingTransfer] = [:]
    private var pendingByToken: [UUID: PendingTransfer] = [:]
    private var stageAggregator = AOSDesktopWorldDevToolsStageSnapshotAggregator()
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
            stageAggregator.discard(requestID: requestID)
        }
        return .success(state)
    }

    func recordStageSnapshot(
        _ raw: [String: Any],
        requestID: String? = nil,
        segment: AOSDesktopWorldDevToolsStageSegmentIdentity? = nil
    ) -> AOSDesktopWorldDevToolsStageCommitResult {
        guard requestID == nil || Self.validToken(requestID!, limit: 128) else {
            return .rejected
        }
        lock.lock()
        defer { lock.unlock() }

        let requestIsPending = requestID.map { candidate in
            sessions.values.contains(where: {
                $0.stageRequestID == candidate && $0.stageRequestCompletedRevision == nil
            })
        } ?? false
        let outcome = stageAggregator.record(
            raw,
            requestID: requestID,
            segment: segment,
            requestIsPending: requestIsPending
        )
        guard outcome.result == .committed, let canonical = outcome.snapshot else {
            return outcome.result
        }

        stageSnapshot = canonical
        stageSnapshotRevision += 1
        var completedRequestIDs = outcome.completedRequestIDs
        if let requestID { completedRequestIDs.insert(requestID) }
        for completedRequestID in completedRequestIDs {
            for sessionID in sessions.compactMap({ sessionID, state in
                state.stageRequestID == completedRequestID ? sessionID : nil
            }) {
                guard var state = sessions[sessionID] else { continue }
                state.stageRequestCompletedRevision = stageSnapshotRevision
                sessions[sessionID] = state
            }
        }
        return .committed
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
