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
    let idleTimeout: TimeInterval = 5.0

    init(socketPath: String, canvasManager: CanvasManager) {
        self.socketPath = socketPath
        self.canvasManager = canvasManager
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
        defer { close(clientFD) }

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

                let semaphore = DispatchSemaphore(value: 0)
                var response = CanvasResponse.fail("Internal error", code: "INTERNAL")
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { semaphore.signal(); return }
                    response = self.canvasManager.handle(request)
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

    func checkIdle() {
        if canvasManager.isEmpty {
            startIdleTimer()
        } else {
            cancelIdleTimer()
        }
    }

    private func startIdleTimer() {
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
    let server = DaemonServer(socketPath: kSocketPath, canvasManager: canvasManager)

    canvasManager.onCanvasCountChanged = { [weak server] in
        server?.checkIdle()
    }

    server.start()

    NSApplication.shared.run()
}
