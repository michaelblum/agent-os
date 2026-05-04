# AOS Phase 2: Fold Display Module Into Unified Binary

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the heads-up display server into the `aos` binary so that `aos show` subcommands manage overlays and `aos serve` runs both perception and display in one daemon, one socket, one process.

**Architecture:** Copy heads-up Swift files into `src/display/`, refactor PerceptionDaemon into a PerceptionEngine (no socket), create a UnifiedDaemon that owns both the PerceptionEngine and CanvasManager on a single socket at `~/.config/aos/sock`. Display client commands route through the same socket. The `render` command remains stateless (no daemon needed).

**Tech Stack:** Swift 5.9+, macOS 14+. Frameworks: Foundation, AppKit, WebKit, ApplicationServices, CoreGraphics. No external dependencies.

**Spec:** `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md` (Section 8, Phase 2)

**Reference code:** `packages/heads-up/*.swift` (the source being ported)

**Phase 1 binary:** `src/` — already has perceive module, shared helpers, envelope, config

---

## File Structure (after Phase 2)

```
src/
  main.swift                        # MODIFY: add "show" routing
  shared/
    helpers.swift                   # MODIFY: add display-specific helpers if needed
    envelope.swift                  # Existing (unchanged)
    config.swift                    # MODIFY: add display config section
    types.swift                     # Existing (unchanged)
  perceive/
    cursor.swift                    # Existing (unchanged)
    models.swift                    # Existing (unchanged)
    ax.swift                        # Existing (unchanged)
    daemon.swift                    # REFACTOR → PerceptionEngine (remove socket server)
    attention.swift                 # Existing (unchanged)
    events.swift                    # Existing (unchanged)
    observe.swift                   # Existing (unchanged)
  display/
    protocol.swift                  # COPY from packages/heads-up/protocol.swift
    canvas.swift                    # COPY from packages/heads-up/canvas.swift
    render.swift                    # COPY from packages/heads-up/render.swift
    autoprojection.swift            # COPY from packages/heads-up/autoprojection.swift
    channel.swift                   # COPY from packages/heads-up/channel.swift
    client.swift                    # ADAPT from packages/heads-up/client.swift
  daemon/
    unified.swift                   # NEW: UnifiedDaemon (socket server, routing, event broadcast)
  commands/
    serve.swift                     # MODIFY: create UnifiedDaemon instead of PerceptionDaemon
    set.swift                       # Existing (unchanged)
build.sh                            # Existing (unchanged — already compiles all src/**/*.swift)
```

---

## Task 1: Port Display Types and Channel Support

**Files:**
- Create: `src/display/protocol.swift`
- Create: `src/display/channel.swift`

### Purpose
Port the IPC protocol types (CanvasRequest, CanvasResponse, CanvasInfo) and channel file reading from heads-up. These are self-contained types with no dependencies on other heads-up code.

- [ ] **Step 1: Copy protocol.swift**

Copy `packages/heads-up/protocol.swift` to `src/display/protocol.swift`. No changes needed — the types are self-contained Codable structs. The file is 130 lines.

```bash
cp packages/heads-up/protocol.swift src/display/protocol.swift
```

- [ ] **Step 2: Copy channel.swift**

Copy `packages/heads-up/channel.swift` to `src/display/channel.swift`. Change the channel directory constant to avoid collision with side-eye's version (they define the same `kChannelDirectory`).

```bash
cp packages/heads-up/channel.swift src/display/channel.swift
```

Then edit `src/display/channel.swift`: rename `kChannelDirectory` to `kDisplayChannelDirectory` to avoid redefinition conflict. Search-replace all references within the file.

Also rename any type that conflicts with types in `src/perceive/`. Check that `ChannelData`, `ChannelTarget`, `ChannelFocus`, `ChannelSubtree`, `ChannelBounds`, `ChannelElement` don't collide with types in `src/perceive/` or `src/shared/`. If they exist only in the display module's channel.swift, they're fine — Swift allows same-named types only if they're in different modules, but since this is a single-module binary, we may need to prefix display-specific types with `Display` if there are collisions.

Check for collisions:
```bash
grep -r 'struct Channel' src/perceive/ src/shared/
```

If no collisions found, the types are fine as-is. If collisions exist, prefix the display-specific ones (e.g., `DisplayChannelData`).

- [ ] **Step 3: Build and verify**

```bash
bash build.sh
```
Expected: Compiles. The new files introduce types but nothing calls them yet.

- [ ] **Step 4: Commit**

```bash
git add src/display/protocol.swift src/display/channel.swift
git commit -m "feat(display): port IPC protocol types and channel support

CanvasRequest, CanvasResponse, CanvasInfo types from heads-up.
Channel file reading for focus channel integration.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Port Canvas System

**Files:**
- Create: `src/display/canvas.swift`

### Purpose
Port the Canvas, CanvasManager, CanvasWindow, CanvasWebView, and CanvasMessageHandler classes. This is the largest file (819 lines) and is the core of the display system. It manages NSWindow + WKWebView overlay canvases.

- [ ] **Step 1: Copy canvas.swift**

```bash
cp packages/heads-up/canvas.swift src/display/canvas.swift
```

- [ ] **Step 2: Remove duplicate helpers**

Edit `src/display/canvas.swift` to remove any functions that duplicate `src/shared/helpers.swift`. Specifically check for:
- `exitError()` — remove if defined, use the one from shared/helpers.swift
- `jsonString()` — remove if defined, use shared version
- `withSockAddr()` — remove if defined, use shared version

The canvas.swift file should NOT define these — it should rely on the versions in shared/helpers.swift which are already compiled into the same binary.

- [ ] **Step 3: Fix socket path references**

Search for any reference to `kSocketPath` or `kSocketDir` or `~/.config/heads-up/` in canvas.swift and replace with `kAosSocketPath` / `kAosSocketDir`. Canvas.swift likely doesn't reference socket paths (that's in client.swift and daemon.swift), but verify:

```bash
grep -n 'kSocket\|heads-up\|config/heads' src/display/canvas.swift
```

- [ ] **Step 4: Build and verify**

```bash
bash build.sh
```

Fix any compilation errors. Common issues:
- Missing `import WebKit` — canvas.swift needs it for WKWebView
- Type conflicts if CanvasInfo is defined in both protocol.swift locations
- Missing helper functions that were in heads-up's helpers.swift

- [ ] **Step 5: Commit**

```bash
git add src/display/canvas.swift
git commit -m "feat(display): port canvas system (NSWindow + WKWebView)

Canvas, CanvasManager, CanvasWindow, CanvasWebView, CanvasMessageHandler.
Coordinate conversion (CG↔Screen), window anchoring, TTL, connection scoping.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Port Render and Auto-Projection

**Files:**
- Create: `src/display/render.swift`
- Create: `src/display/autoprojection.swift`

### Purpose
Port the stateless HTML→PNG renderer and auto-projection HTML generators. These are self-contained and have minimal dependencies.

- [ ] **Step 1: Copy render.swift**

```bash
cp packages/heads-up/render.swift src/display/render.swift
```

Check that `OffscreenRenderer` and `RenderResponse` don't conflict with any existing types. They shouldn't — these names are unique to the display module.

- [ ] **Step 2: Copy autoprojection.swift**

```bash
cp packages/heads-up/autoprojection.swift src/display/autoprojection.swift
```

This file depends on channel types (`ChannelData`, `ChannelElement`, `ChannelBounds`). Verify these are available from `src/display/channel.swift` (ported in Task 1).

- [ ] **Step 3: Build and verify**

```bash
bash build.sh
```

Fix any compilation errors. Render.swift needs `import WebKit` and `import AppKit`. Autoprojection.swift needs `Foundation`.

- [ ] **Step 4: Commit**

```bash
git add src/display/render.swift src/display/autoprojection.swift
git commit -m "feat(display): port renderer and auto-projection

OffscreenRenderer for stateless HTML→PNG rasterization.
Auto-projection HTML generators: cursor_trail, highlight_focused, label_elements.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Refactor PerceptionDaemon → PerceptionEngine

**Files:**
- Modify: `src/perceive/daemon.swift`

### Purpose
Extract the perception logic from PerceptionDaemon into a PerceptionEngine class that does NOT own a socket server. The socket server will move to UnifiedDaemon (Task 5). PerceptionEngine keeps: CGEventTap, cursor monitoring, AX queries, attention envelope. It loses: socket server, connection handling, subscriber management.

Instead, PerceptionEngine emits events via a callback that the UnifiedDaemon hooks into.

- [ ] **Step 1: Rewrite `src/perceive/daemon.swift` as PerceptionEngine**

Replace the entire file content with:

```swift
// daemon.swift — PerceptionEngine: CGEventTap + cursor monitor + AX queries
//
// This is the perception module's core logic, extracted from the daemon.
// It does NOT own a socket — events are emitted via the onEvent callback.
// The UnifiedDaemon hooks into onEvent to broadcast to subscribers.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

class PerceptionEngine {
    let config: AosConfig
    let attention = AttentionEnvelope()

    /// Called when a perception event should be broadcast.
    /// Parameters: (event name, data dictionary)
    var onEvent: ((String, [String: Any]) -> Void)?

    // Cursor state
    private var lastCursorPoint: CGPoint = .zero
    private var lastWindowID: Int = 0
    private var lastAppPID: pid_t = 0
    private var lastAppName: String = ""
    private var lastElementRole: String = ""
    private var lastElementTitle: String = ""
    private var cursorIdleTimer: DispatchSourceTimer?
    private var lastMoveTime: Date = Date()

    // App lookup cache
    private var appLookup: [pid_t: (name: String, bundleID: String?)] = [:]
    private var _appRefreshTimer: DispatchSourceTimer?

    init(config: AosConfig) {
        self.config = config
    }

    // MARK: - Start / Stop

    func start() {
        startEventTap()
        startSettleTimer()
        startAppLookupRefresh()
    }

    // MARK: - CGEventTap (Depth 0)

    private func startEventTap() {
        let eventMask: CGEventMask = (1 << CGEventType.mouseMoved.rawValue)
            | (1 << CGEventType.leftMouseDragged.rawValue)
            | (1 << CGEventType.rightMouseDragged.rawValue)
            | (1 << CGEventType.otherMouseDragged.rawValue)

        let refcon = Unmanaged.passUnretained(self).toOpaque()

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: eventMask,
            callback: { _, _, event, refcon -> Unmanaged<CGEvent>? in
                guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
                let engine = Unmanaged<PerceptionEngine>.fromOpaque(refcon).takeUnretainedValue()
                engine.handleMouseEvent(event)
                return Unmanaged.passUnretained(event)
            },
            userInfo: refcon
        ) else {
            fputs("Warning: CGEventTap failed — cursor monitoring unavailable (check Accessibility permissions)\n", stderr)
            return
        }

        let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func handleMouseEvent(_ event: CGEvent) {
        let point = event.location
        let now = Date()

        let dt = now.timeIntervalSince(lastMoveTime)
        let dx = point.x - lastCursorPoint.x
        let dy = point.y - lastCursorPoint.y
        let dist = sqrt(dx * dx + dy * dy)
        let velocity = dt > 0 ? dist / dt : 0

        lastCursorPoint = point
        lastMoveTime = now

        cursorIdleTimer?.cancel()
        startSettleTimer()

        guard attention.hasSubscribers else { return }

        if attention.wantsContinuousCursor || attention.wantsOnChange {
            let displays = getDisplays()
            let displayOrdinal = displays.first(where: { $0.bounds.contains(point) })?.ordinal
                ?? displays.first(where: { $0.isMain })?.ordinal ?? 1
            let data = cursorMovedData(x: point.x, y: point.y, display: displayOrdinal, velocity: velocity)
            onEvent?("cursor_moved", data)
        }

        if attention.maxDepth >= 1 && attention.wantsOnChange {
            checkWindowAndAppChange(at: point)
        }
    }

    // MARK: - Settle Timer (Depth 2)

    private func startSettleTimer() {
        let threshold = config.perception.settle_threshold_ms
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
        timer.schedule(deadline: .now() + .milliseconds(threshold))
        timer.setEventHandler { [weak self] in
            self?.onCursorSettled()
        }
        timer.resume()
        cursorIdleTimer = timer
    }

    private func onCursorSettled() {
        guard attention.hasSubscribers else { return }
        let point = lastCursorPoint
        let displays = getDisplays()
        let displayOrdinal = displays.first(where: { $0.bounds.contains(point) })?.ordinal
            ?? displays.first(where: { $0.isMain })?.ordinal ?? 1

        if attention.wantsOnSettle {
            let idleMs = Int(Date().timeIntervalSince(lastMoveTime) * 1000)
            let data = cursorSettledData(x: point.x, y: point.y, display: displayOrdinal, idle_ms: idleMs)
            onEvent?("cursor_settled", data)
        }

        if attention.maxDepth >= 1 {
            checkWindowAndAppChange(at: point)
        }

        if attention.maxDepth >= 2 {
            queryAXElementAtCursor(point)
        }
    }

    // MARK: - Depth 1: Window/App Detection

    private func checkWindowAndAppChange(at point: CGPoint) {
        let windowInfoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

        for info in windowInfoList {
            guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else { continue }
            guard rect.contains(point) else { continue }
            let layer = info[kCGWindowLayer as String] as? Int ?? 0
            guard layer == 0 else { continue }
            let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
            guard alpha > 0 else { continue }
            let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
            guard ownerName != "Window Server" else { continue }

            let windowID = info[kCGWindowNumber as String] as? Int ?? 0
            let pid = info[kCGWindowOwnerPID as String] as? pid_t ?? 0

            if windowID != lastWindowID {
                lastWindowID = windowID
                let bundleID = appLookup[pid]?.bundleID
                let data = windowEnteredData(
                    window_id: windowID, app: ownerName, pid: Int(pid),
                    bundle_id: bundleID, bounds: Bounds(from: rect))
                onEvent?("window_entered", data)
            }

            if pid != lastAppPID {
                lastAppPID = pid
                lastAppName = ownerName
                let bundleID = appLookup[pid]?.bundleID
                let data = appEnteredData(app: ownerName, pid: Int(pid), bundle_id: bundleID)
                onEvent?("app_entered", data)
            }

            break
        }
    }

    // MARK: - Depth 2: AX Element Query

    private func queryAXElementAtCursor(_ point: CGPoint) {
        guard AXIsProcessTrusted() else { return }
        guard lastAppPID > 0 else { return }

        if let hit = axElementAtPoint(pid: lastAppPID, point: point) {
            let newRole = hit.role
            let newTitle = hit.title ?? ""
            if newRole != lastElementRole || newTitle != lastElementTitle {
                lastElementRole = newRole
                lastElementTitle = newTitle
                let data = elementFocusedData(
                    role: hit.role, title: hit.title, label: hit.label, value: hit.value,
                    bounds: hit.bounds.map { Bounds(from: $0) },
                    context_path: hit.contextPath)
                onEvent?("element_focused", data)
            }
        }
    }

    // MARK: - App Lookup Refresh

    private func startAppLookupRefresh() {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now(), repeating: 5.0)
        timer.setEventHandler { [weak self] in
            self?.refreshAppLookup()
        }
        timer.resume()
        _appRefreshTimer = timer
    }

    private func refreshAppLookup() {
        var lookup: [pid_t: (name: String, bundleID: String?)] = [:]
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            lookup[app.processIdentifier] = (name: app.localizedName ?? "unknown", bundleID: app.bundleIdentifier)
        }
        appLookup = lookup
    }
}
```

- [ ] **Step 2: Verify build (expect failure)**

```bash
bash build.sh
```

Expected: Build FAILS because `src/commands/serve.swift` still creates `PerceptionDaemon` (now renamed to `PerceptionEngine`), and `src/perceive/observe.swift` may reference the old class. Fix serve.swift temporarily:

In `src/commands/serve.swift`, change `PerceptionDaemon` to `PerceptionEngine` and comment out the `.start()` call temporarily — we'll fix this properly in Task 5.

```swift
func serveCommand(args: [String]) {
    let config = loadConfig()
    // Temporary: PerceptionEngine doesn't own a socket anymore.
    // UnifiedDaemon (Task 5) will replace this.
    fputs("Error: serve requires UnifiedDaemon (not yet implemented)\n", stderr)
    exit(1)
}
```

- [ ] **Step 3: Build and verify**

```bash
bash build.sh
```
Expected: Compiles. `./aos serve` exits with error (expected — UnifiedDaemon not built yet). `./aos see cursor` still works (doesn't need daemon).

- [ ] **Step 4: Commit**

```bash
git add src/perceive/daemon.swift src/commands/serve.swift
git commit -m "refactor(perceive): extract PerceptionEngine from daemon

PerceptionEngine no longer owns a socket server. Events emitted via
onEvent callback. Socket handling moves to UnifiedDaemon (next task).
serve command temporarily disabled.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Create UnifiedDaemon

**Files:**
- Create: `src/daemon/unified.swift`
- Modify: `src/commands/serve.swift`

### Purpose
The central piece. UnifiedDaemon owns the socket server, PerceptionEngine, and CanvasManager. It routes incoming requests by action field — perception actions to the engine, display actions to CanvasManager. Events from both modules broadcast to all subscribers through a single event bus.

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/daemon
```

- [ ] **Step 2: Write `src/daemon/unified.swift`**

```swift
// unified.swift — UnifiedDaemon: single socket hosting perception + display

import AppKit
import Foundation

class UnifiedDaemon {
    let socketPath: String
    let config: AosConfig
    let startTime = Date()

    // Modules
    let perception: PerceptionEngine
    let canvasManager = CanvasManager()

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

        // Wire perception events → broadcast
        perception.onEvent = { [weak self] event, data in
            self?.broadcastEvent(service: "perceive", event: event, data: data)
        }

        // Wire canvas events → broadcast
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
    }

    // MARK: - Event Broadcasting

    func broadcastEvent(service: String, event: String, data: [String: Any]) {
        guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }

        subscriberLock.lock()
        let fds = subscribers.values.map(\.fd)
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
            guard let request = CanvasRequest.from(lineData(from: json)) else {
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
            let canvasCount = canvasManager.isEmpty ? 0 : 1  // rough count
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
```

- [ ] **Step 3: Update `src/commands/serve.swift`**

```swift
// serve.swift — aos serve: start the unified daemon

import AppKit
import Foundation

func serveCommand(args: [String]) {
    // Parse idle timeout
    var idleTimeout: TimeInterval = 300  // 5 minutes default
    var i = 0
    while i < args.count {
        if args[i] == "--idle-timeout" {
            i += 1
            if i < args.count { idleTimeout = parseDuration(args[i]) }
        }
        i += 1
    }

    let config = loadConfig()
    let daemon = UnifiedDaemon(config: config, idleTimeout: idleTimeout)
    daemon.start()

    // Don't appear in Dock
    NSApp.setActivationPolicy(.accessory)

    // Run the main loop (needed for CGEventTap, NSWindow, WKWebView)
    NSApplication.shared.run()
}
```

- [ ] **Step 4: Build and fix**

```bash
bash build.sh
```

This is the most likely step to have compilation errors. Common issues to fix:
- `CanvasRequest.from(_ data: Data)` — the `lineData(from:)` helper produces Data that must be parseable as CanvasRequest
- `canvasManager.cleanupConnection(connectionID)` — verify this method exists in canvas.swift
- `canvasManager.isEmpty` — verify this property exists
- Missing `sendResponse(to:_:)` function — add to unified.swift if not available from shared helpers

Fix all errors until build succeeds.

- [ ] **Step 5: Test daemon starts**

```bash
./aos serve &
sleep 1
echo '{"action":"ping"}' | nc -U ~/.config/aos/sock
kill %1
```
Expected: Ping returns `{"status":"ok","uptime":...,"perception_channels":0,"subscribers":1}`.

- [ ] **Step 6: Test perception still works**

```bash
./aos serve &
sleep 1
echo '{"action":"perceive","depth":2,"scope":"cursor","rate":"on-settle"}' | timeout 3 nc -U ~/.config/aos/sock || true
kill %1
```
Expected: Subscribe response, then perception events as cursor moves.

- [ ] **Step 7: Test display canvas creation**

```bash
./aos serve &
sleep 1
echo '{"action":"create","id":"test","at":[100,100,200,200],"html":"<div style=\"background:rgba(255,0,0,0.5);width:100%;height:100%\"></div>"}' | nc -U ~/.config/aos/sock
sleep 2
echo '{"action":"remove","id":"test"}' | nc -U ~/.config/aos/sock
kill %1
```
Expected: A red semi-transparent overlay appears at coordinates (100,100), size 200x200. It disappears when removed. Canvas creation and removal work through the unified socket.

- [ ] **Step 8: Commit**

```bash
git add src/daemon/ src/commands/serve.swift
git commit -m "feat(daemon): unified daemon hosting perception + display

Single socket at ~/.config/aos/sock handles both perception and display
requests. Routes by action field: perceive/subscribe → PerceptionEngine,
create/update/remove/eval → CanvasManager. Shared event broadcast.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Display Client Commands + Main Routing

**Files:**
- Create: `src/display/client.swift`
- Modify: `src/main.swift`

### Purpose
Port the heads-up client commands (create, update, remove, list, eval, listen, render, ping) as `aos show` subcommands. The client connects to the unified daemon socket at `~/.config/aos/sock`.

- [ ] **Step 1: Create `src/display/client.swift`**

Adapt `packages/heads-up/client.swift` for the unified binary. Key changes:
- Socket path: `kAosSocketPath` instead of `kSocketPath`
- Auto-start: `ensureDaemon()` spawns `aos serve` instead of `heads-up serve`
- Remove `install`/`uninstall` commands (Phase 4+ concern)
- Remove `printUsage()` (handled by main.swift)

Copy the file:
```bash
cp packages/heads-up/client.swift src/display/client.swift
```

Then make these edits:

1. Replace ALL references to `kSocketPath` with `kAosSocketPath`
2. Replace ALL references to `kSocketDir` with `kAosSocketDir`  
3. In `ensureDaemon()`: change the spawn command from `heads-up serve` to the aos binary path. Find the current executable path via `CommandLine.arguments[0]` or `ProcessInfo.processInfo.arguments[0]`. The spawn should run `<self> serve --idle-timeout 5m`.
4. Remove `installCommand()` and `uninstallCommand()` functions
5. Remove the launchd plist path references
6. Remove duplicate `exitError()`, `jsonString()`, `withSockAddr()`, `parseDuration()` — these already exist in `src/shared/helpers.swift`
7. Remove the `resolveHTML()` function only if it conflicts; otherwise keep it (it's display-specific)
8. Replace any reference to `"heads-up"` in error messages with `"aos"`

- [ ] **Step 2: Update `src/main.swift` — add show routing**

Add `show` to the switch statement and create `handleShow`:

In the switch in `AOS.main()`, add:
```swift
case "show":
    handleShow(args: Array(args.dropFirst()))
```

Add the `handleShow` function:
```swift
func handleShow(args: [String]) {
    // Initialize NSApplication for render (needs it for WKWebView even offscreen)
    _ = NSApplication.shared

    guard let sub = args.first else {
        exitError("Usage: aos show <create|update|remove|remove-all|list|render|eval|listen|ping>", code: "MISSING_SUBCOMMAND")
    }
    switch sub {
    case "render":
        renderCommand(args: Array(args.dropFirst()))
    case "create":
        createCommand(args: Array(args.dropFirst()))
    case "update":
        updateCommand(args: Array(args.dropFirst()))
    case "remove":
        removeCommand(args: Array(args.dropFirst()))
    case "remove-all":
        removeAllCommand(args: Array(args.dropFirst()))
    case "list":
        listCommand(args: Array(args.dropFirst()))
    case "eval":
        evalCommand(args: Array(args.dropFirst()))
    case "listen":
        listenCommand(args: Array(args.dropFirst()))
    case "ping":
        pingCommand(args: Array(args.dropFirst()))
    case "to-front":
        toFrontCommand(args: Array(args.dropFirst()))
    case "post":
        postCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown show subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}
```

Update `printUsage()` to include show commands:
```swift
func printUsage() {
    let usage = """
    aos — agent operating system

    Usage: aos <command> [options]

    Commands:
      see <subcommand>     Perception — query what's on screen
      show <subcommand>    Display — manage overlays and render
      set <key> <value>    Configure autonomic settings
      serve                Start the unified daemon

    Perception (aos see):
      cursor               What's under the cursor (display, window, AX element)
      observe              Subscribe to perception stream (requires daemon)

    Display (aos show):
      create               Create a canvas overlay
      update               Update a canvas
      remove               Remove a canvas
      remove-all           Remove all canvases
      list                 List active canvases
      render               Render HTML to PNG (no daemon needed)
      eval                 Run JavaScript in a canvas
      listen               Subscribe to events + forward commands
      ping                 Check daemon status

    Configuration (aos set):
      voice.enabled <bool>              Enable/disable voice output
      perception.default_depth <0-3>    Default perception depth
      perception.settle_threshold_ms <ms>  Cursor settle threshold
      feedback.visual <bool>            Enable/disable visual feedback

    Examples:
      aos see cursor                                # What's under the cursor
      aos serve                                     # Start daemon
      aos show create --id ball --at 100,100,200,200 --html "<div>hello</div>"
      aos show render --width 800 --height 600 --html "<h1>Hi</h1>" --out /tmp/test.png
      aos see observe --depth 2                     # Stream perception events
      aos set voice.enabled true                    # Turn on voice
    """
    print(usage)
}
```

- [ ] **Step 3: Build and fix**

```bash
bash build.sh
```

This will likely have errors from duplicate function definitions between the copied client.swift and existing shared code. Fix all duplicates — remove functions from client.swift that already exist in shared/helpers.swift.

Also check for any function name conflicts between heads-up client commands and existing aos commands (e.g., `pingCommand` might conflict if both perceive and display define one).

- [ ] **Step 4: Test render (no daemon)**

```bash
./aos show render --width 400 --height 300 --html '<div style="font-size:48px;color:white;background:blue;padding:20px">Hello AOS</div>' --out /tmp/aos-test.png
ls -la /tmp/aos-test.png
```
Expected: PNG file created. This works without the daemon.

- [ ] **Step 5: Test create/list/remove (with daemon)**

```bash
./aos serve &
sleep 1
./aos show create --id hello --at 200,200,300,100 --html '<div style="background:rgba(0,200,100,0.8);color:white;font-size:24px;padding:10px">AOS Display</div>'
sleep 1
./aos show list
./aos show remove --id hello
./aos show list
kill %1
```
Expected: Green overlay appears, list shows it, remove deletes it, list shows empty.

- [ ] **Step 6: Test listen (event subscription)**

```bash
./aos serve &
sleep 1
# Listen in background, capture events
timeout 3 ./aos show listen > /tmp/aos-listen.txt 2>&1 &
sleep 1
# Create a canvas (should trigger lifecycle event)
./aos show create --id evt-test --at 50,50,100,100 --html '<div>test</div>'
sleep 1
./aos show remove --id evt-test
sleep 1
kill %2 2>/dev/null; kill %1 2>/dev/null
cat /tmp/aos-listen.txt
```
Expected: listen output includes canvas_lifecycle events for creation and removal.

- [ ] **Step 7: Commit**

```bash
git add src/display/client.swift src/main.swift
git commit -m "feat(display): port client commands as aos show subcommands

create, update, remove, list, render, eval, listen, ping available as
aos show <command>. Client connects to unified daemon at ~/.config/aos/sock.
Render works standalone (no daemon needed).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Integration Testing + Documentation

**Files:**
- Modify: `src/CLAUDE.md`
- Modify: root `CLAUDE.md` (if needed)

### Purpose
End-to-end verification that both perception and display work simultaneously through the unified daemon. Update documentation.

- [ ] **Step 1: Full integration test**

```bash
# Clean build
bash build.sh

# 1. One-shot (no daemon)
./aos see cursor | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'cursor' in d; print('PASS: cursor')"
./aos show render --width 100 --height 100 --html '<div>x</div>' --base64 | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='success'; print('PASS: render')"

# 2. Start daemon
./aos serve &
DAEMON_PID=$!
sleep 1

# 3. Perception + Display on same daemon
echo '{"action":"ping"}' | nc -U ~/.config/aos/sock | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok'; print('PASS: ping')"

./aos show create --id integ --at 100,100,200,100 --html '<div style="background:rgba(0,100,255,0.7);color:white;padding:10px">Integration Test</div>'
sleep 1
./aos show list | python3 -c "import sys,json; d=json.load(sys.stdin); assert any(c['id']=='integ' for c in d.get('canvases',[])); print('PASS: canvas exists')"

# 4. Perception events while canvas is visible
timeout 2 ./aos see observe --depth 1 --rate continuous > /tmp/integ-events.txt 2>&1 || true
EVENTS=$(wc -l < /tmp/integ-events.txt | tr -d ' ')
echo "Perception events: $EVENTS"
[ "$EVENTS" -gt "0" ] && echo "PASS: perception events flowing" || echo "WARN: no events (move cursor)"

# 5. Cleanup
./aos show remove --id integ
kill $DAEMON_PID 2>/dev/null
sleep 1
echo "Integration test complete."
```

- [ ] **Step 2: Update `src/CLAUDE.md`**

Update to reflect both perception and display modules:

```markdown
# aos — Agent Operating System

Unified binary for macOS perception, display, action, and voice.

## Build

\`\`\`bash
bash build.sh
\`\`\`

Requires macOS 14+ and Accessibility permission.

## Usage

### One-Shot Commands (no daemon needed)

\`\`\`bash
aos see cursor                    # What's under the cursor
aos show render --html "..." --out /tmp/x.png  # Render HTML to PNG
aos set voice.enabled true        # Configure autonomic settings
\`\`\`

### Daemon Mode

\`\`\`bash
aos serve                         # Start unified daemon
aos see observe --depth 2         # Stream perception events
aos show create --id x --at 100,100,200,200 --html "<div>overlay</div>"
aos show list                     # List active canvases
aos show remove --id x            # Remove canvas
\`\`\`

### Config

Config file: \`~/.config/aos/config.json\`
Socket: \`~/.config/aos/sock\`

## Architecture

\`\`\`
src/
  main.swift          # Entry point, subcommand routing
  shared/             # Helpers, envelope, config, types
  perceive/           # Perception module (cursor, AX, events, attention)
  display/            # Display module (canvas, render, auto-projection)
  daemon/             # UnifiedDaemon (socket server, routing)
  commands/           # serve, set
\`\`\`

### Unified Daemon

\`aos serve\` starts a single daemon that hosts both perception and display.
One socket (\`~/.config/aos/sock\`), one CGEventTap, one process. Requests
routed by \`action\` field: perception actions → PerceptionEngine, display
actions → CanvasManager.

### Spec

See \`docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md\`
```

- [ ] **Step 3: Commit**

```bash
git add src/CLAUDE.md
git commit -m "docs(aos): update CLAUDE.md for Phase 2 display module

Documents show subcommands, unified daemon architecture, and
display module alongside perception.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Dependency Graph

```
Task 1 (Display types + channel)
Task 2 (Canvas system)          ──┐
Task 3 (Render + autoprojection)  ├── Task 5 (UnifiedDaemon) ── Task 6 (Client + routing) ── Task 7 (Integration)
Task 4 (PerceptionEngine refactor)┘
```

Tasks 1-4 can run in any order (they create/modify independent files). Task 5 depends on all of them. Tasks 6 and 7 are sequential after Task 5.
