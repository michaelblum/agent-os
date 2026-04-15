# Canvas Lifecycle and Provenance Tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add suspend/resume lifecycle primitives and a cascade opt-out flag to the canvas system so toggling the Sigil avatar is instant (~50ms) instead of cold-booting (~5-7s).

**Architecture:** The daemon already tracks parent-child canvas relationships (`canvasCreatedBy`, `canvasChildren` in `unified.swift`) and cascade-removes children. This plan adds: (1) a `cascade` opt-out flag so children can survive parent lifecycle changes, (2) `suspended` state on Canvas with `suspend`/`resume` actions in CanvasManager, (3) lifecycle messages to renderers over the existing `headsup.receive` bridge, (4) ACK-gated resume so stale frames never flash, (5) StatusItemManager three-way toggle.

**Tech Stack:** Swift (macOS AppKit, WebKit), JavaScript (Three.js renderer), existing AOS IPC (`headsup.receive` / `postToHost`)

**Spec:** `docs/superpowers/specs/2026-04-15-canvas-lifecycle-and-provenance-tree-design.md`

---

### File Map

| File | Role | Changes |
|---|---|---|
| `src/display/protocol.swift` | Canvas request/response types | Add `parent`, `cascade` to CanvasRequest; add `parent`, `cascade`, `suspended` to CanvasInfo |
| `src/display/canvas.swift` | Canvas class + CanvasManager | Add `suspended` and `cascadeFromParent` fields to Canvas; add `handleSuspend`, `handleResume`, tree walk helper; modify `handleRemove` for cascade opt-out; modify `handleCreate` for born-suspended; update `toInfo`, `handle` switch |
| `src/daemon/unified.swift` | Daemon wiring | Pass `cascade` flag through canvas create; store `cascade` in provenance maps; add `canvas.suspend`/`canvas.resume` to postMessage handler; handle `lifecycle.ready` ACK; modify `performCascadeRemove` to respect cascade flag |
| `src/display/status-item.swift` | Status item manager | Three-way toggle (active→suspend, suspended→resume, missing→create); remove dismissed eval and dismiss animation |
| `apps/sigil/renderer/index.html` | Avatar renderer | Add `lifecycle` case to message handler; rAF suspend gate; ACK on resume; remove `dismissed` behavior handler |
| `apps/sigil/renderer/hit-area.html` | Click-absorber child canvas | Add lifecycle suspend/resume handler |

---

### Task 1: Add `parent`, `cascade`, `suspended` to Protocol Types

**Files:**
- Modify: `src/display/protocol.swift:57-99`

- [ ] **Step 1: Add `parent` and `cascade` fields to `CanvasRequest`**

In `src/display/protocol.swift`, add two fields to `struct CanvasRequest` after the existing `track` field (line 72):

```swift
var track: String?          // tracking target (e.g. "union") — bounds auto-resolve + auto-update
var parent: String?         // parent canvas ID (nil = infer from source canvas; explicit "null" via JSON null = no parent)
var cascade: Bool?          // lifecycle cascade from parent (default true; false = survive parent suspend/remove)
var channel: String?        // channel name (for "post" action)
```

- [ ] **Step 2: Add `parent`, `cascade`, `suspended` to `CanvasInfo`**

In `struct CanvasInfo` (line 88), add three fields after the existing `track` field (line 98):

```swift
var track: String?          // tracking target if any
var parent: String?         // parent canvas ID (nil if root)
var cascade: Bool?          // lifecycle cascade flag
var suspended: Bool?        // true if canvas is suspended (hidden + paused)
```

- [ ] **Step 3: Build and verify compilation**

Run: `cd /Users/Michael/Code/agent-os && bash build.sh 2>&1 | tail -20`
Expected: Build succeeds. New optional fields with nil defaults don't break existing callers.

- [ ] **Step 4: Commit**

```bash
git add src/display/protocol.swift
git commit -m "feat(canvas): add parent, cascade, suspended to protocol types"
```

---

### Task 2: Add `suspended` and `cascadeFromParent` to Canvas, Update `toInfo`

**Files:**
- Modify: `src/display/canvas.swift:179-349` (Canvas class)

- [ ] **Step 1: Add fields to Canvas class**

In `src/display/canvas.swift`, add two fields to `class Canvas` after the existing `trackTarget` field (line 203):

```swift
var trackTarget: TrackTarget?
var suspended: Bool = false
var cascadeFromParent: Bool = true
```

- [ ] **Step 2: Update `toInfo()` to include new fields**

In `func toInfo()` (line 335), update the return statement to include the new fields:

```swift
func toInfo() -> CanvasInfo {
    let f = cgFrame
    return CanvasInfo(
        id: id,
        at: [f.origin.x, f.origin.y, f.size.width, f.size.height],
        anchorWindow: anchorWindowID.map { Int($0) },
        anchorChannel: anchorChannelID,
        offset: offset.map { [$0.origin.x, $0.origin.y, $0.size.width, $0.size.height] },
        interactive: isInteractive,
        ttl: remainingTTL,
        scope: scope,
        autoProject: autoProjectMode,
        track: trackTarget?.rawValue,
        parent: nil,   // populated by caller (CanvasManager) who knows the tree
        cascade: cascadeFromParent,
        suspended: suspended
    )
}
```

Note: `parent` is set to `nil` here because `Canvas` itself doesn't store the parent ID — the parent-child tree is managed by the daemon's `canvasCreatedBy` dictionary. The `handleList` method in CanvasManager or the daemon will populate it from the tree.

- [ ] **Step 3: Build and verify compilation**

Run: `cd /Users/Michael/Code/agent-os && bash build.sh 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/display/canvas.swift
git commit -m "feat(canvas): add suspended and cascadeFromParent fields to Canvas"
```

---

### Task 3: Implement `handleSuspend` and `handleResume` in CanvasManager

**Files:**
- Modify: `src/display/canvas.swift:179-203` (Canvas class — add `parent` field)
- Modify: `src/display/canvas.swift:354-442` (CanvasManager class)

This is the largest task. It adds a `parent` field to Canvas (so CanvasManager can walk the tree without depending on the daemon's `canvasCreatedBy` dict), the tree walk helper, suspend, resume, ACK tracking, born-suspended logic, and the `canvas(forID:)` accessor.

**Important:** The `parent` field on `Canvas` is the source of truth for CanvasManager's tree walk. The daemon's `canvasCreatedBy`/`canvasChildren` dicts in unified.swift remain as the ownership/permission layer. Task 4 synchronizes them.

- [ ] **Step 1: Add `parent` field to Canvas class**

In Task 2, `suspended` and `cascadeFromParent` were added. Now add `parent` alongside them:

```swift
var suspended: Bool = false
var cascadeFromParent: Bool = true
var parent: String?
```

Also update `toInfo()` to use the real parent value instead of the placeholder `nil`:

```swift
parent: parent,
```

- [ ] **Step 1b: Add tree walk helper, ACK tracking, and `canvas(forID:)` to CanvasManager**

Add after `hasTrackedCanvases` (around line 377):

```swift
/// Collect a canvas and all its cascade-eligible descendants (recursive).
func collectTree(_ rootID: String) -> [String] {
    var result = [rootID]
    for canvas in canvases.values where canvas.parent == rootID && canvas.cascadeFromParent {
        result.append(contentsOf: collectTree(canvas.id))
    }
    return result
}

/// Expose a canvas for external callers (daemon layer) that need to set parent.
func canvas(forID id: String) -> Canvas? { canvases[id] }

/// Pending resume ACKs: canvas IDs we're waiting on.
private var pendingResumeACKs: Set<String> = []
private var resumeCompletion: (() -> Void)?
```

- [ ] **Step 2: Implement `handleSuspend`**

Add after the tree walk helper:

```swift
private func handleSuspend(_ req: CanvasRequest) -> CanvasResponse {
    guard let id = req.id else {
        return .fail("suspend requires --id", code: "MISSING_ID")
    }
    guard let canvas = canvases[id] else {
        return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
    }
    if canvas.suspended { return .ok() }  // already suspended, no-op

    // Phase 1: atomic hide — collect tree, orderOut all windows on main thread
    let tree = collectTree(id)
    for cid in tree {
        guard let c = canvases[cid] else { continue }
        c.window.orderOut(nil)
        c.suspended = true
    }

    // Phase 2: notify renderers (async, best-effort, no ACK needed)
    let suspendMsg = "{\"type\":\"lifecycle\",\"action\":\"suspend\"}"
    let b64 = Data(suspendMsg.utf8).base64EncodedString()
    let js = "window.headsup && window.headsup.receive && window.headsup.receive('\(b64)')"
    for cid in tree {
        evalAsync(canvasID: cid, js: js)
    }

    onCanvasCountChanged?()
    return .ok()
}
```

- [ ] **Step 3: Implement `handleResume`**

Add after `handleSuspend`:

```swift
private func handleResume(_ req: CanvasRequest) -> CanvasResponse {
    guard let id = req.id else {
        return .fail("resume requires --id", code: "MISSING_ID")
    }
    guard let canvas = canvases[id] else {
        return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
    }
    if !canvas.suspended { return .ok() }  // not suspended, no-op

    // Phase 1: notify renderers to wake up, collect ACKs
    let tree = collectTree(id)
    let suspendedInTree = tree.filter { canvases[$0]?.suspended == true }

    pendingResumeACKs = Set(suspendedInTree)
    let showWindows: () -> Void = { [weak self] in
        guard let self = self else { return }
        self.pendingResumeACKs.removeAll()
        self.resumeCompletion = nil
        // Phase 2: atomic show
        for cid in suspendedInTree {
            guard let c = self.canvases[cid] else { continue }
            if c.isInteractive {
                c.window.makeKeyAndOrderFront(nil)
            } else {
                c.window.orderFront(nil)
            }
            c.suspended = false
        }
        self.onCanvasCountChanged?()
    }
    resumeCompletion = showWindows

    // Send lifecycle:resume to each renderer
    let resumeMsg = "{\"type\":\"lifecycle\",\"action\":\"resume\"}"
    let b64 = Data(resumeMsg.utf8).base64EncodedString()
    let js = "window.headsup && window.headsup.receive && window.headsup.receive('\(b64)')"
    for cid in suspendedInTree {
        evalAsync(canvasID: cid, js: js)
    }

    // 200ms timeout — show windows even if ACKs don't arrive
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
        guard let self = self, self.resumeCompletion != nil else { return }
        fputs("[canvas] resume ACK timeout; showing windows anyway\n", stderr)
        self.resumeCompletion?()
    }

    return .ok()
}

/// Called when a renderer sends lifecycle.ready ACK.
func receiveLifecycleReady(_ canvasID: String) {
    pendingResumeACKs.remove(canvasID)
    if pendingResumeACKs.isEmpty, let completion = resumeCompletion {
        completion()
    }
}
```

- [ ] **Step 4: Add suspend/resume to the `handle` switch**

In `func handle(_ request:connectionID:)` (line 429), add two cases:

```swift
case "suspend": return handleSuspend(request)
case "resume":  return handleResume(request)
```

- [ ] **Step 5: Update `handleCreate` for explicit parent, cascade, and born-suspended**

In `handleCreate` (around line 537), after `canvas.trackTarget = trackTarget`, add:

```swift
canvas.trackTarget = trackTarget
canvas.cascadeFromParent = req.cascade ?? true
// Explicit parent from request (implicit parent set by daemon layer in Task 4)
if let explicitParent = req.parent {
    guard canvases[explicitParent] != nil else {
        return .fail("Parent canvas '\(explicitParent)' not found", code: "PARENT_NOT_FOUND")
    }
    canvas.parent = explicitParent
}
// Born suspended: if parent is suspended and cascade is true, start hidden
let bornSuspended: Bool = {
    guard canvas.cascadeFromParent, let pid = canvas.parent,
          let parentCanvas = canvases[pid] else { return false }
    return parentCanvas.suspended
}()
if bornSuspended {
    canvas.suspended = true
}
```

Then find the existing `canvas.show()` call in `handleCreate` and wrap it:

```swift
if !canvas.suspended {
    canvas.show()
}
```

- [ ] **Step 6: Build and verify compilation**

Run: `cd /Users/Michael/Code/agent-os && bash build.sh 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/display/canvas.swift
git commit -m "feat(canvas): implement suspend/resume lifecycle in CanvasManager"
```

---

### Task 4: Wire Suspend/Resume and Cascade Opt-Out into Daemon

**Files:**
- Modify: `src/daemon/unified.swift`

The daemon's `handleCanvasCreate` already sets `canvasCreatedBy[newID] = callerID`. We need to:
1. Pass `cascade` through and store it.
2. Set `canvas.parent` for implicit provenance (when CanvasManager didn't set an explicit one).
3. Add `canvas.suspend` / `canvas.resume` to the postMessage handler.
4. Handle `lifecycle.ready` ACK from renderers.
5. Respect `cascade` in `performCascadeRemove`.

- [ ] **Step 1: Store cascade flag and set implicit parent after create**

In `handleCanvasCreate` (around line 542-551 of unified.swift), after `let response = self.canvasManager.handle(req)` succeeds, add implicit parent assignment and cascade tracking:

```swift
if response.status == "success" {
    // Set implicit parent if CanvasManager didn't set an explicit one
    if let canvas = self.canvasManager.canvas(forID: newID), canvas.parent == nil {
        canvas.parent = callerID
    }

    self.canvasSubscriptionLock.lock()
    self.canvasCreatedBy[newID] = callerID
    var siblings = self.canvasChildren[callerID] ?? []
    siblings.insert(newID)
    self.canvasChildren[callerID] = siblings
    self.canvasSubscriptionLock.unlock()
    // ... existing response dispatch
}
```

Note: `canvas(forID:)` was added to CanvasManager in Task 3 step 1b.

- [ ] **Step 2: Pass `cascade` through the CanvasRequest**

In `handleCanvasCreate`, when building the `CanvasRequest`, pass the `cascade` value from the payload:

```swift
let cascadeFlag = payload["cascade"] as? Bool

let req = CanvasRequest(
    action: "create",
    id: newID,
    at: at,
    anchorWindow: nil, anchorChannel: nil, offset: nil,
    html: nil, url: resolvedURL,
    interactive: interactive,
    focus: nil, ttl: nil, js: nil, scope: nil,
    autoProject: nil,
    track: payload["track"] as? String,
    parent: payload["parent"] as? String,
    cascade: cascadeFlag,
    channel: nil, data: nil
)
```

Note: Task 9 ensures all `CanvasRequest` fields have `= nil` defaults so existing positional call sites don't break. Do Task 9 right after Task 1.

- [ ] **Step 3: Add `canvas.suspend` and `canvas.resume` to postMessage handler**

In the `switch type` block in `onMessage` (around line 138), add:

```swift
case "canvas.suspend":
    self.handleCanvasSuspend(callerID: canvasID, payload: inner ?? [:])
    return
case "canvas.resume":
    self.handleCanvasResume(callerID: canvasID, payload: inner ?? [:])
    return
```

Add the handler methods:

```swift
private func handleCanvasSuspend(callerID: String, payload: [String: Any]) {
    let requestID = payload["request_id"] as? String
    let targetID = (payload["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? callerID

    DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        let req = CanvasRequest(action: "suspend", id: targetID)
        let response = self.canvasManager.handle(req)
        self.dispatchCanvasResponse(to: callerID, requestID: requestID,
            status: response.status == "success" ? "ok" : "error",
            code: response.code, message: response.error)
    }
}

private func handleCanvasResume(callerID: String, payload: [String: Any]) {
    let requestID = payload["request_id"] as? String
    let targetID = (payload["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? callerID

    DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        let req = CanvasRequest(action: "resume", id: targetID)
        let response = self.canvasManager.handle(req)
        self.dispatchCanvasResponse(to: callerID, requestID: requestID,
            status: response.status == "success" ? "ok" : "error",
            code: response.code, message: response.error)
    }
}
```

- [ ] **Step 4: Handle `lifecycle.ready` ACK from renderers**

In the `onMessage` switch, add a case for the lifecycle ACK:

```swift
case "lifecycle.ready":
    DispatchQueue.main.async { [weak self] in
        self?.canvasManager.receiveLifecycleReady(canvasID)
    }
    return
```

- [ ] **Step 5: Respect cascade flag in `performCascadeRemove` and `onCanvasLifecycle`**

In `performCascadeRemove` (around line 665), when orphaning children, also check the cascade flag:

The existing cascade removal in `onCanvasLifecycle` (line 186-198) removes ALL children. Update it to only cascade to children where `cascadeFromParent == true`, and orphan the rest:

```swift
// Cascade: children with cascade=true are removed; cascade=false are orphaned.
for child in children {
    if let childCanvas = self.canvasManager.canvas(forID: child),
       !childCanvas.cascadeFromParent {
        // Orphan: detach parent but don't remove
        childCanvas.parent = nil
        self.canvasSubscriptionLock.lock()
        self.canvasCreatedBy.removeValue(forKey: child)
        self.canvasSubscriptionLock.unlock()
        fputs("[canvas-mut] orphaned child=\(child) (parent=\(canvasID) removed)\n", stderr)
    } else {
        let req = CanvasRequest(action: "remove", id: child)
        _ = self.canvasManager.handle(req)
        fputs("[canvas-mut] cascade-removed child=\(child) (parent=\(canvasID))\n", stderr)
    }
}
```

- [ ] **Step 6: Populate `parent` in list output**

In the `handleList` response path, or in `toInfo()`, populate the `parent` field. Since `Canvas` now has a `parent` property (from Task 3), update `toInfo()` in canvas.swift to use it directly instead of the `nil` placeholder:

```swift
parent: parent,  // was: nil
```

Wait — this was already addressed in Task 2 with a comment saying "populated by caller." Since Canvas now stores `parent` directly (Task 3), just change the `toInfo()` line:

In `src/display/canvas.swift`, in `toInfo()`:

```swift
parent: parent,
```

- [ ] **Step 7: Build and verify compilation**

Run: `cd /Users/Michael/Code/agent-os && bash build.sh 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/daemon/unified.swift src/display/canvas.swift
git commit -m "feat(daemon): wire suspend/resume and cascade opt-out into daemon layer"
```

---

### Task 5: Update StatusItemManager for Three-Way Toggle

**Files:**
- Modify: `src/display/status-item.swift:59-236`

- [ ] **Step 1: Add `isSuspended` check helper**

Add a helper method to StatusItemManager (after `updateIcon`, around line 386):

```swift
private func isCanvasSuspended() -> Bool {
    guard let canvas = canvasManager.canvas(forID: toggleId) else { return false }
    return canvas.suspended
}
```

- [ ] **Step 2: Rewrite `handleClick` as three-way toggle**

Replace the current `handleClick` body (lines 59-67):

```swift
@objc func handleClick(_ sender: Any?) {
    guard !isAnimating else { return }

    if canvasManager.hasCanvas(toggleId) {
        if isCanvasSuspended() {
            resumeCanvas()
        } else {
            suspendCanvas()
        }
    } else {
        summonCanvas()  // cold boot — existing create path
    }
}
```

- [ ] **Step 3: Add `suspendCanvas` method**

Add after `dismissCanvas`:

```swift
private func suspendCanvas() {
    // Save position before suspending (for daemon restart recovery)
    if toggleTrack == nil { saveCurrentPosition() }

    var req = CanvasRequest(action: "suspend")
    req.id = toggleId
    _ = canvasManager.handle(req)
    updateIcon()
}
```

- [ ] **Step 4: Add `resumeCanvas` method**

```swift
private func resumeCanvas() {
    var req = CanvasRequest(action: "resume")
    req.id = toggleId
    _ = canvasManager.handle(req)
    updateIcon()
}
```

- [ ] **Step 5: Remove the `dismissed` eval from `dismissCanvas`**

The `dismissCanvas` method (line 154) currently sends a `dismissed` behavior message via eval before removing the canvas. This is no longer needed — cascade remove handles children. Remove the eval block (lines 161-166):

```swift
// REMOVE these lines:
let msg = "{\"type\":\"behavior\",\"slot\":\"dismissed\"}"
let b64 = Data(msg.utf8).base64EncodedString()
var evalReq = CanvasRequest(action: "eval")
evalReq.id = toggleId
evalReq.js = "window.headsup && window.headsup.receive && window.headsup.receive('\(b64)')"
_ = canvasManager.handle(evalReq)
```

Note: Keep `dismissCanvas` itself — it's the hard-remove path used if the canvas needs to be fully destroyed (e.g., daemon shutdown). But it no longer needs the eval.

- [ ] **Step 6: Update `updateIcon` to reflect suspended state**

```swift
func updateIcon() {
    let exists = canvasManager.hasCanvas(toggleId)
    let suspended = isCanvasSuspended()
    // Filled = active or animating. Unfilled = suspended, absent, or idle.
    statusItem?.button?.image = drawHexagonIcon(filled: (exists && !suspended) || isAnimating)
}
```

- [ ] **Step 7: Build and verify compilation**

Run: `cd /Users/Michael/Code/agent-os && bash build.sh 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/display/status-item.swift
git commit -m "feat(status-item): three-way toggle with suspend/resume"
```

---

### Task 6: Add Lifecycle Message Handler to Avatar Renderer

**Files:**
- Modify: `apps/sigil/renderer/index.html:1196-1197` (animate function), `apps/sigil/renderer/index.html:1459-1601` (handleLiveJsMessage)

- [ ] **Step 1: Add suspended gate to the animate loop**

In `apps/sigil/renderer/index.html`, modify the `animate` function (line 1196):

Before:
```js
function animate() {
    requestAnimationFrame(animate);
    const dt = 0.016;
```

After:
```js
let rendererSuspended = false;

function animate() {
    if (rendererSuspended) return;
    requestAnimationFrame(animate);
    const dt = 0.016;
```

The `rendererSuspended` variable should be declared near the top of the classic `<script>` block, alongside other module-level state. Alternatively, since `animate` is in the classic script context, declare it just above `animate`:

```js
let rendererSuspended = false;

function animate() {
    if (rendererSuspended) return;
    requestAnimationFrame(animate);
```

- [ ] **Step 2: Add `lifecycle` case to `handleLiveJsMessage`**

In the `switch (msg.type)` block (line 1473), add a case before the `default`:

```js
case 'lifecycle':
    if (msg.action === 'suspend') {
        rendererSuspended = true;
        console.log('[sigil] lifecycle: suspended');
    } else if (msg.action === 'resume') {
        rendererSuspended = false;
        requestAnimationFrame(animate);
        // ACK after one frame renders
        requestAnimationFrame(() => {
            postToHost('lifecycle.ready', { reason: 'resume' });
            console.log('[sigil] lifecycle: resumed, ACK sent');
        });
    }
    break;
```

The double-`requestAnimationFrame` ensures: (1) `animate()` restarts and renders a frame, (2) the ACK fires after that frame is painted.

- [ ] **Step 3: Remove the `dismissed` behavior handler**

In `handleLiveJsMessage`, remove the `behavior` case (lines 1587-1597):

```js
// REMOVE this entire case:
case 'behavior':
    if (msg.slot === 'dismissed') {
        postToHost('canvas.remove', { id: 'avatar-hit' });
        if (liveJs.workbenchVisible) {
            postToHost('canvas.remove', { id: 'sigil-workbench' });
            liveJs.workbenchVisible = false;
            liveJs.preWorkbenchPos = null;
        }
    }
    break;
```

Cascade remove in the daemon now handles this.

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/renderer/index.html
git commit -m "feat(renderer): lifecycle suspend/resume with rAF gate and ACK"
```

---

### Task 7: Add Lifecycle Handler to Hit-Area Canvas

**Files:**
- Modify: `apps/sigil/renderer/hit-area.html:10-17`

- [ ] **Step 1: Add lifecycle suspend/resume to hit-area**

Replace the existing `<script>` block in `apps/sigil/renderer/hit-area.html`:

```html
<script>
// Minimal absorber page. Exists where canvas.update puts it so clicks land
// here instead of passing through to the desktop.
window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
    try {
        const json = JSON.parse(atob(b64));
        if (json.type === 'lifecycle') {
            if (json.action === 'resume') {
                // ACK immediately — no rAF loop to restart
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
                    window.webkit.messageHandlers.headsup.postMessage({ type: 'lifecycle.ready', payload: { reason: 'resume' } });
                }
            }
            // suspend is a no-op for hit-area — no render loop to pause
        }
    } catch (e) { /* ignore malformed messages */ }
};
console.log('[avatar-hit] ready');
</script>
```

- [ ] **Step 2: Commit**

```bash
git add apps/sigil/renderer/hit-area.html
git commit -m "feat(hit-area): handle lifecycle suspend/resume ACK"
```

---

### Task 8: Integration Test — Manual Verification

**Files:** None (runtime verification only)

- [ ] **Step 1: Build the daemon**

Run: `cd /Users/Michael/Code/agent-os && bash build.sh`

- [ ] **Step 2: Clean and start the daemon**

Run: `./aos clean && ./aos serve` (in a separate terminal, or verify the running daemon restarts via launchd after `pkill aos`)

- [ ] **Step 3: Verify cold boot still works**

Click the status item icon. The avatar should appear with the dot animation (cold boot path — canvas doesn't exist yet). Verify the console log shows the full boot sequence.

- [ ] **Step 4: Verify suspend**

Click the status item icon again. The avatar should vanish instantly (no animation — suspend path). Verify:
- `aos show list` shows the canvas with `"suspended": true`
- The daemon log shows `[canvas] suspend` messages
- No CPU usage from the WKWebView process (Activity Monitor)

- [ ] **Step 5: Verify resume**

Click the status item icon again. The avatar should appear instantly with a current frame (no stale flash). Verify:
- `aos show list` shows the canvas with `"suspended": false`
- The daemon log shows lifecycle resume + ACK messages

- [ ] **Step 6: Verify cascade**

While the avatar is visible, confirm `avatar-hit` exists in `aos show list` with parent set to `avatar-main` (or whatever the toggle ID is). Suspend via the status item — both canvases should hide. Resume — both should reappear.

- [ ] **Step 7: Commit any fixes**

If any issues found during verification, fix and commit incrementally.

---

### Task 9: Update CanvasRequest Init Sites

**Files:**
- Modify: Multiple files that construct `CanvasRequest` with positional init

Adding `parent` and `cascade` to `CanvasRequest` may break existing positional initializers throughout the codebase. This task is a sweep to add the new fields (as `nil`) to every call site.

- [ ] **Step 1: Find all CanvasRequest construction sites**

Run: `grep -rn 'CanvasRequest(' src/ --include='*.swift'` to find every call site.

- [ ] **Step 2: Add `parent: nil, cascade: nil` to each positional init**

For each call site, insert `parent: nil, cascade: nil` after `track:` in the argument list. Since these are optional fields defaulting to nil, only positional (non-trailing) call sites need updating.

Alternatively, if `CanvasRequest` uses default parameter values (the struct has `var parent: String?` with no explicit default in a custom init), Swift's memberwise init will require them. The safest fix: keep the fields as `var parent: String? = nil` and `var cascade: Bool? = nil` in the struct — but since `CanvasRequest` doesn't have a custom init (it uses the auto-synthesized memberwise init for Codable structs), we need to check whether the new fields' default values carry through.

If the fields are declared as `var parent: String?` (no explicit `= nil`), add `= nil` to ensure the memberwise init has defaults:

```swift
var parent: String? = nil
var cascade: Bool? = nil
```

This way, existing `CanvasRequest(action: "remove", id: id)` call sites that use trailing-argument shorthand continue to work without modification.

- [ ] **Step 3: Build and verify**

Run: `cd /Users/Michael/Code/agent-os && bash build.sh 2>&1 | tail -20`
Expected: Build succeeds with no errors at existing call sites.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "fix(canvas): ensure new CanvasRequest fields have nil defaults"
```

---

### Recommended Task Order

Tasks 1 → 9 → 2 → 3 → 4 → 5 → 6 → 7 → 8

Task 9 (fixing CanvasRequest init sites) should be done immediately after Task 1 (adding the fields) to keep the build green. All other tasks proceed in sequence.
