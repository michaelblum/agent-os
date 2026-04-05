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
    let canvasManager = CanvasManager()
    private var speechEngine: SpeechEngine?

    // Socket server
    var serverFD: Int32 = -1
    private var subscriberLock = NSLock()
    private var subscribers: [UUID: SubscriberConnection] = [:]
    private var activeConnections = Set<UUID>()
    private let eventWriteQueue = DispatchQueue(label: "aos.event-write")

    // Idle management
    var idleTimeout: TimeInterval
    var idleTimer: DispatchSourceTimer?

    struct SubscriberConnection {
        let fd: Int32
        var perceptionChannelIDs: Set<UUID>
        var isSubscribed: Bool  // subscribed to display events too
    }

    init(config: AosConfig, idleTimeout: TimeInterval = 300) {
        self.socketPath = kAosSocketPath
        self.config = config
        self.currentConfig = config
        self.idleTimeout = idleTimeout
        self.perception = PerceptionEngine(config: config)
    }

    // MARK: - Start

    func start() {
        // Ensure directory
        try? FileManager.default.createDirectory(
            atPath: (socketPath as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true)

        unlink(socketPath)

        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else { exitError("socket() failed: \(errno)", code: "SOCKET_ERROR") }

        let bindResult = withSockAddr(socketPath) { addr, len in bind(serverFD, addr, len) }
        guard bindResult == 0 else { exitError("bind() failed: \(errno)", code: "BIND_ERROR") }
        guard listen(serverFD, 10) == 0 else { exitError("listen() failed: \(errno)", code: "LISTEN_ERROR") }

        fputs("aos daemon started on \(socketPath)\n", stderr)

        // Wire perception events -> broadcast
        perception.onEvent = { [weak self] event, data in
            self?.broadcastEvent(service: "perceive", event: event, data: data)
        }

        // Wire canvas events -> broadcast
        canvasManager.onEvent = { [weak self] canvasID, payload in
            guard let self = self else { return }
            let data: [String: Any] = ["id": canvasID, "payload": payload]
            self.broadcastEvent(service: "display", event: "canvas_message", data: data)
        }

        canvasManager.onCanvasLifecycle = { [weak self] canvasID, action, at in
            guard let self = self else { return }
            var data: [String: Any] = ["canvas_id": canvasID, "action": action]
            if let at = at { data["at"] = at }
            self.broadcastEvent(service: "display", event: "canvas_lifecycle", data: data)
        }

        canvasManager.onCanvasCountChanged = { [weak self] in
            self?.checkIdle()
        }

        // Start modules
        perception.start()

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
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.handleConnection(clientFD)
            }
        }
    }

    private func handleConnection(_ clientFD: Int32) {
        let connectionID = UUID()

        subscriberLock.lock()
        activeConnections.insert(connectionID)
        subscribers[connectionID] = SubscriberConnection(fd: clientFD, perceptionChannelIDs: [], isSubscribed: false)
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
                    sendJSON(to: clientFD, ["error": "Invalid JSON", "code": "PARSE_ERROR"])
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
            subscriberLock.lock()
            subscribers[connectionID]?.perceptionChannelIDs.insert(channelID)
            subscribers[connectionID]?.isSubscribed = true
            subscriberLock.unlock()
            sendJSON(to: clientFD, ["status": "ok", "channel_id": channelID.uuidString])

        case "perceive":
            let depth = json["depth"] as? Int ?? config.perception.default_depth
            let scope = json["scope"] as? String ?? "cursor"
            let rate = json["rate"] as? String ?? "on-settle"
            let channelID = perception.attention.addChannel(depth: depth, scope: scope, rate: rate)
            subscriberLock.lock()
            subscribers[connectionID]?.perceptionChannelIDs.insert(channelID)
            subscribers[connectionID]?.isSubscribed = true
            subscriberLock.unlock()
            sendJSON(to: clientFD, ["status": "ok", "channel_id": channelID.uuidString])

        // -- Display actions (dispatch to CanvasManager on main thread) --
        case "create", "update", "remove", "remove-all", "list", "eval", "to-front":
            let requestData = lineData(from: json)
            guard let request = CanvasRequest.from(requestData) else {
                sendJSON(to: clientFD, ["error": "Failed to parse request", "code": "PARSE_ERROR"])
                return
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
            sendJSON(to: clientFD, ["status": "ok"])

        // -- Unified ping --
        case "ping":
            let uptime = Date().timeIntervalSince(startTime)
            let perceptionChannels = perception.attention.channelCount
            subscriberLock.lock()
            let subscriberCount = subscribers.count
            subscriberLock.unlock()
            sendJSON(to: clientFD, [
                "status": "ok",
                "uptime": uptime,
                "perception_channels": perceptionChannels,
                "subscribers": subscriberCount
            ])

        default:
            sendJSON(to: clientFD, ["error": "Unknown action: \(action)", "code": "UNKNOWN_ACTION"])
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

    // MARK: - Idle Management

    var hasSubscribers: Bool {
        subscriberLock.lock()
        let result = !subscribers.isEmpty
        subscriberLock.unlock()
        return result
    }

    func checkIdle() {
        if !canvasManager.isEmpty || hasSubscribers {
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
        unlink(socketPath)
        exit(0)
    }

    private func setupSignalHandlers() {
        let handler: @convention(c) (Int32) -> Void = { _ in
            unlink(kAosSocketPath)
            exit(0)
        }
        signal(SIGINT, handler)
        signal(SIGTERM, handler)
    }
}
