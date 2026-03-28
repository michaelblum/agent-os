// heads-up — Daemon server
// Listens on Unix socket, dispatches commands to CanvasManager, manages idle timeout.

import AppKit
import Foundation

// MARK: - Daemon Server

class DaemonServer {
    let socketPath: String
    let canvasManager: CanvasManager
    var serverFD: Int32 = -1
    var idleTimer: DispatchSourceTimer?
    var idleTimeout: TimeInterval

    // Subscriber tracking for event relay (thread-safe)
    private var subscriberLock = NSLock()
    private var subscribers: [UUID: Int32] = [:]    // connectionID → FD
    private var activeConnections = Set<UUID>()      // all live connections
    private let eventWriteQueue = DispatchQueue(label: "heads-up.event-write")

    init(socketPath: String, canvasManager: CanvasManager, idleTimeout: TimeInterval = 5.0) {
        self.socketPath = socketPath
        self.canvasManager = canvasManager
        self.idleTimeout = idleTimeout
    }

    /// Create the socket file and start accepting connections.
    /// Call this BEFORE NSApplication.run().
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

        // Accept connections on a background queue
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop()
        }

        // Start idle timer (daemon starts idle — no canvases yet)
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

            // Remove connection-scoped canvases (synchronous, on main thread)
            let sem = DispatchSemaphore(value: 0)
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { sem.signal(); return }
                self.canvasManager.cleanupConnection(connectionID)
                self.checkIdle()
                sem.signal()
            }
            sem.wait()

            close(clientFD)
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

                guard let request = CanvasRequest.from(lineData) else {
                    let errResp = CanvasResponse.fail("Invalid JSON", code: "PARSE_ERROR")
                    self.sendResponse(to: clientFD, errResp)
                    continue
                }

                // Handle subscribe at the server level (not forwarded to CanvasManager)
                if request.action == "subscribe" {
                    subscriberLock.lock()
                    subscribers[connectionID] = clientFD
                    subscriberLock.unlock()
                    self.sendResponse(to: clientFD, .ok())
                    DispatchQueue.main.async { [weak self] in self?.checkIdle() }
                    continue
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

                self.sendResponse(to: clientFD, response)
            }
        }
    }

    private func sendResponse(to clientFD: Int32, _ response: CanvasResponse) {
        guard var data = response.toData() else { return }
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

    func checkIdle() {
        // Revised idle: no canvases AND no subscriber connections
        if canvasManager.isEmpty && !hasSubscribers {
            startIdleTimer()
        } else {
            cancelIdleTimer()
        }
    }

    /// Relay a canvas JS event to all subscriber connections.
    /// Called on the main thread from CanvasManager.onEvent.
    func relayEvent(canvasID: String, payload: Any) {
        let event: [String: Any] = ["type": "event", "id": canvasID, "payload": payload]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return }
        var data = jsonData
        data.append(contentsOf: "\n".utf8)

        subscriberLock.lock()
        let fds = Array(subscribers.values)
        subscriberLock.unlock()

        guard !fds.isEmpty else { return }

        // Write on background queue to avoid blocking main thread
        let bytes = [UInt8](data)
        eventWriteQueue.async {
            for fd in fds {
                bytes.withUnsafeBufferPointer { ptr in
                    _ = write(fd, ptr.baseAddress!, ptr.count)
                }
            }
        }
    }

    private func startIdleTimer() {
        guard idleTimeout.isFinite else { return }
        cancelIdleTimer()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + idleTimeout)
        timer.setEventHandler { [weak self] in
            guard let self = self, self.canvasManager.isEmpty else { return }
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
        close(serverFD)
        try? FileManager.default.removeItem(atPath: socketPath)
        exit(0)
    }

    private func setupSignalHandlers() {
        let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        sigterm.setEventHandler { [weak self] in self?.shutdown() }
        sigterm.resume()
        signal(SIGTERM, SIG_IGN)

        let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        sigint.setEventHandler { [weak self] in self?.shutdown() }
        sigint.resume()
        signal(SIGINT, SIG_IGN)

        _sigSources = [sigterm, sigint]
    }
    private var _sigSources: [Any] = []
}

// MARK: - Serve Command

func serveCommand(args: [String]) {
    var idleTimeout: TimeInterval = 5.0

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
        let result = withSockAddr(kSocketPath) { addr, len in
            connect(testSock, addr, len)
        }
        close(testSock)
        if result == 0 {
            exitError("Daemon already running at \(kSocketPath)", code: "ALREADY_RUNNING")
        }
    }

    let canvasManager = CanvasManager()
    let server = DaemonServer(socketPath: kSocketPath, canvasManager: canvasManager, idleTimeout: idleTimeout)

    canvasManager.onCanvasCountChanged = { [weak server] in
        server?.checkIdle()
    }

    canvasManager.onEvent = { [weak server] canvasID, payload in
        server?.relayEvent(canvasID: canvasID, payload: payload)
    }

    server.start()

    NSApplication.shared.run()
}
