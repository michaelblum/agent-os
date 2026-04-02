# hand-off v2 Phase 2: Focus Channel Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the focus channel protocol — side-eye daemon maintains live spatial references as channel files, hand-off `bind` reads them to auto-set context and resolve elements without orchestrator coordinate math.

**Architecture:** side-eye gets a daemon mode (Unix socket server following the heads-up pattern) that maintains a spatial model via periodic polling and writes channel files to `~/.config/agent-os/channels/`. hand-off gets a `bind` action that reads channel files, sets context from the `target` block, and resolves elements against the channel's element list. The two tools never communicate directly — the filesystem is the IPC.

**Tech Stack:** Pure Swift (no SPM), macOS 14+. Unix domain sockets (POSIX), CGWindowListCopyWindowInfo, ApplicationServices (AX), Foundation (JSON, file I/O).

**Spec:** `docs/superpowers/specs/2026-04-01-hand-off-v2-and-focus-channels.md` (Phase 2, Sections 5.1–5.6)

---

## Scope: Two Independent Tracks

Phase 2 spans two packages. They share a file format (channel JSON schema) but no code. They can be implemented in parallel by separate agents.

**Track A — side-eye daemon** (Tasks 1–6): Unix socket server, spatial model, channel file management.
**Track B — hand-off bind** (Tasks 7–9): Channel file reader, bind action, channel-aware element resolution.

---

## Parallelization Map

```
Task 1: side-eye build + shared extraction        ← SEQUENTIAL (first)
    │
    ├── Task 2: Protocol types (side-eye)          ← PARALLEL with Task 7
    ├── Task 3: Daemon server (side-eye)           ← After Task 2
    ├── Task 4: Spatial model (side-eye)            ← After Task 3
    ├── Task 5: Channel manager (side-eye)          ← After Task 4
    └── Task 6: Client + entry point (side-eye)     ← After Task 5
    
    Task 7: Channel types + bind (hand-off)         ← PARALLEL with Track A
    Task 8: Integration tests (both)                ← After Tasks 6 + 7
```

**Agent team dispatch:**
- Track A (side-eye): sequential chain, Tasks 1→2→3→4→5→6
- Track B (hand-off): single agent, Task 7 (independent of Track A)
- Task 8: after both tracks complete

---

## File Structure

### side-eye changes
```
packages/side-eye/
  main.swift              ← MODIFY: add "serve" command routing, extract window enum to shared function
  build.sh                ← MODIFY: compile *.swift instead of main.swift
  protocol.swift          ← CREATE: daemon request/response types, channel file schema types
  daemon.swift            ← CREATE: Unix socket server (follows heads-up pattern)
  spatial.swift           ← CREATE: spatial model polling + channel file management
  client.swift            ← CREATE: CLI commands (focus-create, focus-list, etc.) + auto-start daemon
```

### hand-off changes
```
packages/hand-off/
  channel.swift           ← CREATE: channel file types, reader, bind handler
  session.swift           ← MODIFY: wire "bind" action to handleBind
  models.swift            ← MODIFY: add bound_channel field to SessionState
```

### Shared filesystem
```
~/.config/agent-os/channels/   ← Channel files (created by side-eye daemon)
~/.config/side-eye/sock        ← side-eye daemon Unix socket
```

---

## Task 1: side-eye Build System + Shared Function Extraction

**Files:**
- Modify: `packages/side-eye/build.sh`
- Modify: `packages/side-eye/main.swift`

This task changes the build to compile `*.swift` and extracts the window enumeration logic from `listCommand()` into a standalone function that the daemon can reuse.

- [ ] **Step 1: Update build.sh**

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Compiling side-eye..."
swiftc -parse-as-library -O -o side-eye *.swift

echo "Done: ./side-eye ($(du -h side-eye | cut -f1 | xargs))"
```

- [ ] **Step 2: Extract window enumeration from listCommand()**

In `main.swift`, the `listCommand()` function contains embedded window enumeration logic that builds `STWindow` arrays from `CGWindowListCopyWindowInfo`. Extract this into a top-level function so the daemon can reuse it.

Find the window enumeration block inside `listCommand()` (the part that calls `CGWindowListCopyWindowInfo` and builds the window list) and extract it into a standalone function. The function should return the same data structure that `listCommand()` currently builds inline.

```swift
/// Enumerate all on-screen windows with app info. Returns windows grouped by display.
/// Extracted from listCommand() for reuse by daemon spatial model.
func enumerateWindows(displays: [DisplayEntry]) -> (windows: [STWindow], apps: [STApp], focusedPID: pid_t?) {
    // This function should contain the CGWindowListCopyWindowInfo parsing logic
    // that is currently embedded in listCommand().
    // 
    // The agent implementing this task should:
    // 1. Read listCommand() in main.swift
    // 2. Identify the window enumeration block (CGWindowListCopyWindowInfo call through STWindow construction)
    // 3. Extract it into this function
    // 4. Have listCommand() call this function instead of doing it inline
    // 5. Verify `./side-eye list` still produces identical output
}
```

The implementing agent must read the actual `listCommand()` code, identify the window enumeration block, and extract it cleanly. The goal is: `listCommand()` calls `enumerateWindows()` instead of doing window enumeration inline.

- [ ] **Step 3: Build and verify**

Run: `cd packages/side-eye && bash build.sh`
Expected: compiles cleanly.

Run: `./side-eye list --json | head -5`
Expected: same topology output as before the refactor.

- [ ] **Step 4: Commit**

```bash
git add packages/side-eye/build.sh packages/side-eye/main.swift
git commit -m "refactor(side-eye): multi-file build + extract enumerateWindows for daemon reuse"
```

---

## Task 2: Protocol Types — protocol.swift

**Files:**
- Create: `packages/side-eye/protocol.swift`

Defines all types for daemon IPC and channel files.

- [ ] **Step 1: Create protocol.swift with all daemon + channel types**

```swift
// protocol.swift — Daemon IPC types + focus channel file schema

import Foundation

// MARK: - Daemon Request (ndjson from client)

struct DaemonRequest: Codable {
    let action: String           // "focus-create", "focus-update", "focus-remove", "focus-list", "snapshot", "subscribe"
    var id: String?              // channel ID
    var window_id: Int?          // target window
    var pid: Int?                // target process (alternative to window_id)
    var subtree: ChannelSubtree? // optional AX subtree to focus on
    var depth: Int?              // AX tree depth (default: 3)

    static func from(_ data: Data) -> DaemonRequest? {
        try? JSONDecoder().decode(DaemonRequest.self, from: data)
    }

    func toData() -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return (try? enc.encode(self)) ?? Data()
    }
}

// MARK: - Daemon Response (ndjson to client)

struct DaemonResponse: Codable {
    var status: String?          // "ok"
    var error: String?
    var code: String?
    var channels: [ChannelSummary]?  // for focus-list
    var snapshot: SnapshotData?      // for snapshot
    var uptime: Double?              // daemon uptime

    static let ok = DaemonResponse(status: "ok")

    static func fail(_ message: String, code: String) -> DaemonResponse {
        DaemonResponse(error: message, code: code)
    }

    func toData() -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return (try? enc.encode(self)) ?? Data()
    }

    static func from(_ data: Data) -> DaemonResponse? {
        try? JSONDecoder().decode(DaemonResponse.self, from: data)
    }
}

struct ChannelSummary: Codable {
    let id: String
    let window_id: Int
    let app: String
    let elements_count: Int
    let updated_at: String
}

struct SnapshotData: Codable {
    let displays: Int
    let windows: Int
    let channels: Int
    let focused_app: String?
}

// MARK: - Daemon Event (pushed to subscribers)

struct DaemonEvent: Codable {
    let type: String             // "channel_updated", "window_moved", "focus_changed"
    var id: String?              // channel ID (for channel events)
    var updated_at: String?
    var window_id: Int?
    var bounds: ChannelBounds?
    var pid: Int?
    var app: String?

    func toData() -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return (try? enc.encode(self)) ?? Data()
    }
}

// MARK: - Focus Channel File Schema

/// Written to ~/.config/agent-os/channels/<id>.json by the daemon.
/// Read by hand-off (bind), heads-up (anchor), and any other tool.
struct ChannelFile: Codable {
    let channel_id: String
    let created_by: String       // "side-eye"
    let created_at: String       // ISO 8601
    var updated_at: String       // ISO 8601
    let target: ChannelTarget
    let focus: ChannelFocus
    var window_bounds: ChannelBounds
    var elements: [ChannelElement]
}

struct ChannelTarget: Codable {
    let pid: Int
    let app: String
    let bundle_id: String?
    let window_id: Int
    let display: Int
    let scale_factor: Double
}

struct ChannelFocus: Codable {
    var subtree: ChannelSubtree?
    var depth: Int
}

struct ChannelSubtree: Codable {
    var role: String?
    var title: String?
    var identifier: String?
}

struct ChannelBounds: Codable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double

    init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x; self.y = y; self.w = w; self.h = h
    }

    init(from rect: CGRect) {
        self.x = Double(rect.origin.x)
        self.y = Double(rect.origin.y)
        self.w = Double(rect.size.width)
        self.h = Double(rect.size.height)
    }
}

struct ChannelElement: Codable {
    let role: String
    let title: String?
    let label: String?
    let identifier: String?
    let value: String?
    let enabled: Bool
    let actions: [String]
    let bounds_pixel: ChannelBounds
    let bounds_window: ChannelBounds
    let bounds_global: ChannelBounds
}

// MARK: - Socket Path

let kSideEyeSocketPath: String = {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/.config/side-eye/sock"
}()

let kChannelDirectory: String = {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/.config/agent-os/channels"
}()

// MARK: - ISO 8601 Helper

func iso8601Now() -> String {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.string(from: Date())
}
```

- [ ] **Step 2: Build to verify**

Run: `cd packages/side-eye && bash build.sh`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add packages/side-eye/protocol.swift
git commit -m "feat(side-eye): protocol types for daemon IPC and focus channel files"
```

---

## Task 3: Daemon Server — daemon.swift

**Files:**
- Create: `packages/side-eye/daemon.swift`

Unix socket server following the heads-up daemon pattern. Accepts ndjson connections, dispatches to handlers, manages subscriber connections, auto-exits when idle.

- [ ] **Step 1: Create daemon.swift**

Follow the heads-up `daemon.swift` pattern exactly (it's at `packages/heads-up/daemon.swift`). The implementing agent should read heads-up's daemon.swift and replicate the pattern with these differences:

1. **Socket path**: `kSideEyeSocketPath` (`~/.config/side-eye/sock`)
2. **Request type**: `DaemonRequest` (from protocol.swift)
3. **Response type**: `DaemonResponse` (from protocol.swift)
4. **Action dispatch**: Route to spatial model / channel manager (created in Tasks 4-5)
5. **Idle condition**: No active channels AND no subscriber connections
6. **Default idle timeout**: 30 seconds (longer than heads-up's 5s because spatial polling is useful to keep warm)

Key structure:

```swift
// daemon.swift — Unix socket server for side-eye daemon mode

import Foundation

class SideEyeDaemon {
    let socketPath: String
    var serverFD: Int32 = -1
    var idleTimeout: TimeInterval
    var idleTimer: DispatchSourceTimer?
    let startTime = Date()
    
    // Connection tracking
    var subscribers: [UUID: Int32] = [:]  // connectionID → FD
    let subscriberLock = NSLock()
    
    // Spatial model + channels (Task 4-5)
    let spatial: SpatialModel
    
    init(idleTimeout: TimeInterval = 30) {
        self.socketPath = kSideEyeSocketPath
        self.idleTimeout = idleTimeout
        self.spatial = SpatialModel()
    }
    
    func start() { /* bind, listen, accept loop — same as heads-up */ }
    func acceptLoop() { /* accept connections, spawn handleConnection per client */ }
    func handleConnection(_ clientFD: Int32, connectionID: UUID) { /* ndjson read loop */ }
    func dispatchRequest(_ req: DaemonRequest, connectionID: UUID) -> DaemonResponse { /* route to handlers */ }
    func relayEvent(_ event: DaemonEvent) { /* push to all subscribers */ }
    func checkIdle() { /* start/cancel idle timer based on channels + subscribers */ }
    func shutdown() { /* close socket, remove file, exit */ }
}

/// Helper for sockaddr_un binding (same as heads-up)
func withSockAddr(_ path: String, body: (UnsafePointer<sockaddr>, socklen_t) -> Int32) -> Int32 {
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = path.utf8CString
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        let bound = UnsafeMutableRawPointer(ptr).assumingMemoryBound(to: CChar.self)
        for (i, byte) in pathBytes.enumerated() {
            bound[i] = byte
        }
    }
    return withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            body(sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
}
```

The implementing agent should:
1. Read `packages/heads-up/daemon.swift` (288 lines)
2. Port the socket server pattern to `packages/side-eye/daemon.swift`
3. Replace canvas-specific logic with channel dispatch stubs
4. The `dispatchRequest` method should call placeholder functions that will be implemented in Tasks 4-5. For now, return `DaemonResponse.ok` for known actions and error for unknown.

- [ ] **Step 2: Build to verify**

Run: `cd packages/side-eye && bash build.sh`
Expected: compiles cleanly (with warnings about unused code — that's fine).

- [ ] **Step 3: Commit**

```bash
git add packages/side-eye/daemon.swift
git commit -m "feat(side-eye): daemon server — Unix socket, ndjson protocol, subscriber relay"
```

---

## Task 4: Spatial Model — spatial.swift

**Files:**
- Create: `packages/side-eye/spatial.swift`

Maintains a polled spatial model (displays, windows, focused app) and manages channel lifecycle.

- [ ] **Step 1: Create spatial.swift**

```swift
// spatial.swift — Spatial model polling + channel management

import ApplicationServices
import CoreGraphics
import Foundation

class SpatialModel {
    /// Active channels keyed by ID
    var channels: [String: ChannelState] = [:]
    
    /// Callback when a channel is updated (daemon relays to subscribers)
    var onChannelUpdated: ((String) -> Void)?
    var onWindowMoved: ((Int, ChannelBounds) -> Void)?
    var onFocusChanged: ((Int, String) -> Void)?
    
    /// Polling timer
    private var pollTimer: DispatchSourceTimer?
    private var lastFocusedPID: pid_t = 0
    
    var isEmpty: Bool { channels.isEmpty }
    var channelCount: Int { channels.count }
    
    // MARK: - Polling
    
    func startPolling(intervalMs: Int = 1000) {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now(), repeating: .milliseconds(intervalMs))
        timer.setEventHandler { [weak self] in
            self?.poll()
        }
        timer.resume()
        pollTimer = timer
    }
    
    func stopPolling() {
        pollTimer?.cancel()
        pollTimer = nil
    }
    
    private func poll() {
        // Check each channel's window bounds for movement
        for (id, state) in channels {
            guard let newBounds = windowBoundsForID(state.windowID) else { continue }
            let old = state.lastBounds
            if abs(newBounds.x - old.x) > 0.5 || abs(newBounds.y - old.y) > 0.5 ||
               abs(newBounds.w - old.w) > 0.5 || abs(newBounds.h - old.h) > 0.5 {
                channels[id]?.lastBounds = newBounds
                refreshChannel(id: id)
                onWindowMoved?(state.windowID, newBounds)
            }
        }
        
        // Check focused app change
        if let frontmost = NSWorkspace.shared.frontmostApplication {
            let pid = frontmost.processIdentifier
            if pid != lastFocusedPID {
                lastFocusedPID = pid
                onFocusChanged?(Int(pid), frontmost.localizedName ?? "Unknown")
            }
        }
    }
    
    // MARK: - Channel CRUD
    
    func createChannel(id: String, windowID: Int, pid: Int?, subtree: ChannelSubtree?, depth: Int?) -> DaemonResponse {
        // Look up window info
        guard let winInfo = windowInfoForID(windowID) else {
            return .fail("Window \(windowID) not found", code: "WINDOW_NOT_FOUND")
        }
        
        let resolvedPID = pid ?? winInfo.pid
        let resolvedDepth = depth ?? 3
        
        let state = ChannelState(
            id: id,
            windowID: windowID,
            pid: resolvedPID,
            app: winInfo.appName,
            bundleID: winInfo.bundleID,
            display: winInfo.display,
            scaleFactor: winInfo.scaleFactor,
            subtree: subtree,
            depth: resolvedDepth,
            lastBounds: winInfo.bounds,
            createdAt: iso8601Now()
        )
        
        channels[id] = state
        refreshChannel(id: id)
        return .ok
    }
    
    func updateChannel(id: String, subtree: ChannelSubtree?, depth: Int?) -> DaemonResponse {
        guard channels[id] != nil else {
            return .fail("Channel '\(id)' not found", code: "CHANNEL_NOT_FOUND")
        }
        if let s = subtree { channels[id]!.subtree = s }
        if let d = depth { channels[id]!.depth = d }
        refreshChannel(id: id)
        return .ok
    }
    
    func removeChannel(id: String) -> DaemonResponse {
        guard channels.removeValue(forKey: id) != nil else {
            return .fail("Channel '\(id)' not found", code: "CHANNEL_NOT_FOUND")
        }
        // Delete channel file
        let path = "\(kChannelDirectory)/\(id).json"
        try? FileManager.default.removeItem(atPath: path)
        return .ok
    }
    
    func listChannels() -> DaemonResponse {
        let summaries = channels.values.map { state in
            ChannelSummary(
                id: state.id,
                window_id: state.windowID,
                app: state.app,
                elements_count: state.lastElementCount,
                updated_at: state.lastUpdated
            )
        }.sorted { $0.id < $1.id }
        
        var resp = DaemonResponse.ok
        resp.channels = summaries
        return resp
    }
    
    func snapshot() -> DaemonResponse {
        let displays = getDisplays()
        var resp = DaemonResponse.ok
        resp.snapshot = SnapshotData(
            displays: displays.count,
            windows: 0, // filled by caller if needed
            channels: channels.count,
            focused_app: NSWorkspace.shared.frontmostApplication?.localizedName
        )
        return resp
    }
    
    // MARK: - Channel Refresh (AX traversal + file write)
    
    func refreshChannel(id: String) {
        guard var state = channels[id] else { return }
        
        // Get current window bounds
        guard let bounds = windowBoundsForID(state.windowID) else { return }
        state.lastBounds = bounds
        
        // Traverse AX tree for channel elements
        let elements = traverseForChannel(
            pid: pid_t(state.pid),
            subtree: state.subtree,
            depth: state.depth,
            windowBounds: bounds,
            scaleFactor: state.scaleFactor
        )
        
        state.lastElementCount = elements.count
        state.lastUpdated = iso8601Now()
        channels[id] = state
        
        // Build channel file
        let file = ChannelFile(
            channel_id: id,
            created_by: "side-eye",
            created_at: state.createdAt,
            updated_at: state.lastUpdated,
            target: ChannelTarget(
                pid: state.pid,
                app: state.app,
                bundle_id: state.bundleID,
                window_id: state.windowID,
                display: state.display,
                scale_factor: state.scaleFactor
            ),
            focus: ChannelFocus(subtree: state.subtree, depth: state.depth),
            window_bounds: bounds,
            elements: elements
        )
        
        // Write to disk
        writeChannelFile(file)
        onChannelUpdated?(id)
    }
    
    // MARK: - AX Traversal for Channel Elements
    
    private func traverseForChannel(pid: pid_t, subtree: ChannelSubtree?, depth: Int,
                                     windowBounds: ChannelBounds, scaleFactor: Double) -> [ChannelElement] {
        let app = AXUIElementCreateApplication(pid)
        
        // Find search root (subtree or app root)
        var root = app
        if let sub = subtree {
            if let found = findSubtreeRoot(app: app, subtree: sub) {
                root = found
            }
        }
        
        var elements: [ChannelElement] = []
        traverseAXForChannel(root, depth: 0, maxDepth: depth,
                              windowBounds: windowBounds, scaleFactor: scaleFactor,
                              results: &elements)
        return elements
    }
    
    private func findSubtreeRoot(app: AXUIElement, subtree: ChannelSubtree) -> AXUIElement? {
        // BFS to find element matching subtree spec
        var queue: [AXUIElement] = [app]
        while !queue.isEmpty {
            let current = queue.removeFirst()
            let role = axString(current, kAXRoleAttribute)
            let title = axString(current, kAXTitleAttribute)
            let ident = axString(current, "AXIdentifier")
            
            var match = true
            if let r = subtree.role, r != role { match = false }
            if let t = subtree.title, t != title { match = false }
            if let i = subtree.identifier, i != ident { match = false }
            
            if match && (subtree.role != nil || subtree.title != nil || subtree.identifier != nil) {
                return current
            }
            queue.append(contentsOf: axChildren(current))
        }
        return nil
    }
    
    private func traverseAXForChannel(_ element: AXUIElement, depth: Int, maxDepth: Int,
                                       windowBounds: ChannelBounds, scaleFactor: Double,
                                       results: inout [ChannelElement]) {
        guard depth <= maxDepth else { return }
        
        let role = axString(element, kAXRoleAttribute) ?? ""
        
        // Get bounds
        guard let globalBounds = axFrame(element) else {
            // No bounds — still recurse children
            for child in axChildren(element) {
                traverseAXForChannel(child, depth: depth + 1, maxDepth: maxDepth,
                                      windowBounds: windowBounds, scaleFactor: scaleFactor,
                                      results: &results)
            }
            return
        }
        
        // Skip zero-size elements
        guard globalBounds.width > 0 && globalBounds.height > 0 else { return }
        
        // Only emit interactive roles (same whitelist as --xray)
        let interactiveRoles: Set<String> = [
            "AXButton", "AXTextField", "AXTextArea", "AXCheckBox",
            "AXRadioButton", "AXPopUpButton", "AXComboBox", "AXMenuItem",
            "AXMenuBarItem", "AXLink", "AXSlider", "AXIncrementor",
            "AXColorWell", "AXDisclosureTriangle", "AXTab", "AXStaticText",
            "AXSwitch", "AXToggle", "AXSearchField", "AXSecureTextField",
            "AXScrollArea", "AXTable", "AXOutline", "AXGroup"
        ]
        
        if interactiveRoles.contains(role) {
            // Compute triple coordinates
            let boundsGlobal = ChannelBounds(from: globalBounds)
            
            let boundsWindow = ChannelBounds(
                x: Double(globalBounds.origin.x) - windowBounds.x,
                y: Double(globalBounds.origin.y) - windowBounds.y,
                w: Double(globalBounds.width),
                h: Double(globalBounds.height)
            )
            
            let boundsPixel = ChannelBounds(
                x: boundsWindow.x * scaleFactor,
                y: boundsWindow.y * scaleFactor,
                w: boundsWindow.w * scaleFactor,
                h: boundsWindow.h * scaleFactor
            )
            
            // Get available actions
            var actionsRef: CFArray?
            let actions: [String]
            if AXUIElementCopyActionNames(element, &actionsRef) == .success,
               let names = actionsRef as? [String] {
                actions = names
            } else {
                actions = []
            }
            
            let channelEl = ChannelElement(
                role: role,
                title: axString(element, kAXTitleAttribute),
                label: axString(element, kAXDescriptionAttribute),
                identifier: axString(element, "AXIdentifier"),
                value: axString(element, kAXValueAttribute),
                enabled: axBool(element, kAXEnabledAttribute) ?? true,
                actions: actions,
                bounds_pixel: boundsPixel,
                bounds_window: boundsWindow,
                bounds_global: boundsGlobal
            )
            results.append(channelEl)
        }
        
        // Recurse children
        for child in axChildren(element) {
            traverseAXForChannel(child, depth: depth + 1, maxDepth: maxDepth,
                                  windowBounds: windowBounds, scaleFactor: scaleFactor,
                                  results: &results)
        }
    }
    
    // MARK: - Window Info Helpers
    
    private func windowBoundsForID(_ windowID: Int) -> ChannelBounds? {
        guard let infoList = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(windowID)) as? [[String: Any]],
              let info = infoList.first,
              let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let x = boundsDict["X"] as? Double,
              let y = boundsDict["Y"] as? Double,
              let w = boundsDict["Width"] as? Double,
              let h = boundsDict["Height"] as? Double else { return nil }
        return ChannelBounds(x: x, y: y, w: w, h: h)
    }
    
    private func windowInfoForID(_ windowID: Int) -> WindowInfo? {
        guard let infoList = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(windowID)) as? [[String: Any]],
              let info = infoList.first else { return nil }
        
        guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let x = boundsDict["X"] as? Double,
              let y = boundsDict["Y"] as? Double,
              let w = boundsDict["Width"] as? Double,
              let h = boundsDict["Height"] as? Double else { return nil }
        
        let pid = info[kCGWindowOwnerPID as String] as? Int ?? 0
        let appName = info[kCGWindowOwnerName as String] as? String ?? "Unknown"
        
        // Look up bundle ID
        let bundleID: String?
        if let app = NSRunningApplication(processIdentifier: pid_t(pid)) {
            bundleID = app.bundleIdentifier
        } else {
            bundleID = nil
        }
        
        // Determine which display this window is on
        let centerX = x + w / 2
        let centerY = y + h / 2
        let displays = getDisplays()
        var display = 1
        var scaleFactor = 2.0
        for d in displays {
            if d.bounds.contains(CGPoint(x: centerX, y: centerY)) {
                display = d.ordinal
                scaleFactor = d.scaleFactor
                break
            }
        }
        
        return WindowInfo(
            pid: pid, appName: appName, bundleID: bundleID,
            display: display, scaleFactor: scaleFactor,
            bounds: ChannelBounds(x: x, y: y, w: w, h: h)
        )
    }
    
    // MARK: - Channel File I/O
    
    private func writeChannelFile(_ file: ChannelFile) {
        // Ensure directory exists
        try? FileManager.default.createDirectory(atPath: kChannelDirectory,
                                                  withIntermediateDirectories: true)
        let path = "\(kChannelDirectory)/\(file.channel_id).json"
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(file) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }
}

// MARK: - Internal State Types

struct ChannelState {
    let id: String
    let windowID: Int
    let pid: Int
    let app: String
    let bundleID: String?
    let display: Int
    let scaleFactor: Double
    var subtree: ChannelSubtree?
    var depth: Int
    var lastBounds: ChannelBounds
    var lastElementCount: Int = 0
    var lastUpdated: String = ""
    let createdAt: String
}

struct WindowInfo {
    let pid: Int
    let appName: String
    let bundleID: String?
    let display: Int
    let scaleFactor: Double
    let bounds: ChannelBounds
}
```

**Note:** This file references `axString()`, `axChildren()`, `axFrame()`, `axBool()`, and `getDisplays()` from main.swift. These are internal-scope functions and are accessible from other .swift files in the same compilation unit.

- [ ] **Step 2: Wire dispatch in daemon.swift**

Update `SideEyeDaemon.dispatchRequest()` to route actions to the spatial model:

```swift
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
        // Handled by connection management in handleConnection
        return .ok
    default:
        return .fail("Unknown action: \(req.action)", code: "UNKNOWN_ACTION")
    }
}
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/side-eye && bash build.sh`
Expected: compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add packages/side-eye/spatial.swift packages/side-eye/daemon.swift
git commit -m "feat(side-eye): spatial model + channel management — AX traversal, triple coords, file I/O"
```

---

## Task 5: Client Commands — client.swift

**Files:**
- Create: `packages/side-eye/client.swift`

CLI commands that connect to the daemon socket and send requests. Follows heads-up client.swift pattern.

- [ ] **Step 1: Create client.swift**

The implementing agent should read `packages/heads-up/client.swift` (469 lines) and replicate the pattern. Key components:

1. **`SideEyeClient` class** with `connect()`, `sendRequest()`, `ensureDaemon()` methods
2. **Auto-start**: Fork self with `"serve"` arg, poll for socket (same as heads-up)
3. **CLI functions**: `focusCreateCommand()`, `focusListCommand()`, `focusRemoveCommand()`, `focusUpdateCommand()`, `snapshotCommand()`

```swift
// client.swift — CLI commands that talk to side-eye daemon

import Foundation

class SideEyeClient {
    func connect() -> Int32? {
        let sock = socket(AF_UNIX, SOCK_STREAM, 0)
        guard sock >= 0 else { return nil }
        let result = withSockAddr(kSideEyeSocketPath) { addr, len in
            Foundation.connect(sock, addr, len)
        }
        if result == 0 { return sock }
        close(sock)
        return nil
    }
    
    func ensureDaemon() -> Bool {
        if let fd = connect() { close(fd); return true }
        
        let selfPath = ProcessInfo.processInfo.arguments[0]
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: selfPath)
        proc.arguments = ["serve"]
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        do { try proc.run() } catch { return false }
        
        for _ in 0..<50 {
            usleep(100_000)
            if let fd = connect() { close(fd); return true }
        }
        return false
    }
    
    func sendRequest(_ req: DaemonRequest) -> DaemonResponse {
        guard ensureDaemon() else {
            return .fail("Could not connect to daemon", code: "DAEMON_UNAVAILABLE")
        }
        guard let fd = connect() else {
            return .fail("Could not connect to daemon", code: "DAEMON_UNAVAILABLE")
        }
        defer { close(fd) }
        
        // Write request
        var data = req.toData()
        data.append(UInt8(ascii: "\n"))
        data.withUnsafeBytes { ptr in
            write(fd, ptr.baseAddress!, ptr.count)
        }
        
        // Read response (10s timeout)
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(10.0)
        while Date() < deadline {
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { break }
            buffer.append(contentsOf: chunk[0..<n])
            if buffer.contains(UInt8(ascii: "\n")) { break }
        }
        
        guard let newlineIdx = buffer.firstIndex(of: UInt8(ascii: "\n")) else {
            return .fail("No response from daemon", code: "TIMEOUT")
        }
        let responseData = Data(buffer[buffer.startIndex..<newlineIdx])
        return DaemonResponse.from(responseData) ?? .fail("Invalid response", code: "PARSE_ERROR")
    }
}

// MARK: - CLI Command Functions

func focusCreateCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    guard let widStr = getArg(args, "--window"), let wid = Int(widStr) else {
        exitError("--window <id> is required", code: "MISSING_ARG")
    }
    
    var subtree: ChannelSubtree? = nil
    let subRole = getArg(args, "--subtree-role")
    let subTitle = getArg(args, "--subtree-title")
    if subRole != nil || subTitle != nil {
        subtree = ChannelSubtree(role: subRole, title: subTitle)
    }
    
    let depth = getArg(args, "--depth").flatMap(Int.init)
    let pid = getArg(args, "--pid").flatMap(Int.init)
    
    let req = DaemonRequest(action: "focus-create", id: id, window_id: wid,
                             pid: pid, subtree: subtree, depth: depth)
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printResponse(resp)
}

func focusListCommand() {
    let req = DaemonRequest(action: "focus-list")
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printResponse(resp)
}

func focusRemoveCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    let req = DaemonRequest(action: "focus-remove", id: id)
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printResponse(resp)
}

func snapshotCommand() {
    let req = DaemonRequest(action: "snapshot")
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printResponse(resp)
}

private func printResponse(_ resp: DaemonResponse) {
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? enc.encode(resp), let s = String(data: data, encoding: .utf8) {
        if resp.error != nil {
            FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
            exit(1)
        } else {
            print(s)
        }
    }
}
```

**Note:** `getArg()` and `exitError()` are functions in the existing side-eye main.swift. The implementing agent should verify these exist and are accessible, or adapt the names to match what's actually in main.swift.

- [ ] **Step 2: Build to verify**

Run: `cd packages/side-eye && bash build.sh`
Expected: compiles. May need to adjust function names to match main.swift's actual helpers.

- [ ] **Step 3: Commit**

```bash
git add packages/side-eye/client.swift
git commit -m "feat(side-eye): client commands — focus-create, focus-list, focus-remove, auto-start daemon"
```

---

## Task 6: Entry Point Wiring — main.swift

**Files:**
- Modify: `packages/side-eye/main.swift`

Add `serve`, `focus`, and `daemon-snapshot` commands to the main entry point.

- [ ] **Step 1: Add serve and focus commands to main dispatch**

The implementing agent should read the current main.swift entry point (the `@main struct SideEye` at the end of the file) and add these command routes to the switch statement:

```swift
// In the synchronous command block:
case "serve":
    let idleStr = getArg(args, "--idle-timeout")  // or however main.swift parses args
    let daemon = SideEyeDaemon(idleTimeout: /* parse idleStr or default 30 */)
    daemon.start()  // This blocks (runs the server)

case "focus":
    guard args.count >= 2 else { /* print focus usage */ }
    let subcommand = args[1]
    let rest = Array(args.dropFirst(2))
    switch subcommand {
    case "create":  focusCreateCommand(args: rest)
    case "list":    focusListCommand()
    case "remove":  focusRemoveCommand(args: rest)
    default:        exitError("Unknown focus subcommand: \(subcommand)", code: "UNKNOWN_COMMAND")
    }

case "daemon-snapshot":
    snapshotCommand()
```

- [ ] **Step 2: Update CLAUDE.md with daemon docs**

Add a section to `packages/side-eye/CLAUDE.md` documenting:
- `side-eye serve [--idle-timeout <duration>]` — start daemon
- `side-eye focus create --id <name> --window <id> [--subtree-role <role>] [--subtree-title <title>] [--depth <n>] [--pid <pid>]`
- `side-eye focus list`
- `side-eye focus remove --id <name>`
- Channel file location: `~/.config/agent-os/channels/<id>.json`
- Daemon socket: `~/.config/side-eye/sock`

- [ ] **Step 3: Build, test basic flow**

```bash
cd packages/side-eye && bash build.sh

# Test: start daemon in background, create a channel, list it, remove it
./side-eye serve &
DAEMON_PID=$!
sleep 1

# List (should be empty)
./side-eye focus list

# Create channel for a window (use a real window ID from `./side-eye list --json`)
WINDOW_ID=$(./side-eye list --json | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['apps'][0]['window_ids'][0]) if d.get('apps') else print(0)")
./side-eye focus create --id test-channel --window "$WINDOW_ID"

# List (should show the channel)
./side-eye focus list

# Check channel file exists
ls ~/.config/agent-os/channels/test-channel.json
cat ~/.config/agent-os/channels/test-channel.json | python3 -m json.tool | head -20

# Remove
./side-eye focus remove --id test-channel

# Stop daemon
kill $DAEMON_PID
```

- [ ] **Step 4: Commit**

```bash
git add packages/side-eye/main.swift packages/side-eye/CLAUDE.md
git commit -m "feat(side-eye): wire daemon serve + focus commands into entry point"
```

---

## Task 7: hand-off Bind — channel.swift + session wiring

**Files:**
- Create: `packages/hand-off/channel.swift`
- Modify: `packages/hand-off/session.swift`
- Modify: `packages/hand-off/models.swift`

This task can run in parallel with Track A (side-eye tasks).

- [ ] **Step 1: Add channel binding state to SessionState in models.swift**

Add a `boundChannel` field and channel element storage:

```swift
// In SessionState class, add:
var boundChannel: String? = nil
var channelElements: [ChannelFileElement] = []
var preBindContext: SessionContext? = nil  // saved context to restore on unbind
```

Also add the `ChannelFileElement` type (hand-off's view of a channel element):

```swift
/// Element from a focus channel file. Used for element resolution when bound.
struct ChannelFileElement: Codable {
    let role: String
    let title: String?
    let label: String?
    let identifier: String?
    let value: String?
    let enabled: Bool
    let actions: [String]
    let bounds_pixel: ChannelFileBounds
    let bounds_window: ChannelFileBounds
    let bounds_global: ChannelFileBounds
}

struct ChannelFileBounds: Codable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

struct ChannelFileTarget: Codable {
    let pid: Int
    let app: String
    let bundle_id: String?
    let window_id: Int
    let display: Int
    let scale_factor: Double
}

struct ChannelFileFocus: Codable {
    let subtree: ChannelFileSubtree?
    let depth: Int
}

struct ChannelFileSubtree: Codable {
    let role: String?
    let title: String?
    let identifier: String?
}

struct ChannelFileData: Codable {
    let channel_id: String
    let target: ChannelFileTarget
    let focus: ChannelFileFocus
    let window_bounds: ChannelFileBounds
    let elements: [ChannelFileElement]
    let updated_at: String
}
```

- [ ] **Step 2: Create channel.swift with bind handler and channel reader**

```swift
// channel.swift — Focus channel binding for hand-off sessions

import Foundation

let channelDirectory: String = {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/.config/agent-os/channels"
}()

// MARK: - Channel File Reading

func readChannelFile(id: String) -> ChannelFileData? {
    let path = "\(channelDirectory)/\(id).json"
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
    return try? JSONDecoder().decode(ChannelFileData.self, from: data)
}

/// Check if channel file is stale (>10s since last update)
func isChannelStale(_ channel: ChannelFileData) -> Bool {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    guard let updated = fmt.date(from: channel.updated_at) else { return true }
    return Date().timeIntervalSince(updated) > 10.0
}

// MARK: - Bind Action Handler

func handleBind(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    
    // Unbind
    if req.channel == nil {
        state.boundChannel = nil
        state.channelElements = []
        // Restore pre-bind context if any
        if let saved = state.preBindContext {
            state.context = saved
            state.preBindContext = nil
        } else {
            state.context.clear()
        }
        return ActionResponse(
            status: "ok", action: "bind",
            cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
            context: state.contextSnapshot(),
            duration_ms: Int(Date().timeIntervalSince(start) * 1000)
        )
    }
    
    // Bind to channel
    guard let channelID = req.channel else {
        return ActionResponse(
            status: "error", action: "bind",
            cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
            error: "channel is required", code: "MISSING_ARG"
        )
    }
    
    guard let channel = readChannelFile(id: channelID) else {
        return ActionResponse(
            status: "error", action: "bind",
            cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
            error: "Channel file not found: \(channelID)", code: "CHANNEL_NOT_FOUND"
        )
    }
    
    // Save current context for unbind restore
    state.preBindContext = state.context
    
    // Set context from channel target
    state.context.pid = channel.target.pid
    state.context.app = channel.target.app
    state.context.window_id = channel.target.window_id
    state.context.scale_factor = channel.target.scale_factor
    state.context.coordinate_space = "window"
    
    // Set subtree from channel focus
    if let sub = channel.focus.subtree {
        state.context.subtree = SubtreeSpec(
            role: sub.role, title: sub.title, identifier: sub.identifier
        )
    }
    
    // Load elements
    state.boundChannel = channelID
    state.channelElements = channel.elements
    
    var resp = ActionResponse(
        status: "ok", action: "bind",
        cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
        context: state.contextSnapshot(),
        duration_ms: Int(Date().timeIntervalSince(start) * 1000)
    )
    resp.elements_count = channel.elements.count
    
    // Warn if stale
    if isChannelStale(channel) {
        resp.code = "CHANNEL_STALE"
    }
    
    return resp
}

// MARK: - Channel-Aware Element Resolution

/// Before each action in a bound session, re-read the channel file for fresh data.
func refreshChannelBinding(state: SessionState) {
    guard let channelID = state.boundChannel else { return }
    guard let channel = readChannelFile(id: channelID) else { return }
    state.channelElements = channel.elements
    
    // Update window bounds in case window moved
    state.context.window_id = channel.target.window_id
}

/// Resolve an element from channel data by matching fields.
/// Returns the global CG point at the element's center (for CGEvent actions).
func resolveChannelElement(_ req: ActionRequest, state: SessionState) -> CGPoint? {
    guard state.boundChannel != nil else { return nil }
    
    // Only resolve if the request has AX targeting fields but no coordinates
    guard req.x == nil && req.y == nil else { return nil }
    guard req.role != nil || req.title != nil || req.label != nil || req.identifier != nil else { return nil }
    
    for el in state.channelElements {
        var match = true
        if let role = req.role, el.role != role { match = false }
        if let title = req.title, el.title != title { match = false }
        if let label = req.label, el.label != label { match = false }
        if let ident = req.identifier, el.identifier != ident { match = false }
        
        if match {
            // Return center of global bounds
            let cx = el.bounds_global.x + el.bounds_global.w / 2
            let cy = el.bounds_global.y + el.bounds_global.h / 2
            return CGPoint(x: cx, y: cy)
        }
    }
    return nil
}
```

- [ ] **Step 3: Wire bind into session dispatch**

In `packages/hand-off/session.swift`, update `dispatchAction()`:

Replace the Phase 2 placeholder:
```swift
case "bind":
    return ActionResponse(
        status: "error", action: "bind",
        cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
        error: "bind requires Phase 2 (focus channels)", code: "UNKNOWN_ACTION"
    )
```

With:
```swift
case "bind":
    return handleBind(req, state: state)
```

Also add channel refresh before dispatch. At the top of `dispatchAction()`, before the switch:
```swift
// Re-read channel file before each action if bound
refreshChannelBinding(state: state)
```

- [ ] **Step 4: Build and verify**

Run: `cd packages/hand-off && bash build.sh`
Expected: compiles cleanly.

Test bind with a mock channel file:
```bash
mkdir -p ~/.config/agent-os/channels
cat > ~/.config/agent-os/channels/test.json << 'EOF'
{
  "channel_id": "test",
  "created_by": "side-eye",
  "created_at": "2026-04-02T00:00:00Z",
  "updated_at": "2026-04-02T00:00:00Z",
  "target": {"pid": 1, "app": "Test", "bundle_id": null, "window_id": 1, "display": 1, "scale_factor": 2.0},
  "focus": {"subtree": null, "depth": 3},
  "window_bounds": {"x": 0, "y": 0, "w": 800, "h": 600},
  "elements": [{"role": "AXButton", "title": "Save", "label": null, "identifier": null, "value": null, "enabled": true, "actions": ["AXPress"], "bounds_pixel": {"x": 100, "y": 50, "w": 60, "h": 30}, "bounds_window": {"x": 50, "y": 25, "w": 30, "h": 15}, "bounds_global": {"x": 50, "y": 25, "w": 30, "h": 15}}]
}
EOF

echo '{"action":"bind","channel":"test"}' | ./hand-off session
# Expected: status ok, elements_count: 1, context with pid=1

rm ~/.config/agent-os/channels/test.json
```

- [ ] **Step 5: Commit**

```bash
git add packages/hand-off/channel.swift packages/hand-off/session.swift packages/hand-off/models.swift
git commit -m "feat(hand-off): bind action — read focus channels, auto-set context, element resolution"
```

---

## Task 8: Integration Tests

**Files:**
- Modify: `packages/hand-off/test.sh`
- Create: `packages/side-eye/test-daemon.sh`

- [ ] **Step 1: Add bind tests to hand-off test.sh**

Append to `packages/hand-off/test.sh`:

```bash
echo ""
echo "--- Channel Bind ---"

# Create mock channel file
mkdir -p ~/.config/agent-os/channels
cat > ~/.config/agent-os/channels/test-bind.json << 'CHAN'
{"channel_id":"test-bind","created_by":"side-eye","created_at":"2026-04-02T00:00:00Z","updated_at":"2099-01-01T00:00:00Z","target":{"pid":1,"app":"TestApp","bundle_id":null,"window_id":1,"display":1,"scale_factor":2.0},"focus":{"subtree":null,"depth":3},"window_bounds":{"x":0,"y":0,"w":800,"h":600},"elements":[{"role":"AXButton","title":"Save","label":null,"identifier":null,"value":null,"enabled":true,"actions":["AXPress"],"bounds_pixel":{"x":100,"y":50,"w":60,"h":30},"bounds_window":{"x":50,"y":25,"w":30,"h":15},"bounds_global":{"x":50,"y":25,"w":30,"h":15}}]}
CHAN

# Bind to channel
OUT=$(echo '{"action":"bind","channel":"test-bind"}' | $BINARY session 2>&1)
if echo "$OUT" | grep -q '"elements_count"'; then
    pass "bind returns elements_count"
else
    fail "bind returns elements_count" "$OUT"
fi
if echo "$OUT" | grep -q '"TestApp"'; then
    pass "bind sets context from channel target"
else
    fail "bind sets context from channel target" "$OUT"
fi

# Bind to nonexistent channel
OUT=$(echo '{"action":"bind","channel":"no-such-channel"}' | $BINARY session 2>&1)
if echo "$OUT" | grep -q 'CHANNEL_NOT_FOUND'; then
    pass "bind nonexistent channel returns CHANNEL_NOT_FOUND"
else
    fail "bind nonexistent channel returns CHANNEL_NOT_FOUND" "$OUT"
fi

# Unbind
OUT=$(printf '{"action":"bind","channel":"test-bind"}\n{"action":"bind","channel":null}\n{"action":"status"}\n' | $BINARY session 2>&1)
if echo "$OUT" | grep -q '"ok"'; then
    pass "unbind returns ok"
else
    fail "unbind returns ok" "$OUT"
fi

# Cleanup
rm -f ~/.config/agent-os/channels/test-bind.json
```

- [ ] **Step 2: Create side-eye daemon test script**

Create `packages/side-eye/test-daemon.sh` with basic daemon lifecycle tests.

- [ ] **Step 3: Run tests**

```bash
cd packages/hand-off && bash build.sh && bash test.sh
cd packages/side-eye && bash build.sh && bash test-daemon.sh
```

- [ ] **Step 4: Commit**

```bash
git add packages/hand-off/test.sh packages/side-eye/test-daemon.sh
git commit -m "test: integration tests for focus channel protocol — bind + daemon lifecycle"
```

---

## Final Verification

After all tasks complete:

```bash
# 1. Build both packages
cd packages/side-eye && bash build.sh
cd packages/hand-off && bash build.sh

# 2. Start side-eye daemon
cd packages/side-eye && ./side-eye serve &
sleep 1

# 3. Find a real window
WINDOW_ID=$(./side-eye list --json | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); [print(w) for a in d['apps'] for w in a['window_ids']]" | head -1)

# 4. Create a focus channel
./side-eye focus create --id smoke-test --window $WINDOW_ID

# 5. Verify channel file
cat ~/.config/agent-os/channels/smoke-test.json | python3 -m json.tool | head -30

# 6. Bind from hand-off and check elements
echo '{"action":"bind","channel":"smoke-test"}' | cd ../hand-off && ./hand-off session

# 7. Cleanup
cd ../side-eye && ./side-eye focus remove --id smoke-test
kill %1
```
