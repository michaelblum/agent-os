import AppKit
import Foundation

final class AOSDesktopWorldDevToolsController {
    private let canvasManager: CanvasManager
    private let sceneStageCanvasID: String
    private let ensureSceneStage: () -> Bool
    private let hasSceneMonitor: () -> Bool
    private let resolveContentURL: (String) -> String
    private let sessions = AOSDesktopWorldDevToolsSessionRegistry()

    init(
        canvasManager: CanvasManager,
        sceneStageCanvasID: String,
        ensureSceneStage: @escaping () -> Bool,
        hasSceneMonitor: @escaping () -> Bool,
        resolveContentURL: @escaping (String) -> String
    ) {
        self.canvasManager = canvasManager
        self.sceneStageCanvasID = sceneStageCanvasID
        self.ensureSceneStage = ensureSceneStage
        self.hasSceneMonitor = hasSceneMonitor
        self.resolveContentURL = resolveContentURL
    }

    @discardableResult
    func handleStageSnapshot(_ payload: [String: Any]) -> Bool {
        guard let snapshot = payload["snapshot"] as? [String: Any],
              sessions.recordStageSnapshot(snapshot) else { return false }
        publishSnapshots()
        return true
    }

    func publishSnapshots(hostID: String? = nil) {
        for entry in sessions.activeHostSnapshots() {
            if let hostID, entry.host.id != hostID { continue }
            canvasManager.postMessageToCurrentCanvasAsync(canvasID: entry.host.id, payload: [
                "type": "desktop_world_devtools.snapshot",
                "payload": entry.snapshot,
            ])
        }
    }

    func configureStage() -> Bool {
        let configuration = sessions.instrumentationConfiguration()
        let enabled = configuration.enabled || hasSceneMonitor()
        var stageExists = mutateCanvas { [weak self] in
            guard let self else { return false }
            return self.canvasManager.hasCanvas(self.sceneStageCanvasID)
        }
        if enabled && !stageExists {
            guard !Thread.isMainThread, ensureSceneStage() else { return false }
            stageExists = true
        }
        if !enabled && !stageExists { return true }
        canvasManager.postMessageToCurrentCanvasAsync(canvasID: sceneStageCanvasID, payload: [
            "type": "desktop_world_stage.devtools.configure",
            "payload": ["enabled": enabled, "recording": configuration.recording],
        ])
        if enabled {
            canvasManager.postMessageToCurrentCanvasAsync(canvasID: sceneStageCanvasID, payload: [
                "type": "desktop_world_stage.devtools.request",
                "payload": [:],
            ])
        }
        return true
    }

    func stageSnapshot(resourceID: String) -> [String: Any]? {
        sessions.stageSnapshot(resourceID: resourceID)
    }

    func detachHost(id: String) {
        _ = sessions.detachHost(id: id)
    }

    func handleHostCommand(callerID: String, payload: [String: Any]) {
        guard let action = payload["action"] as? String else {
            sendHostError(canvasID: callerID, code: "INVALID_DEVTOOLS_REQUEST")
            return
        }
        let hostedState = sessions.state(hostID: callerID)
        let sessionID = payload["session"] as? String ?? (action == "close" ? hostedState?.id : nil)
        let expectedRevision = payload["expectedRevision"] as? Int
            ?? (action == "close" ? hostedState?.revision : nil)
        guard let sessionID, let expectedRevision,
              let current = sessions.state(sessionID: sessionID),
              current.host?.id == callerID else {
            sendHostError(canvasID: callerID, code: "DEVTOOLS_HOST_NOT_OWNER")
            return
        }
        if action == "close" {
            let result = sessions.close(sessionID: sessionID, expectedRevision: expectedRevision)
            guard case .success(let closed) = result else {
                sendHostError(canvasID: callerID, code: "DEVTOOLS_REVISION_CONFLICT")
                return
            }
            closeSessionHosts(closed)
            _ = configureStage()
            return
        }
        if action == "detach" {
            let panel = AOSDesktopWorldDevToolsHost(kind: .panel, id: "aos-desktop-world-devtools-\(sessionID)")
            guard case .success = transferHost(
                sessionID: sessionID,
                expectedRevision: expectedRevision,
                next: panel
            ) else {
                sendHostError(canvasID: callerID, code: "DEVTOOLS_HOST_TRANSFER_FAILED")
                return
            }
            return
        }
        guard action == "update", let update = AOSDesktopWorldDevToolsUpdateRequest.parse(payload) else {
            sendHostError(canvasID: callerID, code: "INVALID_DEVTOOLS_REQUEST")
            return
        }
        let result = sessions.update(
            sessionID: sessionID,
            expectedRevision: expectedRevision,
            selectedResource: update.selectedResource,
            activeTab: update.activeTab,
            filters: update.filters,
            recording: update.recording
        )
        guard case .success = result else {
            sendHostError(canvasID: callerID, code: "DEVTOOLS_UPDATE_FAILED")
            return
        }
        _ = configureStage()
        publishSnapshots(hostID: callerID)
    }

    func handleCommand(action: String, payload: [String: Any]) -> [String: Any] {
        if action == "scene-devtools-status" {
            if payload.keys.contains("session") {
                guard let sessionID = payload["session"] as? String,
                      let snapshot = sessions.snapshot(sessionID: sessionID) else {
                    return mutationResponse(.notFound)
                }
                return ["status": "ok", "session": snapshot]
            }
            return ["status": "ok", "sessions": sessions.snapshots()]
        }

        if action == "scene-devtools-open" {
            let created = sessions.create(selectedResource: payload["resource"] as? String)
            guard case .success(let state) = created else { return mutationResponse(created) }
            guard configureStage() else {
                _ = sessions.close(sessionID: state.id)
                return ["error": "DesktopWorld scene stage is unavailable", "code": "SCENE_STAGE_UNAVAILABLE"]
            }
            if payload["headless"] as? Bool == true {
                guard !payload.keys.contains("host") else {
                    _ = sessions.close(sessionID: state.id)
                    _ = configureStage()
                    return mutationResponse(.invalid)
                }
                return mutationResponse(.success(state))
            }
            let fallback = AOSDesktopWorldDevToolsHost(kind: .panel, id: "aos-desktop-world-devtools-\(state.id)")
            let host: AOSDesktopWorldDevToolsHost
            if payload.keys.contains("host") {
                guard let parsed = parseHost(payload["host"]) else {
                    _ = sessions.close(sessionID: state.id)
                    _ = configureStage()
                    return mutationResponse(.invalid)
                }
                host = parsed
            } else {
                host = fallback
            }
            let attached = transferHost(sessionID: state.id, expectedRevision: state.revision, next: host)
            guard case .success = attached else {
                _ = sessions.close(sessionID: state.id)
                _ = configureStage()
                return mutationResponse(attached)
            }
            return mutationResponse(attached)
        }

        guard let sessionID = payload["session"] as? String else { return mutationResponse(.invalid) }
        if action == "scene-devtools-close" {
            let result = sessions.close(sessionID: sessionID, expectedRevision: payload["expected_revision"] as? Int)
            if case .success(let state) = result { closeSessionHosts(state) }
            _ = configureStage()
            if case .success = result { return ["status": "ok", "session": sessionID, "closed": true] }
            return mutationResponse(result)
        }
        guard let expectedRevision = payload["expected_revision"] as? Int else { return mutationResponse(.invalid) }
        if action == "scene-devtools-transfer" {
            guard let host = parseHost(payload["host"]) else { return mutationResponse(.invalid) }
            return mutationResponse(transferHost(sessionID: sessionID, expectedRevision: expectedRevision, next: host))
        }
        guard action == "scene-devtools-update",
              let update = AOSDesktopWorldDevToolsUpdateRequest.parse(payload) else {
            return mutationResponse(.invalid)
        }
        let result = sessions.update(
            sessionID: sessionID,
            expectedRevision: expectedRevision,
            selectedResource: update.selectedResource,
            activeTab: update.activeTab,
            filters: update.filters,
            recording: update.recording
        )
        if case .success = result {
            _ = configureStage()
            publishSnapshots()
        }
        return mutationResponse(result)
    }

    private func parseHost(_ value: Any?) -> AOSDesktopWorldDevToolsHost? {
        guard let object = value as? [String: Any],
              let kindValue = object["kind"] as? String,
              let kind = AOSDesktopWorldDevToolsHostKind(rawValue: kindValue),
              let id = object["id"] as? String else { return nil }
        return AOSDesktopWorldDevToolsHost(kind: kind, id: id)
    }

    private func mutateCanvas(_ operation: @escaping () -> Bool) -> Bool {
        if Thread.isMainThread { return operation() }
        let semaphore = DispatchSemaphore(value: 0)
        var result = false
        DispatchQueue.main.async {
            result = operation()
            semaphore.signal()
        }
        semaphore.wait()
        return result
    }

    private func activateHost(_ host: AOSDesktopWorldDevToolsHost) -> Bool {
        switch host.kind {
        case .panel:
            return mutateCanvas { [weak self] in
                guard let self else { return false }
                if self.canvasManager.hasCanvas(host.id) {
                    return self.canvasManager.handle(CanvasRequest(action: "resume", id: host.id)).status == "success"
                }
                let main = CGDisplayBounds(CGMainDisplayID())
                var request = CanvasRequest(
                    action: "create",
                    id: host.id,
                    at: [main.minX + 48, main.minY + 72, min(960, main.width - 96), min(680, main.height - 120)],
                    url: self.resolveContentURL("aos://toolkit/components/desktop-world-devtools/index.html"),
                    interactive: true,
                    focus: false,
                    scope: "global",
                    owner: CanvasOwnerInfo(
                        consumerID: "daemon.desktop-world-devtools",
                        harness: "daemon",
                        pid: Int(getpid()),
                        cwd: FileManager.default.currentDirectoryPath,
                        worktreeRoot: aosRepoRootFromBases([FileManager.default.currentDirectoryPath]),
                        runtimeMode: aosCurrentRuntimeMode().rawValue
                    )
                )
                request.windowLevel = "floating"
                request.cascade = false
                return self.canvasManager.handle(request).status == "success"
            }
        case .compatibility, .external:
            let exists = mutateCanvas { [weak self] in self?.canvasManager.hasCanvas(host.id) == true }
            guard exists else { return false }
            sendHostMessage(host.id, type: "desktop_world_devtools.host.activate")
            return true
        }
    }

    private func suspendHost(_ host: AOSDesktopWorldDevToolsHost) -> Bool {
        if host.kind == .panel {
            return mutateCanvas { [weak self] in
                guard let self else { return false }
                if !self.canvasManager.hasCanvas(host.id) { return true }
                return self.canvasManager.handle(CanvasRequest(action: "suspend", id: host.id)).status == "success"
            }
        }
        let exists = mutateCanvas { [weak self] in self?.canvasManager.hasCanvas(host.id) == true }
        if exists { sendHostMessage(host.id, type: "desktop_world_devtools.host.suspend") }
        return exists
    }

    private func closeHost(_ host: AOSDesktopWorldDevToolsHost) {
        if host.kind == .panel {
            _ = mutateCanvas { [weak self] in
                guard let self else { return false }
                if !self.canvasManager.hasCanvas(host.id) { return true }
                return self.canvasManager.handle(CanvasRequest(action: "remove", id: host.id)).status == "success"
            }
            return
        }
        sendHostMessage(host.id, type: "desktop_world_devtools.host.close")
    }

    private func sendHostMessage(_ id: String, type: String, payload: [String: Any] = [:]) {
        canvasManager.postMessageToCurrentCanvasAsync(canvasID: id, payload: ["type": type, "payload": payload])
    }

    private func sendHostError(canvasID: String, code: String) {
        sendHostMessage(canvasID, type: "desktop_world_devtools.host.error", payload: ["code": code])
    }

    private func closeSessionHosts(_ state: AOSDesktopWorldDevToolsSessionState) {
        if let host = state.host { closeHost(host) }
        for panelID in state.ownedPanelIDs where panelID != state.host?.id {
            closeHost(AOSDesktopWorldDevToolsHost(kind: .panel, id: panelID))
        }
    }

    private func transferHost(
        sessionID: String,
        expectedRevision: Int,
        next: AOSDesktopWorldDevToolsHost
    ) -> AOSDesktopWorldDevToolsMutationResult {
        let plan: AOSDesktopWorldDevToolsTransferPlan
        switch sessions.prepareHostTransfer(sessionID: sessionID, expectedRevision: expectedRevision, next: next) {
        case .prepared(let prepared): plan = prepared
        case .notFound: return .notFound
        case .conflict(let currentRevision): return .conflict(currentRevision: currentRevision)
        case .busy: return .busy
        case .invalid: return .invalid
        }
        if plan.previous != plan.next, let previous = plan.previous, !suspendHost(previous) {
            _ = sessions.abortHostTransfer(token: plan.token)
            return .busy
        }
        if plan.previous != plan.next && !activateHost(plan.next) {
            if let previous = plan.previous { _ = activateHost(previous) }
            _ = sessions.abortHostTransfer(token: plan.token)
            return .invalid
        }
        let result = sessions.commitHostTransfer(token: plan.token)
        guard case .success(let state) = result else {
            if plan.previous != plan.next {
                if plan.next.kind == .panel { closeHost(plan.next) }
                else { _ = suspendHost(plan.next) }
                if let previous = plan.previous { _ = activateHost(previous) }
            }
            _ = sessions.abortHostTransfer(token: plan.token)
            return result
        }
        publishSnapshots(hostID: state.host?.id)
        return .success(state)
    }

    private func mutationResponse(_ result: AOSDesktopWorldDevToolsMutationResult) -> [String: Any] {
        switch result {
        case .success(let state):
            guard let snapshot = sessions.snapshot(sessionID: state.id) else {
                return ["error": "DesktopWorld DevTools session disappeared", "code": "DEVTOOLS_SESSION_NOT_FOUND"]
            }
            return ["status": "ok", "session": snapshot]
        case .notFound:
            return ["error": "DesktopWorld DevTools session was not found", "code": "DEVTOOLS_SESSION_NOT_FOUND"]
        case .conflict(let currentRevision):
            return ["error": "DesktopWorld DevTools revision conflict", "code": "DEVTOOLS_REVISION_CONFLICT", "current_revision": currentRevision]
        case .busy:
            return ["error": "DesktopWorld DevTools host is busy", "code": "DEVTOOLS_HOST_BUSY"]
        case .invalid:
            return ["error": "Invalid DesktopWorld DevTools request", "code": "INVALID_DEVTOOLS_REQUEST"]
        case .capacity:
            return ["error": "DesktopWorld DevTools session budget exceeded", "code": "DEVTOOLS_SESSION_BUDGET_EXCEEDED"]
        }
    }
}
