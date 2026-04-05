// event-stream.swift — Daemon event stream subscriber.
//
// Subscribes to the daemon, reads continuous NDJSON, fires callbacks per message.
// The stream delivers raw parsed JSON dictionaries. Envelope decoding is optional.
//
// Reconnects with exponential backoff on disconnect.
// Replaces packages/toolkit/patterns/daemon-subscriber.swift.

import Foundation

class DaemonEventStream {

    // -- Configuration --
    let socketPath: String
    let subscribeMessage: [String: Any]
    let initialBackoffSec: Double
    let maxBackoffSec: Double
    let connectTimeoutMs: Int32

    // -- Callbacks --
    /// Called for every parsed JSON message on the stream. This is the primary callback.
    /// Receives ALL messages regardless of shape (envelopes, channel relays, lifecycle, etc).
    var onMessage: (([String: Any]) -> Void)?

    /// Called only for messages matching the daemon envelope schema (v=1, service, event, ts, data).
    /// Convenience adapter — consumers that only care about envelopes use this instead of onMessage.
    var onEnvelope: ((String, String, Double, [String: Any]) -> Void)?

    /// Called when a connection is established. Receives a DaemonSession on the live fd
    /// for sending setup commands (e.g. canvas creation, event filters). The session is only
    /// valid during the callback — do not store it.
    var onConnected: ((DaemonSession) -> Void)?

    /// Called after a reconnect — use for state resync (e.g. re-querying positions).
    var onReconnect: (() -> Void)?

    /// Called when the connection is lost — use for state reset.
    var onDisconnect: (() -> Void)?

    // -- Internal state --
    private var running = false
    private var fd: Int32 = -1
    private let queue = DispatchQueue(label: "daemon-event-stream", qos: .userInitiated)
    private let lock = NSLock()

    init(
        socketPath: String = kDefaultSocketPath,
        subscribeMessage: [String: Any] = ["action": "subscribe"],
        initialBackoffSec: Double = 1.0,
        maxBackoffSec: Double = 10.0,
        connectTimeoutMs: Int32 = 1000
    ) {
        self.socketPath = socketPath
        self.subscribeMessage = subscribeMessage
        self.initialBackoffSec = initialBackoffSec
        self.maxBackoffSec = maxBackoffSec
        self.connectTimeoutMs = connectTimeoutMs
    }

    // MARK: - Public API

    /// Start the subscriber loop on a background queue. Returns immediately.
    func start() {
        lock.lock()
        guard !running else { lock.unlock(); return }
        running = true
        lock.unlock()
        queue.async { [weak self] in self?.subscriberLoop() }
    }

    /// Stop the subscriber and close the connection.
    func stop() {
        lock.lock()
        running = false
        let currentFD = fd
        fd = -1
        lock.unlock()
        if currentFD >= 0 { close(currentFD) }
    }

    var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    // MARK: - Subscriber Loop

    private func subscriberLoop() {
        var backoff = initialBackoffSec

        while true {
            lock.lock()
            guard running else { lock.unlock(); return }
            lock.unlock()

            let sockFD = connectSocket(socketPath, timeoutMs: connectTimeoutMs)
            guard sockFD >= 0 else {
                fputs("event-stream: daemon unavailable, retrying in \(Int(backoff))s...\n", stderr)
                usleep(UInt32(backoff * 1_000_000))
                backoff = min(backoff * 2, maxBackoffSec)
                continue
            }

            backoff = initialBackoffSec

            lock.lock()
            fd = sockFD
            guard running else { fd = -1; lock.unlock(); close(sockFD); return }
            lock.unlock()

            // Send subscribe message
            let session = DaemonSession(socketPath: socketPath)
            // Inject the already-connected fd (DaemonSession manages its own fd,
            // but here we share the subscriber fd for setup commands)
            session.fd = sockFD
            session.sendAndReceive(subscribeMessage)

            // Notify consumer of connection
            onConnected?(session)
            onReconnect?()

            // Prevent session deinit from closing our fd
            session.fd = -1

            fputs("event-stream: connected.\n", stderr)

            // Read events
            readLoop(sockFD)

            // Connection lost
            close(sockFD)
            lock.lock()
            fd = -1
            lock.unlock()

            onDisconnect?()
            fputs("event-stream: connection lost, reconnecting...\n", stderr)

            usleep(UInt32(backoff * 1_000_000))
        }
    }

    // MARK: - Read Loop

    private func readLoop(_ fd: Int32) {
        var reader = NDJSONReader()
        var chunk = [UInt8](repeating: 0, count: 4096)

        while true {
            lock.lock()
            guard running else { lock.unlock(); return }
            lock.unlock()

            let n = read(fd, &chunk, chunk.count)
            guard n > 0 else { return }

            reader.append(chunk, count: n)

            while let json = reader.nextJSON() {
                // Raw callback — every message
                onMessage?(json)

                // Envelope adapter — only matching messages
                if let envelope = decodeEnvelope(json) {
                    onEnvelope?(envelope.service, envelope.event, envelope.ts, envelope.data)
                }
            }
        }
    }
}
