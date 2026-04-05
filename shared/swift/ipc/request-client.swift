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

        // Try to start daemon
        fputs("ipc: starting daemon...\n", stderr)
        let proc = Process()
        let binary = binaryPath
        proc.executableURL = URL(fileURLWithPath: binary)
        proc.arguments = ["serve", "--idle-timeout", "5m"]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
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
    func readOneJSON(timeoutMs: Int32 = 2000) -> [String: Any]? {
        guard fd >= 0 else { return nil }
        // Check if we already have a buffered line
        if let json = reader.nextJSON() { return json }
        // Read more bytes
        var buf = [UInt8](repeating: 0, count: 4096)
        let n = readWithTimeout(fd, &buf, buf.count, timeoutMs: timeoutMs)
        guard n > 0 else { return nil }
        reader.append(buf, count: n)
        return reader.nextJSON()
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
