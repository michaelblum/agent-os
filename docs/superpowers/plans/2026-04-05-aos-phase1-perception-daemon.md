# AOS Phase 1: Unified Binary + Perception Daemon

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `aos` unified binary with `see` subcommands and a perception daemon that publishes depth 0-2 events over a Unix socket.

**Architecture:** Single Swift binary at `src/aos`. Entry point routes subcommands (`see`, `set`, `serve`) to modules. The perception daemon runs as part of `aos serve`, owns a CGEventTap for cursor monitoring, queries AX at cursor-settle, and publishes events in the standard daemon-event envelope to subscribers over `~/.config/aos/sock`. Config lives at `~/.config/aos/config.json`.

**Tech Stack:** Swift 5.9+, macOS 14+. Frameworks: Foundation, AppKit, ApplicationServices (AXUIElement), CoreGraphics. No external dependencies. No SPM. Single `swiftc` invocation via `build.sh`.

**Spec:** `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md`

**Reference code:** The existing `packages/side-eye/` and `packages/heads-up/` implementations are the reference for AX queries, socket servers, and event relay patterns.

---

## File Structure

```
src/
  main.swift                    # Entry point, subcommand routing
  shared/
    helpers.swift               # exitError, JSON encoding, withSockAddr, parseDuration
    envelope.swift              # Daemon event envelope builder
    config.swift                # Config file read/write/watch (~/.config/aos/config.json)
    types.swift                 # Shared types: Bounds, coordinate helpers
  perceive/
    cursor.swift                # One-shot: aos see cursor
    models.swift                # Output types for perception commands
    ax.swift                    # AX utility functions (axString, axBool, etc.)
    daemon.swift                # Perception daemon: CGEventTap, cursor monitor, AX queries
    attention.swift             # Attention envelope: depth/scope/rate channel management
    events.swift                # Perception event definitions and emission
  commands/
    set.swift                   # aos set <key> <value>
    serve.swift                 # aos serve — start unified daemon
build.sh                        # Compile all src/**/*.swift into ./aos
```

---

## Task 1: Shared Foundation

**Files:**
- Create: `src/shared/helpers.swift`
- Create: `src/shared/types.swift`
- Create: `src/shared/envelope.swift`
- Create: `src/shared/config.swift`
- Create: `src/main.swift` (stub)
- Create: `build.sh`

### Purpose
Extract and consolidate shared utilities from existing packages. Every other task depends on these files. This establishes the binary skeleton, build system, and common code.

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p src/shared src/perceive src/commands
```

- [ ] **Step 2: Write `src/shared/helpers.swift`**

Consolidated from `packages/heads-up/helpers.swift` and `packages/side-eye/main.swift`.

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

// MARK: - Socket Path

let kAosSocketDir: String = {
    NSString(string: "~/.config/aos").expandingTildeInPath
}()

let kAosSocketPath: String = {
    kAosSocketDir + "/sock"
}()

// MARK: - Unix Socket Helper

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

// MARK: - Response Helpers

func sendResponse(to fd: Int32, _ data: Data) {
    var buf = data
    buf.append(contentsOf: "\n".utf8)
    buf.withUnsafeBytes { ptr in
        _ = write(fd, ptr.baseAddress!, ptr.count)
    }
}

func sendJSON(to fd: Int32, _ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]) else { return }
    sendResponse(to: fd, data)
}
```

- [ ] **Step 3: Write `src/shared/types.swift`**

```swift
// types.swift — Shared types used across modules

import Foundation
import CoreGraphics

// MARK: - Bounds

struct Bounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }

    init(from rect: CGRect) {
        self.x = Double(rect.origin.x)
        self.y = Double(rect.origin.y)
        self.width = Double(rect.size.width)
        self.height = Double(rect.size.height)
    }

    func contains(_ point: CGPoint) -> Bool {
        point.x >= x && point.x < x + width && point.y >= y && point.y < y + height
    }
}

// MARK: - Coordinate Conversion

/// Convert NSEvent mouse coordinates (bottom-left origin) to CG coordinates (top-left origin).
func mouseInCGCoords() -> CGPoint {
    let mouse = NSEvent.mouseLocation
    let mainH = CGDisplayBounds(CGMainDisplayID()).height
    return CGPoint(x: mouse.x, y: mainH - mouse.y)
}
```

- [ ] **Step 4: Write `src/shared/envelope.swift`**

```swift
// envelope.swift — Daemon event envelope builder per shared/schemas/daemon-event.schema.json

import Foundation

/// Build a standard daemon event envelope.
/// Returns a JSON dictionary ready for serialization.
func buildEnvelope(service: String, event: String, data: [String: Any], ref: String? = nil) -> [String: Any] {
    var envelope: [String: Any] = [
        "v": 1,
        "service": service,
        "event": event,
        "ts": Date().timeIntervalSince1970,
        "data": data
    ]
    if let ref = ref { envelope["ref"] = ref }
    return envelope
}

/// Serialize an envelope to ndjson bytes (JSON + newline).
func envelopeBytes(service: String, event: String, data: [String: Any], ref: String? = nil) -> Data? {
    let dict = buildEnvelope(service: service, event: event, data: data, ref: ref)
    guard var jsonData = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]) else { return nil }
    jsonData.append(contentsOf: "\n".utf8)
    return jsonData
}
```

- [ ] **Step 5: Write `src/shared/config.swift`**

```swift
// config.swift — AOS configuration file: read, write, watch

import Foundation

let kAosConfigPath: String = {
    NSString(string: "~/.config/aos/config.json").expandingTildeInPath
}()

struct AosConfig: Codable {
    var voice: VoiceConfig
    var perception: PerceptionConfig
    var feedback: FeedbackConfig

    struct VoiceConfig: Codable {
        var enabled: Bool
        var announce_actions: Bool
    }

    struct PerceptionConfig: Codable {
        var default_depth: Int
        var settle_threshold_ms: Int
    }

    struct FeedbackConfig: Codable {
        var visual: Bool
        var sound: Bool
    }

    static let defaults = AosConfig(
        voice: VoiceConfig(enabled: false, announce_actions: true),
        perception: PerceptionConfig(default_depth: 1, settle_threshold_ms: 200),
        feedback: FeedbackConfig(visual: true, sound: false)
    )
}

/// Load config from disk, falling back to defaults if missing or invalid.
func loadConfig() -> AosConfig {
    guard let data = FileManager.default.contents(atPath: kAosConfigPath),
          let config = try? JSONDecoder().decode(AosConfig.self, from: data) else {
        return .defaults
    }
    return config
}

/// Save config to disk. Creates parent directory if needed.
func saveConfig(_ config: AosConfig) {
    let dir = (kAosConfigPath as NSString).deletingLastPathComponent
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? enc.encode(config) else { return }
    try? data.write(to: URL(fileURLWithPath: kAosConfigPath))
}

/// Set a dotted key path in config. E.g. "voice.enabled" = "true"
func setConfigValue(key: String, value: String) {
    var config = loadConfig()
    switch key {
    case "voice.enabled":
        config.voice.enabled = (value == "true" || value == "1")
    case "voice.announce_actions":
        config.voice.announce_actions = (value == "true" || value == "1")
    case "perception.default_depth":
        if let n = Int(value), (0...3).contains(n) { config.perception.default_depth = n }
        else { exitError("depth must be 0-3", code: "INVALID_VALUE") }
    case "perception.settle_threshold_ms":
        if let n = Int(value), n > 0 { config.perception.settle_threshold_ms = n }
        else { exitError("settle_threshold_ms must be positive", code: "INVALID_VALUE") }
    case "feedback.visual":
        config.feedback.visual = (value == "true" || value == "1")
    case "feedback.sound":
        config.feedback.sound = (value == "true" || value == "1")
    default:
        exitError("Unknown config key: \(key). Valid: voice.enabled, voice.announce_actions, perception.default_depth, perception.settle_threshold_ms, feedback.visual, feedback.sound", code: "UNKNOWN_KEY")
    }
    saveConfig(config)
    print(jsonString(config))
}
```

- [ ] **Step 6: Write `src/main.swift` (stub)**

```swift
// main.swift — AOS unified binary entry point

import Foundation
import AppKit

@main
struct AOS {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())

        guard let command = args.first else {
            printUsage()
            exit(0)
        }

        switch command {
        case "see":
            handleSee(args: Array(args.dropFirst()))
        case "set":
            handleSet(args: Array(args.dropFirst()))
        case "serve":
            handleServe(args: Array(args.dropFirst()))
        case "--help", "-h", "help":
            printUsage()
        default:
            exitError("Unknown command: \(command). Run 'aos --help' for usage.", code: "UNKNOWN_COMMAND")
        }
    }
}

func printUsage() {
    let usage = """
    aos — agent operating system

    Usage: aos <command> [options]

    Commands:
      see <subcommand>     Perception — query what's on screen
      set <key> <value>    Configure autonomic settings
      serve                Start the unified daemon

    Perception (aos see):
      cursor               What's under the cursor (display, window, AX element)
      observe              Subscribe to perception stream (requires daemon)

    Configuration (aos set):
      voice.enabled <bool>              Enable/disable voice output
      perception.default_depth <0-3>    Default perception depth
      perception.settle_threshold_ms <ms>  Cursor settle threshold
      feedback.visual <bool>            Enable/disable visual feedback

    Examples:
      aos see cursor                    # One-shot: what's under the cursor
      aos serve                         # Start daemon
      aos see observe --depth 2         # Stream perception events
      aos set voice.enabled true        # Turn on voice
    """
    print(usage)
}

func handleSee(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos see <cursor|observe>", code: "MISSING_SUBCOMMAND")
    }
    switch sub {
    case "cursor":
        cursorCommand()
    case "observe":
        observeCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown see subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

func handleSet(args: [String]) {
    setCommand(args: args)
}

func handleServe(args: [String]) {
    serveCommand(args: args)
}
```

- [ ] **Step 7: Write `build.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Compiling aos..."
# Collect all Swift source files from src/ tree
SOURCES=$(find src -name '*.swift' -type f)

swiftc -parse-as-library -O -o aos $SOURCES

echo "Done: ./aos ($(du -h aos | cut -f1 | xargs))"
```

- [ ] **Step 8: Verify skeleton compiles**

The binary won't fully link yet (missing `cursorCommand`, `observeCommand`, `setCommand`, `serveCommand`). Add temporary stubs at the bottom of `src/main.swift`:

```swift
// Temporary stubs — replaced by subsequent tasks
func cursorCommand() { print("{\"status\":\"stub\",\"command\":\"cursor\"}") }
func observeCommand(args: [String]) { print("{\"status\":\"stub\",\"command\":\"observe\"}") }
func setCommand(args: [String]) { print("{\"status\":\"stub\",\"command\":\"set\"}") }
func serveCommand(args: [String]) { print("{\"status\":\"stub\",\"command\":\"serve\"}") }
```

Run:
```bash
chmod +x build.sh && bash build.sh
```
Expected: Compiles successfully, produces `./aos` binary.

- [ ] **Step 9: Test skeleton**

```bash
./aos --help
./aos see cursor
./aos set voice.enabled true
```
Expected: Usage text, stub JSON responses.

- [ ] **Step 10: Commit**

```bash
git add src/ build.sh
git commit -m "feat(aos): unified binary skeleton with shared foundation

Establishes src/ directory structure, shared utilities (helpers, envelope,
config, types), and main.swift entry point with subcommand routing.
Build via build.sh. Stub commands for cursor, observe, set, serve.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: AX Utilities + Perception Models

**Files:**
- Create: `src/perceive/ax.swift`
- Create: `src/perceive/models.swift`

### Purpose
AX helper functions and output types that both one-shot commands and the daemon use. No command implementations yet — just the shared types and utilities.

- [ ] **Step 1: Write `src/perceive/ax.swift`**

Port AX utility functions from `packages/side-eye/main.swift` and `packages/hand-off/helpers.swift`.

```swift
// ax.swift — Accessibility API utility functions

import ApplicationServices
import Foundation

// MARK: - AX Attribute Helpers

func axString(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return value as? String
}

func axBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return (value as? NSNumber)?.boolValue
}

func axInt(_ element: AXUIElement, _ attribute: String) -> Int? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return (value as? NSNumber)?.intValue
}

func axValue(_ element: AXUIElement) -> String? {
    var valRef: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valRef) == .success else { return nil }
    if let s = valRef as? String {
        return s.count > 200 ? String(s.prefix(200)) + "..." : s
    } else if let n = valRef as? NSNumber {
        return n.stringValue
    }
    return nil
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
          let children = value as? [AXUIElement] else { return [] }
    return children
}

func axParent(_ element: AXUIElement) -> AXUIElement? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXParentAttribute as CFString, &value) == .success else { return nil }
    // The returned value is an AXUIElement (opaque CFTypeRef)
    return (value as! AXUIElement)
}

func axBounds(_ element: AXUIElement) -> CGRect? {
    var posValue: AnyObject?
    var sizeValue: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posValue) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success else { return nil }
    var pos = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(posValue as! AXValue, .cgPoint, &pos),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: pos, size: size)
}

func axActions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success, let arr = names as? [String] else { return [] }
    return arr
}

// MARK: - Context Path

/// Walk up the AX tree to build a breadcrumb path like ["Finder", "Main Window", "Toolbar", "Open"].
func axContextPath(_ element: AXUIElement, maxDepth: Int = 6) -> [String] {
    var path: [String] = []
    var current: AXUIElement? = element
    var depth = 0
    while let el = current, depth < maxDepth {
        let role = axString(el, kAXRoleAttribute) ?? ""
        let title = axString(el, kAXTitleAttribute)
        let label = axString(el, kAXDescriptionAttribute)
        let name = title ?? label ?? role
        if !name.isEmpty { path.insert(name, at: 0) }
        current = axParent(el)
        depth += 1
    }
    return path
}

// MARK: - Element at Point

struct AXHitResult {
    let element: AXUIElement
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let enabled: Bool
    let bounds: CGRect?
    let contextPath: [String]
}

/// Hit-test the AX tree at a global CG point for a given app PID.
func axElementAtPoint(pid: pid_t, point: CGPoint) -> AXHitResult? {
    let axApp = AXUIElementCreateApplication(pid)
    var elementRef: AXUIElement?
    let result = AXUIElementCopyElementAtPosition(axApp, Float(point.x), Float(point.y), &elementRef)
    guard result == .success, let el = elementRef else { return nil }

    return AXHitResult(
        element: el,
        role: axString(el, kAXRoleAttribute) ?? "unknown",
        title: axString(el, kAXTitleAttribute),
        label: axString(el, kAXDescriptionAttribute),
        value: axValue(el),
        enabled: axBool(el, kAXEnabledAttribute) ?? true,
        bounds: axBounds(el),
        contextPath: axContextPath(el)
    )
}
```

- [ ] **Step 2: Write `src/perceive/models.swift`**

```swift
// models.swift — Output types for perception commands

import Foundation

// MARK: - Cursor Command Output

struct CursorResponse: Encodable {
    let cursor: CursorPoint
    let display: Int
    let window: CursorWindow?
    let element: CursorElement?
}

struct CursorPoint: Encodable {
    let x: Double
    let y: Double
}

struct CursorWindow: Encodable {
    let window_id: Int
    let title: String?
    let app_name: String
    let app_pid: Int
    let bundle_id: String?
    let bounds: Bounds
}

struct CursorElement: Encodable {
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let enabled: Bool
    let bounds: Bounds?
    let context_path: [String]
}

// MARK: - Display Info

struct DisplayEntry {
    let id: CGDirectDisplayID
    let ordinal: Int
    let bounds: CGRect
    let isMain: Bool
    let scaleFactor: Double
}

func getDisplays() -> [DisplayEntry] {
    var displayIDs = [CGDirectDisplayID](repeating: 0, count: 16)
    var count: UInt32 = 0
    CGGetActiveDisplayList(16, &displayIDs, &count)
    let mainID = CGMainDisplayID()

    return (0..<Int(count)).map { i in
        let id = displayIDs[i]
        let bounds = CGDisplayBounds(id)
        let mode = CGDisplayCopyDisplayMode(id)
        let scale = mode.map { Double($0.pixelWidth) / Double($0.width) } ?? 2.0
        return DisplayEntry(id: id, ordinal: i + 1, bounds: bounds, isMain: id == mainID, scaleFactor: scale)
    }.sorted(by: { $0.bounds.origin.x < $1.bounds.origin.x })
}
```

- [ ] **Step 3: Verify compilation**

```bash
bash build.sh
```
Expected: Compiles. No errors.

- [ ] **Step 4: Commit**

```bash
git add src/perceive/ax.swift src/perceive/models.swift
git commit -m "feat(perceive): AX utilities and perception output models

AX helpers for attribute reading, element hit-testing, context path
building. Output types for cursor command response, display enumeration.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: One-Shot Cursor Command

**Files:**
- Create: `src/perceive/cursor.swift`
- Modify: `src/main.swift` (remove cursorCommand stub)

### Purpose
Implement `aos see cursor` — the first real command. Ports the cursor query logic from `packages/side-eye/main.swift:1618-1700`.

- [ ] **Step 1: Write `src/perceive/cursor.swift`**

```swift
// cursor.swift — One-shot cursor query: what's under the cursor right now

import AppKit
import ApplicationServices
import Foundation

/// aos see cursor — query display, window, and AX element at cursor position.
func cursorCommand() {
    let cursorPt = mouseInCGCoords()

    // -- Which display? --
    let displays = getDisplays()
    let display = displays.first(where: { $0.bounds.contains(cursorPt) }) ?? displays.first(where: { $0.isMain })!

    // -- Window list (on-screen, front-to-back) --
    let windowInfoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

    // -- App lookup for bundle IDs --
    var appLookup: [pid_t: String?] = [:]
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        appLookup[app.processIdentifier] = app.bundleIdentifier
    }

    // -- Hit-test: find frontmost window containing cursor --
    var matchedWindow: CursorWindow? = nil
    var matchedPID: pid_t? = nil
    for info in windowInfoList {
        guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else { continue }
        guard rect.contains(cursorPt) else { continue }
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        guard layer == 0 else { continue }
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
        guard alpha > 0 else { continue }
        let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
        guard ownerName != "Window Server" else { continue }

        let windowID = info[kCGWindowNumber as String] as? Int ?? 0
        let pid = info[kCGWindowOwnerPID as String] as? pid_t ?? 0
        let title = info[kCGWindowName as String] as? String

        matchedWindow = CursorWindow(
            window_id: windowID,
            title: title,
            app_name: ownerName,
            app_pid: Int(pid),
            bundle_id: appLookup[pid] ?? nil,
            bounds: Bounds(from: rect)
        )
        matchedPID = pid
        break
    }

    // -- AX element at cursor point --
    var matchedElement: CursorElement? = nil
    if let pid = matchedPID, AXIsProcessTrusted() {
        if let hit = axElementAtPoint(pid: pid, point: cursorPt) {
            matchedElement = CursorElement(
                role: hit.role,
                title: hit.title,
                label: hit.label,
                value: hit.value,
                enabled: hit.enabled,
                bounds: hit.bounds.map { Bounds(from: $0) },
                context_path: hit.contextPath
            )
        }
    }

    let response = CursorResponse(
        cursor: CursorPoint(x: cursorPt.x, y: cursorPt.y),
        display: display.ordinal,
        window: matchedWindow,
        element: matchedElement
    )
    print(jsonString(response))
}
```

- [ ] **Step 2: Remove cursorCommand stub from main.swift**

Remove the temporary stub line:
```swift
func cursorCommand() { print("{\"status\":\"stub\",\"command\":\"cursor\"}") }
```

- [ ] **Step 3: Build and test**

```bash
bash build.sh
./aos see cursor
```
Expected: JSON output with `cursor`, `display`, `window`, and `element` fields. The `window` and `element` fields depend on what's under the cursor (may be null if cursor is over desktop).

- [ ] **Step 4: Test edge case — cursor over desktop**

Move cursor to desktop area (no window), then:
```bash
./aos see cursor | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'cursor' in d; print('PASS')"
```
Expected: PASS (response always has `cursor` and `display`, `window`/`element` may be null).

- [ ] **Step 5: Commit**

```bash
git add src/perceive/cursor.swift src/main.swift
git commit -m "feat(perceive): implement aos see cursor

One-shot cursor query: returns display, window, and AX element at current
cursor position. Ports logic from side-eye cursorCommand.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Perception Daemon — Attention Envelope + Events

**Files:**
- Create: `src/perceive/attention.swift`
- Create: `src/perceive/events.swift`

### Purpose
The perception channel management and event definitions. The attention envelope tracks what consumers have requested (depth/scope/rate) and determines what work the daemon needs to do. Events define the data published at each depth level.

- [ ] **Step 1: Write `src/perceive/events.swift`**

```swift
// events.swift — Perception event definitions and emission

import Foundation
import CoreGraphics

// MARK: - Perception Event Names

enum PerceptionEvent: String {
    // Depth 0
    case cursor_moved = "cursor_moved"
    case cursor_settled = "cursor_settled"
    // Depth 1
    case window_entered = "window_entered"
    case app_entered = "app_entered"
    // Depth 2
    case element_focused = "element_focused"
}

// MARK: - Event Data Builders

func cursorMovedData(x: Double, y: Double, display: Int, velocity: Double) -> [String: Any] {
    ["x": x, "y": y, "display": display, "velocity": velocity]
}

func cursorSettledData(x: Double, y: Double, display: Int, idle_ms: Int) -> [String: Any] {
    ["x": x, "y": y, "display": display, "idle_ms": idle_ms]
}

func windowEnteredData(window_id: Int, app: String, pid: Int, bundle_id: String?, bounds: Bounds) -> [String: Any] {
    var d: [String: Any] = [
        "window_id": window_id, "app": app, "pid": pid,
        "bounds": ["x": bounds.x, "y": bounds.y, "width": bounds.width, "height": bounds.height]
    ]
    if let bid = bundle_id { d["bundle_id"] = bid }
    return d
}

func appEnteredData(app: String, pid: Int, bundle_id: String?) -> [String: Any] {
    var d: [String: Any] = ["app": app, "pid": pid]
    if let bid = bundle_id { d["bundle_id"] = bid }
    return d
}

func elementFocusedData(role: String, title: String?, label: String?, value: String?,
                         bounds: Bounds?, context_path: [String]) -> [String: Any] {
    var d: [String: Any] = ["role": role, "context_path": context_path]
    if let t = title { d["title"] = t }
    if let l = label { d["label"] = l }
    if let v = value { d["value"] = v }
    if let b = bounds {
        d["bounds"] = ["x": b.x, "y": b.y, "width": b.width, "height": b.height]
    }
    return d
}
```

- [ ] **Step 2: Write `src/perceive/attention.swift`**

```swift
// attention.swift — Attention envelope: manages what the daemon perceives

import Foundation

// MARK: - Perception Channel (one per subscriber request)

struct PerceptionChannel {
    let id: UUID
    let depth: Int          // 0-3
    let scope: String       // "cursor" (only scope for Phase 1)
    let rate: String        // "continuous", "on-change", "on-settle"
}

// MARK: - Attention Envelope

/// Tracks all active perception channels and computes what work the daemon must do.
class AttentionEnvelope {
    private var channels: [UUID: PerceptionChannel] = [:]
    private let lock = NSLock()

    /// Add a perception channel. Returns the channel ID.
    func addChannel(depth: Int, scope: String, rate: String) -> UUID {
        let channel = PerceptionChannel(id: UUID(), depth: depth, scope: scope, rate: rate)
        lock.lock()
        channels[channel.id] = channel
        lock.unlock()
        return channel.id
    }

    /// Remove a perception channel.
    func removeChannel(_ id: UUID) {
        lock.lock()
        channels.removeValue(forKey: id)
        lock.unlock()
    }

    /// Remove all channels for a given connection (identified by a set of channel IDs).
    func removeChannels(_ ids: Set<UUID>) {
        lock.lock()
        for id in ids { channels.removeValue(forKey: id) }
        lock.unlock()
    }

    /// The maximum depth any subscriber wants. Returns -1 if no subscribers.
    var maxDepth: Int {
        lock.lock()
        let result = channels.values.map(\.depth).max() ?? -1
        lock.unlock()
        return result
    }

    /// Whether any subscriber wants continuous cursor events.
    var wantsContinuousCursor: Bool {
        lock.lock()
        let result = channels.values.contains(where: { $0.rate == "continuous" })
        lock.unlock()
        return result
    }

    /// Whether any subscriber wants on-change events.
    var wantsOnChange: Bool {
        lock.lock()
        let result = channels.values.contains(where: { $0.rate == "on-change" || $0.rate == "continuous" })
        lock.unlock()
        return result
    }

    /// Whether any subscriber wants on-settle events (including depth 2+).
    var wantsOnSettle: Bool {
        lock.lock()
        let result = channels.values.contains(where: { $0.rate == "on-settle" || $0.depth >= 2 })
        lock.unlock()
        return result
    }

    /// Whether there are any active channels at all.
    var hasSubscribers: Bool {
        lock.lock()
        let result = !channels.isEmpty
        lock.unlock()
        return result
    }

    /// Snapshot of current channels for debugging.
    var channelCount: Int {
        lock.lock()
        let result = channels.count
        lock.unlock()
        return result
    }
}
```

- [ ] **Step 3: Verify compilation**

```bash
bash build.sh
```
Expected: Compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/perceive/events.swift src/perceive/attention.swift
git commit -m "feat(perceive): attention envelope and perception event types

Attention envelope tracks active perception channels (depth/scope/rate),
computes max depth and rate requirements. Event builders for all depth 0-2
perception events in daemon-event envelope format.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Perception Daemon Core

**Files:**
- Create: `src/perceive/daemon.swift`
- Create: `src/commands/serve.swift`
- Modify: `src/main.swift` (remove serveCommand stub)

### Purpose
The heart of the system. A Unix socket server that accepts subscriber connections, runs a CGEventTap for cursor monitoring, queries AX on cursor settle, and publishes perception events. This is the most complex task.

- [ ] **Step 1: Write `src/perceive/daemon.swift`**

```swift
// daemon.swift — Perception daemon: CGEventTap + cursor monitor + AX queries + event publishing

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

class PerceptionDaemon {
    let socketPath: String
    var serverFD: Int32 = -1
    let startTime = Date()
    let config: AosConfig
    let attention = AttentionEnvelope()

    // Subscriber tracking
    private var subscriberLock = NSLock()
    private var subscribers: [UUID: SubscriberConnection] = [:]
    private let eventWriteQueue = DispatchQueue(label: "aos.event-write")

    // Cursor state
    private var lastCursorPoint: CGPoint = .zero
    private var lastWindowID: Int = 0
    private var lastAppPID: pid_t = 0
    private var lastAppName: String = ""
    private var lastElementRole: String = ""
    private var lastElementTitle: String = ""
    private var cursorIdleTimer: DispatchSourceTimer?
    private var lastMoveTime: Date = Date()

    // App lookup cache (refreshed periodically)
    private var appLookup: [pid_t: (name: String, bundleID: String?)] = [:]
    private var appLookupStale = true

    struct SubscriberConnection {
        let fd: Int32
        var channelIDs: Set<UUID>
    }

    init(config: AosConfig) {
        self.socketPath = kAosSocketPath
        self.config = config
    }

    // MARK: - Start

    func start() {
        // Ensure directory exists
        try? FileManager.default.createDirectory(
            atPath: (socketPath as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true)

        // Remove stale socket
        unlink(socketPath)

        // Create socket
        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else { exitError("socket() failed: \(errno)", code: "SOCKET_ERROR") }

        let bindResult = withSockAddr(socketPath) { addr, len in bind(serverFD, addr, len) }
        guard bindResult == 0 else { exitError("bind() failed: \(errno)", code: "BIND_ERROR") }
        guard listen(serverFD, 10) == 0 else { exitError("listen() failed: \(errno)", code: "LISTEN_ERROR") }

        fputs("aos daemon started on \(socketPath)\n", stderr)

        // Start CGEventTap for cursor monitoring
        startEventTap()

        // Start cursor settle timer
        startSettleTimer()

        // Refresh app lookup periodically
        startAppLookupRefresh()

        // Accept connections on background queue
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop()
        }

        // Handle clean shutdown
        setupSignalHandlers()
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
                let daemon = Unmanaged<PerceptionDaemon>.fromOpaque(refcon).takeUnretainedValue()
                daemon.handleMouseEvent(event)
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
        let point = event.location  // Global CG coordinates
        let now = Date()

        // Compute velocity (pixels per second)
        let dt = now.timeIntervalSince(lastMoveTime)
        let dx = point.x - lastCursorPoint.x
        let dy = point.y - lastCursorPoint.y
        let dist = sqrt(dx * dx + dy * dy)
        let velocity = dt > 0 ? dist / dt : 0

        lastCursorPoint = point
        lastMoveTime = now

        // Reset settle timer
        cursorIdleTimer?.cancel()
        startSettleTimer()

        guard attention.hasSubscribers else { return }

        // -- Depth 0: cursor_moved --
        if attention.wantsContinuousCursor || attention.wantsOnChange {
            let displays = getDisplays()
            let displayOrdinal = displays.first(where: { $0.bounds.contains(point) })?.ordinal
                ?? displays.first(where: { $0.isMain })?.ordinal ?? 1

            let data = cursorMovedData(x: point.x, y: point.y, display: displayOrdinal, velocity: velocity)
            broadcastEvent("cursor_moved", data: data)
        }

        // -- Depth 1: window/app change detection --
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

        // cursor_settled event (depth 0)
        if attention.wantsOnSettle {
            let idleMs = Int(Date().timeIntervalSince(lastMoveTime) * 1000)
            let data = cursorSettledData(x: point.x, y: point.y, display: displayOrdinal, idle_ms: idleMs)
            broadcastEvent("cursor_settled", data: data)
        }

        // Depth 1 check on settle too
        if attention.maxDepth >= 1 {
            checkWindowAndAppChange(at: point)
        }

        // Depth 2: AX element at cursor
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

            // Window changed?
            if windowID != lastWindowID {
                lastWindowID = windowID
                let bundleID = appLookup[pid]?.bundleID
                let data = windowEnteredData(
                    window_id: windowID, app: ownerName, pid: Int(pid),
                    bundle_id: bundleID, bounds: Bounds(from: rect))
                broadcastEvent("window_entered", data: data)
            }

            // App changed?
            if pid != lastAppPID {
                lastAppPID = pid
                lastAppName = ownerName
                let bundleID = appLookup[pid]?.bundleID
                let data = appEnteredData(app: ownerName, pid: Int(pid), bundle_id: bundleID)
                broadcastEvent("app_entered", data: data)
            }

            break
        }
    }

    // MARK: - Depth 2: AX Element Query

    private func queryAXElementAtCursor(_ point: CGPoint) {
        guard AXIsProcessTrusted() else { return }
        guard lastAppPID > 0 else { return }

        if let hit = axElementAtPoint(pid: lastAppPID, point: point) {
            // Only emit if element changed
            let newRole = hit.role
            let newTitle = hit.title ?? ""
            if newRole != lastElementRole || newTitle != lastElementTitle {
                lastElementRole = newRole
                lastElementTitle = newTitle

                let data = elementFocusedData(
                    role: hit.role, title: hit.title, label: hit.label, value: hit.value,
                    bounds: hit.bounds.map { Bounds(from: $0) },
                    context_path: hit.contextPath)
                broadcastEvent("element_focused", data: data)
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
        // Store reference to prevent dealloc
        _appRefreshTimer = timer
    }
    private var _appRefreshTimer: DispatchSourceTimer?

    private func refreshAppLookup() {
        var lookup: [pid_t: (name: String, bundleID: String?)] = [:]
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            lookup[app.processIdentifier] = (name: app.localizedName ?? "unknown", bundleID: app.bundleIdentifier)
        }
        appLookup = lookup
    }

    // MARK: - Event Broadcasting

    private func broadcastEvent(_ event: String, data: [String: Any]) {
        guard let bytes = envelopeBytes(service: "perceive", event: event, data: data) else { return }

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
        subscribers[connectionID] = SubscriberConnection(fd: clientFD, channelIDs: [])
        subscriberLock.unlock()

        defer {
            subscriberLock.lock()
            if let conn = subscribers[connectionID] {
                attention.removeChannels(conn.channelIDs)
            }
            subscribers.removeValue(forKey: connectionID)
            subscriberLock.unlock()
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

                guard let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                      let action = json["action"] as? String else {
                    sendJSON(to: clientFD, ["error": "Invalid JSON", "code": "PARSE_ERROR"])
                    continue
                }

                switch action {
                case "subscribe":
                    // Legacy: simple subscribe (default depth from config)
                    let depth = json["depth"] as? Int ?? config.perception.default_depth
                    let scope = json["scope"] as? String ?? "cursor"
                    let rate = json["rate"] as? String ?? "on-settle"
                    let channelID = attention.addChannel(depth: depth, scope: scope, rate: rate)
                    subscriberLock.lock()
                    subscribers[connectionID]?.channelIDs.insert(channelID)
                    subscriberLock.unlock()
                    sendJSON(to: clientFD, ["status": "ok", "channel_id": channelID.uuidString])

                case "perceive":
                    // Open a perception channel with specific depth/scope/rate
                    let depth = json["depth"] as? Int ?? config.perception.default_depth
                    let scope = json["scope"] as? String ?? "cursor"
                    let rate = json["rate"] as? String ?? "on-settle"
                    let channelID = attention.addChannel(depth: depth, scope: scope, rate: rate)
                    subscriberLock.lock()
                    subscribers[connectionID]?.channelIDs.insert(channelID)
                    subscriberLock.unlock()
                    sendJSON(to: clientFD, ["status": "ok", "channel_id": channelID.uuidString])

                case "ping":
                    let uptime = Date().timeIntervalSince(startTime)
                    let channels = attention.channelCount
                    sendJSON(to: clientFD, ["status": "ok", "uptime": uptime, "channels": channels])

                default:
                    sendJSON(to: clientFD, ["error": "Unknown action: \(action)", "code": "UNKNOWN_ACTION"])
                }
            }
        }
    }

    // MARK: - Signal Handling

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

- [ ] **Step 2: Write `src/commands/serve.swift`**

```swift
// serve.swift — aos serve: start the unified daemon

import AppKit
import Foundation

func serveCommand(args: [String]) {
    let config = loadConfig()
    let daemon = PerceptionDaemon(config: config)
    daemon.start()

    // Run the main loop (needed for CGEventTap and NSApplication)
    NSApplication.shared.run()
}
```

- [ ] **Step 3: Remove serveCommand stub from main.swift**

Remove:
```swift
func serveCommand(args: [String]) { print("{\"status\":\"stub\",\"command\":\"serve\"}") }
```

- [ ] **Step 4: Build**

```bash
bash build.sh
```
Expected: Compiles with no errors.

- [ ] **Step 5: Test daemon starts**

```bash
./aos serve &
sleep 1
# Check socket exists
ls -la ~/.config/aos/sock
# Ping the daemon
echo '{"action":"ping"}' | nc -U ~/.config/aos/sock
kill %1
```
Expected: Socket file exists. Ping returns `{"status":"ok","uptime":...,"channels":0}`.

- [ ] **Step 6: Test perception subscription**

Start daemon, subscribe with depth 2, move cursor:
```bash
./aos serve &
sleep 1
# Subscribe and read events (timeout after 5s)
echo '{"action":"perceive","depth":2,"scope":"cursor","rate":"on-settle"}' | timeout 5 nc -U ~/.config/aos/sock || true
kill %1
```
Expected: After subscribing (get `{"status":"ok","channel_id":"..."}` response), moving the cursor produces `cursor_moved` events. Stopping the cursor produces `cursor_settled` and `element_focused` events.

- [ ] **Step 7: Commit**

```bash
git add src/perceive/daemon.swift src/commands/serve.swift src/main.swift
git commit -m "feat(perceive): perception daemon with depth 0-2 events

CGEventTap-based cursor monitoring, AX element query on cursor settle,
window/app change detection. Attention envelope manages subscriber
depth/scope/rate. Events published in daemon-event envelope format.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Observe Command + Set Command

**Files:**
- Create: `src/perceive/observe.swift`
- Create: `src/commands/set.swift`
- Modify: `src/main.swift` (remove remaining stubs)

### Purpose
`aos see observe` connects to the running daemon and streams perception events to stdout. `aos set` modifies the config file.

- [ ] **Step 1: Write `src/perceive/observe.swift`**

```swift
// observe.swift — aos see observe: subscribe to perception stream from daemon

import Foundation

/// aos see observe [--depth N] [--rate on-settle|on-change|continuous]
func observeCommand(args: [String]) {
    var depth = 2
    var rate = "on-settle"

    // Parse args
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--depth":
            i += 1
            guard i < args.count, let d = Int(args[i]), (0...3).contains(d) else {
                exitError("--depth requires 0-3", code: "INVALID_ARG")
            }
            depth = d
        case "--rate":
            i += 1
            guard i < args.count, ["continuous", "on-change", "on-settle"].contains(args[i]) else {
                exitError("--rate requires: continuous, on-change, on-settle", code: "INVALID_ARG")
            }
            rate = args[i]
        default:
            exitError("Unknown option: \(args[i])", code: "INVALID_ARG")
        }
        i += 1
    }

    // Connect to daemon
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { exitError("socket() failed", code: "SOCKET_ERROR") }

    let connectResult = withSockAddr(kAosSocketPath) { addr, len in connect(fd, addr, len) }
    guard connectResult == 0 else {
        exitError("Cannot connect to daemon at \(kAosSocketPath). Is 'aos serve' running?", code: "CONNECT_ERROR")
    }

    // Send perceive request
    let request: [String: Any] = ["action": "perceive", "depth": depth, "scope": "cursor", "rate": rate]
    guard let reqData = try? JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]) else {
        exitError("Failed to encode request", code: "ENCODE_ERROR")
    }
    var reqBytes = reqData
    reqBytes.append(contentsOf: "\n".utf8)
    reqBytes.withUnsafeBytes { ptr in _ = write(fd, ptr.baseAddress!, ptr.count) }

    // Read and print events until interrupted
    var buffer = Data()
    var chunk = [UInt8](repeating: 0, count: 4096)

    // Disable stdout buffering for real-time output
    setbuf(stdout, nil)

    while true {
        let bytesRead = read(fd, &chunk, chunk.count)
        guard bytesRead > 0 else {
            fputs("Daemon connection closed.\n", stderr)
            break
        }
        buffer.append(contentsOf: chunk[0..<bytesRead])

        while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
            buffer = Data(buffer[(buffer.index(after: newlineIndex))...])

            if let line = String(data: lineData, encoding: .utf8) {
                print(line)
            }
        }
    }

    close(fd)
}
```

- [ ] **Step 2: Write `src/commands/set.swift`**

```swift
// set.swift — aos set <key> <value>: modify autonomic configuration

import Foundation

func setCommand(args: [String]) {
    guard args.count >= 2 else {
        let config = loadConfig()
        print(jsonString(config))
        return
    }

    let key = args[0]
    let value = args[1]
    setConfigValue(key: key, value: value)
}
```

- [ ] **Step 3: Remove remaining stubs from main.swift**

Remove these lines from `src/main.swift`:
```swift
func observeCommand(args: [String]) { print("{\"status\":\"stub\",\"command\":\"observe\"}") }
func setCommand(args: [String]) { print("{\"status\":\"stub\",\"command\":\"set\"}") }
```

- [ ] **Step 4: Build and test set command**

```bash
bash build.sh
./aos set perception.default_depth 2
cat ~/.config/aos/config.json
```
Expected: Config file is created/updated. JSON output shows the updated config.

- [ ] **Step 5: Test observe command**

```bash
# Terminal 1: start daemon
./aos serve &
sleep 1

# Terminal 2: observe (will print events as you move cursor)
./aos see observe --depth 2 --rate on-settle &
sleep 3

# Move cursor around, then check
kill %2  # stop observe
kill %1  # stop daemon
```
Expected: `observe` connects and prints perception events to stdout as ndjson lines. Moving cursor produces events. Stopping cursor produces `cursor_settled` and `element_focused`.

- [ ] **Step 6: Test config affects daemon**

```bash
./aos set perception.settle_threshold_ms 500
./aos serve &
sleep 1
# Observe — settle events should come after 500ms instead of 200ms
./aos see observe --depth 2 &
sleep 3
kill %2; kill %1
```
Expected: Settle threshold changes behavior.

- [ ] **Step 7: Commit**

```bash
git add src/perceive/observe.swift src/commands/set.swift src/main.swift
git commit -m "feat(aos): observe command and set command

aos see observe streams perception events from daemon to stdout.
aos set modifies config.json for autonomic settings.
Removes all temporary stubs — binary is fully functional.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Integration Verification + Documentation

**Files:**
- Create: `src/CLAUDE.md`
- Modify: root `CLAUDE.md` (add aos to structure)

### Purpose
End-to-end integration testing and documentation update. Verify the full workflow works.

- [ ] **Step 1: Full integration test sequence**

```bash
# Clean build
bash build.sh

# 1. One-shot cursor (no daemon)
./aos see cursor | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'cursor' in d and 'display' in d; print('PASS: cursor')"

# 2. Config management
./aos set perception.default_depth 2
./aos set perception.settle_threshold_ms 200
./aos set | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['perception']['default_depth']==2; print('PASS: config')"

# 3. Daemon lifecycle
./aos serve &
DAEMON_PID=$!
sleep 1

# 4. Ping
echo '{"action":"ping"}' | nc -U ~/.config/aos/sock | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok'; print('PASS: ping')"

# 5. Observe (brief)
timeout 3 ./aos see observe --depth 2 --rate continuous > /tmp/aos-events.txt 2>&1 || true
EVENT_COUNT=$(wc -l < /tmp/aos-events.txt)
echo "Events captured: $EVENT_COUNT"

# 6. Clean shutdown
kill $DAEMON_PID 2>/dev/null || true
sleep 1
[ ! -S ~/.config/aos/sock ] && echo "PASS: socket cleaned up" || echo "WARN: socket still exists"
```

- [ ] **Step 2: Write `src/CLAUDE.md`**

```markdown
# aos — Agent Operating System

Unified binary for macOS perception, display, action, and voice.

## Build

```bash
bash build.sh
# or manually:
find src -name '*.swift' | xargs swiftc -parse-as-library -O -o aos
```

Requires macOS 14+ and Accessibility permission.

## Usage

### One-Shot Commands (no daemon needed)

```bash
aos see cursor          # What's under the cursor
aos set voice.enabled true  # Configure autonomic settings
```

### Daemon Mode

```bash
aos serve               # Start unified daemon
aos see observe --depth 2   # Stream perception events
```

### Config

Config file: `~/.config/aos/config.json`
Socket: `~/.config/aos/sock`

## Architecture

```
src/
  main.swift          # Entry point, subcommand routing
  shared/             # Helpers, envelope, config, types
  perceive/           # Perception module (cursor, daemon, AX, events)
  commands/           # serve, set
```

### Perception Daemon

The daemon monitors cursor position via CGEventTap and queries the
AX tree on cursor settle. Events are published in the standard
daemon-event envelope format to subscribers over Unix socket.

Depth levels:
- 0: Cursor position + display
- 1: Window + app identification
- 2: AX element at cursor (role, title, label, bounds)

### Spec

See `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md`
```

- [ ] **Step 3: Update root CLAUDE.md**

Add `src/` to the Structure section:

```
src/              AOS unified binary source (perception, display, action, voice)
```

- [ ] **Step 4: Commit**

```bash
git add src/CLAUDE.md CLAUDE.md
git commit -m "docs(aos): add CLAUDE.md for unified binary, update root structure

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Dependency Graph

```
Task 1 (Foundation + Skeleton)
  ├── Task 2 (AX + Models) ─── Task 3 (Cursor Command)
  ├── Task 4 (Attention + Events)
  └── Task 5 (Perception Daemon) ──── Task 6 (Observe + Set)
                                           └── Task 7 (Integration + Docs)
```

Tasks 2 and 4 can run in parallel after Task 1. Task 3 depends on Task 2. Task 5 depends on Tasks 2 and 4. Task 6 depends on Task 5. Task 7 is last.
