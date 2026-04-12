// unified.swift — UnifiedDaemon: single socket hosting perception + display

import AppKit
import Foundation

class UnifiedDaemon {
    let socketPath: String
    let config: AosConfig
    private(set) var currentConfig: AosConfig
    private let configWatcher = ConfigWatcher()
    let startTime = Date()

    // Modules
    let perception: PerceptionEngine
    let spatial = SpatialModel()
    let canvasManager = CanvasManager()
    private var speechEngine: SpeechEngine?
    private var contentServer: ContentServer?

    // Socket server
    var serverFD: Int32 = -1
    private var subscriberLock = NSLock()
    private var subscribers: [UUID: SubscriberConnection] = [:]

    // Canvas-side event subscriptions: canvas ID → set of event-type names it wants.
    // Populated when a canvas posts {type: 'subscribe', payload: {events: [...]}}.
    var canvasEventSubscriptions: [String: Set<String>] = [:]
    let canvasSubscriptionLock = NSLock()

    // Canvas ownership: child canvas ID → parent canvas ID.
    // Populated when a canvas creates another canvas via postMessage(canvas.create).
    // CLI-originated canvases have no entry here (nil parent), which the permission
    // check treats as "mutable by anyone" for debugging predictability.
    var canvasCreatedBy: [String: String] = [:]

    // Inverse of canvasCreatedBy: parent canvas ID → set of direct child IDs.
    // Maintained alongside canvasCreatedBy so cascade-remove doesn't need a scan.
    var canvasChildren: [String: Set<String>] = [:]
    private var activeConnections = Set<UUID>()
    private let eventWriteQueue = DispatchQueue(label: "aos.event-write")
    private let sigilInputLock = NSLock()
    private var sigilInputState = SigilInputState()

    // Wiki FSEvents watcher
    private var wikiWatcher: WikiWatcher?

    // Idle management
    var idleTimeout: TimeInterval
    var idleTimer: DispatchSourceTimer?

    // Coalesce display_geometry rebroadcasts — didChangeScreenParameters can
    // storm during display reconfig; we only need one broadcast per quiet burst.
    private var displayGeometryBroadcastScheduled = false
    private let displayGeometryCoalesceMs: Int = 100

    struct SubscriberConnection {
        let fd: Int32
        var perceptionChannelIDs: Set<UUID>
        var isSubscribed: Bool  // subscribed to display events too
        var wantsInputEvents: Bool
    }

    private struct SigilInputState {
        var mode: String = "idle"
        var avatarRect: CGRect?
        var chatRect: CGRect?
    }

    init(config: AosConfig, idleTimeout: TimeInterval = 300) {
        self.socketPath = kDefaultSocketPath
        self.config = config
        self.currentConfig = config
        self.idleTimeout = idleTimeout
        self.perception = PerceptionEngine(config: config)
    }

    // MARK: - Start

    func start() {
        let mode = aosCurrentRuntimeMode()
        let otherSocketPath = aosSocketPath(for: mode.other)
        if socketIsReachable(otherSocketPath, timeoutMs: 250) {
            exitError(
                "Mixed runtime state detected: \(mode.other.rawValue) daemon is reachable at \(otherSocketPath). Stop it before starting the \(mode.rawValue) daemon.",
                code: "MIXED_RUNTIME_STATE"
            )
        }

        // Ensure directory
        try? FileManager.default.createDirectory(
            atPath: (socketPath as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true)

        unlink(socketPath)

        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else { exitError("socket() failed: \(errno)", code: "SOCKET_ERROR") }
        _ = disableSigPipe(serverFD)

        let bindResult = withSocketAddress(socketPath) { addr, len in bind(serverFD, addr, len) }
        guard bindResult == 0 else { exitError("bind() failed: \(errno)", code: "BIND_ERROR") }
        guard listen(serverFD, 10) == 0 else { exitError("listen() failed: \(errno)", code: "LISTEN_ERROR") }

        fputs("aos daemon started on \(socketPath)\n", stderr)
        fputs("\(aosIdentityLogLine(program: "aos"))\n", stderr)

        // Wire perception events -> broadcast
        perception.onEvent = { [weak self] event, data in
            self?.broadcastEvent(service: "perceive", event: event, data: data)
        }
        perception.onInputEvent = { [weak self] event, data in
            self?.handleInputEvent(event: event, data: data) ?? false
        }

        // Wire canvas events -> broadcast
        canvasManager.onEvent = { [weak self] canvasID, payload in
            guard let self = self else { return }

            // Intercept subscribe/unsubscribe before relay — these configure daemon
            // state, not events for other subscribers to observe.
            if let dict = payload as? [String: Any],
               let type = dict["type"] as? String {
                let inner = dict["payload"] as? [String: Any]
                switch type {
                case "subscribe", "unsubscribe":
                    let events = (inner?["events"] as? [String]) ?? []
                    self.handleCanvasSubscription(canvasID: canvasID, type: type, events: events)
                    return
                case "canvas.create":
                    self.handleCanvasCreate(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.update":
                    self.handleCanvasUpdate(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.remove":
                    self.handleCanvasRemove(callerID: canvasID, payload: inner ?? [:])
                    return
                default:
                    break
                }
            }

            let data: [String: Any] = ["id": canvasID, "payload": payload]
            self.broadcastEvent(service: "display", event: "canvas_message", data: data)
        }

        canvasManager.onCanvasLifecycle = { [weak self] canvasID, action, at in
            guard let self = self else { return }
            self.updateSigilCanvasState(canvasID: canvasID, action: action, at: at)

            // Drop event subscriptions when the canvas is gone.
            if action == "removed" {
                self.canvasSubscriptionLock.lock()
                let had = self.canvasEventSubscriptions.removeValue(forKey: canvasID) != nil
                let children = self.canvasChildren.removeValue(forKey: canvasID) ?? []
                // Detach this canvas from its parent's child set.
                if let parent = self.canvasCreatedBy.removeValue(forKey: canvasID) {
                    if var peers = self.canvasChildren[parent] {
                        peers.remove(canvasID)
                        if peers.isEmpty {
                            self.canvasChildren.removeValue(forKey: parent)
                        } else {
                            self.canvasChildren[parent] = peers
                        }
                    }
                }
                self.canvasSubscriptionLock.unlock()
                if had {
                    fputs("[canvas-sub] cleared subscriptions for removed canvas=\(canvasID)\n", stderr)
                }
                // Cascade: any children whose parent just died are removed too.
                // Runs on main thread (this closure already does).
                for child in children {
                    let req = CanvasRequest(
                        action: "remove", id: child, at: nil,
                        anchorWindow: nil, anchorChannel: nil, offset: nil,
                        html: nil, url: nil, interactive: nil,
                        focus: nil, ttl: nil, js: nil, scope: nil,
                        autoProject: nil, channel: nil, data: nil
                    )
                    _ = self.canvasManager.handle(req)
                    fputs("[canvas-mut] cascade-removed child=\(child) (parent=\(canvasID))\n", stderr)
                }
            }

            var data: [String: Any] = ["canvas_id": canvasID, "action": action]
            if let at = at { data["at"] = at }
            self.broadcastEvent(service: "display", event: "canvas_lifecycle", data: data)
        }

        canvasManager.onCanvasCountChanged = { [weak self] in
            self?.checkIdle()
        }

        // Start modules
        perception.start()

        // Wire spatial model events -> broadcast
        spatial.onChannelUpdated = { [weak self] id in
            self?.broadcastEvent(service: "perceive", event: "channel_updated", data: ["id": id])
        }
        spatial.onWindowMoved = { [weak self] windowID, bounds in
            guard let data = try? JSONSerialization.jsonObject(
                with: JSONEncoder().encode(bounds)) as? [String: Any] else { return }
            self?.broadcastEvent(service: "perceive", event: "window_moved",
                                data: ["window_id": windowID, "bounds": data])
        }
        spatial.onFocusChanged = { [weak self] pid, app in
            self?.broadcastEvent(service: "perceive", event: "focus_changed",
                                data: ["pid": pid, "app": app])
        }

        // Observe display arrangement changes -> rebroadcast geometry to
        // every canvas subscribed to display_geometry. Coalesce bursts —
        // didChangeScreenParameters can storm during display reconfig.
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.scheduleDisplayGeometryBroadcast()
        }

        spatial.startPolling()

        // Relocate legacy flat layout into aos/ namespace. Idempotent, creates backup.
        let wikiRoot = URL(fileURLWithPath: aosStateDir()).appendingPathComponent("wiki")
        do {
            if try WikiMigrate.migrateIfNeeded(wikiRoot: wikiRoot) {
                fputs("wiki: migrated flat layout into aos/ namespace (backup at wiki.pre-namespace-bak)\n", stderr)
            }
        } catch {
            fputs("wiki: migration failed: \(error) — continuing with current layout\n", stderr)
        }

        // Start content server
        if let contentConfig = currentConfig.content, !contentConfig.roots.isEmpty {
            let repoRoot = aosCurrentRepoRoot()
            contentServer = ContentServer(config: contentConfig, repoRoot: repoRoot, stateDir: aosStateDir())
            contentServer?.start()
        }

        // Start wiki FSEvents watcher and wire change bus
        WikiChangeBus.shared.daemon = self
        let wikiWatchRoot = URL(fileURLWithPath: aosStateDir()).appendingPathComponent("wiki")
        let watcher = WikiWatcher(wikiRoot: wikiWatchRoot)
        watcher.start()
        self.wikiWatcher = watcher

        // Accept connections
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop()
        }

        // Start idle timer
        startIdleTimer()
        setupSignalHandlers()

        // Watch config for changes
        configWatcher.onChange = { [weak self] newConfig in
            guard let self = self else { return }
            let oldConfig = self.currentConfig
            self.currentConfig = newConfig
            self.onConfigChanged(old: oldConfig, new: newConfig)
        }
        configWatcher.start()

        // Initialize voice if enabled
        if currentConfig.voice.enabled {
            initSpeechEngine()
        }
    }

    // MARK: - Event Broadcasting

    func broadcastEvent(service: String, event: String, data: [String: Any]) {
        guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }

        subscriberLock.lock()
        let fds = subscribers.values.filter(\.isSubscribed).map(\.fd)
        subscriberLock.unlock()

        guard !fds.isEmpty else { return }

        let byteArray = [UInt8](bytes)
        eventWriteQueue.async {
            for fd in fds {
                byteArray.withUnsafeBufferPointer { ptr in
                    _ = write(fd, ptr.baseAddress!, ptr.count)
                }
            }
        }
    }

    private func handleCanvasSubscription(canvasID: String, type: String, events: [String]) {
        guard !events.isEmpty else { return }
        var newlyAddedDisplayGeometry = false

        canvasSubscriptionLock.lock()
        if type == "subscribe" {
            var current = canvasEventSubscriptions[canvasID] ?? []
            let before = current
            for ev in events { current.insert(ev) }
            canvasEventSubscriptions[canvasID] = current
            newlyAddedDisplayGeometry =
                events.contains("display_geometry") && !before.contains("display_geometry")
        } else {  // unsubscribe
            if var current = canvasEventSubscriptions[canvasID] {
                for ev in events { current.remove(ev) }
                if current.isEmpty {
                    canvasEventSubscriptions.removeValue(forKey: canvasID)
                } else {
                    canvasEventSubscriptions[canvasID] = current
                }
            }
        }
        let snapshot = canvasEventSubscriptions[canvasID]
        canvasSubscriptionLock.unlock()
        fputs("[canvas-sub] \(type) canvas=\(canvasID) events=\(events) current=\(snapshot ?? [])\n", stderr)

        if newlyAddedDisplayGeometry {
            // Initial state-replay for this subscriber only. Dispatch async
            // to avoid reentering the canvas message handler from inside
            // the subscribe path.
            DispatchQueue.main.async { [weak self] in
                self?.broadcastDisplayGeometry(to: canvasID)
            }
        }
    }

    private func forwardInputEventToCanvases(data: [String: Any]) {
        canvasSubscriptionLock.lock()
        let targets = canvasEventSubscriptions
            .filter { $0.value.contains("input_event") }
            .map { $0.key }
        canvasSubscriptionLock.unlock()

        guard !targets.isEmpty else { return }

        // Serialize once, base64 once, reuse across canvases.
        guard let json = try? JSONSerialization.data(withJSONObject: data, options: []) else { return }
        let b64 = json.base64EncodedString()
        let js = "window.headsup && window.headsup.receive && window.headsup.receive('\(b64)')"

        for canvasID in targets {
            canvasManager.evalAsync(canvasID: canvasID, js: js)
        }
    }

    /// Fan out the current display geometry snapshot to every canvas
    /// subscribed to `display_geometry`. Invoked on subscribe (single
    /// target) and on `NSApplication.didChangeScreenParametersNotification`
    /// (all subscribers).
    private func broadcastDisplayGeometry(to specificCanvas: String? = nil) {
        canvasSubscriptionLock.lock()
        let targets: [String]
        if let one = specificCanvas {
            targets = canvasEventSubscriptions[one]?.contains("display_geometry") == true ? [one] : []
        } else {
            targets = canvasEventSubscriptions
                .filter { $0.value.contains("display_geometry") }
                .map { $0.key }
        }
        canvasSubscriptionLock.unlock()

        guard !targets.isEmpty else { return }
        fputs("[canvas-sub] display_geometry change -> broadcasting to \(targets.count) canvas(es)\n", stderr)

        let snapshot = snapshotDisplayGeometry()
        guard let json = try? JSONSerialization.data(withJSONObject: snapshot, options: []) else { return }
        let b64 = json.base64EncodedString()
        let js = "window.headsup && window.headsup.receive && window.headsup.receive('\(b64)')"

        for canvasID in targets {
            canvasManager.evalAsync(canvasID: canvasID, js: js)
        }
    }

    /// Coalesced entry point for didChangeScreenParameters. Collapses a burst
    /// of notifications into a single broadcast after a short quiet window.
    private func scheduleDisplayGeometryBroadcast() {
        if displayGeometryBroadcastScheduled { return }
        displayGeometryBroadcastScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(displayGeometryCoalesceMs)) { [weak self] in
            guard let self = self else { return }
            self.displayGeometryBroadcastScheduled = false
            self.broadcastDisplayGeometry()
        }
    }

    /// Send an async response to a canvas that made a mutation request with a request_id.
    /// Reuses the headsup.receive dispatch path — the canvas differentiates by msg.type.
    /// If requestID is nil, this is a no-op (fire-and-forget path).
    private func dispatchCanvasResponse(
        to canvasID: String,
        requestID: String?,
        status: String,
        code: String? = nil,
        message: String? = nil,
        createdID: String? = nil
    ) {
        guard let requestID = requestID else { return }
        var obj: [String: Any] = [
            "type": "canvas.response",
            "request_id": requestID,
            "status": status
        ]
        if let code = code { obj["code"] = code }
        if let message = message { obj["message"] = message }
        if let createdID = createdID { obj["id"] = createdID }
        guard let json = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
        let b64 = json.base64EncodedString()
        let js = "window.headsup && window.headsup.receive && window.headsup.receive('\(b64)')"
        canvasManager.evalAsync(canvasID: canvasID, js: js)
    }

    private func handleCanvasCreate(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String

        guard let newID = payload["id"] as? String, !newID.isEmpty else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_ID", message: "canvas.create requires id")
            return
        }
        guard let url = payload["url"] as? String, !url.isEmpty else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_URL", message: "canvas.create requires url")
            return
        }
        guard let frameArr = payload["frame"] as? [Any], frameArr.count == 4 else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_FRAME", message: "frame must be [x,y,w,h]")
            return
        }
        let at: [CGFloat] = frameArr.compactMap { ($0 as? NSNumber).map { CGFloat(truncating: $0) } }
        guard at.count == 4 else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_FRAME", message: "frame values must be numeric")
            return
        }
        let interactive = payload["interactive"] as? Bool

        let resolvedURL = resolveContentURL(url)

        let req = CanvasRequest(
            action: "create",
            id: newID,
            at: at,
            anchorWindow: nil, anchorChannel: nil, offset: nil,
            html: nil, url: resolvedURL,
            interactive: interactive,
            focus: nil, ttl: nil, js: nil, scope: nil,
            autoProject: nil, channel: nil, data: nil
        )

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let response = self.canvasManager.handle(req)
            if response.status == "success" {
                self.canvasSubscriptionLock.lock()
                self.canvasCreatedBy[newID] = callerID
                var siblings = self.canvasChildren[callerID] ?? []
                siblings.insert(newID)
                self.canvasChildren[callerID] = siblings
                self.canvasSubscriptionLock.unlock()
                fputs("[canvas-mut] create ok caller=\(callerID) new=\(newID)\n", stderr)
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "ok", createdID: newID)
            } else {
                fputs("[canvas-mut] create fail caller=\(callerID) new=\(newID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: response.code, message: response.error)
            }
        }
    }

    private func handleCanvasUpdate(callerID: String, payload: [String: Any]) {
        guard let targetID = payload["id"] as? String, !targetID.isEmpty else {
            fputs("[canvas-mut] update dropped caller=\(callerID) reason=missing-id\n", stderr)
            return
        }

        // Permission check. `true` = allowed.
        let permitted: Bool = {
            if targetID == callerID { return true }
            canvasSubscriptionLock.lock()
            defer { canvasSubscriptionLock.unlock() }
            if let owner = canvasCreatedBy[targetID] { return owner == callerID }
            return true  // no recorded owner = CLI-origin = open per spec rule 3
        }()
        guard permitted else {
            fputs("[canvas-mut] update forbidden caller=\(callerID) target=\(targetID)\n", stderr)
            return
        }

        // Build the CanvasRequest. Only `frame` and `interactive` are accepted for update.
        var at: [CGFloat]? = nil
        if let arr = payload["frame"] as? [Any], arr.count == 4 {
            let parsed: [CGFloat] = arr.compactMap { ($0 as? NSNumber).map { CGFloat(truncating: $0) } }
            if parsed.count == 4 { at = parsed }
        }
        let interactive = payload["interactive"] as? Bool

        guard at != nil || interactive != nil else {
            fputs("[canvas-mut] update dropped caller=\(callerID) target=\(targetID) reason=no-fields\n", stderr)
            return
        }

        let req = CanvasRequest(
            action: "update",
            id: targetID,
            at: at,
            anchorWindow: nil, anchorChannel: nil, offset: nil,
            html: nil, url: nil,
            interactive: interactive,
            focus: nil, ttl: nil, js: nil, scope: nil,
            autoProject: nil, channel: nil, data: nil
        )

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let response = self.canvasManager.handle(req)
            if response.status != "success" {
                fputs("[canvas-mut] update fail caller=\(callerID) target=\(targetID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
            }
            // Success path is intentionally silent — update is the 60Hz hot path.
        }
    }

    private func handleCanvasRemove(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        let orphanChildren = (payload["orphan_children"] as? Bool) ?? false

        guard let targetID = payload["id"] as? String, !targetID.isEmpty else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_ID", message: "canvas.remove requires id")
            return
        }

        // Permission check — identical rule to update.
        let permitted: Bool = {
            if targetID == callerID { return true }
            canvasSubscriptionLock.lock()
            defer { canvasSubscriptionLock.unlock() }
            if let owner = canvasCreatedBy[targetID] { return owner == callerID }
            return true
        }()
        guard permitted else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "FORBIDDEN",
                message: "caller \(callerID) may not remove \(targetID)")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.performCascadeRemove(targetID: targetID, orphanChildren: orphanChildren)

            // Check whether the target still exists. If yes, the remove failed.
            let targetExisted = self.canvasManager.handle(
                CanvasRequest(action: "list", id: nil, at: nil,
                              anchorWindow: nil, anchorChannel: nil, offset: nil,
                              html: nil, url: nil, interactive: nil, focus: nil,
                              ttl: nil, js: nil, scope: nil, autoProject: nil,
                              channel: nil, data: nil)
            ).canvases?.contains(where: { $0.id == targetID }) ?? false
            if targetExisted {
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: "REMOVE_FAILED",
                    message: "target \(targetID) still exists after remove")
            } else {
                self.dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok")
            }
        }
    }

    /// Must be called on the main thread. Removes children (recursively) before the target.
    /// If orphanChildren is true, children are detached (createdBy[child] = nil) but not removed.
    /// Updates ownership maps atomically under canvasSubscriptionLock.
    private func performCascadeRemove(targetID: String, orphanChildren: Bool) {
        if orphanChildren {
            canvasSubscriptionLock.lock()
            let children = canvasChildren.removeValue(forKey: targetID) ?? []
            for child in children {
                canvasCreatedBy.removeValue(forKey: child)
            }
            canvasSubscriptionLock.unlock()
        }
        // If not orphaning, the lifecycle handler does the cascade automatically
        // when handle(remove) fires below.

        let req = CanvasRequest(
            action: "remove", id: targetID, at: nil,
            anchorWindow: nil, anchorChannel: nil, offset: nil,
            html: nil, url: nil, interactive: nil,
            focus: nil, ttl: nil, js: nil, scope: nil,
            autoProject: nil, channel: nil, data: nil
        )
        let response = canvasManager.handle(req)
        if response.status != "success" {
            fputs("[canvas-mut] remove fail target=\(targetID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
        } else {
            fputs("[canvas-mut] remove ok target=\(targetID) orphan=\(orphanChildren)\n", stderr)
        }
    }

    // MARK: - Connection Handling

    private func acceptLoop() {
        while true {
            let clientFD = accept(serverFD, nil, nil)
            guard clientFD >= 0 else { continue }
            _ = disableSigPipe(clientFD)
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.handleConnection(clientFD)
            }
        }
    }

    private func handleConnection(_ clientFD: Int32) {
        let connectionID = UUID()

        subscriberLock.lock()
        activeConnections.insert(connectionID)
        subscribers[connectionID] = SubscriberConnection(fd: clientFD, perceptionChannelIDs: [], isSubscribed: false, wantsInputEvents: false)
        subscriberLock.unlock()

        defer {
            subscriberLock.lock()
            if let conn = subscribers[connectionID] {
                perception.attention.removeChannels(conn.perceptionChannelIDs)
            }
            subscribers.removeValue(forKey: connectionID)
            activeConnections.remove(connectionID)
            subscriberLock.unlock()

            // Clean up connection-scoped canvases on main thread
            DispatchQueue.main.async { [weak self] in
                self?.canvasManager.cleanupConnection(connectionID)
                self?.checkIdle()
            }

            close(clientFD)
        }

        cancelIdleTimer()

        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)

        while true {
            let bytesRead = read(clientFD, &chunk, chunk.count)
            guard bytesRead > 0 else { break }
            buffer.append(contentsOf: chunk[0..<bytesRead])

            while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
                let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
                buffer = Data(buffer[(buffer.index(after: newlineIndex))...])

                guard let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                      let action = json["action"] as? String else {
                    sendResponseJSON(to: clientFD, ["error": "Invalid JSON", "code": "PARSE_ERROR"])
                    continue
                }

                routeAction(action, json: json, clientFD: clientFD, connectionID: connectionID)
            }
        }
    }

    // MARK: - Request Routing

    private func routeAction(_ action: String, json: [String: Any], clientFD: Int32, connectionID: UUID) {
        switch action {

        // -- Perception actions --
        case "subscribe":
            let depth = json["depth"] as? Int ?? config.perception.default_depth
            let scope = json["scope"] as? String ?? "cursor"
            let rate = json["rate"] as? String ?? "on-settle"
            let channelID = perception.attention.addChannel(depth: depth, scope: scope, rate: rate)
            let wantsInputEvents = requestedInputEvents(json)
            subscriberLock.lock()
            subscribers[connectionID]?.perceptionChannelIDs.insert(channelID)
            subscribers[connectionID]?.isSubscribed = true
            subscribers[connectionID]?.wantsInputEvents = wantsInputEvents
            subscriberLock.unlock()
            sendResponseJSON(to: clientFD, ["status": "ok", "channel_id": channelID.uuidString])

        case "perceive":
            let depth = json["depth"] as? Int ?? config.perception.default_depth
            let scope = json["scope"] as? String ?? "cursor"
            let rate = json["rate"] as? String ?? "on-settle"
            let channelID = perception.attention.addChannel(depth: depth, scope: scope, rate: rate)
            let wantsInputEvents = requestedInputEvents(json)
            subscriberLock.lock()
            subscribers[connectionID]?.perceptionChannelIDs.insert(channelID)
            subscribers[connectionID]?.isSubscribed = true
            subscribers[connectionID]?.wantsInputEvents = wantsInputEvents
            subscriberLock.unlock()
            sendResponseJSON(to: clientFD, ["status": "ok", "channel_id": channelID.uuidString])

        case "sigil_input_mode":
            guard let mode = json["mode"] as? String, !mode.isEmpty else {
                sendResponseJSON(to: clientFD, ["error": "sigil_input_mode requires mode", "code": "INVALID_ARG"])
                return
            }
            setSigilInputMode(mode)
            sendResponseJSON(to: clientFD, ["status": "ok", "mode": mode])

        // -- Display actions (dispatch to CanvasManager on main thread) --
        case "create", "update", "remove", "remove-all", "list", "eval", "to-front":
            let requestData = lineData(from: json)
            guard var request = CanvasRequest.from(requestData) else {
                sendResponseJSON(to: clientFD, ["error": "Failed to parse request", "code": "PARSE_ERROR"])
                return
            }

            // Rewrite aos:// URLs
            if let url = request.url {
                request.url = resolveContentURL(url)
            }

            let semaphore = DispatchSemaphore(value: 0)
            var response = CanvasResponse.fail("Internal error", code: "INTERNAL")
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { semaphore.signal(); return }
                response = self.canvasManager.handle(request, connectionID: connectionID)
                self.checkIdle()
                semaphore.signal()
            }
            semaphore.wait()

            if let data = response.toData() {
                sendResponse(to: clientFD, data)
            }

            // Announce display actions
            if currentConfig.voice.enabled && currentConfig.voice.announce_actions {
                switch action {
                case "create":
                    if let id = json["id"] as? String {
                        announce("Canvas \(id) created")
                    }
                case "remove":
                    if let id = json["id"] as? String {
                        announce("Canvas \(id) removed")
                    }
                case "remove-all":
                    announce("All canvases removed")
                default:
                    break
                }
            }

        // -- Channel post (relay to all subscribers) --
        case "post":
            if let channel = json["channel"] as? String {
                let payload = json["data"] as? String
                relayChannelPost(channel: channel, dataStr: payload)
            }
            sendResponseJSON(to: clientFD, ["status": "ok"])

        // -- Unified ping --
        case "ping":
            let uptime = Date().timeIntervalSince(startTime)
            let perceptionChannels = perception.attention.channelCount
            subscriberLock.lock()
            let subscriberCount = subscribers.count
            subscriberLock.unlock()
            var response: [String: Any] = [
                "status": "ok",
                "uptime": uptime,
                "perception_channels": perceptionChannels,
                "subscribers": subscriberCount
            ]
            if let port = contentServer?.assignedPort, port > 0 {
                response["content_port"] = Int(port)
            }
            sendResponseJSON(to: clientFD, response)

        case "content_status":
            if let server = contentServer {
                var result = server.statusDict()
                result["status"] = "ok"
                sendResponseJSON(to: clientFD, result)
            } else {
                sendResponseJSON(to: clientFD, ["status": "ok", "port": 0, "roots": [String: String](), "note": "content server not configured"] as [String: Any])
            }

        // -- Spatial / focus / graph actions --
        case "focus-create", "focus-update", "focus-remove", "focus-list",
             "graph-displays", "graph-windows", "graph-deepen", "graph-collapse",
             "snapshot":
            let response = spatial.handleAction(action, json: json)
            sendResponseJSON(to: clientFD, response)

        default:
            sendResponseJSON(to: clientFD, ["error": "Unknown action: \(action)", "code": "UNKNOWN_ACTION"])
        }
    }

    // MARK: - Config Hot-Reload

    private func onConfigChanged(old: AosConfig, new: AosConfig) {
        if old.voice.enabled != new.voice.enabled {
            fputs("Config: voice.enabled = \(new.voice.enabled)\n", stderr)
        }
        if old.perception.default_depth != new.perception.default_depth {
            fputs("Config: perception.default_depth = \(new.perception.default_depth)\n", stderr)
        }
        if old.perception.settle_threshold_ms != new.perception.settle_threshold_ms {
            fputs("Config: perception.settle_threshold_ms = \(new.perception.settle_threshold_ms)\n", stderr)
        }
        if old.content?.roots != new.content?.roots {
            fputs("Config: content.roots changed — restart daemon to apply\n", stderr)
        }
        // Broadcast config change event to subscribers
        let data: [String: Any] = [
            "voice_enabled": new.voice.enabled,
            "perception_depth": new.perception.default_depth,
            "settle_threshold_ms": new.perception.settle_threshold_ms
        ]
        broadcastEvent(service: "system", event: "config_changed", data: data)

        // Voice engine lifecycle
        if new.voice.enabled && !old.voice.enabled {
            initSpeechEngine()
        } else if !new.voice.enabled && old.voice.enabled {
            stopSpeechEngine()
        }
        // Voice settings change while enabled
        if new.voice.enabled {
            if old.voice.voice != new.voice.voice {
                if let voiceID = new.voice.voice {
                    speechEngine?.setVoice(voiceID)
                }
            }
            if old.voice.rate != new.voice.rate, let rate = new.voice.rate {
                speechEngine?.setRate(rate)
            }
        }
    }

    // MARK: - Autonomic Voice

    private func initSpeechEngine() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.speechEngine = SpeechEngine(voice: self.currentConfig.voice.voice)
            if let rate = self.currentConfig.voice.rate {
                self.speechEngine?.setRate(rate)
            }
            fputs("Voice engine initialized\n", stderr)
        }
    }

    private func stopSpeechEngine() {
        DispatchQueue.main.async { [weak self] in
            self?.speechEngine?.stop()
            self?.speechEngine = nil
            fputs("Voice engine stopped\n", stderr)
        }
    }

    /// Speak text if voice is enabled. Non-blocking.
    func announce(_ text: String) {
        guard currentConfig.voice.enabled, let engine = speechEngine else { return }
        DispatchQueue.main.async {
            engine.speak(text)
        }
    }

    // MARK: - Helpers

    /// Rewrite `aos://` URLs to the content server's localhost address.
    func resolveContentURL(_ urlString: String) -> String {
        guard urlString.hasPrefix("aos://"),
              let server = contentServer,
              server.assignedPort > 0 else {
            return urlString
        }
        let path = String(urlString.dropFirst("aos://".count))
        return "http://127.0.0.1:\(server.assignedPort)/\(path)"
    }

    /// Convert a dictionary back to Data for CanvasRequest parsing.
    private func lineData(from json: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: json, options: [])) ?? Data()
    }

    private func relayChannelPost(channel: String, dataStr: String?) {
        var payload: Any = [String: Any]()
        if let str = dataStr, let data = str.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) {
            payload = parsed
        }
        let eventData: [String: Any] = ["channel": channel, "payload": payload]
        broadcastEvent(service: "display", event: "channel_post", data: eventData)
    }

    private func requestedInputEvents(_ json: [String: Any]) -> Bool {
        guard let events = json["events"] as? [String] else { return false }
        return events.contains("input_event")
    }

    private func handleInputEvent(event: String, data: [String: Any]) -> Bool {
        let shouldConsume = shouldConsumeSigilInputEvent(event: event, data: data)
        broadcastInputEvent(service: "input", event: "input_event", data: data)
        return shouldConsume
    }

    private func broadcastInputEvent(service: String, event: String, data: [String: Any]) {
        guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }

        subscriberLock.lock()
        let fds = subscribers.values.filter { $0.isSubscribed && $0.wantsInputEvents }.map(\.fd)
        subscriberLock.unlock()

        if !fds.isEmpty {
            let byteArray = [UInt8](bytes)
            eventWriteQueue.async {
                for fd in fds {
                    byteArray.withUnsafeBufferPointer { ptr in
                        _ = write(fd, ptr.baseAddress!, ptr.count)
                    }
                }
            }
        }

        // Forward to subscribed canvases via JS eval. Non-blocking; no response required.
        forwardInputEventToCanvases(data: data)
    }

    private func updateSigilCanvasState(canvasID: String, action: String, at: [CGFloat]?) {
        sigilInputLock.lock()
        defer { sigilInputLock.unlock() }

        switch canvasID {
        case "avatar":
            sigilInputState.avatarRect = rectForSigilCanvasAction(action: action, at: at)
        case "agent-chat":
            sigilInputState.chatRect = rectForSigilCanvasAction(action: action, at: at)
        default:
            break
        }
    }

    private func rectForSigilCanvasAction(action: String, at: [CGFloat]?) -> CGRect? {
        guard action == "created" || action == "updated" else { return nil }
        guard let at, at.count >= 4 else { return nil }
        return CGRect(x: at[0], y: at[1], width: at[2], height: at[3])
    }

    private func setSigilInputMode(_ mode: String) {
        sigilInputLock.lock()
        sigilInputState.mode = mode
        sigilInputLock.unlock()
    }

    private func shouldConsumeSigilInputEvent(event: String, data: [String: Any]) -> Bool {
        sigilInputLock.lock()
        let state = sigilInputState
        sigilInputLock.unlock()

        switch event {
        case "left_mouse_down":
            guard let point = sigilPoint(from: data) else { return false }
            let onAvatar = isPointOnSigilAvatar(point, avatarRect: state.avatarRect)
            switch state.mode {
            case "idle", "roaming", "followMe":
                return onAvatar
            default:
                return false
            }
        case "left_mouse_dragged", "left_mouse_up":
            return state.mode == "stellating" || state.mode == "radialMenuOpen"
        default:
            return false
        }
    }

    private func sigilPoint(from data: [String: Any]) -> CGPoint? {
        guard let x = data["x"] as? Double, let y = data["y"] as? Double else { return nil }
        return CGPoint(x: x, y: y)
    }

    private func isPointOnSigilAvatar(_ point: CGPoint, avatarRect: CGRect?) -> Bool {
        guard let avatarRect else { return false }
        let center = CGPoint(x: avatarRect.midX, y: avatarRect.midY)
        let radius = avatarRect.width * 0.35
        let dx = point.x - center.x
        let dy = point.y - center.y
        return sqrt(dx * dx + dy * dy) <= radius
    }

    // MARK: - Idle Management

    var hasSubscribers: Bool {
        subscriberLock.lock()
        let result = !subscribers.isEmpty
        subscriberLock.unlock()
        return result
    }

    func checkIdle() {
        if !canvasManager.isEmpty || hasSubscribers || !spatial.isEmpty {
            cancelIdleTimer()
        } else {
            startIdleTimer()
        }
    }

    private func startIdleTimer() {
        guard idleTimeout.isFinite else { return }
        idleTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + idleTimeout)
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            if self.canvasManager.isEmpty && !self.hasSubscribers {
                self.shutdown()
            }
        }
        timer.resume()
        idleTimer = timer
    }

    private func cancelIdleTimer() {
        idleTimer?.cancel()
        idleTimer = nil
    }

    func shutdown() {
        fputs("aos daemon shutting down (idle)\n", stderr)
        spatial.stopPolling()
        unlink(socketPath)
        exit(0)
    }

    private func setupSignalHandlers() {
        let handler: @convention(c) (Int32) -> Void = { _ in
            unlink(kDefaultSocketPath)
            exit(0)
        }
        signal(SIGPIPE, SIG_IGN)
        signal(SIGINT, handler)
        signal(SIGTERM, handler)
    }
}
