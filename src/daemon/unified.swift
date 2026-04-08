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
    private var activeConnections = Set<UUID>()
    private let eventWriteQueue = DispatchQueue(label: "aos.event-write")
    private let sigilInputLock = NSLock()
    private var sigilInputState = SigilInputState()

    // Idle management
    var idleTimeout: TimeInterval
    var idleTimer: DispatchSourceTimer?

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
            let data: [String: Any] = ["id": canvasID, "payload": payload]
            self.broadcastEvent(service: "display", event: "canvas_message", data: data)
        }

        canvasManager.onCanvasLifecycle = { [weak self] canvasID, action, at in
            guard let self = self else { return }
            self.updateSigilCanvasState(canvasID: canvasID, action: action, at: at)
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
        spatial.startPolling()

        // Start content server
        if let contentConfig = currentConfig.content, !contentConfig.roots.isEmpty {
            let repoRoot = aosCurrentRepoRoot()
            contentServer = ContentServer(config: contentConfig, repoRoot: repoRoot, stateDir: aosStateDir())
            contentServer?.start()
        }

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
