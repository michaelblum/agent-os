# DesktopWorldSurface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized-NSWindow `--track union` implementation with a logical `DesktopWorldSurface` backed by per-display physical segments, while keeping existing callers unchanged and migrating Sigil onto the new primitive.

**Architecture:** Phased delivery. **Phase A** ships a renderer-agnostic daemon primitive that is mergeable on its own. **Phase B** ships the toolkit adapter base class and the 2D adapter. **Phase C** is a Three.js validation spike that gates **Phase D** (Sigil migration). **Phase E** is a small spec correction. Phases A and B can land before C resolves; D is gated by C.

**Tech Stack:** Swift (daemon, `src/display/`, `src/daemon/`), JSON Schema 2020-12 (`shared/schemas/`), Node test runner (`tests/`), Three.js (`apps/sigil/renderer/`), DOM (`packages/toolkit/components/canvas-inspector/`), shell integration tests (`tests/*.sh`).

**Spec:** `docs/superpowers/specs/2026-04-25-desktop-world-surface-design.md` (commit `e6c7580`).

**Daemon availability:** The user's local `./aos ready` is currently blocked by a daemon ownership mismatch. The plan calls out which tasks require a working daemon. Tasks that only edit/build/run unit tests do not need the daemon. Integration tests (Phase A's A13, Phase D's D5) require the daemon to be reachable.

**Build cadence:** Tasks that change Swift sources under `src/` or `shared/swift/ipc/` require `bash build.sh` before any `./aos`-invoking step. Pure JS/schema tasks do not. Each task notes whether a rebuild is required.

---

## Phase A — Daemon Primitive (shippable independently)

After Phase A's last task lands and integration tests pass, the daemon primitive is shippable as a single PR. Existing `--track union` callers continue to work; their canvas is now a segmented surface internally. No toolkit or app changes are required for the primitive to ship.

### Task A1: Add `Segment` data type to Swift

**Files:**
- Create: `src/display/desktop-world-surface.swift`
- Modify: none yet

This task introduces only the data type. The Canvas refactor lands in A4.

- [ ] **Step 1: Create the file with the Segment struct**

```swift
import CoreGraphics
import Foundation

struct DesktopWorldSurfaceSegment: Codable, Equatable {
    let displayID: UInt32          // CGDirectDisplayID
    let index: Int                 // position in the ordered topology
    let dwBounds: [CGFloat]        // [x, y, w, h] in DesktopWorld coords
    let nativeBounds: [CGFloat]    // [x, y, w, h] in native CG coords

    enum CodingKeys: String, CodingKey {
        case displayID = "display_id"
        case index
        case dwBounds = "dw_bounds"
        case nativeBounds = "native_bounds"
    }
}

/// Orders segments by (dwBounds.y asc, dwBounds.x asc, displayID asc).
/// Total order; always yields a unique first segment when at least one
/// segment exists.
func orderSegments(_ unordered: [DesktopWorldSurfaceSegment]) -> [DesktopWorldSurfaceSegment] {
    let sorted = unordered.sorted { a, b in
        if a.dwBounds[1] != b.dwBounds[1] { return a.dwBounds[1] < b.dwBounds[1] }
        if a.dwBounds[0] != b.dwBounds[0] { return a.dwBounds[0] < b.dwBounds[0] }
        return a.displayID < b.displayID
    }
    return sorted.enumerated().map { (i, s) in
        DesktopWorldSurfaceSegment(displayID: s.displayID, index: i,
                                    dwBounds: s.dwBounds, nativeBounds: s.nativeBounds)
    }
}
```

- [ ] **Step 2: Build to verify the file compiles**

Run: `bash build.sh`
Expected: build succeeds; the new file is picked up automatically by the Swift target.

- [ ] **Step 3: Commit**

```bash
git add src/display/desktop-world-surface.swift
git commit -m "Add DesktopWorldSurface segment type and ordering"
```

### Task A2: Parse `--surface desktop-world` flag in the CLI

**Files:**
- Modify: `src/display/client.swift:184-189` (track parsing region) and the `ShowOptions` struct (search for `var track: String?` in the same file).

- [ ] **Step 1: Add the `surface` option to the parsed-options struct**

Find the struct that holds `track: String?` (alongside `at`, `anchor_window`, etc.) and add a peer:

```swift
var surface: String?  // "desktop-world" only, for now
```

- [ ] **Step 2: Parse the `--surface` flag**

In the flag-parsing switch (the one that contains `case "--track":` at lines ~184-189), add:

```swift
case "--surface":
    let value = nextCanvasArg(args, index: &i,
                              missingMessage: "--surface requires a target")
    guard value == "desktop-world" else {
        exitError("Unknown --surface target: \(value). Supported: desktop-world",
                  code: "INVALID_ARG")
    }
    options.surface = value
```

- [ ] **Step 3: Marshal `surface` into the request JSON**

Find where `options.track` is serialized into the daemon request body (search for `"track"` in client.swift). Add a peer line:

```swift
if let surface = options.surface { body["surface"] = surface }
```

- [ ] **Step 4: Rebuild and run a smoke check**

Run: `bash build.sh`
Run: `./aos show create --id smoke --html '<body>x</body>' --surface desktop-world` (only if daemon is up)
If the daemon is unavailable: skip the smoke run and verify with the request schema in task A3 instead.

- [ ] **Step 5: Commit**

```bash
git add src/display/client.swift
git commit -m "Parse --surface desktop-world CLI flag"
```

### Task A3: Add `surface` to the request schema and tighten the mutex

**Files:**
- Modify: `shared/schemas/daemon-request.schema.json:95-123` (`ShowCreateData`)

The spec recommends `--surface desktop-world` be mutually exclusive with all of `--at`, `--track`, `--anchor-window`, `--anchor-channel`. The existing `oneOf` already enforces that anchors and `at` are alternatives; we add a fifth alternative for `surface` and require it to be alone.

- [ ] **Step 1: Add the `surface` property and a fifth `oneOf` alternative**

Inside `ShowCreateData.properties`:

```json
"surface": { "type": "string", "enum": ["desktop-world"] }
```

Inside `ShowCreateData.oneOf`, append:

```json
{
  "required": ["surface"],
  "not": {
    "anyOf": [
      { "required": ["at"] },
      { "required": ["track"] },
      { "required": ["anchor_window"] },
      { "required": ["anchor_channel"] }
    ]
  }
}
```

- [ ] **Step 2: Add a schema test that `surface` accepts only `desktop-world`**

Files:
- Create: `tests/schemas/show-create-surface.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';

const schema = JSON.parse(readFileSync(
  new URL('../../shared/schemas/daemon-request.schema.json', import.meta.url)
));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema.$defs.ShowCreateData);

test('surface=desktop-world is accepted', () => {
  assert.equal(validate({ id: 'a', surface: 'desktop-world' }), true);
});

test('surface=other is rejected', () => {
  assert.equal(validate({ id: 'a', surface: 'union' }), false);
});

test('surface and track together are rejected', () => {
  assert.equal(validate({ id: 'a', surface: 'desktop-world', track: 'union' }), false);
});

test('surface and at together are rejected', () => {
  assert.equal(validate({ id: 'a', surface: 'desktop-world', at: [0,0,1,1] }), false);
});
```

- [ ] **Step 3: Run the schema test**

Run: `node --test tests/schemas/show-create-surface.test.mjs`
Expected: all four tests pass.

- [ ] **Step 4: Commit**

```bash
git add shared/schemas/daemon-request.schema.json tests/schemas/show-create-surface.test.mjs
git commit -m "Add surface=desktop-world to ShowCreateData with strict mutex"
```

### Task A4: Add CLI-side mutex check matching the schema

**Files:**
- Modify: `src/display/client.swift:238-239` (the `--track` ⊕ `--at` mutex)

The schema rejects bad combinations on the daemon side, but the CLI should fail fast with a friendlier error before sending the request.

- [ ] **Step 1: Replace the existing mutex with a generalized one**

Replace the existing two-line check with:

```swift
let exclusiveFlags: [(String, Bool)] = [
    ("--at", options.at != nil),
    ("--track", options.track != nil),
    ("--surface", options.surface != nil),
    ("--anchor-window", options.anchorWindow != nil),
    ("--anchor-channel", options.anchorChannel != nil),
]
let active = exclusiveFlags.filter { $0.1 }.map { $0.0 }
if active.count > 1 {
    exitError("cannot combine \(active.joined(separator: ", ")) (pick one)",
              code: "INVALID_ARG")
}
```

(If `options.anchorChannel` and `options.anchorWindow` use different field names in the actual struct, adapt to the real names.)

- [ ] **Step 2: Rebuild**

Run: `bash build.sh`

- [ ] **Step 3: Verify the error path manually**

Run: `./aos show create --id m --html '<body/>' --surface desktop-world --at 0,0,1,1`
Expected stderr: `cannot combine --at, --surface (pick one)` and non-zero exit.

If the daemon is down, this still works because the validation is client-side.

- [ ] **Step 4: Commit**

```bash
git add src/display/client.swift
git commit -m "Tighten CLI mutex for --at/--track/--surface/anchors"
```

### Task A5: Refactor `Canvas` into single-window vs. segmented variants

**Files:**
- Modify: `src/display/canvas.swift` (Canvas class around lines 169-310; CanvasManager around 589-700)

This is the central refactor. The strategy: keep `Canvas` as the single-window form for normal canvases, and introduce a `DesktopWorldSurfaceCanvas` peer that owns N `NSWindow` + `WKWebView` segments under one logical id. Both conform to a small protocol so `CanvasManager` can hold them in the same registry.

- [ ] **Step 1: Define the protocol**

Add to `src/display/desktop-world-surface.swift`:

```swift
protocol CanvasLike: AnyObject {
    var id: String { get }
    var isInteractive: Bool { get }
    var trackTarget: TrackTarget? { get }
    func toInfo() -> CanvasInfo
    func close()
    func evalAsync(_ script: String,
                   completion: @escaping (Result<Any?, Error>) -> Void)
    func postMessage(_ payload: [String: Any])
}
```

Add a conformance `extension Canvas: CanvasLike {}` in `src/display/canvas.swift`. The methods should already exist in some form on `Canvas`; if their signatures don't match, leave a single-line adapter so the existing `Canvas` shape is unchanged.

- [ ] **Step 2: Build to verify the protocol compiles against existing Canvas**

Run: `bash build.sh`
Expected: build succeeds. If not, adapt the protocol signatures to match `Canvas` exactly.

- [ ] **Step 3: Commit**

```bash
git add src/display/canvas.swift src/display/desktop-world-surface.swift
git commit -m "Introduce CanvasLike protocol over Canvas"
```

### Task A6: Implement `DesktopWorldSurfaceCanvas` with one segment per display

**Files:**
- Modify: `src/display/desktop-world-surface.swift`

This is the new physical implementation. Each segment is a `CanvasWindow` (`src/display/canvas.swift:114-141`) sized to its display's native bounds with a `WKWebView` loaded with the same URL/HTML.

- [ ] **Step 1: Implement the surface class**

```swift
final class DesktopWorldSurfaceCanvas: CanvasLike {
    let id: String
    let isInteractive: Bool
    var trackTarget: TrackTarget? { .union }

    private(set) var segments: [Segment]

    struct Segment {
        let displayID: UInt32
        var index: Int
        let nativeBounds: CGRect
        let dwBounds: CGRect
        let window: CanvasWindow
        let webView: WKWebView
    }

    private let url: URL?
    private let html: String?
    private let aosSchemeHandler: WKURLSchemeHandler?

    init(id: String, interactive: Bool, url: URL?, html: String?,
         aosSchemeHandler: WKURLSchemeHandler? = nil) {
        self.id = id
        self.isInteractive = interactive
        self.url = url
        self.html = html
        self.aosSchemeHandler = aosSchemeHandler
        self.segments = []
        self.rebuildSegments()
    }

    /// Rebuilds the segment set from the current display topology.
    /// Called on init and on every display reconfiguration.
    func rebuildSegments() {
        let displays = getDisplays()
        let nativeUnion = allDisplaysBounds()
        let unordered = displays.map { d -> DesktopWorldSurfaceSegment in
            let dw: [CGFloat] = [
                d.bounds.minX - nativeUnion.minX,
                d.bounds.minY - nativeUnion.minY,
                d.bounds.width, d.bounds.height
            ]
            let native: [CGFloat] = [
                d.bounds.minX, d.bounds.minY,
                d.bounds.width, d.bounds.height
            ]
            return DesktopWorldSurfaceSegment(
                displayID: d.id, index: 0, dwBounds: dw, nativeBounds: native)
        }
        let ordered = orderSegments(unordered)
        // Diff against existing segments; create/destroy windows as needed.
        // Implementation continues in the next step.
        applyOrderedSegments(ordered)
    }

    private func applyOrderedSegments(_ ordered: [DesktopWorldSurfaceSegment]) {
        // ... build/teardown loop, see step 2
    }

    func toInfo() -> CanvasInfo {
        // see task A8 — adds segments field
        return CanvasInfo(id: id, at: /* dw union */ [],
                          interactive: isInteractive,
                          track: "union",
                          segments: segments.map { s in
                            DesktopWorldSurfaceSegment(
                              displayID: s.displayID, index: s.index,
                              dwBounds: [s.dwBounds.minX, s.dwBounds.minY,
                                         s.dwBounds.width, s.dwBounds.height],
                              nativeBounds: [s.nativeBounds.minX, s.nativeBounds.minY,
                                             s.nativeBounds.width, s.nativeBounds.height])
                          })
    }

    func close() {
        for s in segments { s.window.orderOut(nil); s.window.close() }
        segments = []
    }

    func evalAsync(_ script: String,
                   completion: @escaping (Result<Any?, Error>) -> Void) {
        // see task A12 (eval fanout + primary-result election)
    }

    func postMessage(_ payload: [String: Any]) {
        // see task A11 (post fanout)
    }
}
```

- [ ] **Step 2: Implement `applyOrderedSegments` (build/teardown loop)**

```swift
private func applyOrderedSegments(_ ordered: [DesktopWorldSurfaceSegment]) {
    var byDisplay = Dictionary(uniqueKeysWithValues:
        segments.map { ($0.displayID, $0) })
    var newSegments: [Segment] = []
    var added: [Segment] = []
    var removed: [Segment] = []
    var changed: [Segment] = []

    for meta in ordered {
        let nativeRect = CGRect(x: meta.nativeBounds[0], y: meta.nativeBounds[1],
                                 width: meta.nativeBounds[2], height: meta.nativeBounds[3])
        let dwRect = CGRect(x: meta.dwBounds[0], y: meta.dwBounds[1],
                             width: meta.dwBounds[2], height: meta.dwBounds[3])
        if let existing = byDisplay.removeValue(forKey: meta.displayID) {
            // Display still present; resize if its bounds moved.
            if existing.nativeBounds != nativeRect || existing.index != meta.index {
                existing.window.setFrame(nativeRect, display: true)
                let updated = Segment(displayID: existing.displayID, index: meta.index,
                                       nativeBounds: nativeRect, dwBounds: dwRect,
                                       window: existing.window, webView: existing.webView)
                newSegments.append(updated)
                changed.append(updated)
            } else {
                newSegments.append(existing)
            }
        } else {
            // New display; build a new window+webview.
            let (window, webView) = makeSegmentWindow(at: nativeRect)
            let seg = Segment(displayID: meta.displayID, index: meta.index,
                              nativeBounds: nativeRect, dwBounds: dwRect,
                              window: window, webView: webView)
            newSegments.append(seg)
            added.append(seg)
        }
    }

    // Anything left in byDisplay was removed.
    for orphan in byDisplay.values {
        orphan.window.orderOut(nil)
        orphan.window.close()
        removed.append(orphan)
    }

    self.segments = newSegments

    // Lifecycle event emission lives in CanvasManager; expose deltas:
    self.lastDelta = (added: added, removed: removed, changed: changed,
                      settled: newSegments)
}

var lastDelta: (added: [Segment], removed: [Segment],
                changed: [Segment], settled: [Segment])?

private func makeSegmentWindow(at frame: CGRect) -> (CanvasWindow, WKWebView) {
    let window = CanvasWindow(contentRect: frame,
                               styleMask: [.borderless],
                               backing: .buffered,
                               defer: false,
                               isInteractive: isInteractive)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.level = isInteractive ? .floating : .statusBar
    window.ignoresMouseEvents = !isInteractive   // passthrough by default
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]

    let config = WKWebViewConfiguration()
    if let h = aosSchemeHandler { config.setURLSchemeHandler(h, forURLScheme: "aos") }
    let webView = WKWebView(frame: window.contentLayoutRect, configuration: config)
    webView.autoresizingMask = [.width, .height]
    webView.setValue(false, forKey: "drawsBackground")
    window.contentView = webView
    if let url = url { webView.load(URLRequest(url: url)) }
    else if let html = html { webView.loadHTMLString(html, baseURL: nil) }
    window.orderFront(nil)
    return (window, webView)
}
```

- [ ] **Step 3: Build**

Run: `bash build.sh`
Expected: success. If `CanvasWindow.init` signature differs, adapt the call to match `src/display/canvas.swift:114-141`.

- [ ] **Step 4: Commit**

```bash
git add src/display/desktop-world-surface.swift
git commit -m "Implement DesktopWorldSurfaceCanvas with per-display segments"
```

### Task A7: Wire `CanvasManager` to construct a `DesktopWorldSurfaceCanvas` for `--track union` and `--surface desktop-world`

**Files:**
- Modify: `src/display/canvas.swift:607-700` (`handleCreate`)

- [ ] **Step 1: Branch on the request**

Inside `handleCreate`, after the request is parsed, before constructing a `Canvas` for `track == .union` (current line ~660-671), branch:

```swift
let isDesktopWorldSurface =
    req.surface == "desktop-world" || req.track == "union"

if isDesktopWorldSurface {
    let surface = DesktopWorldSurfaceCanvas(
        id: req.id,
        interactive: req.interactive ?? false,
        url: req.url.flatMap { URL(string: $0) },
        html: req.html,
        aosSchemeHandler: self.aosSchemeHandler
    )
    canvases[req.id] = surface
    emitLifecycle(surface, action: "created")
    emitSegmentDeltas(surface)   // see Task A10
    return CanvasResponse.ok([:])
}
```

(Path-name details: if the registry is typed `[String: Canvas]` today, widen it to `[String: CanvasLike]`.)

- [ ] **Step 2: Build and run the existing capture-union test (informational only)**

Run: `bash build.sh`
If daemon is up: `bash tests/capture-union-canvas-surface.sh`
Expected: this is informational — the test will likely fail until A10 emits segment metadata. Note the failure shape for reference.

- [ ] **Step 3: Commit**

```bash
git add src/display/canvas.swift
git commit -m "Route --track union and --surface desktop-world to DesktopWorldSurfaceCanvas"
```

### Task A8: Extend `CanvasInfo` with `segments`

**Files:**
- Modify: `src/display/protocol.swift:91-105`

- [ ] **Step 1: Add the field**

```swift
struct CanvasInfo: Codable {
    let id: String
    var at: [CGFloat]
    var anchorWindow: Int?
    var anchorChannel: String?
    var offset: [CGFloat]?
    var interactive: Bool
    var ttl: Double?
    var scope: String?
    var autoProject: String?
    var track: String?
    var parent: String?
    var cascade: Bool?
    var suspended: Bool?
    var segments: [DesktopWorldSurfaceSegment]?   // present iff desktop-world surface

    enum CodingKeys: String, CodingKey {
        case id, at
        case anchorWindow = "anchor_window"
        case anchorChannel = "anchor_channel"
        case offset, interactive, ttl, scope
        case autoProject = "auto_project"
        case track, parent, cascade, suspended, segments
    }
}
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: success. Existing `CanvasInfo(...)` constructions may need a trailing `segments: nil` argument; fix call sites the compiler reports.

- [ ] **Step 3: Update the response schema if one exists**

If `shared/schemas/daemon-event.schema.json` or a peer documents `CanvasInfo`, add `segments` as an optional array of objects with `display_id`, `index`, `dw_bounds` (4 numbers), `native_bounds` (4 numbers). If no such schema exists, this step is a no-op.

- [ ] **Step 4: Commit**

```bash
git add src/display/protocol.swift shared/schemas/
git commit -m "Add segments field to CanvasInfo"
```

### Task A9: Detect display reconfiguration and rebuild segments

**Files:**
- Modify: `src/display/desktop-world-surface.swift`
- Modify: `src/display/canvas.swift` (display-change observer; search for an existing `CGDisplayRegisterReconfigurationCallback` or `NSApplication.didChangeScreenParametersNotification` registration)

- [ ] **Step 1: Find the existing display-change observer**

Search the daemon for `didChangeScreenParameters` or `CGDisplayRegisterReconfigurationCallback`. There is at least one already; the existing single-window union canvas needs to react to display changes.

- [ ] **Step 2: On display change, call `rebuildSegments` on every desktop-world surface**

In the existing observer's handler, after the topology snapshot is updated:

```swift
for case let surface as DesktopWorldSurfaceCanvas in canvases.values {
    surface.rebuildSegments()
    emitSegmentDeltas(surface)   // see A10
}
```

- [ ] **Step 3: Commit**

```bash
git add src/display/canvas.swift src/display/desktop-world-surface.swift
git commit -m "Rebuild DesktopWorldSurface segments on display reconfiguration"
```

### Task A10: Emit segment lifecycle sub-events

**Files:**
- Modify: `src/daemon/unified.swift:402-429` (`canvasLifecyclePayload`, `publishCanvasLifecycle`)
- Modify: `src/display/canvas.swift` (`emitLifecycle`, plus a new `emitSegmentDeltas` helper)

- [ ] **Step 1: Add segment-delta event types**

In `src/daemon/unified.swift`, peer to `canvasLifecyclePayload`, add:

```swift
func canvasSegmentEventPayload(action: String, canvasID: String,
                                segment: DesktopWorldSurfaceSegment) -> [String: Any] {
    [
        "canvas_id": canvasID,
        "action": action,                 // "added" | "removed" | "changed"
        "display_id": Int(segment.displayID),
        "index": segment.index,
        "dw_bounds": segment.dwBounds,
        "native_bounds": segment.nativeBounds,
    ]
}

func canvasTopologySettledPayload(canvasID: String,
                                   segments: [DesktopWorldSurfaceSegment]) -> [String: Any] {
    [
        "canvas_id": canvasID,
        "segments": segments.map {
            [
                "display_id": Int($0.displayID),
                "index": $0.index,
                "dw_bounds": $0.dwBounds,
                "native_bounds": $0.nativeBounds,
            ] as [String: Any]
        },
    ]
}
```

- [ ] **Step 2: Add an `emitSegmentDeltas` helper on `CanvasManager`**

```swift
func emitSegmentDeltas(_ surface: DesktopWorldSurfaceCanvas) {
    guard let delta = surface.lastDelta else { return }
    for s in delta.added {
        let p = canvasSegmentEventPayload(action: "added",
                                           canvasID: surface.id,
                                           segment: segmentMeta(s))
        broadcastEvent(service: "display", event: "canvas_segment_added", data: p)
    }
    for s in delta.removed {
        let p: [String: Any] = [
            "canvas_id": surface.id,
            "display_id": Int(s.displayID),
        ]
        broadcastEvent(service: "display", event: "canvas_segment_removed", data: p)
    }
    for s in delta.changed {
        let p = canvasSegmentEventPayload(action: "changed",
                                           canvasID: surface.id,
                                           segment: segmentMeta(s))
        broadcastEvent(service: "display", event: "canvas_segment_changed", data: p)
    }
    let settled = canvasTopologySettledPayload(canvasID: surface.id,
                                                segments: delta.settled.map(segmentMeta))
    broadcastEvent(service: "display", event: "canvas_topology_settled", data: settled)
}

private func segmentMeta(_ s: DesktopWorldSurfaceCanvas.Segment) -> DesktopWorldSurfaceSegment {
    DesktopWorldSurfaceSegment(
        displayID: s.displayID, index: s.index,
        dwBounds: [s.dwBounds.minX, s.dwBounds.minY, s.dwBounds.width, s.dwBounds.height],
        nativeBounds: [s.nativeBounds.minX, s.nativeBounds.minY,
                        s.nativeBounds.width, s.nativeBounds.height])
}
```

- [ ] **Step 3: Build and commit**

```bash
bash build.sh
git add src/display/canvas.swift src/daemon/unified.swift
git commit -m "Emit canvas_segment_* lifecycle sub-events"
```

### Task A11: Subscription bootstrap delivers a synthetic `canvas_topology_settled`

**Files:**
- Modify: `src/daemon/unified.swift` (subscription handler — search for where `canvas_lifecycle` is initially delivered to a new subscriber; this typically lives near `fanOutCanvasLifecycle` at lines 528-543).

- [ ] **Step 1: Find the bootstrap path**

Search for the function that initializes a new subscriber to `canvas_lifecycle`. There may be a snapshot helper that walks `canvases` and emits a synthetic `created` event for each. If not, this is the first subscription that needs a bootstrap.

- [ ] **Step 2: For each desktop-world surface, emit a settled event before any other event**

In the bootstrap loop:

```swift
for canvas in canvases.values {
    // existing per-canvas bootstrap (e.g. created event) ...
    if let surface = canvas as? DesktopWorldSurfaceCanvas {
        let segs = surface.segments.map { segmentMeta($0) }
        let payload = canvasTopologySettledPayload(canvasID: surface.id, segments: segs)
        deliverEventToSubscriber(subscriber, service: "display",
                                  event: "canvas_topology_settled", data: payload)
    }
}
```

- [ ] **Step 3: Add a bootstrap-ordering test**

Files:
- Create: `tests/desktop-world-surface-bootstrap.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
. tests/lib/isolated-daemon.sh
ROOT="$(mktemp -d)"
aos_test_start_daemon "$ROOT"
trap 'aos_test_stop_daemon' EXIT

./aos show create --id dws-boot --html '<body/>' --surface desktop-world >/dev/null

# Subscribe and collect first event for the surface.
out="$(./aos show subscribe --canvas dws-boot --max-events 1 --timeout 2)"
echo "$out" | python3 -c '
import json, sys
events = [json.loads(line) for line in sys.stdin if line.strip()]
assert events, "no events received"
first = events[0]
assert first.get("event") == "canvas_topology_settled", f"first event was {first.get(\"event\")}"
assert "segments" in first.get("data", {}), "settled event missing segments field"
print("ok")
'
```

(Adapt `aos show subscribe` to whatever the actual subscription CLI is. If there is no subscribe CLI, write the test as a JS file using the daemon HTTP IPC the same way other JS tests do.)

- [ ] **Step 4: Run the test**

Requires a working daemon. If unavailable, mark the test as skipped and note in the commit message.

Run: `bash tests/desktop-world-surface-bootstrap.sh`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/unified.swift tests/desktop-world-surface-bootstrap.sh
git commit -m "Bootstrap subscribers with canvas_topology_settled first"
```

### Task A12: post/eval fanout with primary-result election for eval

**Files:**
- Modify: `src/display/desktop-world-surface.swift` (`evalAsync`, `postMessage`)
- Modify: `src/display/canvas.swift` (`handleEval`, `handlePost` — search for these handlers)

- [ ] **Step 1: Implement `postMessage` fanout**

```swift
func postMessage(_ payload: [String: Any]) {
    let json = (try? JSONSerialization.data(withJSONObject: payload, options: []))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    let script = "window.postMessage(\(json), '*')"
    for s in segments {
        s.webView.evaluateJavaScript(script, completionHandler: nil)
    }
}
```

- [ ] **Step 2: Implement `evalAsync` with primary-result election**

```swift
func evalAsync(_ script: String,
               completion: @escaping (Result<Any?, Error>) -> Void) {
    guard let primary = segments.first else {
        completion(.failure(NSError(domain: "DesktopWorldSurface", code: 1,
                                     userInfo: [NSLocalizedDescriptionKey:
                                       "no segments active"])))
        return
    }
    var primaryResult: Result<Any?, Error>?
    let group = DispatchGroup()

    for s in segments {
        group.enter()
        s.webView.evaluateJavaScript(script) { value, error in
            if s.displayID == primary.displayID {
                if let error = error { primaryResult = .failure(error) }
                else { primaryResult = .success(value) }
            }
            group.leave()
        }
    }

    group.notify(queue: .main) {
        completion(primaryResult ?? .failure(NSError(domain: "DesktopWorldSurface",
                                                      code: 2,
                                                      userInfo: [NSLocalizedDescriptionKey:
                                                        "primary segment did not respond"])))
    }
}
```

- [ ] **Step 3: Route `handleEval` and `handlePost` through `CanvasLike`**

In `src/display/canvas.swift`, the eval/post handlers currently access `Canvas` directly. Switch them to use the protocol so `DesktopWorldSurfaceCanvas` is exercised on the same code path:

```swift
guard let target = canvases[req.id] else { return CanvasResponse.notFound(req.id) }
target.evalAsync(script) { result in /* existing completion handling */ }
```

- [ ] **Step 4: Build and commit**

```bash
bash build.sh
git add src/display/canvas.swift src/display/desktop-world-surface.swift
git commit -m "Fan out post/eval to all segments; eval returns primary result"
```

### Task A13: Update the capture-union test to validate the new contract

**Files:**
- Modify: `tests/capture-union-canvas-surface.sh`

The test already asserts `surfaces[0].segments[]`. After Phase A, the segments returned by `aos see capture` should align (1:1, by `display_id`) with the segments emitted on `canvas_topology_settled`.

- [ ] **Step 1: Add an assertion that the capture's segments match `aos show list`**

After the existing capture assertions, add:

```bash
list_json="$(./aos show list --json)"
echo "$list_json" | python3 -c '
import json, sys
data = json.load(sys.stdin)
target = next(c for c in data["canvases"] if c["id"] == "union-probe")
segments = target.get("segments")
assert segments is not None, "show list missing segments for desktop-world surface"
ids = sorted(s["display_id"] for s in segments)
print("show-list segment display_ids:", ids)
'
```

Then assert the same set against the capture's `segments[].display_id` list.

- [ ] **Step 2: Run the test**

Requires a working daemon and ≥2 displays. If unavailable, skip and note in the commit.

Run: `bash tests/capture-union-canvas-surface.sh`
Expected: passes; segment ids match between `show list` and `see capture`.

- [ ] **Step 3: Commit**

```bash
git add tests/capture-union-canvas-surface.sh
git commit -m "Validate show-list segments match capture segments"
```

**Phase A complete.** This is a natural PR boundary. The daemon primitive ships with `--track union` reinterpreted, `--surface desktop-world` available, segment lifecycle sub-events, bootstrap snapshot, post/eval fanout with primary-elected eval results, and an updated capture test. No callers have to change.

---

## Phase B — Toolkit DesktopWorldSurface base + 2D adapter + inspector

### Task B1: Toolkit `DesktopWorldSurfaceAdapter` base class

**Files:**
- Create: `packages/toolkit/runtime/desktop-world-surface.js`

- [ ] **Step 1: Implement the base class**

```js
import {
  nativeToDesktopWorldPoint,
  computeDesktopWorldBounds,
} from './spatial.js';

/**
 * Runtime base for DesktopWorldSurface adapters. One instance per segment
 * web view. The host is expected to expose subscribe/post/eval primitives
 * via a `host` object (the same object Sigil's main.js uses).
 */
export class DesktopWorldSurfaceAdapter {
  constructor({ host, canvasId }) {
    this.host = host;
    this.canvasId = canvasId;
    this.segment = null;          // this segment's metadata
    this.topology = [];           // ordered list of all segments
    this._appHandlers = {};
    this._unsubscribe = null;
  }

  /** Boot. Resolves once the first canvas_topology_settled arrives. */
  async start(appHandlers) {
    this._appHandlers = appHandlers;
    return new Promise((resolve) => {
      this._unsubscribe = this.host.subscribe(['canvas_lifecycle'], { snapshot: true })
        .on((event) => this._handleLifecycleEvent(event, resolve));
    });
  }

  _handleLifecycleEvent(event, resolveFirst) {
    if (event.event !== 'canvas_topology_settled') return;
    if (event.data.canvas_id !== this.canvasId) return;
    const wasPrimary = this.isPrimary;
    this.topology = event.data.segments;
    this.segment = this._identifyOwnSegment(this.topology);
    if (resolveFirst) {
      this._appHandlers.onInit?.({
        segment: this.segment, topology: this.topology, surface: this,
      });
      resolveFirst();
    } else {
      this._appHandlers.onTopologyChange?.(this.topology);
      const isNowPrimary = this.isPrimary;
      if (!wasPrimary && isNowPrimary) this._appHandlers.becamePrimary?.();
      if (wasPrimary && !isNowPrimary) this._appHandlers.lostPrimary?.();
    }
  }

  /** Identify which segment this web view is rendering. Implemented by adapter. */
  _identifyOwnSegment(_topology) {
    throw new Error('adapter must implement _identifyOwnSegment');
  }

  get isPrimary() {
    return this.segment?.index === 0;
  }

  runOnPrimary(fn) {
    if (this.isPrimary) return fn();
    return undefined;
  }

  /** Adapter input pipeline: native → DesktopWorld → app. */
  feedInput(nativeEvent) {
    const dw = nativeToDesktopWorldPoint(
      { x: nativeEvent.x, y: nativeEvent.y }, this.topology.map((s) => ({
        bounds: { x: s.native_bounds[0], y: s.native_bounds[1],
                  w: s.native_bounds[2], h: s.native_bounds[3] }
      })),
    );
    this._appHandlers.onInput?.({ ...nativeEvent, dwX: dw?.x, dwY: dw?.y });
  }
}
```

- [ ] **Step 2: Add a unit test**

Files:
- Create: `tests/toolkit/desktop-world-surface.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopWorldSurfaceAdapter } from '../../packages/toolkit/runtime/desktop-world-surface.js';

class StubAdapter extends DesktopWorldSurfaceAdapter {
  _identifyOwnSegment(topology) { return topology[0]; }
}

test('isPrimary reflects index === 0', async () => {
  const events = [];
  const fakeHost = {
    subscribe: () => ({
      on: (cb) => {
        events.push(cb);
        cb({ event: 'canvas_topology_settled', data: {
          canvas_id: 'a',
          segments: [{ display_id: 1, index: 0,
                       dw_bounds: [0,0,100,100], native_bounds: [0,0,100,100] }],
        }});
      },
    }),
  };
  const a = new StubAdapter({ host: fakeHost, canvasId: 'a' });
  await a.start({});
  assert.equal(a.isPrimary, true);
  assert.equal(a.runOnPrimary(() => 42), 42);
});

test('runOnPrimary returns undefined for followers', () => {
  const a = new StubAdapter({ host: { subscribe: () => ({ on: () => {} }) },
                              canvasId: 'a' });
  a.segment = { index: 1 };
  assert.equal(a.runOnPrimary(() => 42), undefined);
});
```

- [ ] **Step 3: Run the test**

Run: `node --test tests/toolkit/desktop-world-surface.test.mjs`
Expected: 2 passing.

- [ ] **Step 4: Commit**

```bash
git add packages/toolkit/runtime/desktop-world-surface.js \
        tests/toolkit/desktop-world-surface.test.mjs
git commit -m "Add DesktopWorldSurfaceAdapter toolkit base class"
```

### Task B2: 2D renderer adapter (DOM)

**Files:**
- Create: `packages/toolkit/runtime/desktop-world-surface-2d.js`

- [ ] **Step 1: Implement the 2D adapter**

```js
import { DesktopWorldSurfaceAdapter } from './desktop-world-surface.js';

export class DesktopWorldSurface2D extends DesktopWorldSurfaceAdapter {
  /**
   * In 2D mode every segment renders the same logical scene with a
   * CSS transform that translates the world origin so DesktopWorld
   * (segment.dw_bounds.x, segment.dw_bounds.y) lands at (0,0) of this
   * segment's viewport.
   */
  _identifyOwnSegment(topology) {
    const myDisplayId = window.__aosSegmentDisplayId;  // injected per webview
    return topology.find((s) => s.display_id === myDisplayId) ?? topology[0];
  }

  worldOrigin() {
    if (!this.segment) return { x: 0, y: 0 };
    return { x: -this.segment.dw_bounds[0], y: -this.segment.dw_bounds[1] };
  }

  /** Apply the world-origin translation to a root DOM node. */
  applyWorldTransform(rootNode) {
    const { x, y } = this.worldOrigin();
    rootNode.style.transform = `translate(${x}px, ${y}px)`;
    rootNode.style.transformOrigin = '0 0';
  }
}
```

- [ ] **Step 2: Add a transform test**

Files:
- Create: `tests/toolkit/desktop-world-surface-2d.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopWorldSurface2D } from '../../packages/toolkit/runtime/desktop-world-surface-2d.js';

test('worldOrigin translates by -segment dw_bounds', () => {
  const a = new DesktopWorldSurface2D({ host: { subscribe: () => ({ on: () => {} }) },
                                         canvasId: 'a' });
  a.segment = { dw_bounds: [1920, 0, 1920, 1080] };
  assert.deepEqual(a.worldOrigin(), { x: -1920, y: 0 });
});
```

- [ ] **Step 3: Run the test**

Run: `node --test tests/toolkit/desktop-world-surface-2d.test.mjs`
Expected: 1 passing.

- [ ] **Step 4: Commit**

```bash
git add packages/toolkit/runtime/desktop-world-surface-2d.js \
        tests/toolkit/desktop-world-surface-2d.test.mjs
git commit -m "Add DesktopWorldSurface2D adapter"
```

### Task B3: Daemon hint — inject the segment display id into each segment web view

**Files:**
- Modify: `src/display/desktop-world-surface.swift` (`makeSegmentWindow`)

The 2D adapter (and the future Three.js adapter) needs to know which display id corresponds to its web view. Inject it as a global before any user script runs.

- [ ] **Step 1: Inject `window.__aosSegmentDisplayId` and `window.__aosSurfaceCanvasId`**

In `makeSegmentWindow`, after the `WKWebView` is created and before `webView.load(...)`:

```swift
let userScript = WKUserScript(
    source: "window.__aosSegmentDisplayId = \(displayID); " +
            "window.__aosSurfaceCanvasId = \(idJsLiteral);",
    injectionTime: .atDocumentStart,
    forMainFrameOnly: true)
config.userContentController.addUserScript(userScript)
```

The `idJsLiteral` is `id` JSON-encoded. `displayID` is the `UInt32` from the segment metadata. Pass them into `makeSegmentWindow` from the caller.

- [ ] **Step 2: Build, commit**

```bash
bash build.sh
git add src/display/desktop-world-surface.swift
git commit -m "Inject segment display id into each segment web view"
```

### Task B4: Inspector list view shows expandable segments

**Files:**
- Modify: `packages/toolkit/components/canvas-inspector/index.js:332-391` (`renderTreeNode` + `renderCanvasRow`)

- [ ] **Step 1: Render desktop-world surface rows expanded with segment children**

Adjust `renderCanvasRow(c, depth)` to detect `c.segments` and render an expandable parent + a child row per segment:

```js
function renderCanvasRow(c, depth) {
  if (Array.isArray(c.segments)) {
    return renderSurfaceRow(c, depth);
  }
  // ... existing rendering
}

function renderSurfaceRow(c, depth) {
  const header = `
    <div class="tree-row surface" data-id="${escapeHtml(c.id)}">
      <span class="canvas-id">${escapeHtml(c.id)}</span>
      <span class="canvas-kind">desktop-world</span>
      <span class="canvas-flags">${c.segments.length} segment${c.segments.length === 1 ? '' : 's'}</span>
    </div>`;
  const children = c.segments.map((s) => `
    <div class="tree-row surface-segment" data-display-id="${s.display_id}">
      <span class="seg-index">[${s.index}]</span>
      <span class="seg-display">display ${s.display_id}</span>
      <span class="seg-bounds">dw(${s.dw_bounds.join(',')})</span>
    </div>`).join('');
  return header + children;
}
```

- [ ] **Step 2: Add a JS test for the rendering**

Files:
- Create: `tests/toolkit/canvas-inspector-segments.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCanvasRow } from '../../packages/toolkit/components/canvas-inspector/index.js';

test('renderCanvasRow emits segment children for desktop-world surfaces', () => {
  const html = renderCanvasRow({
    id: 'avatar',
    segments: [
      { display_id: 1, index: 0, dw_bounds: [0,0,1920,1080], native_bounds: [0,0,1920,1080] },
      { display_id: 2, index: 1, dw_bounds: [1920,0,1920,1080], native_bounds: [1920,0,1920,1080] },
    ],
  }, 0);
  assert.match(html, /desktop-world/);
  assert.match(html, /2 segments/);
  assert.match(html, /\[0\][\s\S]*display 1/);
  assert.match(html, /\[1\][\s\S]*display 2/);
});
```

(If `renderCanvasRow` is not currently exported, export it for testing as a peer change.)

- [ ] **Step 3: Run the test**

Run: `node --test tests/toolkit/canvas-inspector-segments.test.mjs`
Expected: 1 passing.

- [ ] **Step 4: Commit**

```bash
git add packages/toolkit/components/canvas-inspector/index.js \
        tests/toolkit/canvas-inspector-segments.test.mjs
git commit -m "Render desktop-world surfaces with expandable segments in inspector"
```

**Phase B complete.** Toolkit base + 2D adapter + inspector polish are mergeable as one PR. They depend on Phase A landing (for `segments` to appear in `CanvasInfo` and for `canvas_topology_settled` to be emitted). They do not depend on the Three.js spike.

---

## Phase C — Three.js validation spike (gates Phase D)

The output of Phase C is a written go/no-go decision document, not production code. The spike answers three questions: visual coherence across segments, latency from primary state mutation to follower render, and CPU/GPU cost per segment.

### Task C1: Throwaway Three.js shared-state surface

**Files:**
- Create: `_dev/spikes/desktop-world-three-spike/index.html`
- Create: `_dev/spikes/desktop-world-three-spike/scene.js`
- Create: `_dev/spikes/desktop-world-three-spike/README.md`

This is `_dev` (non-canonical) and not shipped.

- [ ] **Step 1: Build a minimum scene**

A single rotating cube centered in DesktopWorld. Each segment runs the same `scene.js`, instantiates the toolkit's 2D adapter to get its segment metadata, and renders a `THREE.OrthographicCamera` (or off-axis perspective) carved by the segment's DesktopWorld bounds.

The scene's logical state is `{ avatarPos: { x, y }, t }`. The primary mutates `t` each frame and broadcasts via `BroadcastChannel('dws-spike')` (and as a fallback path, via `host.post`). Followers apply the broadcast and render their slice.

- [ ] **Step 2: Run on a multi-display setup and capture a video**

This requires a working daemon and ≥2 displays. The spike's success criterion is: a smooth-moving avatar that stays visually coherent across the segment seam.

- [ ] **Step 3: Write the decision document**

Files:
- Create: `_dev/spikes/desktop-world-three-spike/decision.md`

Sections:
- Visual coherence: pass/fail, with screenshots.
- Latency: median and p95 from primary-state-update to follower-render, measured.
- CPU/GPU cost: per segment, measured.
- Decision: GO / NO-GO for Sigil migration. If NO-GO, what alternative strategy to explore.

- [ ] **Step 4: Commit the spike artifacts**

```bash
git add _dev/spikes/desktop-world-three-spike/
git commit -m "Spike: Three.js shared-state across DesktopWorldSurface segments"
```

### Task C2: Display hot-plug under animation

- [ ] **Step 1: With the spike running, add and remove a display**

Trigger via System Settings or by physically connecting/disconnecting a monitor. Validate: the new segment renders within ≤ 1 second of the `canvas_segment_added` event; existing segments do not flicker; primary election survives if the previous primary's display was removed.

- [ ] **Step 2: Append observations to `decision.md`**

Capture pass/fail for each scenario.

- [ ] **Step 3: Commit**

```bash
git add _dev/spikes/desktop-world-three-spike/decision.md
git commit -m "Spike: hot-plug observations"
```

### Task C3: Capture composition decision

- [ ] **Step 1: Run `aos see capture` against the spike surface**

Validate that the existing capture path either returns one composited image or returns per-segment images. Decide which the production path should commit to and document in `decision.md`.

- [ ] **Step 2: Commit**

```bash
git add _dev/spikes/desktop-world-three-spike/decision.md
git commit -m "Spike: capture composition decision"
```

**Phase C complete.** A go/no-go is on file. If GO, Phase D proceeds. If NO-GO, the design returns to brainstorming with the spike's evidence as input.

---

## Phase D — Sigil migration (depends on Phase B + Phase C GO)

### Task D1: Classify Sigil renderer boot side effects

**Files:**
- Create: `docs/superpowers/notes/2026-04-25-sigil-boot-classification.md`

This is analysis-only. No code changes.

- [ ] **Step 1: Walk `apps/sigil/renderer/live-modules/main.js` boot sequence and classify each side effect**

Source citations from the implementation reference:
- `host.install()` — line 591
- `host.onMessage(handleHostMessage)` — line 592
- `overlay.mount()` — line 593
- `visibilityTransition.mount()` — line 594
- `fastTravel.mount()` — line 595
- `host.subscribe([...])` — line 596
- `startMarkHeartbeat()` — line 597
- `hitTarget.ensureCreated()` — line 598
- `initScene()` and the animation loop

For each, record:
- name + line
- classification: **once-per-surface** (gate behind `runOnPrimary`) or **per-segment** (run unchanged in every web view)
- reasoning

Default classification:
- `host.install`, `host.onMessage`, `host.subscribe`, `startMarkHeartbeat`, `hitTarget.ensureCreated` — once-per-surface (they have observable global side effects)
- `overlay.mount`, `visibilityTransition.mount`, `fastTravel.mount`, `initScene`, animation loop — per-segment (they manipulate the local DOM/canvas)

The note also identifies the bounds clamp at `apps/sigil/renderer/live-modules/main.js:545-554` for removal in D4.

- [ ] **Step 2: Commit the analysis note**

```bash
git add docs/superpowers/notes/2026-04-25-sigil-boot-classification.md
git commit -m "Classify Sigil renderer boot side effects for DesktopWorldSurface"
```

### Task D2: Implement the Three.js adapter

**Files:**
- Create: `packages/toolkit/runtime/desktop-world-surface-three.js`

Implement the strategy validated in Phase C. Carry forward the `_identifyOwnSegment`, viewport/camera setup, and shared-state replication chosen in the spike's decision document.

- [ ] **Step 1: Build the adapter following the spike's decision**

The exact code depends on the spike outcome. The adapter must extend `DesktopWorldSurfaceAdapter`, expose a `mountScene(scene, options)` method that wires the adapter's segment metadata into a `THREE.Camera`, and apply state updates to the local scene without re-running primary-only logic.

- [ ] **Step 2: Add a unit test for camera frustum derivation**

Files:
- Create: `tests/toolkit/desktop-world-surface-three.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOrthoCamera } from '../../packages/toolkit/runtime/desktop-world-surface-three.js';

test('derives ortho camera carved to segment bounds', () => {
  const cam = deriveOrthoCamera({
    dw_bounds: [1920, 0, 1920, 1080],
  });
  assert.equal(cam.left, 1920);
  assert.equal(cam.right, 3840);
  assert.equal(cam.top, 0);
  assert.equal(cam.bottom, 1080);
});
```

(Adapt to whatever the adapter's actual derivation function is named.)

- [ ] **Step 3: Run the test, commit**

Run: `node --test tests/toolkit/desktop-world-surface-three.test.mjs`

```bash
git add packages/toolkit/runtime/desktop-world-surface-three.js \
        tests/toolkit/desktop-world-surface-three.test.mjs
git commit -m "Add DesktopWorldSurface Three.js adapter"
```

### Task D3: Refactor Sigil's renderer to use the Three.js adapter

**Files:**
- Modify: `apps/sigil/renderer/live-modules/main.js` (boot sequence around lines 590-599; render loop around line 120)

- [ ] **Step 1: Construct the adapter at boot, before existing side effects**

```js
import { DesktopWorldSurface3D } from '@aos/toolkit/runtime/desktop-world-surface-three.js';

const surface = new DesktopWorldSurface3D({
  host, canvasId: window.__aosSurfaceCanvasId,
});
await surface.start({
  onInit({ segment, topology, surface }) {
    // per-segment side effects:
    overlay.mount();
    visibilityTransition.mount();
    fastTravel.mount();
    initScene();
    surface.mountScene(scene, /* opts */);
    renderLoop.schedule(animate);

    // once-per-surface side effects:
    surface.runOnPrimary(() => {
      host.install();
      host.onMessage(handleHostMessage);
      host.subscribe(['display_geometry', 'input_event', 'canvas_message'],
                      { snapshot: true });
      startMarkHeartbeat();
      hitTarget.ensureCreated().catch(/* existing error handler */);
    });
  },

  onTopologyChange(topology) {
    surface.refreshCamera();   // re-derive frustum after segment moved
  },

  becamePrimary() {
    // start primary-only side effects on failover
    host.subscribe(['display_geometry', 'input_event', 'canvas_message'],
                    { snapshot: true });
    startMarkHeartbeat();
    hitTarget.ensureCreated().catch(/* existing error handler */);
  },

  lostPrimary() {
    host.unsubscribeAll();   // adapt to actual host API
    stopMarkHeartbeat();
    hitTarget.dispose();
  },

  onInput(event) { /* dispatch into existing input handlers */ },
});
```

- [ ] **Step 2: Build (no daemon needed)**

JavaScript only; no `bash build.sh` required.

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/renderer/live-modules/main.js
git commit -m "Sigil: route renderer boot through DesktopWorldSurface3D"
```

### Task D4: Remove the legacy bounds clamp

**Files:**
- Modify: `apps/sigil/renderer/live-modules/main.js:545-554`

The current spec references `apps/sigil/renderer/index.html:2917-2940` but the actual clamp lives in `live-modules/main.js`. Remove only after D3 validates that segment-aware rendering keeps the avatar visible without the safety net.

- [ ] **Step 1: Remove the `if (outside) { ... }` block at lines 545-554**

```js
// remove:
// if (outside) {
//   const clamped = clampPointToDisplays(liveJs.displays, liveJs.avatarPos.x, liveJs.avatarPos.y);
//   liveJs.avatarPos = { x: clamped.x, y: clamped.y, valid: true };
// }
```

Also remove the now-unused `clampPointToDisplays` import at the top of the file if no other usage remains.

- [ ] **Step 2: Run Sigil interactively (requires daemon + Sigil app)**

Drag the avatar across display boundaries; verify it stays visible without the clamp.

- [ ] **Step 3: Commit**

```bash
git add apps/sigil/renderer/live-modules/main.js
git commit -m "Sigil: remove legacy bounds clamp post-segmented rendering"
```

### Task D5: Update `tests/sigil-avatar-interactions.sh`

**Files:**
- Modify: `tests/sigil-avatar-interactions.sh`

The avatar lifecycle now goes through the toolkit adapter. Snapshot probes (`__sigilDebug.snapshot()`) should keep working but may need to surface segment metadata.

- [ ] **Step 1: Run the existing test against the migrated code**

Requires daemon + Sigil. Note any failures and adjust the test (not the production code) to validate the new adapter-driven boot.

- [ ] **Step 2: Add a multi-segment assertion**

After the existing `displays.length > 0` check, add:

```bash
./aos show eval --id avatar-main "JSON.stringify(window.__aosSegmentDisplayId)" \
  | python3 -c 'import sys, json; v = json.loads(sys.stdin.read().strip()); assert v is not None; print("segment id:", v)'
```

- [ ] **Step 3: Run and commit**

```bash
bash tests/sigil-avatar-interactions.sh
git add tests/sigil-avatar-interactions.sh
git commit -m "Sigil interactions: assert segment metadata present"
```

**Phase D complete.** Sigil is on the new primitive. The legacy clamp is gone. Tests pass.

---

## Phase E — Spec correction

The spec at `docs/superpowers/specs/2026-04-25-desktop-world-surface-design.md` references the legacy clamp at `apps/sigil/renderer/index.html:2917-2940`, but the actual location is `apps/sigil/renderer/live-modules/main.js:545-554` (verified during this plan's exploration). Fix the reference.

### Task E1: Fix the clamp file:line reference in the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-04-25-desktop-world-surface-design.md`

- [ ] **Step 1: Update the two references**

Change the two occurrences of `apps/sigil/renderer/index.html:2917-2940` (one in the migration table's "After" column, one in the References list) to `apps/sigil/renderer/live-modules/main.js:545-554`.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-25-desktop-world-surface-design.md
git commit -m "Spec: correct legacy clamp file:line reference"
```

This task can land at any time; it does not gate any other work.

---

## Self-review

**Spec coverage:**
- Primitive contract (one canvas_id, ordered segments, no daemon-side primary): A1, A6, A10
- `--track union` reinterpretation + `--surface desktop-world`: A2, A3, A4, A7
- `CanvasInfo.segments` snapshot: A8
- `canvas_segment_added/removed/changed/topology_settled` events: A10
- Subscription bootstrap delivers settled-first: A11
- post/eval fanout with primary-result election: A12
- Capture-test alignment: A13
- Toolkit adapter base + `runOnPrimary` + becamePrimary/lostPrimary: B1
- 2D adapter: B2
- Three.js spike: C1, C2, C3
- Sigil migration: D1 (classification), D3 (refactor), D4 (clamp removal), D5 (tests)
- Inspector list view shows expandable segments: B4
- Stricter CLI mutex: A3 (schema), A4 (CLI)
- Multi-webview boot contract enforcement: D1 (classification), D3 (gating)
- Spec correction (clamp path): E1

**Placeholder scan:** No "TBD"/"TODO"; one unavoidable phrase in D2 ("the exact code depends on the spike outcome") — mitigated by an example test that locks the function name and shape, plus the spike decision document being a hard prerequisite for D2 to start.

**Type consistency:** `DesktopWorldSurfaceSegment` (Swift) and the JSON shape `{ display_id, index, dw_bounds, native_bounds }` (events + `CanvasInfo.segments`) match throughout. `runOnPrimary` is named identically in B1 spec text and in B1/B2 tests. `surface.start({...})` signature matches between B1 implementation and D3 usage.

**Daemon dependency labeling:** A2's smoke (step 4), A11's bootstrap test (steps 4), A13 (capture test), C1-C3 (spike runs), D4 (interactive verification), and D5 (Sigil interactions) all require a working daemon. The user's local `./aos ready` block does not prevent writing/building any code; it prevents running the daemon-dependent verification steps until the ownership mismatch is resolved.
