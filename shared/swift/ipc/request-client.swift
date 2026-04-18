// request-client.swift — Daemon request/response client.
//
// Two modes over the same primitive:
//   - Persistent session: open connection, send/receive many times, close.
//   - One-shot convenience: connect, send, receive, close.
//
// Lockstep semantics: sendAndReceive() does one write + one read on the same fd.
// sendOnly() writes without reading — caller must understand that unread responses
// accumulate on the fd (acceptable for eval commands on a subscribed connection
// where the event loop consumes everything).

import Foundation

// MARK: - Persistent Session

/// A persistent connection to the daemon for repeated request/response cycles.
/// The fd stays open until close() is called. Suitable for animation loops,
/// streaming eval commands, and any multi-command sequence.
class DaemonSession {
    let socketPath: String
    var fd: Int32 = -1
    private var reader = NDJSONReader()

    init(socketPath: String = kDefaultSocketPath) {
        self.socketPath = socketPath
    }

    deinit {
        if fd >= 0 { close(fd) }
    }

    /// Connect to the daemon. Returns true on success.
    func connect(timeoutMs: Int32 = 1000) -> Bool {
        if fd >= 0 { close(fd) }
        fd = connectSocket(socketPath, timeoutMs: timeoutMs)
        return fd >= 0
    }

    /// Connect, auto-starting the daemon if needed.
    /// Spawns the binary at `binaryPath` with `serve --idle-timeout 5m` and polls
    /// for the socket to become available.
    ///
    /// `binaryPath` is required. There is no default — callers must know which
    /// binary provides the daemon. For `aos` commands, pass `CommandLine.arguments[0]`.
    /// External consumers (e.g. Sigil) must pass the path to the `aos` binary explicitly.
    func connectWithAutoStart(binaryPath: String, timeoutMs: Int32 = 1000) -> Bool {
        if connect(timeoutMs: timeoutMs) { return true }

        let currentMode = aosCurrentRuntimeMode(executablePath: binaryPath)
        let otherSocketPath = aosSocketPath(for: currentMode.other)
        if socketIsReachable(otherSocketPath, timeoutMs: 250) {
            fputs("ipc: refusing to auto-start \(currentMode.rawValue) daemon while \(currentMode.other.rawValue) daemon is reachable at \(otherSocketPath)\n", stderr)
            return false
        }

        // Try to start daemon
        fputs("ipc: starting daemon...\n", stderr)
        let proc = Process()
        let binary = binaryPath
        proc.executableURL = URL(fileURLWithPath: binary)
        proc.arguments = ["serve", "--idle-timeout", "5m"]
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice
        let logPath = aosDaemonLogPath()
        try? FileManager.default.createDirectory(atPath: kDefaultSocketDir, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: logPath, contents: nil)
        if let logHandle = FileHandle(forWritingAtPath: logPath) {
            logHandle.seekToEndOfFile()
            proc.standardError = logHandle
        } else {
            proc.standardError = FileHandle.nullDevice
        }
        try? proc.run()

        // Poll for socket (up to 3 seconds)
        for _ in 0..<30 {
            usleep(100_000)
            if connect(timeoutMs: timeoutMs) { return true }
        }
        return false
    }

    /// Send a JSON dictionary and read one response. Lockstep: one write, one read.
    /// Returns the parsed response, or nil on timeout/error.
    @discardableResult
    func sendAndReceive(_ json: [String: Any]) -> [String: Any]? {
        guard fd >= 0 else { return nil }
        writeJSON(json)
        return readOneJSON()
    }

    /// Send a JSON dictionary without reading the response.
    /// Use when the response will be consumed by an event loop on the same fd,
    /// or when the response is intentionally discarded.
    func sendOnly(_ json: [String: Any]) {
        guard fd >= 0 else { return }
        writeJSON(json)
    }

    /// Read one JSON response from the fd. Used after sendOnly() when the caller
    /// wants to read the response later, or for reading event loop messages.
    ///
    /// Reads in a loop until a complete newline-delimited JSON object is available,
    /// so large responses (> 4 KiB) are handled correctly. Each iteration uses the
    /// full `timeoutMs` budget (only the first call waits; subsequent reads use a
    /// shorter poll so we don't double-count time for mid-message continuations).
    func readOneJSON(timeoutMs: Int32 = 2000) -> [String: Any]? {
        guard fd >= 0 else { return nil }
        // Check if we already have a buffered line
        if let json = reader.nextJSON() { return json }
        // Read chunks until we accumulate a complete newline-terminated line.
        // First chunk uses the caller's full timeout; continuation chunks use a
        // shorter poll (100 ms) so we yield quickly if data stops arriving.
        var firstRead = true
        var buf = [UInt8](repeating: 0, count: 4096)
        while true {
            let pollMs: Int32 = firstRead ? timeoutMs : 100
            let n = readWithTimeout(fd, &buf, buf.count, timeoutMs: pollMs)
            guard n > 0 else { return nil }
            reader.append(buf, count: n)
            if let json = reader.nextJSON() { return json }
            firstRead = false
        }
    }

    /// Drain any buffered responses without blocking.
    /// Call periodically (e.g. end of animation) to prevent socket buffer backlog
    /// without adding per-frame latency.
    func drainResponses() {
        guard fd >= 0 else { return }
        while true {
            var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            guard poll(&pfd, 1, 0) > 0, pfd.revents & Int16(POLLIN) != 0 else { break }
            var buf = [UInt8](repeating: 0, count: 4096)
            let n = read(fd, &buf, buf.count)
            if n <= 0 { break }
            // Discard — we don't need the responses
        }
        reader = NDJSONReader()
    }

    /// Whether the session has an open connection.
    var isConnected: Bool { fd >= 0 }

    /// Close the connection.
    func disconnect() {
        if fd >= 0 { close(fd); fd = -1 }
        reader = NDJSONReader()
    }

    // MARK: - Private

    private func writeJSON(_ json: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) else { return }
        var payload = data
        payload.append(contentsOf: "\n".utf8)
        payload.withUnsafeBytes { ptr in _ = write(fd, ptr.baseAddress!, ptr.count) }
    }
}

// MARK: - One-Shot Convenience

/// Connect, send one JSON dictionary, read one response, close.
/// If `autoStartBinary` is provided and connection fails, spawns that binary as daemon.
@discardableResult
func daemonOneShot(
    _ json: [String: Any],
    socketPath: String = kDefaultSocketPath,
    autoStartBinary: String? = nil
) -> [String: Any]? {
    let session = DaemonSession(socketPath: socketPath)
    let connected: Bool
    if let binary = autoStartBinary {
        connected = session.connectWithAutoStart(binaryPath: binary)
    } else {
        connected = session.connect()
    }
    guard connected else { return nil }
    defer { session.disconnect() }
    return session.sendAndReceive(json)
}

/// Connect, send one JSON string (pre-serialized), read and discard response, close.
/// For callers that build their own JSON strings (e.g. legacy compatibility).
func daemonOneShotRaw(_ jsonString: String, socketPath: String = kDefaultSocketPath) {
    let fd = connectSocket(socketPath)
    guard fd >= 0 else { return }
    let line = jsonString + "\n"
    line.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }
    var buf = [UInt8](repeating: 0, count: 4096)
    _ = readWithTimeout(fd, &buf, buf.count)
    close(fd)
}

// MARK: - Envelope Helpers

/// Build a v1 envelope payload dict from (service, action, data, ref?).
/// For use by callers that hold a persistent DaemonSession and can't use the
/// one-shot sendEnvelopeRequest helper.
func buildEnvelopePayload(
    service: String,
    action: String,
    data: [String: Any],
    ref: String? = nil
) -> [String: Any] {
    var payload: [String: Any] = [
        "v": 1,
        "service": service,
        "action": action,
        "data": data
    ]
    if let ref = ref { payload["ref"] = ref }
    return payload
}

// MARK: - Envelope Request (v1)

/// Send a v1 envelope request and return the parsed response as a dictionary.
/// - Parameters:
///   - service: The namespace (see, do, show, tell, listen, session, voice, system).
///   - action: The verb within the namespace.
///   - data: Action payload. Pass `[:]` for no payload.
///   - ref: Optional correlation id echoed back in the response.
///   - socketPath: Optional override of the daemon socket path.
///   - autoStartBinary: If provided and the daemon is unreachable, spawn this binary as daemon before retrying.
///   - timeoutMs: Socket I/O timeout.
/// - Returns: The parsed response JSON, or nil on connection/parse failure.
@discardableResult
func sendEnvelopeRequest(
    service: String,
    action: String,
    data: [String: Any],
    ref: String? = nil,
    socketPath: String = kDefaultSocketPath,
    autoStartBinary: String? = nil,
    timeoutMs: Int32 = 3000
) -> [String: Any]? {
    var payload: [String: Any] = [
        "v": 1,
        "service": service,
        "action": action,
        "data": data
    ]
    if let ref = ref { payload["ref"] = ref }
    let session = DaemonSession(socketPath: socketPath)
    let connected: Bool
    if let binary = autoStartBinary {
        connected = session.connectWithAutoStart(binaryPath: binary)
    } else {
        connected = session.connect(timeoutMs: timeoutMs)
    }
    guard connected else { return nil }
    defer { session.disconnect() }
    session.sendOnly(payload)
    return session.readOneJSON(timeoutMs: timeoutMs)
}
