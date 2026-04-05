// daemon-subscriber.swift -- Reusable subscriber for agent-os daemon event streams.
//
// Drop into any Swift project that needs to subscribe to a Unix-socket daemon
// (heads-up, side-eye, hand-off). Handles connection, ndjson parsing, reconnection
// with backoff, and envelope decoding per shared/schemas/daemon-event.schema.json.
//
// Usage:
//   let sub = DaemonSubscriber(
//       socketPath: "~/.config/heads-up/sock",
//       onEvent: { service, event, ts, data in
//           print("\(service).\(event): \(data)")
//       }
//   )
//   sub.connect()
//   // ... later ...
//   sub.disconnect()

import Foundation

// MARK: - DaemonSubscriber

class DaemonSubscriber {

    // -- Configuration --
    let socketPath: String
    let subscribeMessage: String
    let initialBackoffSec: Double
    let maxBackoffSec: Double
    let connectTimeoutMs: Int32
    let readTimeoutMs: Int32

    // -- Callbacks --
    /// Called for each envelope event: (service, event, timestamp, data).
    var onEvent: ((String, String, Double, [String: Any]) -> Void)?
    /// Called with the raw JSON dictionary for consumers that want full access (includes v, ref, etc.).
    var onRawEvent: (([String: Any]) -> Void)?
    /// Called after a successful reconnect — use for state resync (e.g. re-querying positions).
    var onReconnect: (() -> Void)?
    /// Called when the connection is first established or re-established. Receives the live fd
    /// so the consumer can send additional setup commands (e.g. event filters). fd is only valid
    /// during the callback — do not store it.
    var onConnected: ((Int32) -> Void)?

    // -- Internal state --
    private var running = false
    private var fd: Int32 = -1
    private let queue = DispatchQueue(label: "daemon-subscriber", qos: .userInitiated)
    private let lock = NSLock()

    // MARK: - Init

    /// Create a subscriber.
    ///
    /// - Parameters:
    ///   - socketPath: Unix socket path (tilde-expanded automatically).
    ///   - subscribeMessage: JSON sent to register as subscriber. Default: `{"action":"subscribe"}`.
    ///   - initialBackoffSec: First retry delay in seconds. Default: 1.
    ///   - maxBackoffSec: Maximum retry delay in seconds. Default: 10.
    ///   - connectTimeoutMs: Connect poll timeout in milliseconds. Default: 1000.
    ///   - readTimeoutMs: Read poll timeout for subscribe response in milliseconds. Default: 5000.
    ///   - onEvent: Envelope callback — (service, event, ts, data).
    init(
        socketPath: String,
        subscribeMessage: String = "{\"action\":\"subscribe\"}",
        initialBackoffSec: Double = 1.0,
        maxBackoffSec: Double = 10.0,
        connectTimeoutMs: Int32 = 1000,
        readTimeoutMs: Int32 = 5000,
        onEvent: ((String, String, Double, [String: Any]) -> Void)? = nil
    ) {
        self.socketPath = NSString(string: socketPath).expandingTildeInPath
        self.subscribeMessage = subscribeMessage
        self.initialBackoffSec = initialBackoffSec
        self.maxBackoffSec = maxBackoffSec
        self.connectTimeoutMs = connectTimeoutMs
        self.readTimeoutMs = readTimeoutMs
        self.onEvent = onEvent
    }

    // MARK: - Public API

    /// Start the subscriber loop on a background queue. Returns immediately.
    /// Reconnects automatically on disconnect.
    func connect() {
        lock.lock()
        guard !running else { lock.unlock(); return }
        running = true
        lock.unlock()

        queue.async { [weak self] in
            self?.subscriberLoop()
        }
    }

    /// Disconnect and stop reconnecting. Safe to call from any thread.
    func disconnect() {
        lock.lock()
        running = false
        let currentFD = fd
        fd = -1
        lock.unlock()

        if currentFD >= 0 {
            close(currentFD)
        }
    }

    /// Whether the subscriber loop is active (may be between reconnects).
    var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    // MARK: - Subscriber Loop

    private func subscriberLoop() {
        var backoff = initialBackoffSec

        while true {
            // Check if we should stop
            lock.lock()
            guard running else { lock.unlock(); return }
            lock.unlock()

            // Attempt connection
            let sockFD = connectSocket()
            guard sockFD >= 0 else {
                log("daemon unavailable, retrying in \(String(format: "%.0f", backoff))s...")
                sleepSeconds(backoff)
                backoff = min(backoff * 2, maxBackoffSec)
                continue
            }

            // Reset backoff on successful connect
            backoff = initialBackoffSec

            // Store fd for disconnect()
            lock.lock()
            fd = sockFD
            guard running else {
                fd = -1
                lock.unlock()
                close(sockFD)
                return
            }
            lock.unlock()

            // Send subscribe message
            let req = subscribeMessage + "\n"
            req.withCString { ptr in _ = write(sockFD, ptr, strlen(ptr)) }

            // Read and discard subscribe response
            var responseBuf = [UInt8](repeating: 0, count: 4096)
            let subN = readWithPollTimeout(sockFD, &responseBuf, responseBuf.count, timeoutMs: readTimeoutMs)
            guard subN > 0 else {
                log("subscribe failed, retrying...")
                close(sockFD)
                lock.lock(); fd = -1; lock.unlock()
                sleepSeconds(backoff)
                continue
            }

            // Notify consumer of connection
            onConnected?(sockFD)
            onReconnect?()

            log("connected.")

            // Event loop: read ndjson
            readEventLoop(sockFD)

            // Connection lost
            close(sockFD)
            lock.lock(); fd = -1; lock.unlock()

            log("connection lost, reconnecting...")

            // Brief pause before reconnect
            sleepSeconds(backoff)
        }
    }

    // MARK: - Event Loop

    private func readEventLoop(_ fd: Int32) {
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)

        while true {
            // Check if we should stop
            lock.lock()
            guard running else { lock.unlock(); return }
            lock.unlock()

            let n = read(fd, &chunk, chunk.count)
            guard n > 0 else { return }  // disconnect or error

            buffer.append(contentsOf: chunk[0..<n])

            // Parse complete lines
            while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
                let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
                buffer = Data(buffer[buffer.index(after: newlineIndex)...])

                guard !lineData.isEmpty else { continue }

                guard let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any]
                else { continue }

                // Dispatch raw callback
                onRawEvent?(json)

                // Try to decode as daemon event envelope (v + service + event + ts + data)
                if let v = json["v"] as? Int, v == 1,
                   let service = json["service"] as? String,
                   let event = json["event"] as? String,
                   let ts = json["ts"] as? Double,
                   let data = json["data"] as? [String: Any] {
                    onEvent?(service, event, ts, data)
                }
            }
        }
    }

    // MARK: - Socket Helpers

    /// Connect to the Unix domain socket. Returns fd >= 0 on success, -1 on failure.
    private func connectSocket() -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return -1 }

        // Set non-blocking for connect timeout
        let flags = fcntl(fd, F_GETFL)
        fcntl(fd, F_SETFL, flags | O_NONBLOCK)

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = socketPath.utf8CString
        let maxLen = MemoryLayout.size(ofValue: addr.sun_path)
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            pathBytes.withUnsafeBufferPointer { src in
                UnsafeMutableRawPointer(ptr).copyMemory(
                    from: src.baseAddress!, byteCount: min(pathBytes.count, maxLen))
            }
        }
        let r = withUnsafePointer(to: &addr) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Foundation.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if r != 0 {
            if errno == EINPROGRESS {
                var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
                let ready = poll(&pfd, 1, connectTimeoutMs)
                if ready <= 0 { close(fd); return -1 }
                var optErr: Int32 = 0
                var optLen = socklen_t(MemoryLayout<Int32>.size)
                getsockopt(fd, SOL_SOCKET, SO_ERROR, &optErr, &optLen)
                if optErr != 0 { close(fd); return -1 }
            } else {
                close(fd); return -1
            }
        }

        // Restore blocking mode for reads
        fcntl(fd, F_SETFL, flags & ~O_NONBLOCK)
        return fd
    }

    /// Read with poll-based timeout. Returns bytes read, or -1 on timeout/error.
    private func readWithPollTimeout(_ fd: Int32, _ buf: inout [UInt8], _ count: Int, timeoutMs: Int32) -> Int {
        var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        let ready = poll(&pfd, 1, timeoutMs)
        guard ready > 0 else { return -1 }
        return read(fd, &buf, count)
    }

    // MARK: - Utilities

    private func log(_ msg: String) {
        fputs("daemon-subscriber: \(msg)\n", stderr)
    }

    private func sleepSeconds(_ seconds: Double) {
        usleep(UInt32(seconds * 1_000_000))
    }
}
