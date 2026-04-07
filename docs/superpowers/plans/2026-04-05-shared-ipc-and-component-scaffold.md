# Shared IPC Library and Component Scaffold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify duplicated daemon IPC code into a shared composed library at `shared/swift/ipc/`, then standardize HTML component scaffolding.

**Architecture:** Composition-based — small focused types (connection, request client, event stream, NDJSON framing) that snap together. No class hierarchy. Consumers compile shared sources directly. HTML components share a base bridge/CSS via inlined includes.

**Tech Stack:** Swift 5.9+, Unix domain sockets, POSIX poll, JSONSerialization, WKWebView (HTML components)

**Spec:** `docs/superpowers/specs/2026-04-05-shared-ipc-and-component-scaffold.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `shared/swift/ipc/connection.swift` | Socket lifecycle: connect with timeout, sockaddr construction, poll-based read, close |
| `shared/swift/ipc/ndjson.swift` | NDJSON framing: buffer bytes, yield parsed JSON dictionaries |
| `shared/swift/ipc/request-client.swift` | Persistent session (send/receive on one fd) + one-shot convenience + daemon auto-start |
| `shared/swift/ipc/event-stream.swift` | Subscribe, read continuous NDJSON, raw callbacks + optional envelope adapter, reconnect with backoff |
| `packages/toolkit/components/_base/bridge.js` | Shared headsup.receive() bridge, esc(), message dispatch |
| `packages/toolkit/components/_base/theme.css` | Shared dark-theme tokens, transparent background, typography, scrollbar |

### Modified files

| File | Change |
|------|--------|
| `build.sh` | Add `shared/swift/ipc/*.swift` to source list |
| `apps/sigil/build-avatar.sh` | Add `shared/swift/ipc/*.swift` to source list |
| `src/shared/helpers.swift` | Remove `withSockAddr`, `kAosSocketPath`, `kAosSocketDir` (moved to shared IPC). Keep `sendJSON(to:_:)` (server-side response writing — rename to `sendResponse(json:to:)` for clarity) |
| `src/commands/log.swift` | Replace private IPC helpers with shared library |
| `src/commands/inspect.swift` | Replace private IPC helpers with shared library |
| `apps/sigil/avatar-ipc.swift` | Replace socket/send/subscribe code with shared library |
| `apps/sigil/avatar-animate.swift` | Use shared request client for persistent sessions |
| `apps/sigil/avatar-sub.swift` | Use shared event stream for subscriber loop |
| `packages/toolkit/components/inspector-panel.html` | Use shared bridge.js + theme.css |
| `packages/toolkit/components/log-console.html` | Use shared bridge.js + theme.css |

### Removed files

| File | Reason |
|------|--------|
| `packages/toolkit/patterns/daemon-subscriber.swift` | Superseded by `shared/swift/ipc/event-stream.swift` |

---

## Task 1: Connection Management

**Files:**
- Create: `shared/swift/ipc/connection.swift`

- [ ] **Step 1: Create directory and write connection.swift**

```swift
// connection.swift — Unix domain socket lifecycle.
//
// Lowest layer of the shared IPC library. Handles connect with timeout,
// sockaddr construction, poll-based read, close. No JSON awareness.

import Foundation

// MARK: - Default Socket Path

/// Default daemon socket path. Consumers can override per-call.
let kDefaultSocketPath: String = {
    NSString(string: "~/.config/aos/sock").expandingTildeInPath
}()

let kDefaultSocketDir: String = {
    NSString(string: "~/.config/aos").expandingTildeInPath
}()

// MARK: - Socket Address

/// Construct a sockaddr_un for the given path and pass it to a closure.
/// Returns the closure's return value.
func withSocketAddress(_ path: String, _ body: (UnsafePointer<sockaddr>, socklen_t) -> Int32) -> Int32 {
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

// MARK: - Connect

/// Connect to a Unix domain socket. Returns fd >= 0 on success, -1 on failure.
/// Uses non-blocking connect with poll-based timeout.
func connectSocket(_ path: String = kDefaultSocketPath, timeoutMs: Int32 = 1000) -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }

    let flags = fcntl(fd, F_GETFL)
    fcntl(fd, F_SETFL, flags | O_NONBLOCK)

    let r = withSocketAddress(path) { addr, len in connect(fd, addr, len) }
    if r != 0 {
        if errno == EINPROGRESS {
            var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
            let ready = poll(&pfd, 1, timeoutMs)
            if ready <= 0 { close(fd); return -1 }
            var optErr: Int32 = 0
            var optLen = socklen_t(MemoryLayout<Int32>.size)
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &optErr, &optLen)
            if optErr != 0 { close(fd); return -1 }
        } else {
            close(fd); return -1
        }
    }

    // Restore blocking mode for subsequent reads/writes
    fcntl(fd, F_SETFL, flags & ~O_NONBLOCK)
    return fd
}

// MARK: - Read with Timeout

/// Poll-based read. Returns bytes read, or -1 on timeout/error.
func readWithTimeout(_ fd: Int32, _ buf: inout [UInt8], _ count: Int, timeoutMs: Int32 = 2000) -> Int {
    var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
    let ready = poll(&pfd, 1, timeoutMs)
    guard ready > 0 else { return -1 }
    return read(fd, &buf, count)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `swiftc -parse-as-library -typecheck shared/swift/ipc/connection.swift`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add shared/swift/ipc/connection.swift
git commit -m "feat(ipc): connection management — socket lifecycle, connect with timeout"
```

---

## Task 2: NDJSON Framing

**Files:**
- Create: `shared/swift/ipc/ndjson.swift`

- [ ] **Step 1: Write ndjson.swift**

```swift
// ndjson.swift — Newline-delimited JSON framing.
//
// Buffers raw bytes and yields complete parsed JSON dictionaries.
// Used by both request/response (single line) and event stream (continuous).

import Foundation

struct NDJSONReader {
    private var buffer = Data()

    /// Append raw bytes to the internal buffer.
    mutating func append(_ data: Data) {
        buffer.append(data)
    }

    /// Append raw bytes from a fixed-size array.
    mutating func append(_ bytes: [UInt8], count: Int) {
        buffer.append(contentsOf: bytes[0..<count])
    }

    /// Extract and parse the next complete JSON line, if available.
    /// Returns nil when no complete line is buffered.
    mutating func nextJSON() -> [String: Any]? {
        while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
            buffer = Data(buffer[buffer.index(after: newlineIndex)...])
            if lineData.isEmpty { continue }
            if let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] {
                return json
            }
        }
        return nil
    }

    /// Extract the next complete line as raw Data, if available.
    /// Returns nil when no complete line is buffered.
    mutating func nextRawLine() -> Data? {
        guard let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) else {
            return nil
        }
        let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
        buffer = Data(buffer[buffer.index(after: newlineIndex)...])
        return lineData.isEmpty ? nextRawLine() : lineData
    }

    /// Whether the buffer is empty.
    var isEmpty: Bool { buffer.isEmpty }
}

// MARK: - Envelope Decoding

/// Attempt to decode a raw JSON dictionary as a daemon event envelope.
/// Returns (service, event, timestamp, data) if the message matches the envelope schema.
/// Returns nil for non-envelope messages (e.g. channel relays, lifecycle events).
func decodeEnvelope(_ json: [String: Any]) -> (service: String, event: String, ts: Double, data: [String: Any])? {
    guard let v = json["v"] as? Int, v == 1,
          let service = json["service"] as? String,
          let event = json["event"] as? String,
          let ts = json["ts"] as? Double,
          let data = json["data"] as? [String: Any] else {
        return nil
    }
    return (service, event, ts, data)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `swiftc -parse-as-library -typecheck shared/swift/ipc/ndjson.swift`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add shared/swift/ipc/ndjson.swift
git commit -m "feat(ipc): NDJSON framing — buffered reader with envelope adapter"
```

---

## Task 3: Request/Response Client

The persistent session is the primary mode. One-shot is layered on top. Lockstep semantics: `sendAndReceive` always does one write followed by one read. `sendOnly` writes without reading — the caller is responsible for understanding that unread responses will accumulate on the fd.

**Files:**
- Create: `shared/swift/ipc/request-client.swift`

- [ ] **Step 1: Write request-client.swift**

```swift
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
    private(set) var fd: Int32 = -1
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
    /// Spawns `aos serve` and polls for the socket to become available.
    func connectWithAutoStart(binaryPath: String? = nil, timeoutMs: Int32 = 1000) -> Bool {
        if connect(timeoutMs: timeoutMs) { return true }

        // Try to start daemon
        fputs("ipc: starting daemon...\n", stderr)
        let proc = Process()
        let binary = binaryPath ?? CommandLine.arguments[0]
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
/// Auto-starts daemon if `autoStart` is true.
@discardableResult
func daemonOneShot(
    _ json: [String: Any],
    socketPath: String = kDefaultSocketPath,
    autoStart: Bool = false
) -> [String: Any]? {
    let session = DaemonSession(socketPath: socketPath)
    let connected = autoStart
        ? session.connectWithAutoStart()
        : session.connect()
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
```

- [ ] **Step 2: Verify it compiles with dependencies**

Run: `swiftc -parse-as-library -typecheck shared/swift/ipc/connection.swift shared/swift/ipc/ndjson.swift shared/swift/ipc/request-client.swift`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add shared/swift/ipc/request-client.swift
git commit -m "feat(ipc): request client — persistent session, one-shot, auto-start"
```

---

## Task 4: Event Stream

Raw NDJSON subscriber with optional envelope decoding. This replaces `packages/toolkit/patterns/daemon-subscriber.swift`.

**Files:**
- Create: `shared/swift/ipc/event-stream.swift`

- [ ] **Step 1: Write event-stream.swift**

```swift
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
```

**Important note on `DaemonSession.fd` access:** The event stream needs to share its connected fd with the session for setup commands in `onConnected`. The current `DaemonSession` above has `private(set) var fd` — this needs to be `var fd` (internal set) so event-stream can inject the fd. Update `request-client.swift` accordingly:

Change in `request-client.swift`:
```swift
// Change from:
private(set) var fd: Int32 = -1
// To:
var fd: Int32 = -1
```

- [ ] **Step 2: Update request-client.swift fd access**

In `shared/swift/ipc/request-client.swift`, change `private(set) var fd: Int32 = -1` to `var fd: Int32 = -1`.

- [ ] **Step 3: Verify full library compiles**

Run: `swiftc -parse-as-library -typecheck shared/swift/ipc/connection.swift shared/swift/ipc/ndjson.swift shared/swift/ipc/request-client.swift shared/swift/ipc/event-stream.swift`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add shared/swift/ipc/event-stream.swift shared/swift/ipc/request-client.swift
git commit -m "feat(ipc): event stream — raw NDJSON subscriber with envelope adapter, reconnect"
```

---

## Task 5: Resolve Symbol Overlap in src/shared/helpers.swift

Before any consumer can compile against both `src/shared/` and `shared/swift/ipc/`, we must remove the duplicate symbols. Socket-related helpers move to the shared IPC library. The server-side `sendJSON(to:_:)` stays but gets renamed for clarity.

**Files:**
- Modify: `src/shared/helpers.swift`

- [ ] **Step 1: Remove moved symbols and rename server-side sendJSON**

In `src/shared/helpers.swift`, remove:
- `kAosSocketDir` (now `kDefaultSocketDir` in connection.swift)
- `kAosSocketPath` (now `kDefaultSocketPath` in connection.swift)
- `withSockAddr` (now `withSocketAddress` in connection.swift)

Rename `sendJSON(to:_:)` to `sendResponseJSON(to:_:)` to distinguish it from client-side sending.

The resulting file should look like:

```swift
// helpers.swift — Shared utilities for the aos binary

import Foundation

// MARK: - JSON Helpers

func jsonString<T: Encodable>(_ value: T, pretty: Bool = true) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = pretty ? [.prettyPrinted, .sortedKeys] : [.sortedKeys]
    guard let data = try? enc.encode(value), let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
}

func jsonCompact<T: Encodable>(_ value: T) -> String {
    jsonString(value, pretty: false)
}

// MARK: - Error Output

func exitError(_ message: String, code: String) -> Never {
    let obj: [String: String] = ["error": message, "code": code]
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write(s.data(using: .utf8)!)
        FileHandle.standardError.write("\n".data(using: .utf8)!)
    }
    exit(1)
}

// MARK: - Duration Parser

func parseDuration(_ str: String) -> TimeInterval {
    if str == "none" { return .infinity }
    let s = str.lowercased()
    if s.hasSuffix("s"), let n = Double(s.dropLast()) { return n }
    if s.hasSuffix("m"), let n = Double(s.dropLast()) { return n * 60 }
    if s.hasSuffix("h"), let n = Double(s.dropLast()) { return n * 3600 }
    if let n = Double(s) { return n }
    exitError("Invalid duration: \(str). Use format like 5s, 10m, 1h, or 'none'.", code: "INVALID_DURATION")
}

// MARK: - ISO 8601

func iso8601Now() -> String {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.string(from: Date())
}

// MARK: - Server-Side Response Helpers

/// Send a raw Data response to a client fd. Appends newline.
/// This is server-side (daemon → client). Not to be confused with
/// client-side request sending in shared/swift/ipc/.
func sendResponse(to fd: Int32, _ data: Data) {
    var buf = data
    buf.append(contentsOf: "\n".utf8)
    buf.withUnsafeBytes { ptr in
        _ = write(fd, ptr.baseAddress!, ptr.count)
    }
}

/// Send a JSON dictionary response to a client fd.
/// Server-side only. See sendResponse(to:_:) above.
func sendResponseJSON(to fd: Int32, _ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]) else { return }
    sendResponse(to: fd, data)
}
```

- [ ] **Step 2: Find and update all call sites of removed/renamed symbols**

Search for `kAosSocketPath`, `kAosSocketDir`, `withSockAddr`, and `sendJSON(to:` across `src/`:

Run: `grep -rn 'kAosSocketPath\|kAosSocketDir\|withSockAddr\|sendJSON(to:' src/`

Replace each occurrence:
- `kAosSocketPath` → `kDefaultSocketPath`
- `kAosSocketDir` → `kDefaultSocketDir`
- `withSockAddr(path)` → `withSocketAddress(path)`
- `sendJSON(to: fd, dict)` → `sendResponseJSON(to: fd, dict)`

These will appear in:
- `src/commands/inspect.swift` (uses `kAosSocketPath`, `withSockAddr`)
- `src/commands/log.swift` (uses `kAosSocketPath`, `withSockAddr`)
- `src/daemon/unified.swift` (uses `kAosSocketDir`, `kAosSocketPath`, `sendJSON(to:`)
- `src/commands/serve.swift` or similar (may use socket path)

- [ ] **Step 3: Verify aos compiles with shared IPC sources**

Run: `cd /Users/Michael/Documents/GitHub/agent-os && swiftc -parse-as-library -typecheck $(find src -name '*.swift' -type f) shared/swift/ipc/*.swift`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/helpers.swift src/
git commit -m "refactor(helpers): move socket symbols to shared IPC, rename server-side sendJSON"
```

---

## Task 6: Update Build Scripts

**Files:**
- Modify: `build.sh`
- Modify: `apps/sigil/build-avatar.sh`

- [ ] **Step 1: Update build.sh**

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Compiling aos..."
# Collect all Swift source files from src/ tree and shared IPC library
SOURCES=$(find src -name '*.swift' -type f)
SHARED_IPC=$(find shared/swift/ipc -name '*.swift' -type f 2>/dev/null)

swiftc -parse-as-library -O -o aos $SOURCES $SHARED_IPC

echo "Done: ./aos ($(du -h aos | cut -f1 | xargs))"
```

- [ ] **Step 2: Update build-avatar.sh**

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"
BUILD_DIR="$PWD/build"
OUTPUT_PATH="${SIGIL_OUTPUT_PATH:-$BUILD_DIR/avatar-sub}"

mkdir -p "$(dirname "$OUTPUT_PATH")"
echo "Compiling avatar-sub..."
swiftc -parse-as-library -O -o "$OUTPUT_PATH" \
    avatar-easing.swift \
    avatar-ipc.swift \
    avatar-animate.swift \
    avatar-spatial.swift \
    avatar-behaviors.swift \
    avatar-sub.swift \
    "$REPO_ROOT"/shared/swift/ipc/*.swift
echo "Done: $OUTPUT_PATH ($(du -h "$OUTPUT_PATH" | cut -f1 | xargs))"
```

- [ ] **Step 3: Verify aos builds**

Run: `cd /Users/Michael/Documents/GitHub/agent-os && bash build.sh`
Expected: Compiles successfully.

- [ ] **Step 4: Verify Sigil builds**

Run: `cd /Users/Michael/Documents/GitHub/agent-os/apps/sigil && bash build-avatar.sh`
Expected: Compiles successfully. (Will have duplicate symbol warnings for `readWithTimeout` etc. since Sigil still has its own copies — that's expected before migration and will be fixed in Task 9.)

- [ ] **Step 5: Commit**

```bash
git add build.sh apps/sigil/build-avatar.sh
git commit -m "build: add shared/swift/ipc/ to aos and Sigil build scripts"
```

---

## Task 7: Migrate log.swift

The simplest consumer. Pure request/response — create canvas, stream eval commands.

**Files:**
- Modify: `src/commands/log.swift`

- [ ] **Step 1: Rewrite log.swift using shared IPC library**

Replace the entire file. All private helpers (`tryLogConnect`, `connectToLogDaemon`, `sendLogJSON`, `findLogHTML`) are replaced by `DaemonSession` and `daemonOneShot`. The `findLogHTML` helper stays since it's component-specific, not IPC.

```swift
// log.swift — aos log: visible log console panel
//
// Creates a scrolling log overlay. Two modes:
//   aos log                — stream: reads stdin, pushes each line to console
//   aos log push "msg"     — one-shot: pushes a single message and exits
//   aos log clear           — clears the log console

import Foundation
import CoreGraphics

func logCommand(args: [String]) {
    let sub = args.first

    // Parse position
    var panelWidth: Double = 450
    var panelHeight: Double = 300
    var panelX: Double? = nil
    var panelY: Double? = nil
    var level = "info"

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--at":
            i += 1
            if i < args.count {
                let parts = args[i].split(separator: ",").compactMap { Double($0) }
                if parts.count >= 4 {
                    panelX = parts[0]; panelY = parts[1]
                    panelWidth = parts[2]; panelHeight = parts[3]
                }
            }
        case "--level":
            i += 1
            if i < args.count { level = args[i] }
        default:
            break
        }
        i += 1
    }

    // Auto-position: bottom-left with margin
    if panelX == nil || panelY == nil {
        let mainBounds = CGDisplayBounds(CGMainDisplayID())
        panelX = 20
        panelY = mainBounds.height - panelHeight - 20
    }

    switch sub {
    case "push":
        let message = args.dropFirst().filter { !$0.hasPrefix("--") && $0 != "push" }.joined(separator: " ")
        guard !message.isEmpty else {
            exitError("Usage: aos log push <message>", code: "MISSING_TEXT")
        }
        logPushMessage(message, level: level)
        return

    case "clear":
        logClearConsole()
        return

    default:
        break
    }

    // Stream mode: create console and read stdin
    let htmlPath = findLogHTML()
    guard let htmlData = FileManager.default.contents(atPath: htmlPath),
          let html = String(data: htmlData, encoding: .utf8) else {
        exitError("Cannot read log-console.html at \(htmlPath)", code: "FILE_NOT_FOUND")
    }

    let session = DaemonSession()
    guard session.connectWithAutoStart() else {
        exitError("Cannot connect to daemon. Run 'aos serve' first.", code: "CONNECT_ERROR")
    }

    signal(SIGINT) { _ in exit(0) }
    signal(SIGTERM) { _ in exit(0) }

    // Create connection-scoped log canvas
    session.sendAndReceive([
        "action": "create",
        "id": "__log__",
        "at": [panelX!, panelY!, panelWidth, panelHeight],
        "html": html,
        "scope": "connection"
    ])

    fputs("Log console active. Reading stdin. Ctrl-C to stop.\n", stderr)

    evalLog(session: session, message: "Log console started", level: "debug")

    // Read stdin line by line
    while let line = readLine(strippingNewline: true) {
        if line.isEmpty { continue }

        if line.hasPrefix("{"),
           let data = line.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let msg = json["message"] as? String {
            let lvl = json["level"] as? String ?? level
            evalLog(session: session, message: msg, level: lvl)
        } else {
            evalLog(session: session, message: line, level: level)
        }
    }

    session.disconnect()
}

// MARK: - Helpers

private func evalLog(session: DaemonSession, message: String, level: String) {
    let escaped = message
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "'", with: "\\'")
        .replacingOccurrences(of: "\n", with: "\\n")
    let js = "pushLog('\(escaped)','\(level)')"
    session.sendOnly(["action": "eval", "id": "__log__", "js": js])
}

private func logPushMessage(_ message: String, level: String) {
    let session = DaemonSession()
    guard session.connect() else {
        exitError("Daemon not running or no log console active", code: "CONNECT_ERROR")
    }
    evalLog(session: session, message: message, level: level)
    // Read response to flush
    _ = session.readOneJSON()
    session.disconnect()
    print("{\"status\":\"ok\"}")
}

private func logClearConsole() {
    let result = daemonOneShot(
        ["action": "eval", "id": "__log__", "js": "clearLog()"]
    )
    if result != nil {
        print("{\"status\":\"ok\"}")
    } else {
        exitError("Daemon not running or no log console active", code: "CONNECT_ERROR")
    }
}

private func findLogHTML() -> String {
    let candidates = [
        (CommandLine.arguments[0] as NSString).deletingLastPathComponent + "/../packages/toolkit/components/log-console.html",
        "packages/toolkit/components/log-console.html",
        NSString(string: "~/Documents/GitHub/agent-os/packages/toolkit/components/log-console.html").expandingTildeInPath
    ]
    for path in candidates {
        let resolved = (path as NSString).standardizingPath
        if FileManager.default.fileExists(atPath: resolved) { return resolved }
    }
    return candidates.last!
}
```

- [ ] **Step 2: Verify aos builds**

Run: `cd /Users/Michael/Documents/GitHub/agent-os && bash build.sh`
Expected: Compiles successfully.

- [ ] **Step 3: Smoke test**

Run: `echo '{"message":"hello","level":"info"}' | timeout 3 ./aos log 2>/dev/null || true`
Expected: No crash. (Will fail gracefully if daemon isn't running — that's fine for a build verification.)

- [ ] **Step 4: Commit**

```bash
git add src/commands/log.swift
git commit -m "refactor(log): migrate to shared IPC library"
```

---

## Task 8: Migrate inspect.swift

More complex than log — mixes request/response (create canvas, send evals) with event stream behavior (read perception events on same fd). Uses a persistent session for the duration of the command.

**Files:**
- Modify: `src/commands/inspect.swift`

- [ ] **Step 1: Rewrite inspect.swift using shared IPC library**

```swift
// inspect.swift — aos inspect: live AX element inspector overlay
//
// Combines perception (depth 2) + display (inspector canvas) into one command.
// Creates a floating overlay showing element details under the cursor.
// Ctrl-C to stop. Canvas is connection-scoped and auto-removes.

import Foundation
import CoreGraphics

func inspectCommand(args: [String]) {
    // Parse position (default: bottom-right corner of main display)
    var panelWidth: Double = 320
    var panelHeight: Double = 250
    var panelX: Double? = nil
    var panelY: Double? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--at":
            i += 1
            if i < args.count {
                let parts = args[i].split(separator: ",").compactMap { Double($0) }
                if parts.count >= 4 {
                    panelX = parts[0]; panelY = parts[1]
                    panelWidth = parts[2]; panelHeight = parts[3]
                } else if parts.count >= 2 {
                    panelX = parts[0]; panelY = parts[1]
                }
            }
        case "--size":
            i += 1
            if i < args.count {
                let parts = args[i].split(separator: ",").compactMap { Double($0) }
                if parts.count >= 2 { panelWidth = parts[0]; panelHeight = parts[1] }
            }
        default:
            break
        }
        i += 1
    }

    // Auto-position: bottom-right of main display with 20px margin
    if panelX == nil || panelY == nil {
        let mainBounds = CGDisplayBounds(CGMainDisplayID())
        panelX = mainBounds.width - panelWidth - 20
        panelY = mainBounds.height - panelHeight - 20
    }

    // Read the inspector HTML from the toolkit
    let htmlPath = findInspectorHTML()
    guard let htmlData = FileManager.default.contents(atPath: htmlPath),
          let html = String(data: htmlData, encoding: .utf8) else {
        exitError("Cannot read inspector-panel.html at \(htmlPath)", code: "FILE_NOT_FOUND")
    }

    // Connect to daemon (persistent session for the lifetime of the command)
    let session = DaemonSession()
    guard session.connectWithAutoStart() else {
        exitError("Cannot connect to daemon. Run 'aos serve' first.", code: "CONNECT_ERROR")
    }

    signal(SIGINT) { _ in exit(0) }
    signal(SIGTERM) { _ in exit(0) }

    // Create connection-scoped inspector canvas
    session.sendAndReceive([
        "action": "create",
        "id": "__inspector__",
        "at": [panelX!, panelY!, panelWidth, panelHeight],
        "html": html,
        "scope": "connection"
    ])

    // Subscribe to perception at depth 2
    session.sendAndReceive([
        "action": "perceive",
        "depth": 2,
        "scope": "cursor",
        "rate": "on-settle"
    ])

    fputs("Inspector active. Move cursor to inspect elements. Ctrl-C to stop.\n", stderr)

    // Event loop: read ndjson from the subscribed connection.
    // This fd now receives both perception events and eval responses.
    // We filter for envelope events (have "v" field) and discard eval responses.
    var reader = NDJSONReader()
    var chunk = [UInt8](repeating: 0, count: 4096)

    while true {
        let bytesRead = read(session.fd, &chunk, chunk.count)
        guard bytesRead > 0 else {
            fputs("Daemon connection lost.\n", stderr)
            break
        }
        reader.append(chunk, count: bytesRead)

        while let json = reader.nextJSON() {
            // Only process envelope events
            guard let envelope = decodeEnvelope(json) else { continue }

            switch envelope.event {
            case "element_focused":
                let jsData = inspectJsonStringForJS(envelope.data)
                session.sendOnly([
                    "action": "eval",
                    "id": "__inspector__",
                    "js": "updateElement(\(jsData))"
                ])

            case "cursor_moved", "cursor_settled":
                if let x = envelope.data["x"] as? Double,
                   let y = envelope.data["y"] as? Double,
                   let display = envelope.data["display"] as? Int {
                    session.sendOnly([
                        "action": "eval",
                        "id": "__inspector__",
                        "js": "updateCursor(\(x),\(y),\(display))"
                    ])
                }

            default:
                break
            }
        }
    }

    session.disconnect()
}

// MARK: - Helpers

private func findInspectorHTML() -> String {
    let candidates = [
        (CommandLine.arguments[0] as NSString).deletingLastPathComponent + "/../packages/toolkit/components/inspector-panel.html",
        "packages/toolkit/components/inspector-panel.html",
        NSString(string: "~/Documents/GitHub/agent-os/packages/toolkit/components/inspector-panel.html").expandingTildeInPath
    ]
    for path in candidates {
        let resolved = (path as NSString).standardizingPath
        if FileManager.default.fileExists(atPath: resolved) { return resolved }
    }
    return candidates.last!
}

private func inspectJsonStringForJS(_ dict: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
          let str = String(data: data, encoding: .utf8) else { return "{}" }
    return str
}
```

- [ ] **Step 2: Verify aos builds**

Run: `cd /Users/Michael/Documents/GitHub/agent-os && bash build.sh`
Expected: Compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add src/commands/inspect.swift
git commit -m "refactor(inspect): migrate to shared IPC library"
```

---

## Task 9: Migrate Sigil

Replace `avatar-ipc.swift` internals with the shared library. Update socket path from `~/.config/heads-up/sock` to `~/.config/aos/sock`. Update `avatar-animate.swift` to use `DaemonSession` for persistent animation sessions. Update `avatar-sub.swift` to use `DaemonEventStream` for the subscriber loop.

**Files:**
- Modify: `apps/sigil/avatar-ipc.swift`
- Modify: `apps/sigil/avatar-animate.swift`
- Modify: `apps/sigil/avatar-behaviors.swift`
- Modify: `apps/sigil/avatar-sub.swift`

- [ ] **Step 1: Rewrite avatar-ipc.swift**

Replace all hand-rolled socket code. Keep Sigil-specific helpers (canvas queries, telemetry, behavior messaging) but reimplement them using `DaemonSession` and `daemonOneShotRaw`/`daemonOneShot`.

```swift
// avatar-ipc.swift -- IPC helpers for communicating with the aos daemon.
//
// Uses shared/swift/ipc/ for transport. Sigil-specific helpers
// (canvas queries, telemetry, behavior messaging) are layered on top.

import Foundation

// -- Well-known IDs --
let avatarID   = "avatar"
let chatID     = "agent-chat"
let telemetryID = "telemetry"

// -- Fire-and-forget: connect, send, read response, close --
func sendOneShot(_ json: String) {
    daemonOneShotRaw(json)
}

// -- Query all canvases --
func getCanvasList() -> String {
    let session = DaemonSession()
    guard session.connect() else { return "" }
    defer { session.disconnect() }
    guard let response = session.sendAndReceive(["action": "list"]) else { return "" }
    guard let data = try? JSONSerialization.data(withJSONObject: response),
          let str = String(data: data, encoding: .utf8) else { return "" }
    return str
}

// -- Extract position from list JSON for a given canvas ID --
func parseCanvasPosition(_ listStr: String, _ canvasID: String) -> (Double, Double, Double, Double)? {
    guard let idRange = listStr.range(of: "\"id\":\"\(canvasID)\"") else { return nil }
    let before = listStr[listStr.startIndex..<idRange.lowerBound]
    guard let atRange = before.range(of: "\"at\":[", options: .backwards) else { return nil }
    let nums = listStr[atRange.upperBound...]
    guard let endBracket = nums.firstIndex(of: "]") else { return nil }
    let parts = String(nums[..<endBracket]).split(separator: ",").compactMap {
        Double($0.trimmingCharacters(in: .whitespaces))
    }
    guard parts.count >= 4 else { return nil }
    return (parts[0], parts[1], parts[2], parts[3])
}

// -- Query chat DOM for pip (dot) position --
func queryDotPosition() -> (Double, Double) {
    var dotCX = 25.0, dotCY = 21.5  // fallback
    let session = DaemonSession()
    guard session.connect() else { return (dotCX, dotCY) }
    defer { session.disconnect() }
    let js = "var r=document.getElementById('dot').getBoundingClientRect();r.left+r.width/2+','+(r.top+r.height/2)"
    guard let response = session.sendAndReceive([
        "action": "eval", "id": chatID, "js": js
    ]) else { return (dotCX, dotCY) }
    if let result = response["result"] as? String {
        let parts = result.split(separator: ",")
        if parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) {
            dotCX = x; dotCY = y
        }
    }
    return (dotCX, dotCY)
}

// -- Z-ordering --
func bringToFront(_ canvasID: String) {
    daemonOneShot(["action": "to-front", "id": canvasID])
}

// -- Telemetry --
func pushTelemetry(channel: String, data: [String: Any]) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: ["channel": channel, "data": data]),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    let escaped = b64.replacingOccurrences(of: "'", with: "\\'")
    daemonOneShot(["action": "eval", "id": telemetryID, "js": "headsup.receive('\(escaped)')"])
}

func pushEvent(_ text: String, level: String = "") {
    pushTelemetry(channel: "_event", data: ["text": text, "level": level])
}

func pushAvatarState() {
    pushTelemetry(channel: "avatar", data: [
        "state": "active",
        "position": "(\(Int(curX)), \(Int(curY)))",
        "size": Int(curSize),
    ])
}

// -- Send behavior slot message to avatar skin --
func sendBehavior(_ slot: String, data: [String: Any] = [:]) {
    let msg: [String: Any] = ["type": "behavior", "slot": slot, "data": data]
    guard let jsonData = try? JSONSerialization.data(withJSONObject: msg),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    daemonOneShot(["action": "eval", "id": avatarID, "js": "headsup.receive('\(b64)')"])
}
```

- [ ] **Step 2: Rewrite avatar-animate.swift to use DaemonSession**

Replace all `connectSock()` / `sendJSON(fd, ...)` / `close(fd)` patterns with `DaemonSession`. Each animation function opens a session, sends updates in a loop, then disconnects.

```swift
// avatar-animate.swift -- Reusable animation primitives for avatar motion.
//
// Uses DaemonSession from shared/swift/ipc/ for persistent connections
// during animation loops.

import Foundation

// -- Shared mutable state (position/size of the avatar canvas) --
var curX: Double = 0, curY: Double = 0, curSize: Double = 300
var moveID: UInt64 = 0

// -- Size constants --
let fullSize: Double   = 300
let surgeSize: Double  = 400
let dockedSize: Double = 40
let animFPS: Double    = 60.0

// -- Generic frame pump --
func runAnimation(duration: Double, fps: Double = 60, body: @escaping (Double) -> Bool) {
    let n = Int(fps * duration)
    let t0 = Date()
    for i in 0...n {
        let t = Double(i) / Double(n)
        if !body(t) { break }
        let want = Double(i + 1) / fps
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }
}

/// Helper: update avatar position on a persistent session.
/// Sends without reading response — responses accumulate but the session
/// is short-lived (one animation) so this is acceptable.
private func sendAvatarUpdate(_ session: DaemonSession) {
    session.sendOnly([
        "action": "update",
        "id": avatarID,
        "at": [curX, curY, curSize, curSize]
    ])
}

// -- Position animation --
func moveTo(x: Double, y: Double, duration: Double, easing: @escaping EasingFn = easeInOutCubic, mid: UInt64? = nil) {
    let sx = curX, sy = curY
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }
    runAnimation(duration: duration) { t in
        if let mid = mid, moveID != mid { return false }
        let e = easing(t)
        curX = sx + (x - sx) * e
        curY = sy + (y - sy) * e
        sendAvatarUpdate(session)
        return true
    }
}

// -- Size animation --
func scaleTo(size: Double, duration: Double, easing: @escaping EasingFn = easeInOutCubic) {
    let ss = curSize
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }
    runAnimation(duration: duration) { t in
        let e = easing(t)
        curSize = ss + (size - ss) * e
        sendAvatarUpdate(session)
        return true
    }
}

// -- Combined move + scale --
func moveAndScale(x: Double, y: Double, size: Double, duration: Double, easing: @escaping EasingFn = easeInOutCubic, mid: UInt64? = nil) {
    let sx = curX, sy = curY, ss = curSize
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }
    runAnimation(duration: duration) { t in
        if let mid = mid, moveID != mid { return false }
        let e = easing(t)
        curX = sx + (x - sx) * e
        curY = sy + (y - sy) * e
        curSize = ss + (size - ss) * e
        sendAvatarUpdate(session)
        return true
    }
}

// -- Orbit around a rectangle's perimeter --
func orbit(bounds: (x: Double, y: Double, w: Double, h: Double), duration: Double, laps: Int = 1) {
    let perimeter = 2 * (bounds.w + bounds.h)
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }
    runAnimation(duration: duration * Double(laps)) { t in
        let p = (t * Double(laps)).truncatingRemainder(dividingBy: 1.0) * perimeter
        var ox: Double, oy: Double
        if p < bounds.w {
            ox = bounds.x + p - curSize / 2; oy = bounds.y - curSize / 2
        } else if p < bounds.w + bounds.h {
            ox = bounds.x + bounds.w - curSize / 2; oy = bounds.y + (p - bounds.w) - curSize / 2
        } else if p < 2 * bounds.w + bounds.h {
            ox = bounds.x + bounds.w - (p - bounds.w - bounds.h) - curSize / 2; oy = bounds.y + bounds.h - curSize / 2
        } else {
            ox = bounds.x - curSize / 2; oy = bounds.y + bounds.h - (p - 2 * bounds.w - bounds.h) - curSize / 2
        }
        curX = ox; curY = oy
        sendAvatarUpdate(session)
        return true
    }
}

// -- Smoothed follow: continuously track a moving target --
func holdPosition(getTarget: @escaping () -> (Double, Double)?, smoothing: Double = 0.15, shouldContinue: @escaping () -> Bool) {
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }
    while shouldContinue() {
        if let (tx, ty) = getTarget() {
            curX += (tx - curSize / 2 - curX) * smoothing
            curY += (ty - curSize / 2 - curY) * smoothing
            sendAvatarUpdate(session)
        }
        Thread.sleep(forTimeInterval: 1.0 / 60.0)
    }
}
```

- [ ] **Step 3: Update avatar-behaviors.swift**

`avatar-behaviors.swift` also opens persistent connections for animation loops (behaviorFollowClick, behaviorDock, behaviorUndock, behaviorEscapeAndDock). Replace `connectSock()`/`sendJSON(fd,...)` with `DaemonSession`.

Pattern: in each behavior function that has `let fd = connectSock()` / `defer { close(fd) }` / `sendJSON(fd, ...)`, replace with:

```swift
let session = DaemonSession()
guard session.connect() else { /* handle failure same as before */ }
defer { session.disconnect() }
// Replace sendJSON(fd, "...") with:
session.sendOnly(["action": "update", "id": avatarID, "at": [curX, curY, curSize, curSize]])
```

Functions that need this change:
- `behaviorFollowClick` (line ~105)
- `behaviorDock` (line ~231, ~252, ~271 — three animation phases on same session)
- `behaviorUndock` (line ~329)
- `behaviorEscapeAndDock` (line ~370)

For `behaviorDock` which has three phases on the same fd, use a single `DaemonSession` across all three phases (same pattern as current code where one fd is opened at phase 1 and closed after phase 3).

- [ ] **Step 4: Rewrite startSubscriber() in avatar-sub.swift to use DaemonEventStream**

Replace the manual subscriber loop (lines 674-777 of `avatar-sub.swift`) with `DaemonEventStream`. Keep the message dispatch logic identical.

Find and replace the `startSubscriber()` function:

```swift
// Replace the existing startSubscriber() function with:

var subscriberStream: DaemonEventStream? = nil

func startSubscriber() {
    let stream = DaemonEventStream()
    subscriberStream = stream  // retain

    stream.onReconnect = {
        queryAvatar()
        fputs("avatar-sub: connected to daemon.\n", stderr)
    }

    stream.onDisconnect = {
        resetInteractionState()
    }

    stream.onMessage = { json in
        guard let type = json["type"] as? String else { return }

        // Channel events
        if type == "channel",
           let channel = json["channel"] as? String,
           let data = json["data"] as? [String: Any] {
            handleChannelEvent(channel: channel, data: data)
        }

        // Avatar canvas JS events (from postMessage relay)
        if type == "event",
           let id = json["id"] as? String, id == avatarID,
           let payload = json["payload"] as? [String: Any] {
            DispatchQueue.global(qos: .userInteractive).async {
                handleAvatarEvent(payload: payload)
            }
        }

        // Canvas lifecycle events — resync avatar position
        if type == "event",
           let id = json["id"] as? String, id == "__lifecycle__",
           let payload = json["payload"] as? [String: Any],
           let lifecycleType = payload["type"] as? String, lifecycleType == "canvas_lifecycle",
           let canvasID = payload["id"] as? String, canvasID == avatarID {

            let action = payload["action"] as? String ?? ""
            if action == "created" || action == "updated",
               let at = payload["at"] as? [Double], at.count >= 3 {
                curX = at[0]; curY = at[1]; curSize = at[2]
                fputs("avatar-sub: avatar \(action) at (\(Int(curX)), \(Int(curY)), \(Int(curSize)))\n", stderr)
            } else if action == "removed" {
                curX = 0; curY = 0; curSize = 0
                fputs("avatar-sub: avatar removed, zeroed position.\n", stderr)
            }
        }
    }

    stream.start()
}
```

Also update the coalescing worker in `avatar-sub.swift` to use `DaemonSession` instead of `connectSock()`. Find the coalescing worker code (around line 59-80) and replace the socket usage:

In the `startCoalescingWorker()` function's event handler, replace:
```swift
// Old:
if coalescingWorkerFD < 0 {
    coalescingWorkerFD = connectSock()
}
guard coalescingWorkerFD >= 0 else { return }
```

With:
```swift
if coalescingWorkerFD < 0 {
    coalescingWorkerFD = connectSocket()
}
guard coalescingWorkerFD >= 0 else { return }
```

And update `closeCoalescingSocket()` if it references `connectSock`.

- [ ] **Step 5: Remove old connectSock/readWithTimeout/sendJSON from avatar-ipc.swift**

Verify that `avatar-ipc.swift` no longer defines `connectSock()`, `readWithTimeout()`, or `sendJSON(_ fd:)` — these are now provided by the shared library (`connectSocket()`, `readWithTimeout()` from `connection.swift`).

The `socketPath` constant is also removed — `kDefaultSocketPath` from the shared library replaces it.

- [ ] **Step 6: Verify Sigil builds**

Run: `cd /Users/Michael/Documents/GitHub/agent-os/apps/sigil && bash build-avatar.sh`
Expected: Compiles successfully with no duplicate symbol errors.

- [ ] **Step 7: Commit**

```bash
git add apps/sigil/avatar-ipc.swift apps/sigil/avatar-animate.swift apps/sigil/avatar-behaviors.swift apps/sigil/avatar-sub.swift
git commit -m "refactor(sigil): migrate to shared IPC library, update socket path to aos"
```

---

## Task 10: Retire daemon-subscriber.swift

**Files:**
- Remove: `packages/toolkit/patterns/daemon-subscriber.swift`

- [ ] **Step 1: Verify no other consumers**

Run: `grep -rn 'DaemonSubscriber\|daemon-subscriber' --include='*.swift' --include='*.md' .`

Confirm that the only references are in `packages/toolkit/patterns/daemon-subscriber.swift` itself and documentation. If any other consumer exists, update it to use `DaemonEventStream` from `shared/swift/ipc/` first.

- [ ] **Step 2: Remove the file**

```bash
rm packages/toolkit/patterns/daemon-subscriber.swift
```

- [ ] **Step 3: Update toolkit CLAUDE.md if it references daemon-subscriber**

Check `packages/toolkit/CLAUDE.md` for references and remove or update them.

- [ ] **Step 4: Commit**

```bash
git add -A packages/toolkit/patterns/ packages/toolkit/CLAUDE.md
git commit -m "refactor(toolkit): retire daemon-subscriber.swift, superseded by shared/swift/ipc/"
```

---

## Task 11: HTML Import Mechanism Spike

Open question from the spec: can WKWebView load sibling files from a `file://` URL? This determines whether shared CSS/JS can be `<link>`/`<script src>` includes or must be inlined.

**Files:** None (spike only — results inform Task 12)

- [ ] **Step 1: Check how canvas.swift loads URLs**

Read `src/display/canvas.swift` `loadURL()` method. Current code uses `webView.load(URLRequest(url:))` which does **not** grant read access to the URL's directory — unlike `webView.loadFileURL(_:allowingReadAccessTo:)` which does.

For inline HTML (`loadHTMLString`), `baseURL` is `nil`, so relative paths resolve to nothing.

- [ ] **Step 2: Determine approach**

Given the current loading mechanism:
- `loadHTMLString(html, baseURL: nil)` — no relative imports possible
- `webView.load(URLRequest(url: fileURL))` — restricted file access

**Conclusion:** Shared CSS/JS must be **inlined into each component HTML** at authoring time, not loaded at runtime. This means:
- `_base/bridge.js` and `_base/theme.css` are **source files** that component authors copy-paste or that a simple build script concatenates
- Each component HTML file remains fully self-contained (no external dependencies at runtime)
- The value is in having a **single source of truth** for the bridge and theme, even if the delivery mechanism is manual inclusion

**Alternative:** Modify `canvas.swift` to use `loadFileURL(_:allowingReadAccessTo:)` with the component directory as the access scope. This would enable runtime `<script src>` and `<link>` tags. This is a cleaner long-term solution but requires changing the display layer.

- [ ] **Step 3: Document the decision**

For now: inline approach. The shared files are reference implementations. Components include their content directly. A future task can upgrade `canvas.swift` to enable runtime imports.

- [ ] **Step 4: Commit** (no code changes — document in commit message)

```bash
git commit --allow-empty -m "spike: HTML import mechanism — inline approach, runtime imports need canvas.swift change"
```

---

## Task 12: Create Shared Bridge JS and Base CSS

**Files:**
- Create: `packages/toolkit/components/_base/bridge.js`
- Create: `packages/toolkit/components/_base/theme.css`

- [ ] **Step 1: Write bridge.js**

Extracted from the identical bridge code in inspector-panel.html and log-console.html:

```javascript
// bridge.js — Shared WKWebView ↔ component bridge.
//
// Inline this into component HTML files. Provides:
//   - headsup.receive(b64): base64 decode + JSON parse + dispatch to onHeadsupMessage(msg)
//   - esc(s): HTML-safe string escaping
//
// Components define: function onHeadsupMessage(msg) { ... }

function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
  window.headsup = {
    receive: function(b64) {
      try {
        var msg = JSON.parse(atob(b64));
        if (typeof onHeadsupMessage === 'function') {
          onHeadsupMessage(msg);
        }
      } catch(e) {}
    }
  };
}
```

- [ ] **Step 2: Write theme.css**

Extracted from overlapping styles in inspector-panel.html and log-console.html:

```css
/* theme.css — Shared dark theme for aos canvas components.
 *
 * Inline this into component HTML files. Provides:
 *   - Transparent background (required for overlay canvases)
 *   - Dark theme color tokens via CSS custom properties
 *   - Typography defaults (SF Mono / system monospace)
 *   - Scrollbar styling
 *   - Backdrop blur for panels
 */

* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg-panel: rgba(18, 18, 28, 0.93);
  --bg-hover: rgba(60, 60, 90, 0.15);
  --border-panel: rgba(100, 100, 140, 0.35);
  --border-subtle: rgba(80, 80, 120, 0.2);
  --text-primary: #e0e0e0;
  --text-secondary: #999;
  --text-muted: #666;
  --text-label: #888;
  --text-header: #556;
  --accent-blue: #8ab4ff;
  --accent-green: #6a9;
  --accent-yellow: #da6;
  --accent-red: #e66;
  --accent-purple: rgba(80, 120, 255, 0.25);
  --font-mono: "SF Mono", "Menlo", "Courier New", monospace;
  --font-size-base: 11px;
  --font-size-small: 10px;
  --font-size-header: 9px;
  --blur-radius: 20px;
  --radius-panel: 8px;
}

html, body {
  background: transparent !important;
  font-family: var(--font-mono);
  font-size: var(--font-size-base);
  color: var(--text-primary);
  overflow: hidden;
  width: 100%; height: 100%;
}

/* Scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(100,100,140,0.3); border-radius: 2px; }

/* Panel container mixin — apply to your root container */
.aos-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-panel);
  border-radius: var(--radius-panel);
  backdrop-filter: blur(var(--blur-radius));
  -webkit-backdrop-filter: blur(var(--blur-radius));
  width: 100%; height: 100%;
}

/* Header bar */
.aos-header {
  font-size: var(--font-size-header);
  color: var(--text-header);
  text-transform: uppercase;
  letter-spacing: 1px;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/toolkit/components/_base/
git commit -m "feat(toolkit): shared bridge.js and theme.css for canvas components"
```

---

## Task 13: Retrofit Inspector Panel and Log Console

Rewrite both components to use the shared bridge and theme. Since we're inlining (per Task 11), each file includes the shared code directly but the source of truth is `_base/`.

**Files:**
- Modify: `packages/toolkit/components/inspector-panel.html`
- Modify: `packages/toolkit/components/log-console.html`

- [ ] **Step 1: Rewrite inspector-panel.html**

```html
<!DOCTYPE html>
<html style="background:transparent">
<head>
<style>
/* Inlined from _base/theme.css */
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg-panel: rgba(18, 18, 28, 0.93);
  --bg-hover: rgba(60, 60, 90, 0.15);
  --border-panel: rgba(100, 100, 140, 0.35);
  --border-subtle: rgba(80, 80, 120, 0.2);
  --text-primary: #e0e0e0;
  --text-secondary: #999;
  --text-muted: #666;
  --text-label: #888;
  --text-header: #556;
  --accent-blue: #8ab4ff;
  --accent-green: #6a9;
  --accent-yellow: #da6;
  --accent-red: #e66;
  --accent-purple: rgba(80, 120, 255, 0.25);
  --font-mono: "SF Mono", "Menlo", "Courier New", monospace;
  --font-size-base: 11px;
  --font-size-small: 10px;
  --font-size-header: 9px;
  --blur-radius: 20px;
  --radius-panel: 8px;
}
html, body {
  background: transparent !important;
  font-family: var(--font-mono);
  font-size: var(--font-size-base);
  color: var(--text-primary);
  overflow: hidden;
  width: 100%; height: 100%;
}
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(100,100,140,0.3); border-radius: 2px; }
.aos-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-panel);
  border-radius: var(--radius-panel);
  backdrop-filter: blur(var(--blur-radius));
  -webkit-backdrop-filter: blur(var(--blur-radius));
  width: 100%; height: 100%;
}
.aos-header {
  font-size: var(--font-size-header);
  color: var(--text-header);
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* Component-specific styles */
.row { display: flex; margin-bottom: 4px; line-height: 1.4; }
.label {
  color: var(--text-label);
  min-width: 52px;
  flex-shrink: 0;
  font-size: var(--font-size-small);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.value { color: var(--text-primary); word-break: break-word; flex: 1; }
.role-badge {
  display: inline-block;
  background: var(--accent-purple);
  color: var(--accent-blue);
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
}
.path {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
}
.path span { color: #bbb; }
.path .sep { color: #555; margin: 0 3px; }
.bounds { color: var(--accent-green); font-size: var(--font-size-small); }
#empty { color: var(--text-muted); text-align: center; padding: 20px; font-style: italic; }
</style>
</head>
<body>
<div class="aos-panel" style="padding: 10px 12px; overflow-y: auto;">
  <div class="aos-header" style="margin-bottom: 8px;">AOS Inspector</div>
  <div id="content">
    <div id="empty">Move cursor to inspect elements</div>
  </div>
</div>

<script>
/* Inlined from _base/bridge.js */
function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
  window.headsup = {
    receive: function(b64) {
      try {
        var msg = JSON.parse(atob(b64));
        if (typeof onHeadsupMessage === 'function') onHeadsupMessage(msg);
      } catch(e) {}
    }
  };
}

/* Component logic */
function onHeadsupMessage(msg) {
  if (msg.type === 'element') updateElement(msg.data);
  if (msg.type === 'cursor') updateCursor(msg.x, msg.y, msg.display);
}

function updateElement(data) {
  var c = document.getElementById('content');
  if (!data || !data.role) {
    c.innerHTML = '<div id="empty">No element under cursor</div>';
    return;
  }
  var html = '';
  html += '<div class="row"><span class="label">Role</span><span class="value"><span class="role-badge">' +
    esc(data.role) + '</span></span></div>';
  if (data.title)
    html += '<div class="row"><span class="label">Title</span><span class="value">' + esc(data.title) + '</span></div>';
  if (data.label)
    html += '<div class="row"><span class="label">Label</span><span class="value">' + esc(data.label) + '</span></div>';
  if (data.value)
    html += '<div class="row"><span class="label">Value</span><span class="value">' + esc(data.value) + '</span></div>';
  if (data.bounds) {
    var b = data.bounds;
    html += '<div class="row"><span class="label">Bounds</span><span class="value bounds">' +
      Math.round(b.x) + ', ' + Math.round(b.y) + '  ' +
      Math.round(b.width) + ' \u00d7 ' + Math.round(b.height) + '</span></div>';
  }
  if (data.context_path && data.context_path.length > 0) {
    html += '<div class="path">';
    for (var i = 0; i < data.context_path.length; i++) {
      if (i > 0) html += '<span class="sep">\u203a</span>';
      html += '<span>' + esc(data.context_path[i]) + '</span>';
    }
    html += '</div>';
  }
  c.innerHTML = html;
}

function updateCursor(x, y, display) {
  document.querySelector('.aos-header').textContent =
    'AOS Inspector \u2014 ' + Math.round(x) + ', ' + Math.round(y) + '  Display ' + display;
}
</script>
</body>
</html>
```

- [ ] **Step 2: Rewrite log-console.html**

```html
<!DOCTYPE html>
<html style="background:transparent">
<head>
<style>
/* Inlined from _base/theme.css */
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg-panel: rgba(18, 18, 28, 0.93);
  --bg-hover: rgba(60, 60, 90, 0.15);
  --border-panel: rgba(100, 100, 140, 0.35);
  --border-subtle: rgba(80, 80, 120, 0.2);
  --text-primary: #e0e0e0;
  --text-secondary: #999;
  --text-muted: #666;
  --text-label: #888;
  --text-header: #556;
  --accent-blue: #8ab4ff;
  --accent-green: #6a9;
  --accent-yellow: #da6;
  --accent-red: #e66;
  --accent-purple: rgba(80, 120, 255, 0.25);
  --font-mono: "SF Mono", "Menlo", "Courier New", monospace;
  --font-size-base: 11px;
  --font-size-small: 10px;
  --font-size-header: 9px;
  --blur-radius: 20px;
  --radius-panel: 8px;
}
html, body {
  background: transparent !important;
  font-family: var(--font-mono);
  font-size: var(--font-size-base);
  color: var(--text-primary);
  overflow: hidden;
  width: 100%; height: 100%;
}
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(100,100,140,0.3); border-radius: 2px; }
.aos-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-panel);
  border-radius: var(--radius-panel);
  backdrop-filter: blur(var(--blur-radius));
  -webkit-backdrop-filter: blur(var(--blur-radius));
  width: 100%; height: 100%;
}
.aos-header {
  font-size: var(--font-size-header);
  color: var(--text-header);
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* Component-specific styles */
#console { display: flex; flex-direction: column; }
#header {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
}
#count { color: var(--text-muted); }
#entries { flex: 1; overflow-y: auto; padding: 4px 0; }
.entry {
  padding: 2px 10px;
  line-height: 1.5;
  border-bottom: 1px solid rgba(50, 50, 70, 0.15);
  display: flex;
  gap: 8px;
}
.entry:hover { background: var(--bg-hover); }
.ts { color: var(--text-header); flex-shrink: 0; font-size: var(--font-size-small); }
.level { flex-shrink: 0; font-size: var(--font-size-small); font-weight: 600; min-width: 36px; }
.level.info { color: var(--accent-green); }
.level.warn { color: var(--accent-yellow); }
.level.error { color: var(--accent-red); }
.level.debug { color: #88a; }
.msg { flex: 1; word-break: break-word; }
</style>
</head>
<body>
<div id="console" class="aos-panel">
  <div id="header">
    <span class="aos-header">AOS Log</span>
    <span id="count">0 entries</span>
  </div>
  <div id="entries"></div>
</div>

<script>
/* Inlined from _base/bridge.js */
function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
  window.headsup = {
    receive: function(b64) {
      try {
        var msg = JSON.parse(atob(b64));
        if (typeof onHeadsupMessage === 'function') onHeadsupMessage(msg);
      } catch(e) {}
    }
  };
}

/* Component logic */
var entryCount = 0;
var maxEntries = 500;

function onHeadsupMessage(msg) {
  if (msg.type === 'log') pushLog(msg.message, msg.level);
  if (msg.type === 'clear') clearLog();
}

function pushLog(message, level) {
  level = level || 'info';
  var entries = document.getElementById('entries');
  var entry = document.createElement('div');
  entry.className = 'entry';
  var now = new Date();
  var ts = ('0'+now.getHours()).slice(-2) + ':' +
           ('0'+now.getMinutes()).slice(-2) + ':' +
           ('0'+now.getSeconds()).slice(-2);
  entry.innerHTML =
    '<span class="ts">' + ts + '</span>' +
    '<span class="level ' + esc(level) + '">' + esc(level) + '</span>' +
    '<span class="msg">' + esc(message) + '</span>';
  entries.appendChild(entry);
  entryCount++;
  while (entries.children.length > maxEntries) {
    entries.removeChild(entries.firstChild);
  }
  entries.scrollTop = entries.scrollHeight;
  document.getElementById('count').textContent = entryCount + ' entries';
}

function pushEvent(data) {
  pushLog(data.message || JSON.stringify(data), data.level || 'info');
}

function clearLog() {
  document.getElementById('entries').innerHTML = '';
  entryCount = 0;
  document.getElementById('count').textContent = '0 entries';
}
</script>
</body>
</html>
```

- [ ] **Step 3: Verify aos builds (components are loaded at runtime, not compiled)**

Run: `cd /Users/Michael/Documents/GitHub/agent-os && bash build.sh`
Expected: Compiles (HTML changes don't affect Swift build, but confirms nothing is broken).

- [ ] **Step 4: Commit**

```bash
git add packages/toolkit/components/inspector-panel.html packages/toolkit/components/log-console.html
git commit -m "refactor(toolkit): retrofit components with shared bridge and theme tokens"
```

---

## Task 14: Update Documentation

**Files:**
- Modify: `packages/toolkit/CLAUDE.md`

- [ ] **Step 1: Update toolkit CLAUDE.md**

Add the `_base/` directory to the structure section and note the shared assets:

```markdown
## Structure

```
components/
  _base/          Shared bridge JS and theme CSS — inline into component HTML files
  *.html          Self-contained HTML components for aos canvases
patterns/         Reusable code patterns (IPC helpers, state machines, etc.)
```

## Shared Component Assets

`components/_base/` contains the source-of-truth for shared JavaScript and CSS used by all canvas components:

| File | What it provides |
|------|-----------------|
| `bridge.js` | `headsup.receive()` bridge, `esc()` helper, `onHeadsupMessage()` dispatch |
| `theme.css` | Transparent background, dark theme CSS custom properties, typography, scrollbar |

Components inline these assets directly (WKWebView `file://` loading doesn't support relative imports with the current canvas implementation). When creating a new component, copy the bridge and theme blocks from an existing component or from `_base/`.
```

- [ ] **Step 2: Commit**

```bash
git add packages/toolkit/CLAUDE.md
git commit -m "docs(toolkit): document shared component assets and IPC migration"
```
