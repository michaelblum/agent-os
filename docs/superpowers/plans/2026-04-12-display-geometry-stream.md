# Display Geometry Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subscribable, push-based `display_geometry` event channel from the AOS daemon to any canvas that subscribes, delivering the current display arrangement on subscribe and rebroadcasting on macOS display-configuration changes.

**Architecture:** Extend the Phase 3 canvas subscription machinery (`canvasEventSubscriptions` in `src/daemon/unified.swift`) to carry a second event type. A new `src/display/display-geometry.swift` produces a schema-shaped snapshot from existing `getDisplays()` plus per-display UUID / visible_bounds / rotation lookups. An `NSApplication.didChangeScreenParametersNotification` observer at daemon start triggers a broadcast on change. On subscribe, the daemon sends the current snapshot only to the subscribing canvas (state replay).

**Tech Stack:** Swift (macOS 14+), AppKit (`NSApplication`, `NSScreen`), CoreGraphics (`CGDisplay*`), WKWebView postMessage/evaluateJavaScript plumbing already established in Phase 3.

**Reference spec:** `docs/superpowers/specs/2026-04-12-display-geometry-stream.md`.

---

## File Structure

**Create:**
- `src/display/display-geometry.swift` — snapshot helper + event shape builder.
- `apps/sigil/test-display-geometry/index.html` — manual verification harness.

**Modify:**
- `src/daemon/unified.swift` — extend subscribe handler to replay current snapshot when `display_geometry` is added; add `broadcastDisplayGeometry()` method; register observer in `start()`.
- `build.sh` — pick up the new `.swift` file if the build script enumerates files explicitly (check during Task 2; no-op if it globs).

---

## Task 1: Build the snapshot helper

**Files:**
- Create: `src/display/display-geometry.swift`

- [ ] **Step 1: Create the file with the snapshot function**

Write `src/display/display-geometry.swift`:

```swift
import AppKit
import CoreGraphics
import Foundation

/// Produces the event payload (JSON-ready dict) broadcast on the
/// `display_geometry` channel. The shape is a subset of
/// `spatial-topology.schema.json`'s `displays[]`, plus a derived
/// `global_bounds` convenience field.
///
/// Coordinate system is the shared AOS convention: top-left of primary
/// display = (0, 0), logical points, per-display `scale_factor`.
func snapshotDisplayGeometry() -> [String: Any] {
    let entries = getDisplays()  // from src/perceive/models.swift
    let screensByNumber = screenIndexByDisplayNumber()

    var displayDicts: [[String: Any]] = []
    var minX = Double.infinity, minY = Double.infinity
    var maxX = -Double.infinity, maxY = -Double.infinity

    for entry in entries {
        let cgID = entry.id
        let uuid = displayUUID(for: cgID) ?? ""
        let bounds = entry.bounds
        let visible = visibleBounds(for: cgID, fallback: bounds, screens: screensByNumber)
        let rotation = Int(CGDisplayRotation(cgID))

        displayDicts.append([
            "display_id": Int(cgID),
            "display_uuid": uuid,
            "bounds": [
                "x": bounds.origin.x,
                "y": bounds.origin.y,
                "w": bounds.width,
                "h": bounds.height,
            ],
            "visible_bounds": [
                "x": visible.origin.x,
                "y": visible.origin.y,
                "w": visible.width,
                "h": visible.height,
            ],
            "scale_factor": entry.scaleFactor,
            "rotation": rotation,
            "is_main": entry.isMain,
        ])

        minX = min(minX, bounds.minX)
        minY = min(minY, bounds.minY)
        maxX = max(maxX, bounds.maxX)
        maxY = max(maxY, bounds.maxY)
    }

    let globalBounds: [String: Double]
    if entries.isEmpty {
        globalBounds = ["x": 0, "y": 0, "w": 0, "h": 0]
    } else {
        globalBounds = [
            "x": minX,
            "y": minY,
            "w": maxX - minX,
            "h": maxY - minY,
        ]
    }

    return [
        "type": "display_geometry",
        "displays": displayDicts,
        "global_bounds": globalBounds,
    ]
}

/// Lookup CGDirectDisplayID -> UUID string, e.g.
/// "37D8832A-2B0A-4DFB-8C3E-CFFD4C93F3A5".
private func displayUUID(for id: CGDirectDisplayID) -> String? {
    guard let uuidRef = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue() else {
        return nil
    }
    guard let str = CFUUIDCreateString(nil, uuidRef) as String? else {
        return nil
    }
    return str
}

/// Index NSScreen by its `NSScreenNumber` device description key (the
/// CGDirectDisplayID). Used to look up `visibleFrame` per display.
private func screenIndexByDisplayNumber() -> [CGDirectDisplayID: NSScreen] {
    var map: [CGDirectDisplayID: NSScreen] = [:]
    for screen in NSScreen.screens {
        if let num = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
            map[CGDirectDisplayID(num.uint32Value)] = screen
        }
    }
    return map
}

/// Return visible bounds in top-left-origin coordinates matching the
/// AOS global CG convention. NSScreen returns frames in bottom-left
/// origin; we flip y against the primary display's full height so the
/// result is consistent with `CGDisplayBounds`.
private func visibleBounds(
    for id: CGDirectDisplayID,
    fallback: CGRect,
    screens: [CGDirectDisplayID: NSScreen]
) -> CGRect {
    guard let screen = screens[id] else { return fallback }
    let visibleBottomLeft = screen.visibleFrame
    let fullBottomLeft = screen.frame

    // visibleFrame sits inside frame. Top inset = (frame.maxY - visibleFrame.maxY).
    // Bottom inset = (visibleFrame.minY - frame.minY).
    let topInset = fullBottomLeft.maxY - visibleBottomLeft.maxY
    let leftInset = visibleBottomLeft.minX - fullBottomLeft.minX

    return CGRect(
        x: fallback.origin.x + leftInset,
        y: fallback.origin.y + topInset,
        width: visibleBottomLeft.width,
        height: visibleBottomLeft.height
    )
}
```

- [ ] **Step 2: Verify build picks up the new file**

Run: `bash build.sh`
Expected: build succeeds, produces `./aos`. If the build script enumerates files explicitly and misses the new one, add it to the list. (Most recent build scripts in this repo glob; expect no change needed.)

- [ ] **Step 3: Commit**

```bash
git add src/display/display-geometry.swift
git commit -m "feat(display): add display-geometry snapshot helper"
```

---

## Task 2: Add the broadcast method

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Add `broadcastDisplayGeometry()` method**

Immediately after `forwardInputEventToCanvases` (around line 297 in the current file) add:

```swift
    /// Fan out the current display geometry snapshot to every canvas
    /// subscribed to `display_geometry`. Invoked on subscribe (single
    /// target) and on `NSApplication.didChangeScreenParametersNotification`
    /// (all subscribers).
    private func broadcastDisplayGeometry(to specificCanvas: String? = nil) {
        canvasSubscriptionLock.lock()
        let targets: [String]
        if let one = specificCanvas {
            targets = canvasEventSubscriptions[one]?.contains("display_geometry") == true ? [one] : []
        } else {
            targets = canvasEventSubscriptions
                .filter { $0.value.contains("display_geometry") }
                .map { $0.key }
        }
        canvasSubscriptionLock.unlock()

        guard !targets.isEmpty else { return }

        let snapshot = snapshotDisplayGeometry()
        guard let json = try? JSONSerialization.data(withJSONObject: snapshot, options: []) else { return }
        let b64 = json.base64EncodedString()
        let js = "window.headsup && window.headsup.receive && window.headsup.receive('\(b64)')"

        for canvasID in targets {
            canvasManager.evalAsync(canvasID: canvasID, js: js)
        }
        fputs("[canvas-sub] display_geometry broadcast to \(targets.count) canvas(es)\n", stderr)
    }
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: PASS (no call sites yet, just the method exists).

- [ ] **Step 3: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): add broadcastDisplayGeometry method"
```

---

## Task 3: Replay snapshot on subscribe

**Files:**
- Modify: `src/daemon/unified.swift` (extend `handleCanvasSubscription`)

- [ ] **Step 1: Trigger replay after adding `display_geometry` to the subscription set**

In `handleCanvasSubscription` (around line 258) the current body updates the `canvasEventSubscriptions` dict under lock and logs the result. Extend it to fire the initial snapshot when the canvas is newly subscribing to `display_geometry`.

Replace the current function body with:

```swift
    private func handleCanvasSubscription(canvasID: String, type: String, events: [String]) {
        guard !events.isEmpty else { return }
        var newlyAddedDisplayGeometry = false

        canvasSubscriptionLock.lock()
        if type == "subscribe" {
            var current = canvasEventSubscriptions[canvasID] ?? []
            let before = current
            for ev in events { current.insert(ev) }
            canvasEventSubscriptions[canvasID] = current
            newlyAddedDisplayGeometry =
                events.contains("display_geometry") && !before.contains("display_geometry")
        } else {  // unsubscribe
            if var current = canvasEventSubscriptions[canvasID] {
                for ev in events { current.remove(ev) }
                if current.isEmpty {
                    canvasEventSubscriptions.removeValue(forKey: canvasID)
                } else {
                    canvasEventSubscriptions[canvasID] = current
                }
            }
        }
        let snapshot = canvasEventSubscriptions[canvasID]
        canvasSubscriptionLock.unlock()
        fputs("[canvas-sub] \(type) canvas=\(canvasID) events=\(events) current=\(snapshot ?? [])\n", stderr)

        if newlyAddedDisplayGeometry {
            // Initial state-replay for this subscriber only. Dispatch async
            // to avoid reentering the canvas message handler from inside
            // the subscribe path.
            DispatchQueue.main.async { [weak self] in
                self?.broadcastDisplayGeometry(to: canvasID)
            }
        }
    }
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): replay display_geometry snapshot on subscribe"
```

---

## Task 4: Observe screen-parameter changes

**Files:**
- Modify: `src/daemon/unified.swift` (add observer registration in `start()`)

- [ ] **Step 1: Register the notification observer at daemon boot**

Find `perception.start()` in `start()` (around line 188) and add the observer registration near the other boot wiring. Place it before `spatial.startPolling()`:

```swift
        // Observe display arrangement changes -> rebroadcast geometry to
        // every canvas subscribed to display_geometry.
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.broadcastDisplayGeometry()
            fputs("[canvas-sub] display_geometry change notification fired\n", stderr)
        }
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: PASS.

- [ ] **Step 3: Launch daemon and confirm startup line appears in log (no observer trigger yet — just confirms boot path)**

Run: `launchctl kickstart -k gui/$(id -u)/com.agent-os.aos.repo`
Then: inspect `~/.config/aos/repo/daemon.log` and confirm the daemon starts cleanly with no Swift crash/assertion around the observer registration. Expected: clean startup (no new message yet, since no display change has happened).

- [ ] **Step 4: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): observe didChangeScreenParameters and rebroadcast"
```

---

## Task 5: Test harness page

**Files:**
- Create: `apps/sigil/test-display-geometry/index.html`

- [ ] **Step 1: Write the page**

Create `apps/sigil/test-display-geometry/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; padding: 16px; background: #0a0e14; color: #cbd5e1;
  font: 13px/1.4 ui-monospace, SFMono-Regular, monospace; }
h1 { font-size: 14px; margin: 0 0 12px 0; color: #8ef; }
.row { margin-bottom: 12px; }
.displays { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.display {
  border: 1px solid #334155; padding: 10px 12px; border-radius: 4px;
  background: rgba(30, 41, 59, 0.6); min-width: 220px;
}
.display.main { border-color: #8ef; }
.k { color: #64748b; }
.v { color: #e2e8f0; }
#log { background: #020617; padding: 8px 12px; border-radius: 4px;
  max-height: 320px; overflow-y: auto; white-space: pre-wrap; font-size: 12px; }
.ts { color: #8ef; }
</style>
</head>
<body>
<h1>display_geometry test harness</h1>
<div class="row"><span class="k">global_bounds:</span> <span class="v" id="global">—</span></div>
<div class="displays" id="displays"></div>
<div><strong>Log</strong></div>
<div id="log"></div>
<script>
var snapshotCount = 0;
var logEl = document.getElementById('log');
var globalEl = document.getElementById('global');
var displaysEl = document.getElementById('displays');

function postToHost(type, payload) {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
    window.webkit.messageHandlers.headsup.postMessage(
      payload !== undefined ? { type: type, payload: payload } : { type: type }
    );
  }
}

function fmtRect(r) {
  return '[' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' +
         Math.round(r.w) + 'x' + Math.round(r.h) + ']';
}

function render(snapshot) {
  globalEl.textContent = fmtRect(snapshot.global_bounds);
  displaysEl.innerHTML = '';
  snapshot.displays.forEach(function(d) {
    var el = document.createElement('div');
    el.className = 'display' + (d.is_main ? ' main' : '');
    el.innerHTML =
      '<div><span class="k">id:</span> <span class="v">' + d.display_id + '</span>' +
      (d.is_main ? '  <span class="k">(main)</span>' : '') + '</div>' +
      '<div><span class="k">uuid:</span> <span class="v">' + (d.display_uuid || '').slice(0, 8) + '…</span></div>' +
      '<div><span class="k">bounds:</span> <span class="v">' + fmtRect(d.bounds) + '</span></div>' +
      '<div><span class="k">visible:</span> <span class="v">' + fmtRect(d.visible_bounds) + '</span></div>' +
      '<div><span class="k">scale:</span> <span class="v">' + d.scale_factor + '×</span>' +
      '  <span class="k">rot:</span> <span class="v">' + d.rotation + '°</span></div>';
    displaysEl.appendChild(el);
  });
}

function log(msg) {
  var ts = new Date().toISOString().slice(11, 23);
  var line = document.createElement('div');
  line.innerHTML = '<span class="ts">' + ts + '</span> ' + msg;
  logEl.insertBefore(line, logEl.firstChild);
}

window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
  try {
    var msg = JSON.parse(atob(b64));
    if (msg.type === 'display_geometry') {
      snapshotCount++;
      log('snapshot #' + snapshotCount + ' — ' + msg.displays.length + ' display(s), global=' + fmtRect(msg.global_bounds));
      render(msg);
    }
  } catch (e) {
    log('parse error: ' + e);
  }
};

postToHost('subscribe', { events: ['display_geometry'] });
log('subscribed; waiting for snapshot…');
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add apps/sigil/test-display-geometry/index.html
git commit -m "test(sigil): display_geometry harness page"
```

---

## Task 6: Manual verification

**Files:** None (manual procedure against the live daemon).

- [ ] **Step 1: Ensure the daemon is running the new build**

Run: `launchctl kickstart -k gui/$(id -u)/com.agent-os.aos.repo`
Tail log: `tail -f ~/.config/aos/repo/daemon.log` in a separate shell.
Expected: clean startup, no crash, no `CGEventTap failed` warning (unrelated TCC issue tracked in issue #22 — if present, reset per the issue's resolution notes).

- [ ] **Step 2: Launch the harness canvas**

Run: `./aos show create --id display-test --url aos://sigil/test-display-geometry/index.html --at 80,80,860,620`
Expected: canvas opens. Within one eval tick: log shows `snapshot #1 — N display(s), global=...` and the page renders one card per display.

- [ ] **Step 3: Compare against `side-eye list`**

Run: `./aos see list | head -80`
Expected: the displays block in `side-eye`'s output matches the test page's displays (same count, same bounds, same `is_main`). UUIDs should match when present.

- [ ] **Step 4: Plug/unplug external display (if hardware available)**

Action: connect or disconnect an external display.
Expected: log shows a new `snapshot #N` line within a second, displays list updates, `global_bounds` recomputes.
If no external hardware available, skip to Step 5 and note the limitation when handing off.

- [ ] **Step 5: Rearrange displays in System Settings**

Action: open System Settings → Displays → Arrangement, drag a display to a new position, apply.
Expected: test page log shows a new snapshot with updated `bounds.x` / `bounds.y`.
Skip if single-display setup; note the limitation.

- [ ] **Step 6: Toggle primary display (if multi-display)**

Action: System Settings → Displays → "Use as" change which display is primary.
Expected: new snapshot with updated `is_main` flag.
Skip if single-display.

- [ ] **Step 7: Rotate a display (if hardware allows)**

Action: System Settings → Displays → rotate 90°.
Expected: new snapshot with updated `rotation` and transposed `bounds`.
Skip if hardware does not support rotation.

- [ ] **Step 8: Cleanup and verify subscription drop**

Run: `./aos show remove --id display-test`
Tail: `daemon.log`
Expected: `[canvas-sub] cleared subscriptions for removed canvas=display-test` appears (existing Phase 3 cleanup path handles the drop).

- [ ] **Step 9: Verify idle CPU**

Run: `ps -o pcpu,rss,command $(pgrep -f 'aos serve')` with the harness canvas open and no cursor motion (move the cursor away from the page and let it rest).
Expected: daemon CPU sits near steady-state idle. No polling implies no change from pre-subscribe baseline.

- [ ] **Step 10: Commit the verification result**

If all applicable steps pass, there's no code to commit — the verification is the result. Record the outcome in a handoff message to the next session (template: `handoff:` channel, type `session_brief`, include which steps were skipped due to hardware).

---

## Self-review checklist (run after implementation)

- Spec `## Acceptance criteria` items 1–7 each map to a Task 6 step (1→Step 2, 2→Step 4, 3→Step 5, 4→Step 7, 5→Step 8, 6→Step 9, 7 is covered by Task 3's scope plus the fact that the same canvas can also subscribe to `input_event` via Phase 3 — optional extra probe: subscribe the harness to both and confirm via log).
- Non-goals in spec are respected: no CLI surface added, no new schema file, no change to `aos show create --display`.
- No placeholders or TBDs in any task.
