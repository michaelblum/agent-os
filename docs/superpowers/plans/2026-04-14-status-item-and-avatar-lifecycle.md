# Status Item and Avatar Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-add the macOS menu bar status item as a generic daemon primitive with position persistence and ingress/egress animation; wire Sigil as the first consumer with right-click workbench toggle and auto-park.

**Architecture:** The daemon owns a config-driven `StatusItemManager` that toggles a single canvas on/off via the menu bar icon. The Sigil renderer owns all avatar click behaviors — right-click on avatar in IDLE toggles the workbench canvas, auto-parks the avatar, and restores on dismiss.

**Tech Stack:** Swift (daemon — AppKit, NSStatusItem, CanvasManager), JavaScript (Sigil renderer — state machine, canvas IPC)

**Spec:** `docs/superpowers/specs/2026-04-14-status-item-and-avatar-lifecycle-design.md`

---

## File Map

**Create:**
- `src/display/status-item.swift` — StatusItemManager: icon, click toggle, animation, position persistence

**Modify:**
- `src/shared/config.swift` — Add `StatusItemConfig` struct, `status_item` field, `setConfigValue` cases
- `src/display/canvas.swift` — Re-add `setCanvasAlpha(_:_:)`
- `src/commands/serve.swift` — Instantiate StatusItemManager, wire config changes
- `apps/sigil/renderer/index.html` — Right-click workbench toggle, auto-park, canvas_lifecycle subscription, dismissed handler

---

## Task 1: Add StatusItemConfig to the config system

**Files:**
- Modify: `src/shared/config.swift`

- [ ] **Step 1: Add StatusItemConfig struct**

In `src/shared/config.swift`, add the struct after `ContentConfig`:

```swift
struct StatusItemConfig: Codable {
    var enabled: Bool
    var toggle_id: String
    var toggle_url: String
    var toggle_at: [Double]
    var toggle_track: String?
    var icon: String
}
```

- [ ] **Step 2: Add status_item field to AosConfig**

Add `var status_item: StatusItemConfig?` to `AosConfig`, after the `content` field:

```swift
var content: ContentConfig?
var status_item: StatusItemConfig?
```

- [ ] **Step 3: Add setConfigValue cases for status_item keys**

In the `setConfigValue` function's switch statement, before the `default:` case, add:

```swift
case "status_item.enabled":
    if config.status_item == nil {
        config.status_item = AosConfig.StatusItemConfig(
            enabled: false, toggle_id: "avatar", toggle_url: "",
            toggle_at: [200, 200, 300, 300], toggle_track: nil, icon: "hexagon"
        )
    }
    config.status_item?.enabled = (value == "true" || value == "1")
case "status_item.toggle_id":
    if config.status_item == nil {
        config.status_item = AosConfig.StatusItemConfig(
            enabled: false, toggle_id: "avatar", toggle_url: "",
            toggle_at: [200, 200, 300, 300], toggle_track: nil, icon: "hexagon"
        )
    }
    config.status_item?.toggle_id = value
case "status_item.toggle_url":
    if config.status_item == nil {
        config.status_item = AosConfig.StatusItemConfig(
            enabled: false, toggle_id: "avatar", toggle_url: "",
            toggle_at: [200, 200, 300, 300], toggle_track: nil, icon: "hexagon"
        )
    }
    config.status_item?.toggle_url = value
case "status_item.toggle_track":
    if config.status_item == nil {
        config.status_item = AosConfig.StatusItemConfig(
            enabled: false, toggle_id: "avatar", toggle_url: "",
            toggle_at: [200, 200, 300, 300], toggle_track: nil, icon: "hexagon"
        )
    }
    config.status_item?.toggle_track = value == "none" ? nil : value
case "status_item.icon":
    if config.status_item == nil {
        config.status_item = AosConfig.StatusItemConfig(
            enabled: false, toggle_id: "avatar", toggle_url: "",
            toggle_at: [200, 200, 300, 300], toggle_track: nil, icon: "hexagon"
        )
    }
    config.status_item?.icon = value
```

- [ ] **Step 4: Build to verify config compiles**

```bash
bash build.sh 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 5: Verify config round-trip**

```bash
./aos set status_item.enabled true
./aos set status_item.toggle_id avatar-main
./aos set status_item.toggle_url "aos://sigil/renderer/index.html"
./aos set status_item.toggle_track union
cat ~/.config/aos/repo/config.json | python3 -m json.tool | grep -A 10 status_item
```

Expected: `status_item` section appears in config with correct values.

- [ ] **Step 6: Commit**

```bash
git add src/shared/config.swift
git commit -m "feat(config): add status_item config section for menu bar icon"
```

---

## Task 2: Re-add setCanvasAlpha to CanvasManager

**Files:**
- Modify: `src/display/canvas.swift`

- [ ] **Step 1: Add setCanvasAlpha method**

In `src/display/canvas.swift`, add this method to the `CanvasManager` class, after the `hasCanvas` method (around line 368):

```swift
func setCanvasAlpha(_ id: String, _ alpha: CGFloat) {
    guard let canvas = canvases[id] else { return }
    canvas.window.alphaValue = alpha
}
```

- [ ] **Step 2: Build to verify**

```bash
bash build.sh 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/display/canvas.swift
git commit -m "feat(display): re-add setCanvasAlpha for status item ingress reveal"
```

---

## Task 3: Write StatusItemManager — icon + click toggle

**Files:**
- Create: `src/display/status-item.swift`

- [ ] **Step 1: Create the file with icon rendering and click handler**

Create `src/display/status-item.swift`:

```swift
// status-item.swift — Generic menu bar icon that toggles a canvas on/off.
//
// Config-driven: status_item.enabled, toggle_id, toggle_url, toggle_at, toggle_track, icon.
// The daemon creates/removes a canvas. The canvas handles its own behaviors.

import AppKit
import Foundation

class StatusItemManager {
    let canvasManager: CanvasManager
    var statusItem: NSStatusItem?

    private(set) var toggleId: String
    private(set) var toggleUrl: String
    private(set) var toggleAt: [Double]
    private(set) var toggleTrack: String?
    private(set) var iconStyle: String
    var urlResolver: ((String) -> String)?

    private var isAnimating = false
    private let positionFile: String

    init(canvasManager: CanvasManager, config: AosConfig.StatusItemConfig) {
        self.canvasManager = canvasManager
        self.toggleId = config.toggle_id
        self.toggleUrl = config.toggle_url
        self.toggleAt = config.toggle_at
        self.toggleTrack = config.toggle_track
        self.iconStyle = config.icon
        self.positionFile = (kAosConfigPath as NSString)
            .deletingLastPathComponent
            .appending("/status-item-position.json")
    }

    func setup() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        updateIcon()
        statusItem?.button?.target = self
        statusItem?.button?.action = #selector(handleClick(_:))
    }

    func teardown() {
        if let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
    }

    func updateConfig(_ config: AosConfig.StatusItemConfig) {
        toggleId = config.toggle_id
        toggleUrl = config.toggle_url
        toggleAt = config.toggle_at
        toggleTrack = config.toggle_track
        iconStyle = config.icon
        updateIcon()
    }

    @objc func handleClick(_ sender: Any?) {
        guard !isAnimating else { return }

        if canvasManager.hasCanvas(toggleId) {
            dismissCanvas()
        } else {
            summonCanvas()
        }
    }

    // MARK: - Summon

    private func summonCanvas() {
        guard !toggleUrl.isEmpty else { return }

        let target = loadSavedPosition() ?? toggleAt
        guard target.count == 4 else { return }

        let iconPos = statusItemCGPosition()
        let startSize: CGFloat = 40
        let fromX = iconPos.x - startSize / 2
        let fromY = iconPos.y

        let resolvedUrl = urlResolver?(toggleUrl) ?? toggleUrl

        var req = CanvasRequest(action: "create")
        req.id = toggleId
        req.url = resolvedUrl
        req.at = [fromX, fromY, startSize, startSize]
        if let track = toggleTrack { req.track = track }
        _ = canvasManager.handle(req)
        canvasManager.setCanvasAlpha(toggleId, 0)
        updateIcon()

        isAnimating = true
        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            Thread.sleep(forTimeInterval: 0.35)

            DispatchQueue.main.async {
                self?.canvasManager.setCanvasAlpha(self?.toggleId ?? "", 1)
            }

            self?.animateFrame(
                from: [fromX, fromY, startSize, startSize],
                to: target.map { CGFloat($0) },
                duration: 0.5,
                easing: { t in 1 - pow(1 - t, 3) }  // easeOutCubic
            )

            DispatchQueue.main.async { [weak self] in
                self?.isAnimating = false
                self?.updateIcon()
            }
        }
    }

    // MARK: - Dismiss

    private func dismissCanvas() {
        saveCurrentPosition()

        // Give the canvas a chance to clean up children
        let msg = "{\"type\":\"behavior\",\"slot\":\"dismissed\"}"
        let b64 = Data(msg.utf8).base64EncodedString()
        var evalReq = CanvasRequest(action: "eval")
        evalReq.id = toggleId
        evalReq.js = "window.headsup && window.headsup.receive && window.headsup.receive('\(b64)')"
        _ = canvasManager.handle(evalReq)

        let iconPos = statusItemCGPosition()
        let endSize: CGFloat = 20
        let toX = iconPos.x - endSize / 2
        let toY = iconPos.y

        // Read current position
        var fromX: CGFloat = 200, fromY: CGFloat = 200
        var fromW: CGFloat = 300, fromH: CGFloat = 300
        let listResp = canvasManager.handle(CanvasRequest(action: "list"))
        if let canvases = listResp.canvases {
            for c in canvases where c.id == toggleId {
                fromX = c.at[0]; fromY = c.at[1]; fromW = c.at[2]; fromH = c.at[3]
            }
        }

        isAnimating = true
        updateIcon()

        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            self?.animateFrame(
                from: [fromX, fromY, fromW, fromH],
                to: [toX, toY, endSize, endSize],
                duration: 0.4,
                easing: { t in
                    let c1 = 1.70158, c3 = c1 + 1
                    return c3 * t * t * t - c1 * t * t  // easeInBack
                }
            )

            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                var rm = CanvasRequest(action: "remove")
                rm.id = self.toggleId
                _ = self.canvasManager.handle(rm)
                self.isAnimating = false
                self.updateIcon()
            }
        }
    }

    // MARK: - Animation

    private func animateFrame(
        from: [CGFloat], to: [CGFloat],
        duration: Double, easing: @escaping (Double) -> Double
    ) {
        guard from.count == 4, to.count == 4 else { return }
        let fps = 60.0
        let totalFrames = Int(duration * fps)
        let t0 = Date()

        for i in 0...totalFrames {
            let t = Double(i) / Double(totalFrames)
            let e = CGFloat(easing(t))

            let x = from[0] + (to[0] - from[0]) * e
            let y = from[1] + (to[1] - from[1]) * e
            let w = from[2] + (to[2] - from[2]) * e
            let h = from[3] + (to[3] - from[3]) * e

            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                var updateReq = CanvasRequest(action: "update")
                updateReq.id = self.toggleId
                updateReq.at = [x, y, w, h]
                _ = self.canvasManager.handle(updateReq)
            }

            let want = Double(i + 1) / fps
            let got = Date().timeIntervalSince(t0)
            if want > got { Thread.sleep(forTimeInterval: want - got) }
        }
    }

    // MARK: - Position Persistence

    private func loadSavedPosition() -> [Double]? {
        guard let data = FileManager.default.contents(atPath: positionFile),
              let dict = try? JSONDecoder().decode([String: PositionEntry].self, from: data),
              let entry = dict[toggleId] else {
            return nil
        }
        return entry.at
    }

    private func saveCurrentPosition() {
        let listResp = canvasManager.handle(CanvasRequest(action: "list"))
        guard let canvases = listResp.canvases else { return }
        guard let canvas = canvases.first(where: { $0.id == toggleId }) else { return }
        let at = canvas.at.map { Double($0) }

        var dict: [String: PositionEntry] = [:]
        if let data = FileManager.default.contents(atPath: positionFile),
           let existing = try? JSONDecoder().decode([String: PositionEntry].self, from: data) {
            dict = existing
        }
        dict[toggleId] = PositionEntry(at: at)

        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(dict) {
            try? data.write(to: URL(fileURLWithPath: positionFile))
        }
    }

    // MARK: - Icon

    func statusItemCGPosition() -> CGPoint {
        guard let button = statusItem?.button,
              let window = button.window else {
            return CGPoint(x: 100, y: 0)
        }
        let frame = window.frame
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        return CGPoint(x: frame.midX, y: primaryHeight - frame.midY)
    }

    func updateIcon() {
        let showing = canvasManager.hasCanvas(toggleId)
        statusItem?.button?.image = drawHexagonIcon(filled: showing || isAnimating)
    }

    private func drawHexagonIcon(filled: Bool) -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let img = NSImage(size: size, flipped: false) { rect in
            let cx = rect.midX, cy = rect.midY
            let r: CGFloat = 7.0
            let path = NSBezierPath()

            for i in 0..<6 {
                let angle = CGFloat(Double(i) * .pi / 3.0 - .pi / 6.0)
                let px = cx + r * cos(angle)
                let py = cy + r * sin(angle)
                if i == 0 { path.move(to: NSPoint(x: px, y: py)) }
                else { path.line(to: NSPoint(x: px, y: py)) }
            }
            path.close()

            NSColor.black.setStroke()
            path.lineWidth = 1.2
            if filled { NSColor.black.setFill(); path.fill() }
            path.stroke()

            let dotR: CGFloat = filled ? 2.0 : 1.5
            let dotRect = NSRect(x: cx - dotR, y: cy - dotR, width: dotR * 2, height: dotR * 2)
            let dot = NSBezierPath(ovalIn: dotRect)
            if filled { NSColor.white.setFill() } else { NSColor.black.setFill() }
            dot.fill()

            return true
        }
        img.isTemplate = true
        return img
    }
}

// MARK: - Persistence Types

private struct PositionEntry: Codable {
    let at: [Double]
}
```

- [ ] **Step 2: Build to verify**

```bash
bash build.sh 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/display/status-item.swift
git commit -m "feat(display): add StatusItemManager — menu bar icon with canvas toggle"
```

---

## Task 4: Wire StatusItemManager into the daemon

**Files:**
- Modify: `src/commands/serve.swift`
- Modify: `src/daemon/unified.swift` (onCanvasCountChanged)

- [ ] **Step 1: Update serve.swift to instantiate StatusItemManager**

Replace the contents of `src/commands/serve.swift` with:

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

    // Accessory policy: no dock icon, no menu bar, but can own key windows
    // and receive mouse/keyboard events. Required for interactive canvases.
    //
    // Note: use NSApplication.shared (not the NSApp global) to force
    // initialization of the singleton. Accessing NSApp before NSApplication.shared
    // has been evaluated traps, because NSApp is an implicitly-unwrapped optional
    // that is only assigned as a side effect of NSApplication.shared's first access.
    NSApplication.shared.setActivationPolicy(.accessory)

    // Status item (menu bar icon)
    var statusItemManager: StatusItemManager?
    if let siConfig = config.status_item, siConfig.enabled {
        let mgr = StatusItemManager(canvasManager: daemon.canvasManager, config: siConfig)
        mgr.urlResolver = { [weak daemon] url in daemon?.resolveContentURL(url) ?? url }
        mgr.setup()
        statusItemManager = mgr
    }

    // Update status item icon when canvas count changes
    let existingCallback = daemon.canvasManager.onCanvasCountChanged
    daemon.canvasManager.onCanvasCountChanged = { [weak statusItemManager] in
        existingCallback?()
        statusItemManager?.updateIcon()
    }

    // Watch config for status item changes
    daemon.onConfigChanged = { [weak statusItemManager, weak daemon] newConfig in
        guard let daemon = daemon else { return }
        if let siConfig = newConfig.status_item, siConfig.enabled {
            if let mgr = statusItemManager {
                mgr.updateConfig(siConfig)
            } else {
                let mgr = StatusItemManager(canvasManager: daemon.canvasManager, config: siConfig)
                mgr.urlResolver = { [weak daemon] url in daemon?.resolveContentURL(url) ?? url }
                mgr.setup()
                statusItemManager = mgr
            }
        } else {
            statusItemManager?.teardown()
            statusItemManager = nil
        }
    }

    // Run the main loop (needed for CGEventTap, NSWindow, WKWebView)
    NSApplication.shared.run()
}
```

- [ ] **Step 2: Expose onConfigChanged callback on UnifiedDaemon**

In `src/daemon/unified.swift`, add a public callback property near the other callback declarations (around line 60):

```swift
var onConfigChanged: ((AosConfig) -> Void)?
```

Then in the existing `onConfigChanged()` method (around line 936), add a call at the end:

```swift
self.onConfigChanged?(config)
```

- [ ] **Step 3: Verify resolveContentURL is accessible**

Check that `UnifiedDaemon` exposes `resolveContentURL` and `canvasManager` as accessible properties. Search for their declarations:

```bash
grep -n 'func resolveContentURL\|var canvasManager\|let canvasManager' src/daemon/unified.swift | head -5
```

If `canvasManager` is private, it needs to be internal. If `resolveContentURL` doesn't exist as a public method, check how URLs are resolved and expose the resolver.

- [ ] **Step 4: Build and verify**

```bash
bash build.sh 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 5: Test the status item**

```bash
./aos set status_item.enabled true
./aos set status_item.toggle_id avatar-main
./aos set status_item.toggle_url "aos://sigil/renderer/index.html"
./aos set status_item.toggle_track union
```

Then restart the daemon:

```bash
./aos service restart
```

Expected: hexagonal icon appears in the menu bar. Clicking it creates the avatar canvas with ingress animation. Clicking again dismisses with egress animation.

Verify:

```bash
# After clicking to summon:
./aos show list --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([c['id'] for c in d.get('canvases',[])])"
```

Expected: `['avatar-main']` after summon, `[]` after dismiss.

- [ ] **Step 6: Verify position persistence**

```bash
# Click icon to summon avatar
# Drag avatar to a new position (or use aos show update --id avatar-main --at 500,300,180,180)
# Click icon to dismiss
cat ~/.config/aos/repo/status-item-position.json | python3 -m json.tool
# Click icon to summon again — avatar should appear at saved position
```

- [ ] **Step 7: Commit**

```bash
git add src/commands/serve.swift src/daemon/unified.swift
git commit -m "feat(daemon): wire StatusItemManager into daemon lifecycle with config watch"
```

---

## Task 5: Update Sigil renderer — right-click workbench toggle

**Files:**
- Modify: `apps/sigil/renderer/index.html`

- [ ] **Step 1: Add workbench state to liveJs**

In `apps/sigil/renderer/index.html`, find the `liveJs` object initialization (around line 1264). Add these fields after `displays: null`:

```javascript
workbenchVisible: false,
preWorkbenchPos: null,
```

- [ ] **Step 2: Add canvas_lifecycle to subscribe call**

Find the subscribe call (around line 1320):

```javascript
postToHost('subscribe', { events: ['input_event', 'display_geometry', 'wiki_page_changed'] });
```

Change to:

```javascript
postToHost('subscribe', { events: ['input_event', 'display_geometry', 'wiki_page_changed', 'canvas_lifecycle'] });
```

- [ ] **Step 3: Add workbench helper functions**

Add these functions before the `handleLiveJsMessage` function (around line 1385):

```javascript
function computeWorkbenchFrame() {
    if (!liveJs.displays || !liveJs.avatarPos.valid) return null;
    const ax = liveJs.avatarPos.x, ay = liveJs.avatarPos.y;
    let best = null, bestD = null;
    for (const d of liveJs.displays) {
        const b = d.visible_bounds || d.bounds;
        const inside = b.x <= ax && ax <= b.x + b.w && b.y <= ay && ay <= b.y + b.h;
        if (inside) { best = b; break; }
        const cx = Math.max(b.x, Math.min(ax, b.x + b.w));
        const cy = Math.max(b.y, Math.min(ay, b.y + b.h));
        const d2 = (ax - cx) ** 2 + (ay - cy) ** 2;
        if (bestD === null || d2 < bestD) { bestD = d2; best = b; }
    }
    if (!best) return null;
    const mx = 32, my = 28;
    const uw = Math.max(480, best.w - mx * 2);
    const uh = Math.max(360, best.h - my * 2);
    const w = Math.max(480, Math.round(uw * 2 / 3));
    const h = uh;
    const x = best.x + best.w - mx - w;
    const y = best.y + my;
    return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
}

function computeNonantHome() {
    if (!liveJs.displays || !liveJs.avatarPos.valid) return null;
    const ax = liveJs.avatarPos.x, ay = liveJs.avatarPos.y;
    let best = null, bestD = null;
    for (const d of liveJs.displays) {
        const b = d.visible_bounds || d.bounds;
        const inside = b.x <= ax && ax <= b.x + b.w && b.y <= ay && ay <= b.y + b.h;
        if (inside) { best = b; break; }
        const cx = Math.max(b.x, Math.min(ax, b.x + b.w));
        const cy = Math.max(b.y, Math.min(ay, b.y + b.h));
        const d2 = (ax - cx) ** 2 + (ay - cy) ** 2;
        if (bestD === null || d2 < bestD) { bestD = d2; best = b; }
    }
    if (!best) return null;
    return { x: best.x + best.w / 6, y: best.y + best.h / 6 };
}

function showWorkbench() {
    const frame = computeWorkbenchFrame();
    if (!frame) return;
    liveJs.preWorkbenchPos = { x: liveJs.avatarPos.x, y: liveJs.avatarPos.y };
    postToHost('canvas.create', {
        id: 'sigil-workbench',
        url: 'aos://sigil/workbench/index.html',
        frame: frame,
        interactive: true,
        focus: true,
    });
    liveJs.workbenchVisible = true;
    // Auto-park to top-left nonant
    const home = computeNonantHome();
    if (home) startFastTravel(home.x, home.y);
}

function dismissWorkbench() {
    // Set state BEFORE removing canvas so the canvas_lifecycle handler
    // sees workbenchVisible=false and doesn't double-restore.
    liveJs.workbenchVisible = false;
    const restorePos = liveJs.preWorkbenchPos;
    liveJs.preWorkbenchPos = null;
    postToHost('canvas.remove', { id: 'sigil-workbench' });
    if (restorePos) startFastTravel(restorePos.x, restorePos.y);
}
```

- [ ] **Step 4: Add smIsOnAvatar helper**

Find the `smDistance` helper function (near the state machine functions) and add after it:

```javascript
function smIsOnAvatar(x, y) {
    if (!liveJs.avatarPos.valid) return false;
    return smDistance(x, y, liveJs.avatarPos.x, liveJs.avatarPos.y) <= liveJs.avatarHitRadius;
}
```

- [ ] **Step 5: Modify right-click handler in handleLiveJsMessage**

Find the `right_mouse_down` case in `handleLiveJsMessage` (around line 1412). Replace:

```javascript
case 'right_mouse_down':
    smHandleCancel('right_click');
    break;
```

With:

```javascript
case 'right_mouse_down':
    if (liveJs.state === 'IDLE' && smIsOnAvatar(msg.x, msg.y)) {
        if (liveJs.workbenchVisible) {
            dismissWorkbench();
        } else {
            showWorkbench();
        }
    } else {
        smHandleCancel('right_click');
    }
    break;
```

- [ ] **Step 6: Add canvas_lifecycle handler**

In `handleLiveJsMessage`, in the switch statement, add a case for `canvas_lifecycle`:

```javascript
case 'canvas_lifecycle':
    if (msg.canvas_id === 'sigil-workbench' && msg.action === 'removed') {
        liveJs.workbenchVisible = false;
        if (liveJs.preWorkbenchPos) {
            startFastTravel(liveJs.preWorkbenchPos.x, liveJs.preWorkbenchPos.y);
            liveJs.preWorkbenchPos = null;
        }
    }
    break;
```

- [ ] **Step 7: Add behavior/dismissed handler**

In `handleLiveJsMessage`, add a case for the dismissed behavior message (sent by the status item before egress animation):

```javascript
case 'behavior':
    if (msg.slot === 'dismissed') {
        // Clean up child canvases before parent is torn down
        postToHost('canvas.remove', { id: 'avatar-hit' });
        if (liveJs.workbenchVisible) {
            postToHost('canvas.remove', { id: 'sigil-workbench' });
            liveJs.workbenchVisible = false;
        }
    }
    break;
```

- [ ] **Step 8: Commit**

```bash
git add apps/sigil/renderer/index.html
git commit -m "feat(sigil): right-click avatar toggles workbench, auto-park and restore"
```

---

## Task 6: Update CLAUDE.md docs

**Files:**
- Modify: `src/CLAUDE.md`

- [ ] **Step 1: Add status_item config keys to the config table**

In `src/CLAUDE.md`, find the "Config Keys" table and add after the `content.roots.{name}` row:

```markdown
| status_item.enabled | bool | false | Show menu bar icon |
| status_item.toggle_id | string | "avatar" | Canvas ID to toggle on click |
| status_item.toggle_url | string | — | URL loaded in toggled canvas |
| status_item.toggle_track | string | — | Optional track target (e.g. "union") |
| status_item.icon | string | "hexagon" | Icon style |
```

- [ ] **Step 2: Add status-item to architecture file listing**

In `src/CLAUDE.md`, find the `display/` line in the architecture section and add:

```markdown
  display/            # Display: canvas, render, auto-projection, status-item (menu bar)
```

(This line should already be present from the old code — verify it's there.)

- [ ] **Step 3: Commit**

```bash
git add src/CLAUDE.md
git commit -m "docs: add status_item config keys and architecture reference"
```

---

## Task 7: End-to-end verification

- [ ] **Step 1: Build**

```bash
bash build.sh 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 2: Clean and restart**

```bash
./aos clean
./aos service restart
```

- [ ] **Step 3: Configure status item for Sigil**

```bash
./aos set status_item.enabled true
./aos set status_item.toggle_id avatar-main
./aos set status_item.toggle_url "aos://sigil/renderer/index.html"
./aos set status_item.toggle_track union
./aos service restart
```

- [ ] **Step 4: Verify summon**

Click the hexagonal menu bar icon.

```bash
./aos show list --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([c['id'] for c in d.get('canvases',[])])"
```

Expected: `['avatar-main']`. Avatar canvas visible with ingress animation.

- [ ] **Step 5: Verify right-click workbench**

Right-click on the avatar.

```bash
./aos show list --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([c['id'] for c in d.get('canvases',[])])"
```

Expected: `['avatar-main', 'avatar-hit', 'sigil-workbench']`. Workbench visible. Avatar parked in top-left nonant.

- [ ] **Step 6: Verify workbench dismiss**

Right-click on the avatar again.

Expected: workbench removed. Avatar returns to pre-workbench position via fast-travel.

- [ ] **Step 7: Verify dismiss + position persistence**

Click the menu bar icon to dismiss. Check saved position:

```bash
cat ~/.config/aos/repo/status-item-position.json
```

Click the icon again to summon. Avatar should appear at saved position.

- [ ] **Step 8: Verify status item dismiss cleans up children**

Summon avatar. Open workbench (right-click avatar). Click menu bar icon to dismiss.

```bash
./aos show list --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([c['id'] for c in d.get('canvases',[])])"
```

Expected: `[]`. All canvases (avatar-main, avatar-hit, sigil-workbench) removed.

---

## Constraint Reminders

- [ ] **No Sigil-specific code in `status-item.swift` or `config.swift`.** The daemon knows about a canvas ID, URL, and position — not about Sigil, avatars, or workbenches.
- [ ] **`canvas.create` in the renderer uses `postToHost`**, not `postMessage` directly. The `postToHost` helper wraps `window.webkit.messageHandlers.headsup.postMessage(...)`.
- [ ] **The `behavior/dismissed` message is base64-encoded** by the daemon before eval. The renderer's `headsup.receive` decodes it.
