# hand-off v2 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform hand-off from a stateless CLI (single `main.swift`, 820 lines) into a session-mode actuator with behavioral profiles, context operator, overhauled AX targeting, and new CGEvent primitives — implementing Phase 1 of the hand-off v2 spec.

**Architecture:** Split monolithic `main.swift` into focused files following the heads-up pattern (flat `.swift` files compiled with `swiftc -parse-as-library *.swift`). Session mode reads ndjson from stdin, maintains cursor/modifier/context state, dispatches to action handlers, writes ndjson responses. Profiles drive timing and mouse curves. Context enables window-relative coordinates. All existing CLI commands preserved and enhanced.

**Tech Stack:** Pure Swift (no SPM), macOS 14+. ApplicationServices (AX API), CoreGraphics (CGEvent), AppKit (NSRunningApplication), Foundation (JSON, file I/O, NSAppleScript).

**Spec:** `docs/superpowers/specs/2026-04-01-hand-off-v2-and-focus-channels.md` (Phase 1 only, Sections 4.1–4.7)

---

## File Structure

```
packages/hand-off/
  main.swift          ← REWRITE: entry point only (CLI dispatch + session start)
  models.swift        ← CREATE: all shared types (responses, targeting, profile schema, session state)
  helpers.swift       ← CREATE: JSON output, key code mapping, arg parsing, math utilities
  targeting.swift     ← CREATE: findElement overhaul (multi-field, match modes, near, depth/timeout, subtree)
  profiles.swift      ← CREATE: profile loading, timing distributions, Bezier curve generation, profile CLI
  context.swift       ← CREATE: context state management, coordinate conversion via CGWindowListCopyWindowInfo
  session.swift       ← CREATE: stdin/stdout ndjson loop, state machine, action dispatch
  actions.swift       ← CREATE: all action handlers (CGEvent, AX, AppleScript, meta)
  cli.swift           ← CREATE: standalone CLI command parsing + dispatch (preserves v1 interface)
  build.sh            ← MODIFY: compile *.swift instead of main.swift
```

---

## Parallelization Map

```
Task 1: Foundation (models + helpers + build.sh)     ← SEQUENTIAL, must be first
    │
    ├── Task 2: Targeting (targeting.swift)           ← PARALLEL
    ├── Task 3: Profiles (profiles.swift)             ← PARALLEL
    └── Task 4: Context (context.swift)               ← PARALLEL
         │
         ├── Task 5: Actions (actions.swift)          ← PARALLEL (after 2,3,4)
         └── Task 6: Session (session.swift)          ← PARALLEL (after 2,3,4)
              │
              Task 7: CLI + Entry Point               ← SEQUENTIAL (after all)
              Task 8: Integration Tests               ← SEQUENTIAL (after 7)
```

**Agent team dispatch:**
- After Task 1: dispatch 3 agents in parallel (Tasks 2, 3, 4)
- After Tasks 2-4: dispatch 2 agents in parallel (Tasks 5, 6)
- Tasks 7-8: sequential in main session

---

## Task 1: Foundation — models.swift + helpers.swift + build.sh

**Files:**
- Create: `packages/hand-off/models.swift`
- Create: `packages/hand-off/helpers.swift`
- Modify: `packages/hand-off/build.sh`
- Modify: `packages/hand-off/main.swift` (strip to stub for compilation)

This task defines every shared type. All subsequent tasks depend on these exact type definitions.

- [ ] **Step 1: Create models.swift with all shared types**

```swift
// models.swift — Shared types for hand-off v2
// All response, request, targeting, profile, and state types live here.

import CoreGraphics
import Foundation

// MARK: - Session Action Request (ndjson input)

/// Decoded from each line of stdin in session mode.
struct ActionRequest: Codable {
    let action: String

    // Coordinate fields (CGEvent actions)
    var x: Double?
    var y: Double?
    var dx: Double?
    var dy: Double?
    var from: CursorPosition?
    var button: String?           // "left" | "right"
    var count: Int?               // click count

    // Text/key fields
    var text: String?
    var key: String?

    // AX targeting fields
    var pid: Int?
    var role: String?
    var title: String?
    var label: String?
    var identifier: String?
    var value: String?
    var index: Int?
    var near: [Double]?           // [x, y]
    var match: String?            // "exact" | "contains" | "regex"

    // AX tree controls
    var depth: Int?
    var timeout: Int?             // milliseconds

    // Context fields
    var set: ContextFields?
    var clear: Bool?

    // AppleScript
    var app: String?
    var script: String?

    // Window targeting
    var window_id: Int?

    // Phase 2 placeholder
    var channel: String?
}

struct ContextFields: Codable {
    var pid: Int?
    var app: String?
    var window_id: Int?
    var coordinate_space: String? // "global" | "window"
    var scale_factor: Double?
    var subtree: SubtreeSpec?
}

struct SubtreeSpec: Codable {
    var role: String?
    var title: String?
    var identifier: String?
}

// MARK: - Session Action Response (ndjson output)

struct ActionResponse: Encodable {
    let status: String            // "ok" | "error"
    let action: String
    var cursor: CursorPosition?
    var modifiers: [String]?
    var context: ContextSnapshot?
    var duration_ms: Int?

    // Error fields
    var error: String?
    var code: String?

    // Status-specific
    var profile: String?
    var session_uptime_s: Double?
    var bound_channel: String?

    // Element count (for bind)
    var elements_count: Int?
}

struct CursorPosition: Codable {
    let x: Double
    let y: Double
}

struct ContextSnapshot: Codable {
    var pid: Int?
    var app: String?
    var window_id: Int?
    var coordinate_space: String?
    var scale_factor: Double?
}

// MARK: - Session State

/// Mutable state maintained across a session's lifetime.
class SessionState {
    var cursor: CursorPosition
    var modifiers: Set<String> = []
    var context: SessionContext = SessionContext()
    var profileName: String
    var profile: BehaviorProfile
    var startTime: Date = Date()

    init(profile: BehaviorProfile, profileName: String) {
        // Get current cursor position from CGEvent
        let pos = CGEvent(source: nil)?.location ?? .zero
        self.cursor = CursorPosition(x: pos.x, y: pos.y)
        self.profile = profile
        self.profileName = profileName
    }

    func updateCursor(_ point: CGPoint) {
        cursor = CursorPosition(x: Double(point.x), y: Double(point.y))
    }

    func contextSnapshot() -> ContextSnapshot? {
        guard context.pid != nil else { return nil }
        return ContextSnapshot(
            pid: context.pid,
            app: context.app,
            window_id: context.window_id,
            coordinate_space: context.coordinate_space,
            scale_factor: context.scale_factor
        )
    }
}

struct SessionContext {
    var pid: Int?
    var app: String?
    var window_id: Int?
    var coordinate_space: String = "global"
    var scale_factor: Double = 1.0
    var subtree: SubtreeSpec?

    mutating func apply(_ fields: ContextFields) {
        if let v = fields.pid { pid = v }
        if let v = fields.app { app = v }
        if let v = fields.window_id { window_id = v }
        if let v = fields.coordinate_space { coordinate_space = v }
        if let v = fields.scale_factor { scale_factor = v }
        if let v = fields.subtree { subtree = v }
    }

    mutating func clear() {
        pid = nil; app = nil; window_id = nil
        coordinate_space = "global"; scale_factor = 1.0
        subtree = nil
    }
}

// MARK: - Behavioral Profile

struct BehaviorProfile: Codable {
    var name: String
    var description: String?
    var timing: TimingProfile
    var mouse: MouseProfile
    var scroll: ScrollProfile
    var ax: AXProfile

    static let natural = BehaviorProfile(
        name: "natural",
        description: "Default human-like feel — moderate speed, natural variance",
        timing: TimingProfile(
            keystroke_delay: DelayRange(min: 80, max: 250, distribution: "gaussian"),
            typing_cadence: TypingCadence(wpm: 65, variance: 0.3, pause_after_word: DelayRange(min: 30, max: 150)),
            click_dwell: DelayRange(min: 40, max: 120),
            action_gap: DelayRange(min: 100, max: 400)
        ),
        mouse: MouseProfile(pixels_per_second: 800, curve: "bezier", jitter: 2, overshoot: 0.05),
        scroll: ScrollProfile(events_per_action: 4, deceleration: 0.7, interval_ms: 30),
        ax: AXProfile(depth: 20, timeout: 5000)
    )
}

struct TimingProfile: Codable {
    var keystroke_delay: DelayRange
    var typing_cadence: TypingCadence
    var click_dwell: DelayRange
    var action_gap: DelayRange
}

struct DelayRange: Codable {
    var min: Int
    var max: Int
    var distribution: String?     // "gaussian" | "uniform"
}

struct TypingCadence: Codable {
    var wpm: Int
    var variance: Double
    var pause_after_word: DelayRange?
}

struct MouseProfile: Codable {
    var pixels_per_second: Double
    var curve: String             // "bezier" | "linear"
    var jitter: Double
    var overshoot: Double
}

struct ScrollProfile: Codable {
    var events_per_action: Int
    var deceleration: Double
    var interval_ms: Int
}

struct AXProfile: Codable {
    var depth: Int
    var timeout: Int              // milliseconds
}

// MARK: - AX Targeting

enum MatchMode: String {
    case exact = "exact"
    case contains = "contains"
    case regex = "regex"
}

/// All fields that can identify an AX element.
struct ElementQuery {
    var pid: pid_t
    var role: String?
    var title: String?
    var label: String?
    var identifier: String?
    var value: String?
    var index: Int?
    var near: CGPoint?
    var matchMode: MatchMode = .exact
    var maxDepth: Int = 20
    var timeoutMs: Int = 5000
    var subtree: SubtreeSpec?

    /// Build from an ActionRequest + session context.
    init(from req: ActionRequest, context: SessionContext, profile: BehaviorProfile) {
        self.pid = pid_t(req.pid ?? context.pid ?? 0)
        self.role = req.role
        self.title = req.title
        self.label = req.label
        self.identifier = req.identifier
        self.value = req.value
        self.index = req.index
        if let near = req.near, near.count == 2 {
            self.near = CGPoint(x: near[0], y: near[1])
        }
        self.matchMode = MatchMode(rawValue: req.match ?? "exact") ?? .exact
        self.maxDepth = req.depth ?? profile.ax.depth
        self.timeoutMs = req.timeout ?? profile.ax.timeout
        self.subtree = req.subtree ?? context.subtree
    }
}

// MARK: - CLI v1 Compatibility (standalone mode)

/// Used only by the standalone CLI commands (backward compat with v1).
struct LegacySuccessResponse: Encodable {
    let status: String
    let action: String
    let backend: String
    let target: LegacyTargetInfo
    var detail: String?
}

struct LegacyTargetInfo: Encodable {
    var pid: Int?
    var role: String?
    var title: String?
    var index: Int?
    var x: Double?
    var y: Double?
    var x2: Double?
    var y2: Double?
    var app: String?
    var script: String?
    var window_id: Int?
    var width: Double?
    var height: Double?
    var text: String?
    var keys: String?
}
```

- [ ] **Step 2: Create helpers.swift with shared utilities**

```swift
// helpers.swift — JSON output, key codes, arg parsing, math utilities

import CoreGraphics
import Foundation

// MARK: - JSON Output

let jsonEncoder: JSONEncoder = {
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    return enc
}()

func writeJSON<T: Encodable>(_ value: T, to handle: FileHandle = .standardOutput) {
    guard let data = try? jsonEncoder.encode(value),
          let s = String(data: data, encoding: .utf8) else { return }
    handle.write((s + "\n").data(using: .utf8)!)
}

func exitWithError(_ message: String, code: String) -> Never {
    let obj: [String: String] = ["error": message, "code": code]
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
    }
    exit(1)
}

// MARK: - Arg Parsing (CLI mode)

func getArg(_ args: [String], _ flag: String) -> String? {
    guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

func hasFlag(_ args: [String], _ flag: String) -> Bool {
    args.contains(flag)
}

func parseInt(_ s: String?) -> Int? {
    guard let s = s else { return nil }
    return Int(s)
}

func parseDouble(_ s: String?) -> Double? {
    guard let s = s else { return nil }
    return Double(s)
}

func parseCoords(_ s: String) -> (Double, Double)? {
    let parts = s.split(separator: ",").map(String.init)
    guard parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) else { return nil }
    return (x, y)
}

// MARK: - Key Code Mapping

let keyCodeMap: [String: CGKeyCode] = [
    // Letters
    "a": 0x00, "b": 0x0B, "c": 0x08, "d": 0x02, "e": 0x0E,
    "f": 0x03, "g": 0x05, "h": 0x04, "i": 0x22, "j": 0x26,
    "k": 0x28, "l": 0x25, "m": 0x2E, "n": 0x2D, "o": 0x1F,
    "p": 0x23, "q": 0x0C, "r": 0x0F, "s": 0x01, "t": 0x11,
    "u": 0x20, "v": 0x09, "w": 0x0D, "x": 0x07, "y": 0x10,
    "z": 0x06,
    // Numbers
    "0": 0x1D, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15,
    "5": 0x17, "6": 0x16, "7": 0x1A, "8": 0x1C, "9": 0x19,
    // Special keys
    "return": 0x24, "enter": 0x24, "tab": 0x30, "space": 0x31,
    "delete": 0x33, "backspace": 0x33, "escape": 0x35, "esc": 0x35,
    "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C,
    "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
    "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76,
    "f5": 0x60, "f6": 0x61, "f7": 0x62, "f8": 0x64,
    "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
    // Punctuation
    "-": 0x1B, "=": 0x18, "[": 0x21, "]": 0x1E,
    "\\": 0x2A, ";": 0x29, "'": 0x27, ",": 0x2B,
    ".": 0x2F, "/": 0x2C, "`": 0x32,
]

/// Modifier name → (CGKeyCode for key_down/key_up, CGEventFlags for flag masking)
let modifierMap: [String: (keyCode: CGKeyCode, flag: CGEventFlags)] = [
    "cmd":     (0x37, .maskCommand),
    "command": (0x37, .maskCommand),
    "shift":   (0x38, .maskShift),
    "alt":     (0x3A, .maskAlternate),
    "option":  (0x3A, .maskAlternate),
    "opt":     (0x3A, .maskAlternate),
    "ctrl":    (0x3B, .maskControl),
    "control": (0x3B, .maskControl),
    "fn":      (0x3F, .maskSecondaryFn),
]

/// Parse "cmd+shift+tab" → (keyCode, flags) for the non-modifier key, with modifier flags combined.
func parseKeyCombo(_ combo: String) -> (CGKeyCode, CGEventFlags)? {
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    var flags: CGEventFlags = []
    var keyName: String?

    for part in parts {
        if let mod = modifierMap[part] {
            flags.insert(mod.flag)
        } else {
            keyName = part
        }
    }

    guard let key = keyName, let keyCode = keyCodeMap[key] else { return nil }
    return (keyCode, flags)
}

/// Resolve a key name to its CGKeyCode. Returns nil for modifiers (they don't have standalone key codes in this context).
func keyCodeForName(_ name: String) -> CGKeyCode? {
    if let code = keyCodeMap[name] { return code }
    if let mod = modifierMap[name] { return mod.keyCode }
    return nil
}

/// Modifier name → CGEventFlags (for building the flags mask from held modifiers).
func flagsForModifier(_ name: String) -> CGEventFlags? {
    return modifierMap[name]?.flag
}

// MARK: - Timing Math

/// Sample a random delay from a DelayRange using the specified distribution.
func sampleDelay(_ range: DelayRange) -> UInt32 {
    let lo = Double(range.min)
    let hi = Double(range.max)
    guard lo < hi else { return UInt32(lo) * 1000 }

    let value: Double
    switch range.distribution {
    case "gaussian":
        // Box-Muller transform, clamped to [min, max]
        let mid = (lo + hi) / 2.0
        let sigma = (hi - lo) / 6.0 // 99.7% within range
        let u1 = Double.random(in: 0.001...1.0)
        let u2 = Double.random(in: 0.0...1.0)
        let z = sqrt(-2.0 * log(u1)) * cos(2.0 * .pi * u2)
        value = min(hi, max(lo, mid + z * sigma))
    default: // "uniform" or unspecified
        value = Double.random(in: lo...hi)
    }
    return UInt32(value) * 1000 // convert ms → microseconds for usleep
}

// MARK: - Bezier Curve Math

/// Generate points along a cubic Bezier from `start` to `end` with overshoot and jitter.
func bezierPath(from start: CGPoint, to end: CGPoint, steps: Int, overshoot: Double, jitter: Double) -> [CGPoint] {
    guard steps > 0 else { return [end] }

    let dx = end.x - start.x
    let dy = end.y - start.y
    let dist = sqrt(dx * dx + dy * dy)
    guard dist > 1.0 else { return [end] }

    // Control points: offset perpendicular to the line for a natural curve
    let perpX = -dy / dist
    let perpY = dx / dist
    let curvature = Double.random(in: 0.1...0.4) * dist
    let side: Double = Bool.random() ? 1.0 : -1.0

    let cp1 = CGPoint(
        x: start.x + dx * 0.3 + perpX * curvature * side,
        y: start.y + dy * 0.3 + perpY * curvature * side
    )

    // Overshoot target
    let overshootDist = dist * overshoot
    let overshootTarget = CGPoint(
        x: end.x + (dx / dist) * overshootDist,
        y: end.y + (dy / dist) * overshootDist
    )
    let cp2 = CGPoint(
        x: overshootTarget.x - dx * 0.1,
        y: overshootTarget.y - dy * 0.1
    )

    var points: [CGPoint] = []
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let u = 1.0 - t
        // Cubic Bezier: B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
        let bx = u*u*u*Double(start.x) + 3*u*u*t*Double(cp1.x) + 3*u*t*t*Double(cp2.x) + t*t*t*Double(end.x)
        let by = u*u*u*Double(start.y) + 3*u*u*t*Double(cp1.y) + 3*u*t*t*Double(cp2.y) + t*t*t*Double(end.y)

        // Add jitter (Gaussian)
        let jx = jitter > 0 ? Double.random(in: -jitter...jitter) : 0
        let jy = jitter > 0 ? Double.random(in: -jitter...jitter) : 0

        points.append(CGPoint(x: bx + jx, y: by + jy))
    }

    // Final point is exactly the target (no jitter)
    if !points.isEmpty {
        points[points.count - 1] = end
    }

    return points
}

// MARK: - AX Helpers

func axString(_ element: AXUIElement, _ attr: String) -> String? {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &ref) == .success else { return nil }
    return ref as? String
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &ref) == .success,
          let children = ref as? [AXUIElement] else { return [] }
    return children
}

func axActions(_ element: AXUIElement) -> [String] {
    var ref: CFArray?
    guard AXUIElementCopyActionNames(element, &ref) == .success,
          let names = ref as? [String] else { return [] }
    return names
}

func axBounds(_ element: AXUIElement) -> CGRect? {
    var posRef: AnyObject?
    var sizeRef: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success else {
        return nil
    }
    var pos = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(posRef as! AXValue, .cgPoint, &pos),
          AXValueGetValue(sizeRef as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: pos, size: size)
}

// Undocumented but stable API to get CGWindowID from AXUIElement
@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ windowID: UnsafeMutablePointer<CGWindowID>) -> AXError

/// Find a window by CGWindowID for a given pid.
func findWindowByID(pid: pid_t, windowID: Int) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &ref) == .success,
          let windows = ref as? [AXUIElement] else { return nil }
    for win in windows {
        var winID: CGWindowID = 0
        if _AXUIElementGetWindow(win, &winID) == .success && Int(winID) == windowID {
            return win
        }
    }
    return nil
}

/// Find the first window for a given pid.
func findFirstWindow(pid: pid_t) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &ref) == .success,
          let windows = ref as? [AXUIElement], let first = windows.first else { return nil }
    return first
}

// MARK: - Window Origin Lookup

/// Get a window's origin in global CG coordinates via CGWindowListCopyWindowInfo.
func windowOrigin(windowID: Int) -> CGPoint? {
    guard let infoList = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(windowID)) as? [[String: Any]],
          let info = infoList.first,
          let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
          let x = boundsDict["X"] as? Double,
          let y = boundsDict["Y"] as? Double else { return nil }
    return CGPoint(x: x, y: y)
}
```

- [ ] **Step 3: Update build.sh to compile all Swift files**

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Compiling hand-off..."
swiftc -parse-as-library -O -o hand-off *.swift

echo "Done: ./hand-off ($(du -h hand-off | cut -f1 | xargs))"
```

- [ ] **Step 4: Replace main.swift with a minimal stub**

Replace the entire contents of `main.swift` with a stub that compiles alongside the new files. The full entry point is written in Task 7; this stub just ensures `build.sh` works after Task 1.

```swift
// main.swift — Entry point (stub, replaced in Task 7)

import Foundation

@_cdecl("main")
func entryPoint(_ argc: Int32, _ argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    let args = Array(CommandLine.arguments.dropFirst())
    if args.isEmpty || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
        print("hand-off v2 — macOS actuator. Build in progress.")
    } else {
        print("Command dispatch not yet wired. See Task 7.")
    }
    return 0
}
```

- [ ] **Step 5: Build to verify compilation**

Run: `cd packages/hand-off && bash build.sh`
Expected: compiles with no errors. May produce warnings about unused code — that's fine.

- [ ] **Step 6: Commit**

```bash
git add packages/hand-off/models.swift packages/hand-off/helpers.swift packages/hand-off/build.sh packages/hand-off/main.swift
git commit -m "refactor(hand-off): split v1 into multi-file foundation — models, helpers, build"
```

---

## Task 2: AX Targeting Overhaul — targeting.swift

**Files:**
- Create: `packages/hand-off/targeting.swift`

**Depends on:** Task 1 (models.swift, helpers.swift)

**Spec reference:** Section 4.5 — AX Targeting Overhaul

This is the new `findElement` that supports all identity fields, match modes, `near` disambiguation, depth/timeout limits, and subtree scoping. The old `findElement` (role + optional title + optional index, unlimited depth, no timeout) is replaced entirely.

- [ ] **Step 1: Create targeting.swift with the full findElement implementation**

```swift
// targeting.swift — AX element targeting with multi-field matching, near, depth, timeout, subtree

import ApplicationServices
import CoreGraphics
import Foundation

/// Result of an element search.
enum FindResult {
    case found(AXUIElement)
    case notFound(String)  // human-readable reason
    case timeout
}

/// Find an AX element matching the query criteria.
/// BFS traversal with depth limit and wall-clock timeout.
func findElement(query: ElementQuery) -> FindResult {
    guard query.pid != 0 else {
        return .notFound("pid is 0 or not set")
    }

    let app = AXUIElementCreateApplication(query.pid)
    let deadline = Date().addingTimeInterval(Double(query.timeoutMs) / 1000.0)

    // Determine search root: subtree or app root
    let searchRoot: AXUIElement
    if let subtree = query.subtree {
        // Find the subtree root first
        let subtreeQuery = ElementQuery(
            pid: query.pid,
            role: subtree.role,
            title: subtree.title,
            identifier: subtree.identifier,
            matchMode: .exact,
            maxDepth: query.maxDepth,
            timeoutMs: query.timeoutMs
        )
        switch findElementBFS(root: app, query: subtreeQuery, deadline: deadline) {
        case .found(let el):
            searchRoot = el
        case .notFound(let reason):
            return .notFound("Subtree root not found: \(reason)")
        case .timeout:
            return .timeout
        }
    } else {
        searchRoot = app
    }

    return findElementBFS(root: searchRoot, query: query, deadline: deadline)
}

private func findElementBFS(root: AXUIElement, query: ElementQuery, deadline: Date) -> FindResult {
    struct QueueEntry {
        let element: AXUIElement
        let depth: Int
    }

    var queue: [QueueEntry] = [QueueEntry(element: root, depth: 0)]
    var matches: [(element: AXUIElement, bounds: CGRect?)] = []

    while !queue.isEmpty {
        // Check timeout
        if Date() > deadline {
            return .timeout
        }

        let entry = queue.removeFirst()

        // Check depth limit
        if entry.depth > query.maxDepth {
            continue
        }

        // Test this element against criteria
        if elementMatches(entry.element, query: query) {
            let bounds = query.near != nil ? axBounds(entry.element) : nil
            matches.append((entry.element, bounds))

            // If no near/index, first match wins
            if query.near == nil && query.index == nil {
                return .found(entry.element)
            }

            // If index specified and we have enough matches, stop
            if let idx = query.index, matches.count > idx {
                return .found(matches[idx].element)
            }
        }

        // Enqueue children
        let children = axChildren(entry.element)
        for child in children {
            queue.append(QueueEntry(element: child, depth: entry.depth + 1))
        }
    }

    // Post-processing
    if matches.isEmpty {
        return .notFound(describeQuery(query))
    }

    if let idx = query.index {
        if idx < matches.count {
            return .found(matches[idx].element)
        }
        return .notFound("\(describeQuery(query)) — only \(matches.count) matches, index \(idx) out of range")
    }

    if let nearPoint = query.near {
        // Pick the match whose bounds center is closest to nearPoint
        var best: AXUIElement?
        var bestDist = Double.infinity
        for m in matches {
            guard let b = m.bounds ?? axBounds(m.element) else { continue }
            let cx = Double(b.midX)
            let cy = Double(b.midY)
            let dist = hypot(cx - Double(nearPoint.x), cy - Double(nearPoint.y))
            if dist < bestDist {
                bestDist = dist
                best = m.element
            }
        }
        if let best = best {
            return .found(best)
        }
        return .notFound("\(describeQuery(query)) — \(matches.count) matches but none have computable bounds for near disambiguation")
    }

    return .found(matches[0].element)
}

/// Test whether a single element matches all query criteria (excluding near/index which are post-filters).
private func elementMatches(_ element: AXUIElement, query: ElementQuery) -> Bool {
    // Role check (if specified)
    if let role = query.role {
        let actual = axString(element, kAXRoleAttribute) ?? ""
        if actual != role { return false }
    }

    // Title check
    if let title = query.title {
        let actual = axString(element, kAXTitleAttribute) ?? ""
        if !stringMatches(actual, pattern: title, mode: query.matchMode) { return false }
    }

    // Label check (AXDescription)
    if let label = query.label {
        let actual = axString(element, kAXDescriptionAttribute) ?? ""
        if !stringMatches(actual, pattern: label, mode: query.matchMode) { return false }
    }

    // Identifier check
    if let identifier = query.identifier {
        let actual = axString(element, "AXIdentifier") ?? ""
        if !stringMatches(actual, pattern: identifier, mode: query.matchMode) { return false }
    }

    // Value check
    if let value = query.value {
        let actual = axString(element, kAXValueAttribute) ?? ""
        if !stringMatches(actual, pattern: value, mode: query.matchMode) { return false }
    }

    return true
}

/// String matching with mode support.
private func stringMatches(_ actual: String, pattern: String, mode: MatchMode) -> Bool {
    switch mode {
    case .exact:
        return actual == pattern
    case .contains:
        return actual.localizedCaseInsensitiveContains(pattern)
    case .regex:
        return (try? Regex(pattern).firstMatch(in: actual)) != nil
    }
}

/// Human-readable description of a query for error messages.
private func describeQuery(_ query: ElementQuery) -> String {
    var parts: [String] = []
    if let r = query.role { parts.append("role=\(r)") }
    if let t = query.title { parts.append("title=\(t)") }
    if let l = query.label { parts.append("label=\(l)") }
    if let i = query.identifier { parts.append("identifier=\(i)") }
    if let v = query.value { parts.append("value=\(v)") }
    if let idx = query.index { parts.append("index=\(idx)") }
    if query.matchMode != .exact { parts.append("match=\(query.matchMode.rawValue)") }
    return parts.isEmpty ? "(no criteria)" : parts.joined(separator: " ")
}
```

An `init` convenience that doesn't require `ActionRequest` is needed for the subtree search and for CLI mode. Add this to the `ElementQuery` struct definition — but since `ElementQuery` is in `models.swift`, the agent should add this as an extension in `targeting.swift`:

```swift
extension ElementQuery {
    /// Direct init for internal use (subtree search, CLI commands).
    init(pid: pid_t, role: String? = nil, title: String? = nil, label: String? = nil,
         identifier: String? = nil, value: String? = nil, index: Int? = nil,
         near: CGPoint? = nil, matchMode: MatchMode = .exact,
         maxDepth: Int = 20, timeoutMs: Int = 5000, subtree: SubtreeSpec? = nil) {
        self.pid = pid
        self.role = role
        self.title = title
        self.label = label
        self.identifier = identifier
        self.value = value
        self.index = index
        self.near = near
        self.matchMode = matchMode
        self.maxDepth = maxDepth
        self.timeoutMs = timeoutMs
        self.subtree = subtree
    }
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd packages/hand-off && bash build.sh`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add packages/hand-off/targeting.swift
git commit -m "feat(hand-off): AX targeting overhaul — multi-field, match modes, near, depth/timeout, subtree"
```

---

## Task 3: Behavioral Profiles — profiles.swift

**Files:**
- Create: `packages/hand-off/profiles.swift`

**Depends on:** Task 1 (models.swift, helpers.swift)

**Spec reference:** Section 4.6 — Behavioral Profiles

- [ ] **Step 1: Create profiles.swift with loading, discovery, and CLI commands**

```swift
// profiles.swift — Profile loading, discovery, and CLI subcommands

import Foundation

// MARK: - Profile Loading

let profileDirectory = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".config/hand-off/profiles")

/// Load a profile by name. Checks user directory first, falls back to built-in.
func loadProfile(name: String) -> BehaviorProfile? {
    // User profiles override built-ins
    let userFile = profileDirectory.appendingPathComponent("\(name).json")
    if FileManager.default.fileExists(atPath: userFile.path),
       let data = try? Data(contentsOf: userFile),
       let profile = try? JSONDecoder().decode(BehaviorProfile.self, from: data) {
        return profile
    }

    // Built-in profiles
    if name == "natural" {
        return .natural
    }

    return nil
}

/// List all available profiles (user + built-in).
func listProfiles() -> [(name: String, description: String?, source: String)] {
    var profiles: [(name: String, description: String?, source: String)] = []
    var seen: Set<String> = []

    // User profiles
    if let files = try? FileManager.default.contentsOfDirectory(at: profileDirectory, includingPropertiesForKeys: nil) {
        for file in files where file.pathExtension == "json" {
            let name = file.deletingPathExtension().lastPathComponent
            if let data = try? Data(contentsOf: file),
               let profile = try? JSONDecoder().decode(BehaviorProfile.self, from: data) {
                profiles.append((name: name, description: profile.description, source: "user"))
                seen.insert(name)
            }
        }
    }

    // Built-in profiles (only if not overridden)
    if !seen.contains("natural") {
        profiles.append((name: "natural", description: BehaviorProfile.natural.description, source: "built-in"))
    }

    return profiles.sorted { $0.name < $1.name }
}

// MARK: - Profile CLI Subcommands

/// `hand-off profiles` — list all profiles
func profilesListCommand() {
    let profiles = listProfiles()
    if profiles.isEmpty {
        print("No profiles found.")
        return
    }
    // JSON array output
    let entries = profiles.map { entry -> [String: String] in
        var d: [String: String] = ["name": entry.name, "source": entry.source]
        if let desc = entry.description { d["description"] = desc }
        return d
    }
    if let data = try? JSONSerialization.data(withJSONObject: entries, options: [.prettyPrinted, .sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

/// `hand-off profiles show <name>` — dump full profile JSON
func profilesShowCommand(name: String) {
    guard let profile = loadProfile(name: name) else {
        exitWithError("Profile not found: \(name)", code: "PROFILE_NOT_FOUND")
    }
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? enc.encode(profile), let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd packages/hand-off && bash build.sh`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add packages/hand-off/profiles.swift
git commit -m "feat(hand-off): behavioral profiles — loading, discovery, natural default, CLI commands"
```

---

## Task 4: Context Operator — context.swift

**Files:**
- Create: `packages/hand-off/context.swift`

**Depends on:** Task 1 (models.swift, helpers.swift)

**Spec reference:** Section 4.4 — Context Operator

- [ ] **Step 1: Create context.swift with coordinate conversion and context action handler**

```swift
// context.swift — Context operator and coordinate conversion

import CoreGraphics
import Foundation

// MARK: - Coordinate Conversion

/// Convert coordinates from the request's coordinate space to global CG points.
/// When coordinate_space is "window", looks up the window's current origin and applies scale factor.
func resolveCoordinates(x: Double, y: Double, context: SessionContext) -> CGPoint? {
    switch context.coordinate_space {
    case "window":
        guard let windowID = context.window_id else { return nil }
        guard let origin = windowOrigin(windowID: windowID) else { return nil }
        let sf = context.scale_factor
        let cgX = (x / sf) + Double(origin.x)
        let cgY = (y / sf) + Double(origin.y)
        return CGPoint(x: cgX, y: cgY)
    default: // "global"
        return CGPoint(x: x, y: y)
    }
}

/// Resolve coordinates from an ActionRequest, falling back to current cursor position.
func resolveActionCoordinates(_ req: ActionRequest, state: SessionState) -> CGPoint? {
    if let x = req.x, let y = req.y {
        return resolveCoordinates(x: x, y: y, context: state.context)
    }
    return nil
}

// MARK: - Context Action Handler

/// Process a "context" action — set, clear, or update session context.
func handleContextAction(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    if req.clear == true {
        state.context.clear()
    }

    if let fields = req.set {
        state.context.apply(fields)
    }

    // Validate: coordinate_space "window" requires window_id
    if state.context.coordinate_space == "window" && state.context.window_id == nil {
        return ActionResponse(
            status: "error", action: "context",
            cursor: state.cursor, modifiers: Array(state.modifiers),
            error: "coordinate_space \"window\" requires window_id in context",
            code: "INVALID_CONTEXT"
        )
    }

    let elapsed = Int(Date().timeIntervalSince(start) * 1000)
    return ActionResponse(
        status: "ok", action: "context",
        cursor: state.cursor, modifiers: Array(state.modifiers),
        context: state.contextSnapshot(),
        duration_ms: elapsed
    )
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd packages/hand-off && bash build.sh`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add packages/hand-off/context.swift
git commit -m "feat(hand-off): context operator — coordinate conversion, window-relative support"
```

---

## Task 5: Actions — actions.swift

**Files:**
- Create: `packages/hand-off/actions.swift`

**Depends on:** Tasks 1–4 (models, helpers, targeting, profiles, context)

**Spec reference:** Sections 4.2, 4.3 — Action Vocabulary + Response Format

Every action handler takes `(ActionRequest, SessionState) -> ActionResponse`. CGEvent actions use profile-driven timing. AX actions use the new targeting system. All responses include cursor + modifiers.

- [ ] **Step 1: Create actions.swift with all action handlers**

```swift
// actions.swift — All action implementations (CGEvent, AX, AppleScript, meta)

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - Response Helpers

/// Build a success response with current state.
private func okResponse(_ action: String, state: SessionState, start: Date, extra: ((inout ActionResponse) -> Void)? = nil) -> ActionResponse {
    var resp = ActionResponse(
        status: "ok", action: action,
        cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
        context: state.contextSnapshot(),
        duration_ms: Int(Date().timeIntervalSince(start) * 1000)
    )
    extra?(&resp)
    return resp
}

private func errorResponse(_ action: String, state: SessionState, message: String, code: String) -> ActionResponse {
    ActionResponse(
        status: "error", action: action,
        cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
        error: message, code: code
    )
}

/// Build CGEventFlags from currently held modifiers.
private func currentFlags(_ state: SessionState) -> CGEventFlags {
    var flags: CGEventFlags = []
    for mod in state.modifiers {
        if let f = flagsForModifier(mod) { flags.insert(f) }
    }
    return flags
}

// MARK: - CGEvent Actions

func handleMove(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    guard let target = resolveActionCoordinates(req, state: state) else {
        return errorResponse("move", state: state, message: "x and y required for move", code: "MISSING_ARG")
    }

    let current = CGPoint(x: state.cursor.x, y: state.cursor.y)
    let profile = state.profile

    // Generate Bezier path
    let dist = hypot(Double(target.x - current.x), Double(target.y - current.y))
    let steps = max(5, Int(dist / Double(profile.mouse.pixels_per_second) * 60)) // ~60fps
    let path = bezierPath(from: current, to: target, steps: steps,
                          overshoot: profile.mouse.overshoot, jitter: profile.mouse.jitter)

    // Interval between steps based on speed
    let totalTime = dist / profile.mouse.pixels_per_second // seconds
    let intervalUs = UInt32(totalTime / Double(max(1, path.count)) * 1_000_000)

    for point in path {
        if let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                                mouseCursorPosition: point, mouseButton: .left) {
            event.flags = currentFlags(state)
            event.post(tap: .cghidEventTap)
        }
        if intervalUs > 0 { usleep(intervalUs) }
    }

    state.updateCursor(target)
    return okResponse("move", state: state, start: start)
}

func handleClick(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    guard let target = resolveActionCoordinates(req, state: state) else {
        return errorResponse("click", state: state, message: "x and y required for click", code: "MISSING_ARG")
    }

    let profile = state.profile
    let button: CGMouseButton = (req.button == "right") ? .right : .left
    let clickCount = req.count ?? 1

    // Move to target first if not already there
    let current = CGPoint(x: state.cursor.x, y: state.cursor.y)
    let dist = hypot(Double(target.x - current.x), Double(target.y - current.y))
    if dist > 2.0 {
        let moveReq = ActionRequest(action: "move", x: Double(target.x), y: Double(target.y))
        _ = handleMove(moveReq, state: state)
    }

    let flags = currentFlags(state)
    let downType: CGEventType = button == .left ? .leftMouseDown : .rightMouseDown
    let upType: CGEventType = button == .left ? .leftMouseUp : .rightMouseUp

    for i in 0..<clickCount {
        guard let down = CGEvent(mouseEventSource: nil, mouseType: downType,
                                  mouseCursorPosition: target, mouseButton: button),
              let up = CGEvent(mouseEventSource: nil, mouseType: upType,
                                mouseCursorPosition: target, mouseButton: button) else {
            return errorResponse("click", state: state, message: "Failed to create mouse event", code: "CGEVENT_FAILED")
        }
        down.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
        up.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        usleep(sampleDelay(profile.timing.click_dwell))
        up.post(tap: .cghidEventTap)
        if i < clickCount - 1 {
            usleep(30_000) // 30ms between multi-clicks
        }
    }

    state.updateCursor(target)
    return okResponse("click", state: state, start: start)
}

func handleDrag(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    guard let target = resolveActionCoordinates(req, state: state) else {
        return errorResponse("drag", state: state, message: "x and y required for drag", code: "MISSING_ARG")
    }

    let fromPoint: CGPoint
    if let from = req.from {
        fromPoint = resolveCoordinates(x: from.x, y: from.y, context: state.context) ?? CGPoint(x: from.x, y: from.y)
    } else {
        fromPoint = CGPoint(x: state.cursor.x, y: state.cursor.y)
    }

    let flags = currentFlags(state)

    // Mouse down at start
    guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                              mouseCursorPosition: fromPoint, mouseButton: .left) else {
        return errorResponse("drag", state: state, message: "Failed to create mouse event", code: "CGEVENT_FAILED")
    }
    down.flags = flags
    down.post(tap: .cghidEventTap)
    usleep(50_000)

    // Drag in steps (Bezier path)
    let path = bezierPath(from: fromPoint, to: target, steps: 30,
                          overshoot: 0, jitter: state.profile.mouse.jitter)
    for point in path {
        if let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged,
                               mouseCursorPosition: point, mouseButton: .left) {
            drag.flags = flags
            drag.post(tap: .cghidEventTap)
        }
        usleep(10_000)
    }

    // Mouse up at end
    guard let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                            mouseCursorPosition: target, mouseButton: .left) else {
        return errorResponse("drag", state: state, message: "Failed to create mouse event", code: "CGEVENT_FAILED")
    }
    up.flags = flags
    up.post(tap: .cghidEventTap)

    state.updateCursor(target)
    return okResponse("drag", state: state, start: start)
}

func handleScroll(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile

    // Scroll position: use x,y if given, else current cursor
    let scrollAt: CGPoint
    if let x = req.x, let y = req.y {
        scrollAt = resolveCoordinates(x: x, y: y, context: state.context) ?? CGPoint(x: x, y: y)
    } else {
        scrollAt = CGPoint(x: state.cursor.x, y: state.cursor.y)
    }

    guard req.dx != nil || req.dy != nil else {
        return errorResponse("scroll", state: state, message: "At least one of dx or dy required", code: "MISSING_ARG")
    }

    let totalDY = Int32(req.dy ?? 0)
    let totalDX = Int32(req.dx ?? 0)
    let eventsCount = profile.scroll.events_per_action
    let decel = profile.scroll.deceleration
    let intervalUs = UInt32(profile.scroll.interval_ms) * 1000

    // Move cursor to scroll position
    if let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                           mouseCursorPosition: scrollAt, mouseButton: .left) {
        move.post(tap: .cghidEventTap)
        usleep(10_000)
    }

    // Post scroll events with deceleration
    var remainDY = Double(totalDY)
    var remainDX = Double(totalDX)
    for i in 0..<eventsCount {
        let factor = pow(decel, Double(i))
        let dy = Int32(remainDY * factor / Double(eventsCount))
        let dx = Int32(remainDX * factor / Double(eventsCount))

        guard let scroll = CGEvent(scrollWheelEvent2Source: nil, units: .pixel,
                                    wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) else { continue }
        scroll.post(tap: .cghidEventTap)
        usleep(intervalUs)
    }

    return okResponse("scroll", state: state, start: start)
}

func handleKeyDown(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    guard let keyName = req.key?.lowercased() else {
        return errorResponse("key_down", state: state, message: "key is required", code: "MISSING_ARG")
    }

    // Check if it's a modifier
    if let mod = modifierMap[keyName] {
        state.modifiers.insert(keyName == "command" ? "cmd" : keyName == "option" ? "alt" : keyName == "control" ? "ctrl" : keyName)
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: mod.keyCode, keyDown: true) else {
            return errorResponse("key_down", state: state, message: "Failed to create key event", code: "CGEVENT_FAILED")
        }
        event.flags = currentFlags(state)
        event.post(tap: .cghidEventTap)
        return okResponse("key_down", state: state, start: start)
    }

    // Regular key
    guard let keyCode = keyCodeMap[keyName] else {
        return errorResponse("key_down", state: state, message: "Unknown key: \(keyName)", code: "INVALID_KEY")
    }
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true) else {
        return errorResponse("key_down", state: state, message: "Failed to create key event", code: "CGEVENT_FAILED")
    }
    event.flags = currentFlags(state)
    event.post(tap: .cghidEventTap)
    return okResponse("key_down", state: state, start: start)
}

func handleKeyUp(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    guard let keyName = req.key?.lowercased() else {
        return errorResponse("key_up", state: state, message: "key is required", code: "MISSING_ARG")
    }

    // Check if it's a modifier
    if let mod = modifierMap[keyName] {
        // Remove the canonical modifier name from held set
        let canonical = keyName == "command" ? "cmd" : keyName == "option" ? "alt" : keyName == "control" ? "ctrl" : keyName
        state.modifiers.remove(canonical)
        // Also remove aliases
        for alias in ["cmd", "command", "shift", "alt", "option", "opt", "ctrl", "control", "fn"] {
            if modifierMap[alias]?.flag == mod.flag {
                state.modifiers.remove(alias)
            }
        }
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: mod.keyCode, keyDown: false) else {
            return errorResponse("key_up", state: state, message: "Failed to create key event", code: "CGEVENT_FAILED")
        }
        event.flags = currentFlags(state)
        event.post(tap: .cghidEventTap)
        return okResponse("key_up", state: state, start: start)
    }

    // Regular key
    guard let keyCode = keyCodeMap[keyName] else {
        return errorResponse("key_up", state: state, message: "Unknown key: \(keyName)", code: "INVALID_KEY")
    }
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
        return errorResponse("key_up", state: state, message: "Failed to create key event", code: "CGEVENT_FAILED")
    }
    event.flags = currentFlags(state)
    event.post(tap: .cghidEventTap)
    return okResponse("key_up", state: state, start: start)
}

func handleKeyTap(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    guard let combo = req.key else {
        return errorResponse("key_tap", state: state, message: "key is required", code: "MISSING_ARG")
    }

    guard let (keyCode, comboFlags) = parseKeyCombo(combo) else {
        return errorResponse("key_tap", state: state, message: "Unknown key combo: \(combo)", code: "INVALID_KEY")
    }

    // Combine combo flags with currently held modifiers
    var flags = currentFlags(state)
    flags.insert(comboFlags)

    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
        return errorResponse("key_tap", state: state, message: "Failed to create key event", code: "CGEVENT_FAILED")
    }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    usleep(sampleDelay(state.profile.timing.keystroke_delay))
    up.post(tap: .cghidEventTap)

    return okResponse("key_tap", state: state, start: start)
}

func handleType(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    guard let text = req.text else {
        return errorResponse("type", state: state, message: "text is required", code: "MISSING_ARG")
    }

    let profile = state.profile
    let baseInterval = 60_000_000 / UInt32(max(1, profile.timing.typing_cadence.wpm * 5)) // microseconds per character

    for char in text {
        let utf16 = Array(String(char).utf16)
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { continue }
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        down.flags = currentFlags(state)
        up.flags = currentFlags(state)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)

        // Profile-driven delay
        let variance = profile.timing.typing_cadence.variance
        let jitter = Double.random(in: (1.0 - variance)...(1.0 + variance))
        let delay = UInt32(Double(baseInterval) * jitter)
        usleep(delay)

        // Extra pause after whitespace
        if char.isWhitespace, let wordPause = profile.timing.typing_cadence.pause_after_word {
            usleep(sampleDelay(wordPause))
        }
    }

    return okResponse("type", state: state, start: start)
}

// MARK: - AX Actions

func handlePress(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard AXIsProcessTrusted() else {
        return errorResponse("press", state: state, message: "Accessibility permission required", code: "PERMISSION_DENIED")
    }

    let query = ElementQuery(from: req, context: state.context, profile: state.profile)
    guard query.pid != 0 else {
        return errorResponse("press", state: state, message: "pid required (directly or via context)", code: "MISSING_ARG")
    }

    switch findElement(query: query) {
    case .found(let element):
        let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if result != .success {
            return errorResponse("press", state: state,
                                 message: "AXPerformAction(AXPress) failed with code \(result.rawValue)", code: "AX_ACTION_FAILED")
        }
        return okResponse("press", state: state, start: start)
    case .notFound(let reason):
        return errorResponse("press", state: state, message: "Element not found: \(reason)", code: "ELEMENT_NOT_FOUND")
    case .timeout:
        return errorResponse("press", state: state, message: "AX tree search timed out", code: "AX_TIMEOUT")
    }
}

func handleSetValue(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    guard let newValue = req.value else {
        return errorResponse("set_value", state: state, message: "value is required", code: "MISSING_ARG")
    }

    guard AXIsProcessTrusted() else {
        return errorResponse("set_value", state: state, message: "Accessibility permission required", code: "PERMISSION_DENIED")
    }

    // Build query — use value field for targeting, not for the new value.
    // The spec says set_value's "value" is the new value to set, not a match criterion.
    // So we remove value from the query.
    var targetReq = req
    targetReq.value = nil
    let query = ElementQuery(from: targetReq, context: state.context, profile: state.profile)
    guard query.pid != 0 else {
        return errorResponse("set_value", state: state, message: "pid required", code: "MISSING_ARG")
    }

    switch findElement(query: query) {
    case .found(let element):
        var settable: DarwinBoolean = false
        AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
        guard settable.boolValue else {
            return errorResponse("set_value", state: state, message: "AXValue is not settable on this element", code: "AX_NOT_SETTABLE")
        }
        let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, newValue as CFTypeRef)
        if result != .success {
            return errorResponse("set_value", state: state,
                                 message: "AXUIElementSetAttributeValue failed with code \(result.rawValue)", code: "AX_ACTION_FAILED")
        }
        return okResponse("set_value", state: state, start: start)
    case .notFound(let reason):
        return errorResponse("set_value", state: state, message: "Element not found: \(reason)", code: "ELEMENT_NOT_FOUND")
    case .timeout:
        return errorResponse("set_value", state: state, message: "AX tree search timed out", code: "AX_TIMEOUT")
    }
}

func handleFocus(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard AXIsProcessTrusted() else {
        return errorResponse("focus", state: state, message: "Accessibility permission required", code: "PERMISSION_DENIED")
    }

    let query = ElementQuery(from: req, context: state.context, profile: state.profile)
    guard query.pid != 0 else {
        return errorResponse("focus", state: state, message: "pid required", code: "MISSING_ARG")
    }

    switch findElement(query: query) {
    case .found(let element):
        let result = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, true as CFTypeRef)
        if result != .success {
            return errorResponse("focus", state: state, message: "Failed to set focus", code: "AX_ACTION_FAILED")
        }
        return okResponse("focus", state: state, start: start)
    case .notFound(let reason):
        return errorResponse("focus", state: state, message: "Element not found: \(reason)", code: "ELEMENT_NOT_FOUND")
    case .timeout:
        return errorResponse("focus", state: state, message: "AX tree search timed out", code: "AX_TIMEOUT")
    }
}

func handleRaise(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard AXIsProcessTrusted() else {
        return errorResponse("raise", state: state, message: "Accessibility permission required", code: "PERMISSION_DENIED")
    }

    let pid = req.pid ?? state.context.pid
    guard let pid = pid else {
        return errorResponse("raise", state: state, message: "pid required", code: "MISSING_ARG")
    }

    // Activate the application
    if let app = NSRunningApplication(processIdentifier: pid_t(pid)) {
        app.activate()
    }

    // Raise specific window
    let windowID = req.window_id ?? state.context.window_id
    if let wid = windowID, let window = findWindowByID(pid: pid_t(pid), windowID: wid) {
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    } else if let window = findFirstWindow(pid: pid_t(pid)) {
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    }

    return okResponse("raise", state: state, start: start)
}

// MARK: - AppleScript Actions

func handleTell(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    guard let app = req.app, let script = req.script else {
        return errorResponse("tell", state: state, message: "app and script are required", code: "MISSING_ARG")
    }

    let fullScript = "tell application \"\(app)\" to \(script)"
    let appleScript = NSAppleScript(source: fullScript)
    var errorInfo: NSDictionary?
    let result = appleScript?.executeAndReturnError(&errorInfo)

    if let error = errorInfo {
        let message = error[NSAppleScript.errorMessage] as? String ?? "AppleScript execution failed"
        return errorResponse("tell", state: state, message: message, code: "APPLESCRIPT_FAILED")
    }

    return okResponse("tell", state: state, start: start)
}

// MARK: - Meta Actions

func handleStatus(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    var resp = ActionResponse(
        status: "ok", action: "status",
        cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
        context: state.contextSnapshot()
    )
    resp.profile = state.profileName
    resp.session_uptime_s = Date().timeIntervalSince(state.startTime)
    resp.bound_channel = nil // Phase 2
    return resp
}

func handleEnd(state: SessionState) -> ActionResponse {
    // Release all held modifier keys
    for mod in state.modifiers {
        if let info = modifierMap[mod] {
            if let event = CGEvent(keyboardEventSource: nil, virtualKey: info.keyCode, keyDown: false) {
                event.flags = []
                event.post(tap: .cghidEventTap)
            }
        }
    }
    state.modifiers.removeAll()

    return ActionResponse(
        status: "ok", action: "end",
        cursor: state.cursor, modifiers: []
    )
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd packages/hand-off && bash build.sh`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add packages/hand-off/actions.swift
git commit -m "feat(hand-off): session action handlers — CGEvent, AX, AppleScript, meta"
```

---

## Task 6: Session Mode — session.swift

**Files:**
- Create: `packages/hand-off/session.swift`

**Depends on:** Tasks 1–5 (all types and action handlers)

**Spec reference:** Section 4.1 — Session Mode

- [ ] **Step 1: Create session.swift with stdin/stdout ndjson loop**

```swift
// session.swift — Session mode: stdin ndjson loop, state management, action dispatch

import Foundation

/// Run a session: read ndjson from stdin, dispatch actions, write ndjson responses to stdout.
func runSession(profileName: String) -> Never {
    guard let profile = loadProfile(name: profileName) else {
        exitWithError("Profile not found: \(profileName)", code: "PROFILE_NOT_FOUND")
    }

    let state = SessionState(profile: profile, profileName: profileName)
    let decoder = JSONDecoder()

    // Disable stdout buffering for real-time response streaming
    setbuf(stdout, nil)

    while let line = readLine(strippingNewline: true) {
        // Skip empty lines
        guard !line.isEmpty else { continue }

        // Parse request
        guard let data = line.data(using: .utf8) else {
            writeJSON(ActionResponse(
                status: "error", action: "unknown",
                cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
                error: "Invalid UTF-8 input", code: "PARSE_ERROR"
            ))
            continue
        }

        let req: ActionRequest
        do {
            req = try decoder.decode(ActionRequest.self, from: data)
        } catch {
            writeJSON(ActionResponse(
                status: "error", action: "unknown",
                cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
                error: "Invalid JSON: \(error.localizedDescription)", code: "PARSE_ERROR"
            ))
            continue
        }

        // Dispatch action
        let response = dispatchAction(req, state: state)
        writeJSON(response)

        // End action terminates session
        if req.action == "end" {
            exit(0)
        }
    }

    // stdin closed — release modifiers and exit
    _ = handleEnd(state: state)
    exit(0)
}

/// Route an action request to its handler.
func dispatchAction(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    switch req.action {
    // CGEvent actions
    case "move":
        return handleMove(req, state: state)
    case "click":
        return handleClick(req, state: state)
    case "drag":
        return handleDrag(req, state: state)
    case "scroll":
        return handleScroll(req, state: state)
    case "key_down":
        return handleKeyDown(req, state: state)
    case "key_up":
        return handleKeyUp(req, state: state)
    case "key_tap":
        return handleKeyTap(req, state: state)
    case "type":
        return handleType(req, state: state)

    // AX actions
    case "press":
        return handlePress(req, state: state)
    case "set_value":
        return handleSetValue(req, state: state)
    case "focus":
        return handleFocus(req, state: state)
    case "raise":
        return handleRaise(req, state: state)

    // AppleScript
    case "tell":
        return handleTell(req, state: state)

    // Meta actions
    case "context":
        return handleContextAction(req, state: state)
    case "status":
        return handleStatus(req, state: state)
    case "end":
        return handleEnd(state: state)

    // Phase 2 placeholder
    case "bind":
        return ActionResponse(
            status: "error", action: "bind",
            cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
            error: "bind requires Phase 2 (focus channels)", code: "UNKNOWN_ACTION"
        )

    default:
        return ActionResponse(
            status: "error", action: req.action,
            cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
            error: "Unknown action: \(req.action)", code: "UNKNOWN_ACTION"
        )
    }
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd packages/hand-off && bash build.sh`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add packages/hand-off/session.swift
git commit -m "feat(hand-off): session mode — ndjson stdin/stdout loop with action dispatch"
```

---

## Task 7: CLI Dispatch + Entry Point — cli.swift + main.swift

**Files:**
- Create: `packages/hand-off/cli.swift`
- Modify: `packages/hand-off/main.swift`

**Depends on:** Tasks 1–6 (all components)

This task wires everything together. The CLI preserves full backward compatibility with v1 commands while adding new commands (`session`, `hover`, `profiles`) and new flags (`--depth`, `--timeout`, `--label`, `--identifier`, `--match`, `--near`, `--delay`, `--variance`, `--dx`, `--profile`, `--dwell`).

- [ ] **Step 1: Create cli.swift with all standalone CLI commands**

Each CLI command wraps the session-mode action handlers by creating a temporary `SessionState`, building an `ActionRequest`, calling the handler, and converting the response to the v1 `LegacySuccessResponse` format for backward compatibility.

```swift
// cli.swift — Standalone CLI commands (backward-compatible with v1)

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - CLI to Session Bridge

/// Create a one-shot session state for CLI commands. Loads profile if --profile is given.
func cliSessionState(args: [String]) -> SessionState {
    let profileName = getArg(args, "--profile") ?? "natural"
    let profile = loadProfile(name: profileName) ?? .natural
    return SessionState(profile: profile, profileName: profileName)
}

/// Convert a session ActionResponse to v1 LegacySuccessResponse for stdout.
func cliPrintLegacy(action: String, backend: String, target: LegacyTargetInfo, detail: String? = nil, dryRun: Bool = false) {
    let resp = LegacySuccessResponse(
        status: dryRun ? "dry_run" : "success",
        action: action, backend: backend, target: target, detail: detail
    )
    writeJSON(resp)
}

// MARK: - CLI Commands

func cliPress(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitWithError("--pid is required.", code: "MISSING_ARG")
    }

    let role = getArg(args, "--role")
    let title = getArg(args, "--title")
    let label = getArg(args, "--label")
    let identifier = getArg(args, "--identifier")
    let index = parseInt(getArg(args, "--index"))
    let matchMode = getArg(args, "--match")
    let depth = parseInt(getArg(args, "--depth"))
    let timeout = parseInt(getArg(args, "--timeout"))
    var nearPoint: [Double]? = nil
    if let nearStr = getArg(args, "--near"), let (nx, ny) = parseCoords(nearStr) {
        nearPoint = [nx, ny]
    }

    let target = LegacyTargetInfo(pid: pid, role: role, title: title, index: index)

    if dryRun {
        cliPrintLegacy(action: "press", backend: "ax", target: target,
                       detail: "Would AXPerformAction(AXPress) on matching element.", dryRun: true)
        return
    }

    let req = ActionRequest(action: "press", pid: pid, role: role, title: title,
                            label: label, identifier: identifier, index: index,
                            near: nearPoint, match: matchMode, depth: depth, timeout: timeout)
    let resp = handlePress(req, state: state)
    if resp.status == "error" {
        exitWithError(resp.error ?? "Unknown error", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "press", backend: "ax", target: target)
}

func cliSetValue(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitWithError("--pid is required.", code: "MISSING_ARG")
    }
    guard let role = getArg(args, "--role") else {
        exitWithError("--role is required.", code: "MISSING_ARG")
    }
    guard let value = getArg(args, "--value") else {
        exitWithError("--value is required.", code: "MISSING_ARG")
    }
    let title = getArg(args, "--title")
    let index = parseInt(getArg(args, "--index"))

    let target = LegacyTargetInfo(pid: pid, role: role, title: title, index: index)

    if dryRun {
        cliPrintLegacy(action: "set-value", backend: "ax", target: target,
                       detail: "Would set AXValue to: \(value)", dryRun: true)
        return
    }

    let req = ActionRequest(action: "set_value", pid: pid, role: role, title: title,
                            value: value, index: index)
    let resp = handleSetValue(req, state: state)
    if resp.status == "error" {
        exitWithError(resp.error ?? "Unknown error", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "set-value", backend: "ax", target: target)
}

func cliFocusElement(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitWithError("--pid is required.", code: "MISSING_ARG")
    }
    guard let role = getArg(args, "--role") else {
        exitWithError("--role is required.", code: "MISSING_ARG")
    }
    let title = getArg(args, "--title")
    let index = parseInt(getArg(args, "--index"))

    let target = LegacyTargetInfo(pid: pid, role: role, title: title, index: index)

    if dryRun {
        cliPrintLegacy(action: "focus", backend: "ax", target: target,
                       detail: "Would set AXFocused=true on matching element.", dryRun: true)
        return
    }

    let req = ActionRequest(action: "focus", pid: pid, role: role, title: title, index: index)
    let resp = handleFocus(req, state: state)
    if resp.status == "error" {
        exitWithError(resp.error ?? "Unknown error", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "focus", backend: "ax", target: target)
}

func cliClick(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let isRight = hasFlag(args, "--right")
    let isDouble = hasFlag(args, "--double")
    let state = cliSessionState(args: args)

    let positional = args.filter { !$0.hasPrefix("--") }
    guard let coordStr = positional.first, let (x, y) = parseCoords(coordStr) else {
        exitWithError("Coordinates required: hand-off click <x>,<y>", code: "MISSING_ARG")
    }

    let target = LegacyTargetInfo(x: x, y: y)
    let button = isRight ? "right" : "left"
    let count = isDouble ? 2 : 1

    if dryRun {
        cliPrintLegacy(action: "click", backend: "cgevent", target: target,
                       detail: "\(isRight ? "Right" : "Left") click\(isDouble ? " (double)" : "") at (\(x), \(y)).", dryRun: true)
        return
    }

    let req = ActionRequest(action: "click", x: x, y: y, button: button, count: count)
    let resp = handleClick(req, state: state)
    if resp.status == "error" {
        exitWithError(resp.error ?? "Unknown error", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "click", backend: "cgevent", target: target)
}

func cliHover(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    let positional = args.filter { !$0.hasPrefix("--") }
    guard let coordStr = positional.first, let (x, y) = parseCoords(coordStr) else {
        exitWithError("Coordinates required: hand-off hover <x>,<y>", code: "MISSING_ARG")
    }

    let target = LegacyTargetInfo(x: x, y: y)

    if dryRun {
        cliPrintLegacy(action: "hover", backend: "cgevent", target: target,
                       detail: "Would move cursor to (\(x), \(y)).", dryRun: true)
        return
    }

    let req = ActionRequest(action: "move", x: x, y: y)
    let resp = handleMove(req, state: state)
    if resp.status == "error" {
        exitWithError(resp.error ?? "Unknown error", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "hover", backend: "cgevent", target: target)
}

func cliDrag(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    let positional = args.filter { !$0.hasPrefix("--") }
    guard positional.count >= 2,
          let (x1, y1) = parseCoords(positional[0]),
          let (x2, y2) = parseCoords(positional[1]) else {
        exitWithError("Two coordinate pairs required: hand-off drag <x1>,<y1> <x2>,<y2>", code: "MISSING_ARG")
    }

    let target = LegacyTargetInfo(x: x1, y: y1, x2: x2, y2: y2)

    if dryRun {
        cliPrintLegacy(action: "drag", backend: "cgevent", target: target,
                       detail: "Drag from (\(x1),\(y1)) to (\(x2),\(y2)).", dryRun: true)
        return
    }

    let req = ActionRequest(action: "drag", x: x2, y: y2,
                            from: CursorPosition(x: x1, y: y1))
    let resp = handleDrag(req, state: state)
    if resp.status == "error" {
        exitWithError(resp.error ?? "Unknown error", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "drag", backend: "cgevent", target: target)
}

func cliScroll(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    let positional = args.filter { !$0.hasPrefix("--") }
    guard let coordStr = positional.first, let (x, y) = parseCoords(coordStr) else {
        exitWithError("Coordinates required: hand-off scroll <x>,<y> --dy <pixels>", code: "MISSING_ARG")
    }

    let dy = parseDouble(getArg(args, "--dy"))
    let dx = parseDouble(getArg(args, "--dx"))
    guard dy != nil || dx != nil else {
        exitWithError("At least one of --dx or --dy is required.", code: "MISSING_ARG")
    }

    let target = LegacyTargetInfo(x: x, y: y)

    if dryRun {
        cliPrintLegacy(action: "scroll", backend: "cgevent", target: target,
                       detail: "Scroll dx=\(dx ?? 0) dy=\(dy ?? 0) at (\(x),\(y)).", dryRun: true)
        return
    }

    let req = ActionRequest(action: "scroll", x: x, y: y, dx: dx, dy: dy)
    let resp = handleScroll(req, state: state)
    if resp.status == "error" {
        exitWithError(resp.error ?? "Unknown error", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "scroll", backend: "cgevent", target: target)
}

func cliType(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    let positional = args.filter { !$0.hasPrefix("--") }
    guard let text = positional.first else {
        exitWithError("Text required: hand-off type \"hello world\"", code: "MISSING_ARG")
    }

    let target = LegacyTargetInfo(text: text)

    if dryRun {
        let preview = text.count > 50 ? String(text.prefix(50)) + "..." : text
        cliPrintLegacy(action: "type", backend: "cgevent", target: target,
                       detail: "Would type: \(preview)", dryRun: true)
        return
    }

    let req = ActionRequest(action: "type", text: text)
    let resp = handleType(req, state: state)
    if resp.status == "error" {
        exitWithError(resp.error ?? "Unknown error", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "type", backend: "cgevent", target: target)
}

func cliKey(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    let positional = args.filter { !$0.hasPrefix("--") }
    guard let combo = positional.first else {
        exitWithError("Key combo required: hand-off key cmd+s", code: "MISSING_ARG")
    }

    let target = LegacyTargetInfo(keys: combo)

    if dryRun {
        cliPrintLegacy(action: "key", backend: "cgevent", target: target,
                       detail: "Would press: \(combo)", dryRun: true)
        return
    }

    let req = ActionRequest(action: "key_tap", key: combo)
    let resp = handleKeyTap(req, state: state)
    if resp.status == "error" {
        exitWithError(resp.error ?? "Unknown error", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "key", backend: "cgevent", target: target)
}

func cliRaise(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitWithError("--pid is required.", code: "MISSING_ARG")
    }
    let windowID = parseInt(getArg(args, "--window"))

    let target = LegacyTargetInfo(pid: pid, window_id: windowID)

    if dryRun {
        cliPrintLegacy(action: "raise", backend: "ax", target: target,
                       detail: "Would raise window to front.", dryRun: true)
        return
    }

    let req = ActionRequest(action: "raise", pid: pid, window_id: windowID)
    let resp = handleRaise(req, state: state)
    if resp.status == "error" {
        exitWithError(resp.error ?? "Unknown error", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "raise", backend: "ax", target: target)
}

func cliMove(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitWithError("--pid is required.", code: "MISSING_ARG")
    }
    guard let toStr = getArg(args, "--to"), let (x, y) = parseCoords(toStr) else {
        exitWithError("--to <x>,<y> is required.", code: "MISSING_ARG")
    }
    let windowID = parseInt(getArg(args, "--window"))

    let target = LegacyTargetInfo(pid: pid, x: x, y: y, window_id: windowID)

    if dryRun {
        cliPrintLegacy(action: "move", backend: "ax", target: target,
                       detail: "Would move window to (\(x),\(y)).", dryRun: true)
        return
    }

    guard AXIsProcessTrusted() else {
        exitWithError("Accessibility permission required.", code: "PERMISSION_DENIED")
    }

    guard let window = windowID != nil
        ? findWindowByID(pid: pid_t(pid), windowID: windowID!)
        : findFirstWindow(pid: pid_t(pid)) else {
        exitWithError("Window not found.", code: "WINDOW_NOT_FOUND")
    }

    var point = CGPoint(x: x, y: y)
    let axValue = AXValueCreate(.cgPoint, &point)!
    let result = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, axValue)
    guard result == .success else {
        exitWithError("Failed to move window (AX error \(result.rawValue)).", code: "AX_ACTION_FAILED")
    }

    cliPrintLegacy(action: "move", backend: "ax", target: target)
}

func cliResize(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitWithError("--pid is required.", code: "MISSING_ARG")
    }
    guard let toStr = getArg(args, "--to"), let (w, h) = parseCoords(toStr) else {
        exitWithError("--to <width>,<height> is required.", code: "MISSING_ARG")
    }
    let windowID = parseInt(getArg(args, "--window"))

    let target = LegacyTargetInfo(pid: pid, window_id: windowID, width: w, height: h)

    if dryRun {
        cliPrintLegacy(action: "resize", backend: "ax", target: target,
                       detail: "Would resize window to \(w)x\(h).", dryRun: true)
        return
    }

    guard AXIsProcessTrusted() else {
        exitWithError("Accessibility permission required.", code: "PERMISSION_DENIED")
    }

    guard let window = windowID != nil
        ? findWindowByID(pid: pid_t(pid), windowID: windowID!)
        : findFirstWindow(pid: pid_t(pid)) else {
        exitWithError("Window not found.", code: "WINDOW_NOT_FOUND")
    }

    var size = CGSize(width: w, height: h)
    let axValue = AXValueCreate(.cgSize, &size)!
    let result = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, axValue)
    guard result == .success else {
        exitWithError("Failed to resize window (AX error \(result.rawValue)).", code: "AX_ACTION_FAILED")
    }

    cliPrintLegacy(action: "resize", backend: "ax", target: target)
}

func cliTell(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let positional = args.filter { !$0.hasPrefix("--") }
    guard positional.count >= 2 else {
        exitWithError("Usage: hand-off tell <app> <script-body>", code: "MISSING_ARG")
    }
    let appName = positional[0]
    let scriptBody = positional.dropFirst().joined(separator: " ")

    let target = LegacyTargetInfo(app: appName, script: scriptBody)
    let fullScript = "tell application \"\(appName)\" to \(scriptBody)"

    if dryRun {
        cliPrintLegacy(action: "tell", backend: "applescript", target: target,
                       detail: "Would execute: \(fullScript)", dryRun: true)
        return
    }

    let appleScript = NSAppleScript(source: fullScript)
    var errorInfo: NSDictionary?
    let result = appleScript?.executeAndReturnError(&errorInfo)

    if let error = errorInfo {
        let message = error[NSAppleScript.errorMessage] as? String ?? "AppleScript execution failed."
        exitWithError(message, code: "APPLESCRIPT_FAILED")
    }

    var detail: String? = nil
    if let resultStr = result?.stringValue, !resultStr.isEmpty {
        detail = resultStr
    }
    cliPrintLegacy(action: "tell", backend: "applescript", target: target, detail: detail)
}

// MARK: - Help Text

func printUsage() {
    print("""
    hand-off — Multi-backend macOS actuator CLI  (v2.0)

    USAGE
      hand-off session [--profile <name>]                   Start session mode (ndjson stdin/stdout)
      hand-off press --pid <pid> --role <role> [options]    Press a UI element (AX)
      hand-off set-value --pid <pid> --role <role> --value  Set element value (AX)
      hand-off focus --pid <pid> --role <role> [options]    Focus a UI element (AX)
      hand-off click <x>,<y> [--right] [--double]          Click at coordinates (CGEvent)
      hand-off hover <x>,<y>                               Move cursor without clicking (CGEvent)
      hand-off drag <x1>,<y1> <x2>,<y2>                    Drag between points (CGEvent)
      hand-off scroll <x>,<y> [--dx <px>] [--dy <px>]     Scroll at position (CGEvent)
      hand-off type "text"                                  Type text (CGEvent)
      hand-off key <combo>                                  Key combo, e.g. cmd+s (CGEvent)
      hand-off raise --pid <pid> [--window <id>]            Raise window (AX)
      hand-off move --pid <pid> --to <x>,<y>               Move window (AX)
      hand-off resize --pid <pid> --to <w>,<h>             Resize window (AX)
      hand-off tell <app> <script>                          AppleScript verb
      hand-off profiles                                     List available profiles
      hand-off profiles show <name>                         Show full profile JSON

    SESSION MODE
      Reads newline-delimited JSON from stdin, writes JSON responses to stdout.
      Maintains state: cursor position, modifier keys, context, profile.
      Actions: move, click, drag, scroll, key_down, key_up, key_tap, type,
               press, set_value, focus, raise, tell, context, status, end

    ELEMENT TARGETING (AX commands)
      --pid <pid>         Target process ID (required)
      --role <role>       AX role, e.g. AXButton, AXTextField
      --title <title>     Match element title
      --label <label>     Match element description (AXDescription)
      --identifier <id>   Match AXIdentifier
      --index <n>         0-based index among matching elements
      --near <x>,<y>      Disambiguate by proximity to coordinate
      --match <mode>      "exact" (default), "contains", "regex"
      --depth <n>         Max AX tree depth (default: profile value)
      --timeout <ms>      AX search timeout in milliseconds

    PROFILES
      --profile <name>    Load behavioral profile (default: natural)

    COORDINATES
      All coordinates are global CG points (matching side-eye topology output).
      Format: <x>,<y> (no spaces).

    SAFETY
      --dry-run           Show what would happen without doing it

    JSON OUTPUT
      CLI mode:     {"status":"success", "action":"...", "backend":"...", "target":{...}}
      Session mode: {"status":"ok", "action":"...", "cursor":{...}, "modifiers":[...], ...}
    """)
}
```

- [ ] **Step 2: Rewrite main.swift as entry point**

Replace `main.swift` with the final entry point that dispatches to session mode or CLI commands:

```swift
// main.swift — Entry point for hand-off v2

import Foundation

@available(macOS 14.0, *)
struct HandOff {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())

        guard !args.isEmpty else {
            printUsage()
            exit(0)
        }

        let command = args[0]
        let commandArgs = Array(args.dropFirst())

        switch command {
        // Session mode (v2)
        case "session":
            let profileName = getArg(commandArgs, "--profile") ?? "natural"
            runSession(profileName: profileName)

        // Profile management
        case "profiles":
            if let subcommand = commandArgs.first, subcommand == "show" {
                guard commandArgs.count >= 2 else {
                    exitWithError("Usage: hand-off profiles show <name>", code: "MISSING_ARG")
                }
                profilesShowCommand(name: commandArgs[1])
            } else {
                profilesListCommand()
            }

        // AX backend
        case "press":       cliPress(args: commandArgs)
        case "set-value":   cliSetValue(args: commandArgs)
        case "focus":       cliFocusElement(args: commandArgs)
        case "raise":       cliRaise(args: commandArgs)
        case "move":        cliMove(args: commandArgs)
        case "resize":      cliResize(args: commandArgs)

        // CGEvent backend
        case "click":       cliClick(args: commandArgs)
        case "hover":       cliHover(args: commandArgs)
        case "drag":        cliDrag(args: commandArgs)
        case "scroll":      cliScroll(args: commandArgs)
        case "type":        cliType(args: commandArgs)
        case "key":         cliKey(args: commandArgs)

        // AppleScript backend
        case "tell":        cliTell(args: commandArgs)

        // Help
        case "help", "--help", "-h":
            printUsage()

        default:
            exitWithError("Unknown command: \(command). Run 'hand-off help' for usage.", code: "UNKNOWN_COMMAND")
        }

        exit(0)
    }
}

@_cdecl("main")
func entryPoint(_ argc: Int32, _ argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    if #available(macOS 14.0, *) {
        HandOff.main()
    } else {
        exitWithError("hand-off requires macOS 14.0 or later.", code: "UNSUPPORTED_OS")
    }
    return 0
}
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/hand-off && bash build.sh`
Expected: compiles cleanly, binary produced.

Verify CLI help:
Run: `cd packages/hand-off && ./hand-off help`
Expected: v2 help text with session mode and new commands.

Verify profile listing:
Run: `cd packages/hand-off && ./hand-off profiles`
Expected: JSON array with `natural` profile.

- [ ] **Step 4: Commit**

```bash
git add packages/hand-off/cli.swift packages/hand-off/main.swift
git commit -m "feat(hand-off): CLI dispatch + entry point — session mode, hover, profiles, new targeting flags"
```

---

## Task 8: Integration Tests + CLAUDE.md Update

**Files:**
- Create: `packages/hand-off/test.sh`
- Modify: `packages/hand-off/CLAUDE.md`

**Depends on:** Task 7 (everything compiles and runs)

- [ ] **Step 1: Create test.sh with integration tests**

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

PASS=0
FAIL=0
BINARY="./hand-off"

# Ensure binary exists
if [ ! -f "$BINARY" ]; then
    echo "Binary not found. Run build.sh first."
    exit 1
fi

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1 — $2"; }

echo "=== hand-off v2 integration tests ==="

# --- CLI backward compatibility ---
echo ""
echo "--- CLI Commands ---"

# Help
if $BINARY help 2>&1 | grep -q "session"; then
    pass "help shows session mode"
else
    fail "help shows session mode" "missing 'session' in help output"
fi

# Click dry-run
OUT=$($BINARY click 100,100 --dry-run 2>&1)
if echo "$OUT" | grep -q '"dry_run"'; then
    pass "click --dry-run"
else
    fail "click --dry-run" "$OUT"
fi

# Hover dry-run
OUT=$($BINARY hover 200,200 --dry-run 2>&1)
if echo "$OUT" | grep -q '"dry_run"'; then
    pass "hover --dry-run"
else
    fail "hover --dry-run" "$OUT"
fi

# Scroll with --dx (new in v2)
OUT=$($BINARY scroll 100,100 --dx 50 --dry-run 2>&1)
if echo "$OUT" | grep -q '"dry_run"'; then
    pass "scroll --dx --dry-run"
else
    fail "scroll --dx --dry-run" "$OUT"
fi

# Scroll with --dx and --dy
OUT=$($BINARY scroll 100,100 --dx 50 --dy -100 --dry-run 2>&1)
if echo "$OUT" | grep -q '"dry_run"'; then
    pass "scroll --dx --dy --dry-run"
else
    fail "scroll --dx --dy --dry-run" "$OUT"
fi

# Key dry-run
OUT=$($BINARY key cmd+s --dry-run 2>&1)
if echo "$OUT" | grep -q '"dry_run"'; then
    pass "key --dry-run"
else
    fail "key --dry-run" "$OUT"
fi

# Type dry-run
OUT=$($BINARY type "hello" --dry-run 2>&1)
if echo "$OUT" | grep -q '"dry_run"'; then
    pass "type --dry-run"
else
    fail "type --dry-run" "$OUT"
fi

# Drag dry-run
OUT=$($BINARY drag 100,100 200,200 --dry-run 2>&1)
if echo "$OUT" | grep -q '"dry_run"'; then
    pass "drag --dry-run"
else
    fail "drag --dry-run" "$OUT"
fi

# Profiles list
OUT=$($BINARY profiles 2>&1)
if echo "$OUT" | grep -q '"natural"'; then
    pass "profiles lists natural"
else
    fail "profiles lists natural" "$OUT"
fi

# Profiles show
OUT=$($BINARY profiles show natural 2>&1)
if echo "$OUT" | grep -q '"pixels_per_second"'; then
    pass "profiles show natural"
else
    fail "profiles show natural" "$OUT"
fi

# --- Session Mode ---
echo ""
echo "--- Session Mode ---"

# Session: status
OUT=$(echo '{"action":"status"}' | $BINARY session 2>&1)
if echo "$OUT" | grep -q '"profile"'; then
    pass "session status returns profile"
else
    fail "session status returns profile" "$OUT"
fi

# Session: cursor in status response
if echo "$OUT" | grep -q '"cursor"'; then
    pass "session status returns cursor"
else
    fail "session status returns cursor" "$OUT"
fi

# Session: context set and status
OUT=$(printf '{"action":"context","set":{"pid":1,"app":"Test","coordinate_space":"global"}}\n{"action":"status"}\n' | $BINARY session 2>&1)
if echo "$OUT" | grep -q '"app"'; then
    pass "session context set + status"
else
    fail "session context set + status" "$OUT"
fi

# Session: context clear
OUT=$(printf '{"action":"context","set":{"pid":1}}\n{"action":"context","clear":true}\n{"action":"status"}\n' | $BINARY session 2>&1)
if echo "$OUT" | grep -q '"ok"'; then
    pass "session context clear"
else
    fail "session context clear" "$OUT"
fi

# Session: invalid JSON
OUT=$(echo 'not json' | $BINARY session 2>&1)
if echo "$OUT" | grep -q 'PARSE_ERROR'; then
    pass "session parse error on invalid JSON"
else
    fail "session parse error on invalid JSON" "$OUT"
fi

# Session: unknown action
OUT=$(echo '{"action":"banana"}' | $BINARY session 2>&1)
if echo "$OUT" | grep -q 'UNKNOWN_ACTION'; then
    pass "session unknown action error"
else
    fail "session unknown action error" "$OUT"
fi

# Session: end action
OUT=$(echo '{"action":"end"}' | $BINARY session 2>&1)
if echo "$OUT" | grep -q '"end"'; then
    pass "session end action"
else
    fail "session end action" "$OUT"
fi

# Session: invalid context (window coordinate_space without window_id)
OUT=$(echo '{"action":"context","set":{"coordinate_space":"window"}}' | $BINARY session 2>&1)
if echo "$OUT" | grep -q 'INVALID_CONTEXT'; then
    pass "session invalid context error"
else
    fail "session invalid context error" "$OUT"
fi

# Session: profile flag
OUT=$(echo '{"action":"status"}' | $BINARY session --profile natural 2>&1)
if echo "$OUT" | grep -q '"natural"'; then
    pass "session --profile natural"
else
    fail "session --profile natural" "$OUT"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 2: Run tests**

Run: `cd packages/hand-off && bash build.sh && bash test.sh`
Expected: all tests pass.

- [ ] **Step 3: Update CLAUDE.md with v2 documentation**

Replace `packages/hand-off/CLAUDE.md` with updated documentation covering session mode, profiles, context, new targeting, and new CLI commands. Follow the same structure as the heads-up CLAUDE.md — it serves as both human docs and agent instructions.

Key sections to add:
- Session mode usage with examples
- Behavioral profiles (loading, creating, listing)
- Context operator (set, clear, coordinate spaces)
- New targeting fields (label, identifier, near, match, depth, timeout)
- New CLI commands (session, hover, profiles)
- New flags on existing commands

- [ ] **Step 4: Commit**

```bash
git add packages/hand-off/test.sh packages/hand-off/CLAUDE.md
git commit -m "test(hand-off): integration tests + updated CLAUDE.md for v2 session mode"
```

---

## Final Build Verification

After all tasks are complete:

```bash
cd packages/hand-off && bash build.sh && bash test.sh
```

Expected: clean compilation, all tests pass, binary size ~200-400KB.

Verify the file structure matches the plan:
```bash
ls packages/hand-off/*.swift
# Expected: actions.swift cli.swift context.swift helpers.swift main.swift models.swift profiles.swift session.swift targeting.swift
```
