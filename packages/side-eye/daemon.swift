// daemon.swift — Unix socket server for side-eye daemon mode
//
// Follows the heads-up daemon.swift pattern. Accepts ndjson connections,
// dispatches to SpatialModel handlers, manages subscriber connections,
// auto-exits when idle (no channels + no subscribers).

import Cocoa
import Foundation

// MARK: - Daemon Server

class SideEyeDaemon {
    let socketPath: String
    var serverFD: Int32 = -1
    var idleTimeout: TimeInterval
    var idleTimer: DispatchSourceTimer?
    let startTime = Date()

    // Connection tracking
    private var subscriberLock = NSLock()
    private var subscribers: [UUID: Int32] = [:]    // connectionID → FD
    private var activeConnections = Set<UUID>()
    private let eventWriteQueue = DispatchQueue(label: "side-eye.event-write")

    // Spatial model (manages channels + polling)
    let spatial: SpatialModel

    init(idleTimeout: TimeInterval = 30) {
        self.socketPath = kSideEyeSocketPath
        self.idleTimeout = idleTimeout
        self.spatial = SpatialModel()
    }

    /// Create the socket file and start accepting connections.
    func start() {
        // Ensure directory exists
        try? FileManager.default.createDirectory(
            atPath: (socketPath as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true)

        // Remove stale socket
        unlink(socketPath)

        // Create socket
        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else {
            exitError("socket() failed: \(errno)", code: "SOCKET_ERROR")
        }

        // Bind
        let bindResult = withSockAddr(socketPath) { addr, len in
            bind(serverFD, addr, len)
        }
        guard bindResult == 0 else {
            exitError("bind() failed: \(errno)", code: "BIND_ERROR")
        }

        // Listen
        guard listen(serverFD, 5) == 0 else {
            exitError("listen() failed: \(errno)", code: "LISTEN_ERROR")
        }

        // Wire up spatial model event callbacks
        spatial.onChannelUpdated = { [weak self] id in
            self?.relayEvent(DaemonEvent(type: "channel_updated", id: id, updated_at: iso8601Now()))
        }
        spatial.onWindowMoved = { [weak self] windowID, bounds in
            self?.relayEvent(DaemonEvent(type: "window_moved", window_id: windowID, bounds: bounds))
        }
        spatial.onFocusChanged = { [weak self] pid, app in
            self?.relayEvent(DaemonEvent(type: "focus_changed", pid: pid, app: app))
        }

        // Start spatial polling
        spatial.startPolling()

        // Accept connections on a background queue
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop()
        }

        // Start idle timer (daemon starts idle — no channels yet)
        startIdleTimer()

        // Clean up socket on termination
        setupSignalHandlers()
    }

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

        // Track this connection
        subscriberLock.lock()
        activeConnections.insert(connectionID)
        subscriberLock.unlock()

        defer {
            // Remove from subscribers and active connections
            subscriberLock.lock()
            subscribers.removeValue(forKey: connectionID)
            activeConnections.remove(connectionID)
            subscriberLock.unlock()

            close(clientFD)
            checkIdle()
        }

        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)

        while true {
            let bytesRead = read(clientFD, &chunk, chunk.count)
            guard bytesRead > 0 else { break }

            buffer.append(contentsOf: chunk[0..<bytesRead])

            while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
                let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
                buffer = Data(buffer[(buffer.index(after: newlineIndex))...])

                guard let request = DaemonRequest.from(lineData) else {
                    let errResp = DaemonResponse.fail("Invalid JSON", code: "PARSE_ERROR")
                    self.sendResponse(to: clientFD, errResp)
                    continue
                }

                // Handle subscribe at the server level
                if request.action == "subscribe" {
                    subscriberLock.lock()
                    subscribers[connectionID] = clientFD
                    subscriberLock.unlock()
                    self.sendResponse(to: clientFD, .ok)
                    checkIdle()
                    continue
                }

                let response = self.dispatchRequest(request, connectionID: connectionID)
                self.sendResponse(to: clientFD, response)
                checkIdle()
            }
        }
    }

    func dispatchRequest(_ req: DaemonRequest, connectionID: UUID) -> DaemonResponse {
        switch req.action {
        case "focus-create":
            guard let id = req.id else { return .fail("id required", code: "MISSING_ARG") }
            guard let wid = req.window_id else { return .fail("window_id required", code: "MISSING_ARG") }
            return spatial.createChannel(id: id, windowID: wid, pid: req.pid,
                                          subtree: req.subtree, depth: req.depth)
        case "focus-update":
            guard let id = req.id else { return .fail("id required", code: "MISSING_ARG") }
            return spatial.updateChannel(id: id, subtree: req.subtree, depth: req.depth)
        case "focus-remove":
            guard let id = req.id else { return .fail("id required", code: "MISSING_ARG") }
            return spatial.removeChannel(id: id)
        case "focus-list":
            return spatial.listChannels()
        case "snapshot":
            return spatial.snapshot()
        case "subscribe":
            // Already handled above, but just in case
            return .ok

        // Graph navigation commands
        case "graph-displays":
            let displays = spatial.enumerateDisplays()
            var resp = DaemonResponse.ok
            resp.displays = displays
            return resp
        case "graph-windows":
            let windows = spatial.enumerateWindows(display: req.display)
            var resp = DaemonResponse.ok
            resp.windows = windows
            return resp
        case "graph-deepen":
            guard let id = req.id else { return .fail("id required", code: "MISSING_ARG") }
            return spatial.deepenChannel(id: id, subtree: req.subtree, depth: req.depth)
        case "graph-collapse":
            guard let id = req.id else { return .fail("id required", code: "MISSING_ARG") }
            return spatial.collapseChannel(id: id, depth: req.depth)

        default:
            return .fail("Unknown action: \(req.action)", code: "UNKNOWN_ACTION")
        }
    }

    private func sendResponse(to clientFD: Int32, _ response: DaemonResponse) {
        var data = response.toData()
        data.append(UInt8(ascii: "\n"))
        data.withUnsafeBytes { ptr in
            _ = write(clientFD, ptr.baseAddress!, ptr.count)
        }
    }

    var hasSubscribers: Bool {
        subscriberLock.lock()
        let result = !subscribers.isEmpty
        subscriberLock.unlock()
        return result
    }

    /// Relay a daemon event to all subscriber connections.
    func relayEvent(_ event: DaemonEvent) {
        var data = event.toData()
        data.append(contentsOf: "\n".utf8)

        subscriberLock.lock()
        let fds = Array(subscribers.values)
        subscriberLock.unlock()

        guard !fds.isEmpty else { return }

        let bytes = [UInt8](data)
        eventWriteQueue.async {
            for fd in fds {
                bytes.withUnsafeBufferPointer { ptr in
                    _ = write(fd, ptr.baseAddress!, ptr.count)
                }
            }
        }
    }

    func checkIdle() {
        // Idle: no active channels AND no subscriber connections
        if spatial.isEmpty && !hasSubscribers {
            startIdleTimer()
        } else {
            cancelIdleTimer()
        }
    }

    private func startIdleTimer() {
        guard idleTimeout.isFinite else { return }
        cancelIdleTimer()
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now() + idleTimeout)
        timer.setEventHandler { [weak self] in
            guard let self = self, self.spatial.isEmpty, !self.hasSubscribers else { return }
            self.shutdown()
        }
        timer.resume()
        idleTimer = timer
    }

    private func cancelIdleTimer() {
        idleTimer?.cancel()
        idleTimer = nil
    }

    func shutdown() {
        cancelIdleTimer()
        spatial.stopPolling()
        close(serverFD)
        try? FileManager.default.removeItem(atPath: socketPath)
        exit(0)
    }

    private func setupSignalHandlers() {
        let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: DispatchQueue.global(qos: .utility))
        sigterm.setEventHandler { [weak self] in self?.shutdown() }
        sigterm.resume()
        signal(SIGTERM, SIG_IGN)

        let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: DispatchQueue.global(qos: .utility))
        sigint.setEventHandler { [weak self] in self?.shutdown() }
        sigint.resume()
        signal(SIGINT, SIG_IGN)

        _sigSources = [sigterm, sigint]
    }
    private var _sigSources: [Any] = []
}

// MARK: - Serve Command

func serveCommand(args: [String]) {
    var idleTimeout: TimeInterval = 30.0

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--idle-timeout":
            i += 1
            guard i < args.count else { exitError("--idle-timeout requires a duration", code: "MISSING_ARG") }
            idleTimeout = parseDuration(args[i])
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    // Check for existing daemon
    let testSock = socket(AF_UNIX, SOCK_STREAM, 0)
    if testSock >= 0 {
        let result = withSockAddr(kSideEyeSocketPath) { addr, len in
            connect(testSock, addr, len)
        }
        close(testSock)
        if result == 0 {
            exitError("Daemon already running at \(kSideEyeSocketPath)", code: "ALREADY_RUNNING")
        }
    }

    let daemon = SideEyeDaemon(idleTimeout: idleTimeout)
    daemon.start()

    // Keep the process alive
    dispatchMain()
}

// MARK: - Unix Socket Helper

/// Execute a closure with a properly bound sockaddr_un. Handles the ugly C interop.
func withSockAddr(_ path: String, _ body: (UnsafePointer<sockaddr>, socklen_t) -> Int32) -> Int32 {
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = path.utf8CString
    let maxLen = MemoryLayout.size(ofValue: addr.sun_path)
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        pathBytes.withUnsafeBufferPointer { src in
            UnsafeMutableRawPointer(ptr).copyMemory(
                from: src.baseAddress!, byteCount: min(pathBytes.count, maxLen))
        }
    }
    return withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            body(sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
}

// MARK: - Duration Parser

/// Parse a duration string like "5s", "10m", "1h", or "none".
/// Returns seconds. "none" returns .infinity (no timeout).
func parseDuration(_ str: String) -> TimeInterval {
    if str == "none" { return .infinity }
    let s = str.lowercased()
    if s.hasSuffix("s"), let n = Double(s.dropLast()) { return n }
    if s.hasSuffix("m"), let n = Double(s.dropLast()) { return n * 60 }
    if s.hasSuffix("h"), let n = Double(s.dropLast()) { return n * 3600 }
    if let n = Double(s) { return n }  // plain number = seconds
    exitError("Invalid duration: \(str). Use format like 5s, 10m, 1h, or 'none'.", code: "INVALID_DURATION")
}
