# Canvas Mutation API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let JS inside a canvas create, update, and remove canvases via `postMessage`, reusing the daemon's existing `CanvasRequest` pipeline with parent→child ownership tracking for lifecycle hygiene.

**Architecture:** Extend the existing `canvasManager.onEvent` interception block in `src/daemon/unified.swift` to match three new message types (`canvas.create`, `canvas.update`, `canvas.remove`). Each handler translates the postMessage payload into a `CanvasRequest`, runs a permission check (self + children + CLI-origin), calls `canvasManager.handle(...)`, updates ownership state (`createdBy` / `children` dicts), and — if the caller supplied a `request_id` — dispatches a response back via `canvasManager.evalAsync(js: "headsup.receive(...)")`. Cascade-on-remove walks `children` before removing the target. No new transport; no duplicated canvas logic.

**Tech Stack:** Swift (daemon, AppKit, WebKit), `CanvasRequest` / `CanvasResponse` structs in `src/display/protocol.swift`, `canvasManager.handle` / `canvasManager.evalAsync` (shipped in PoC), `headsup` postMessage bridge, vanilla HTML/JS test harness.

**Spec:** `docs/superpowers/specs/2026-04-11-canvas-mutation-api.md`

---

## Pre-flight

All work happens on `main` (branch policy: do NOT push to origin — avatar-sub elimination arc lands as one push). Before starting, confirm dev state:

```bash
# From repo root
cd /Users/Michael/Code/agent-os

# Content root registered (sanity check; should already be true from PoC)
./aos set content.roots.sigil apps/sigil

# Stop any running daemon so rebuilds start clean
pkill -f "aos serve" 2>/dev/null || true
```

The standard rebuild-and-restart cycle used throughout:

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
bash build.sh
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

### Naming conventions locked in this plan

- **JS API field names use `frame`** for `[x,y,w,h]`, matching the spec. Translate to `at` when building the `CanvasRequest` struct (the existing internal name).
- **JS API uses `interactive`** (bool), identical to `CanvasRequest.interactive` and the `--interactive` CLI flag. No aliasing.
- **Error codes** align with existing daemon codes where equivalents exist: `DUPLICATE_ID` (verified in `canvas.swift:339`), not a new `ID_COLLISION`. New codes added only where nothing equivalent exists (`FORBIDDEN`, `INVALID_FRAME`).

### Existing primitives this plan relies on

All shipped by the PoC (tasks 1–9 of the predecessor plan):

- `canvasManager.evalAsync(canvasID:, js:)` — fire-and-forget JS eval (`src/display/canvas.swift`)
- `canvasManager.onEvent` interception block (`src/daemon/unified.swift:98–114`)
- `canvasSubscriptionLock` + `canvasEventSubscriptions` state (`unified.swift:26–27`)
- `handleCanvasSubscription(...)` pattern to reuse (`unified.swift:210–230`)
- `CanvasRequest` / `CanvasResponse` structs (`src/display/protocol.swift:57–85`)
- `canvasManager.handle(_:, connectionID:)` (`canvas.swift:319`)
- `canvas_lifecycle` removed path (`unified.swift:116–133`) — we'll extend it

---

### Task 1: Add ownership state to `UnifiedDaemon`

Add the two dicts that track parent→child relationships. No behavior yet — just state. These reuse the existing `canvasSubscriptionLock` so all per-canvas state stays serialized together.

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Locate the existing canvas-subscription state**

```bash
grep -n "canvasEventSubscriptions" src/daemon/unified.swift
```

You'll see (near line 26):

```swift
// Canvas-side event subscriptions: canvas ID → set of event-type names it wants.
// Populated when a canvas posts {type: 'subscribe', payload: {events: [...]}}.
var canvasEventSubscriptions: [String: Set<String>] = [:]
let canvasSubscriptionLock = NSLock()
```

- [ ] **Step 2: Add the ownership dicts next to it**

Add immediately after the `canvasSubscriptionLock` declaration:

```swift
// Canvas ownership: child canvas ID → parent canvas ID.
// Populated when a canvas creates another canvas via postMessage(canvas.create).
// CLI-originated canvases have no entry here (nil parent), which the permission
// check treats as "mutable by anyone" for debugging predictability.
var canvasCreatedBy: [String: String] = [:]

// Inverse of canvasCreatedBy: parent canvas ID → set of direct child IDs.
// Maintained alongside canvasCreatedBy so cascade-remove doesn't need a scan.
var canvasChildren: [String: Set<String>] = [:]
```

Both share `canvasSubscriptionLock`. No new lock.

- [ ] **Step 3: Verify it compiles**

```bash
bash build.sh
```

Expected: clean build. Dicts are unused so far.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): add canvas ownership state for mutation API"
```

---

### Task 2: Add `dispatchCanvasResponse` helper

The helper that sends an async response back to the calling canvas. Used by create and remove. Encodes `{type: "canvas.response", ...}` as JSON, base64s it, and calls `evalAsync` with `headsup.receive('<b64>')`. Matches the PoC's input-event dispatch path exactly.

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Locate `forwardInputEventToCanvases`**

```bash
grep -n "func forwardInputEventToCanvases" src/daemon/unified.swift
```

The new helper lives next to it — they use the same `evalAsync → headsup.receive` path.

- [ ] **Step 2: Add the helper**

Immediately after `forwardInputEventToCanvases`:

```swift
/// Send an async response to a canvas that made a mutation request with a request_id.
/// Reuses the headsup.receive dispatch path — the canvas differentiates by msg.type.
/// If requestID is nil, this is a no-op (fire-and-forget path).
private func dispatchCanvasResponse(
    to canvasID: String,
    requestID: String?,
    status: String,
    code: String? = nil,
    message: String? = nil,
    createdID: String? = nil
) {
    guard let requestID = requestID else { return }
    var obj: [String: Any] = [
        "type": "canvas.response",
        "request_id": requestID,
        "status": status
    ]
    if let code = code { obj["code"] = code }
    if let message = message { obj["message"] = message }
    if let createdID = createdID { obj["id"] = createdID }
    guard let json = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
    let b64 = json.base64EncodedString()
    let js = "window.headsup && window.headsup.receive && window.headsup.receive('\(b64)')"
    canvasManager.evalAsync(canvasID: canvasID, js: js)
}
```

- [ ] **Step 3: Verify it compiles**

```bash
bash build.sh
```

Expected: clean build. Helper unused so far.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): add dispatchCanvasResponse helper for async JS replies"
```

---

### Task 3: Intercept `canvas.create` from JS

Teach `canvasManager.onEvent` to recognize `canvas.create`, translate the payload into a `CanvasRequest`, call `canvasManager.handle(...)` on the main thread, record parentage on success, and dispatch the response.

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Locate the existing interception block**

```bash
grep -n "type == \"subscribe\" || type == \"unsubscribe\"" src/daemon/unified.swift
```

You'll find (around line 103–110):

```swift
if let dict = payload as? [String: Any],
   let type = dict["type"] as? String,
   type == "subscribe" || type == "unsubscribe" {
    let inner = dict["payload"] as? [String: Any]
    let events = (inner?["events"] as? [String]) ?? []
    self.handleCanvasSubscription(canvasID: canvasID, type: type, events: events)
    return
}
```

- [ ] **Step 2: Extend the interception block to recognize mutation types**

Replace the existing block with:

```swift
if let dict = payload as? [String: Any],
   let type = dict["type"] as? String {
    let inner = dict["payload"] as? [String: Any]
    switch type {
    case "subscribe", "unsubscribe":
        let events = (inner?["events"] as? [String]) ?? []
        self.handleCanvasSubscription(canvasID: canvasID, type: type, events: events)
        return
    case "canvas.create":
        self.handleCanvasCreate(callerID: canvasID, payload: inner ?? [:])
        return
    case "canvas.update":
        self.handleCanvasUpdate(callerID: canvasID, payload: inner ?? [:])
        return
    case "canvas.remove":
        self.handleCanvasRemove(callerID: canvasID, payload: inner ?? [:])
        return
    default:
        break
    }
}
```

Unknown types fall through to the existing `canvas_message` broadcast — same as today.

- [ ] **Step 3: Add `handleCanvasCreate`**

Near `handleCanvasSubscription` and `dispatchCanvasResponse`, add:

```swift
private func handleCanvasCreate(callerID: String, payload: [String: Any]) {
    let requestID = payload["request_id"] as? String

    guard let newID = payload["id"] as? String, !newID.isEmpty else {
        dispatchCanvasResponse(to: callerID, requestID: requestID,
            status: "error", code: "MISSING_ID", message: "canvas.create requires id")
        return
    }
    guard let url = payload["url"] as? String, !url.isEmpty else {
        dispatchCanvasResponse(to: callerID, requestID: requestID,
            status: "error", code: "MISSING_URL", message: "canvas.create requires url")
        return
    }
    guard let frameArr = payload["frame"] as? [Any], frameArr.count == 4 else {
        dispatchCanvasResponse(to: callerID, requestID: requestID,
            status: "error", code: "INVALID_FRAME", message: "frame must be [x,y,w,h]")
        return
    }
    // Accept both Int and Double from JSON — NSNumber handles both.
    let at: [CGFloat] = frameArr.compactMap { ($0 as? NSNumber).map { CGFloat(truncating: $0) } }
    guard at.count == 4 else {
        dispatchCanvasResponse(to: callerID, requestID: requestID,
            status: "error", code: "INVALID_FRAME", message: "frame values must be numeric")
        return
    }
    let interactive = payload["interactive"] as? Bool

    // Rewrite aos:// URLs same as the socket path does.
    let resolvedURL = resolveContentURL(url)

    let req = CanvasRequest(
        action: "create",
        id: newID,
        at: at,
        anchorWindow: nil, anchorChannel: nil, offset: nil,
        html: nil, url: resolvedURL,
        interactive: interactive,
        focus: nil, ttl: nil, js: nil, scope: nil,
        autoProject: nil, channel: nil, data: nil
    )

    // Must run on main thread — canvasManager owns AppKit objects.
    DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        let response = self.canvasManager.handle(req)
        if response.status == "success" {
            self.canvasSubscriptionLock.lock()
            self.canvasCreatedBy[newID] = callerID
            var siblings = self.canvasChildren[callerID] ?? []
            siblings.insert(newID)
            self.canvasChildren[callerID] = siblings
            self.canvasSubscriptionLock.unlock()
            fputs("[canvas-mut] create ok caller=\(callerID) new=\(newID)\n", stderr)
            self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "ok", createdID: newID)
        } else {
            fputs("[canvas-mut] create fail caller=\(callerID) new=\(newID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
            self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: response.code, message: response.error)
        }
    }
}
```

The `resolveContentURL` function is already used at line 365 for socket requests — no new import.

- [ ] **Step 4: Stub the other two handlers so the switch compiles**

Add these stubs near `handleCanvasCreate` (they'll be filled in Tasks 4 and 5):

```swift
private func handleCanvasUpdate(callerID: String, payload: [String: Any]) {
    // Implemented in Task 4.
    fputs("[canvas-mut] update stub caller=\(callerID)\n", stderr)
}

private func handleCanvasRemove(callerID: String, payload: [String: Any]) {
    // Implemented in Task 5.
    fputs("[canvas-mut] remove stub caller=\(callerID)\n", stderr)
}
```

- [ ] **Step 5: Build and restart daemon**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
bash build.sh
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

- [ ] **Step 6: Smoke test with an ad-hoc page**

Write a temporary page that creates a child on load. Save as `apps/sigil/test-mutation/index.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>body{margin:0;background:rgba(0,0,0,0.4);color:#fff;font:14px ui-monospace,monospace;padding:12px;}</style>
</head>
<body>
<div id="log">test-mutation: booting</div>
<script>
var log = document.getElementById('log');
function writeln(s){ log.textContent += '\n' + s; }
window.headsup = window.headsup || {};
window.headsup.receive = function(b64){
  try { var msg = JSON.parse(atob(b64)); writeln('recv: ' + JSON.stringify(msg)); }
  catch(e){ writeln('parse err: ' + e); }
};
function post(type, payload){
  window.webkit.messageHandlers.headsup.postMessage({type:type, payload:payload});
}
// Ask for a child canvas 300x200 at (400, 400).
post('canvas.create', {
  id: 'child-a', url: 'aos://sigil/test-mutation/child.html',
  frame: [400, 400, 300, 200], interactive: false, request_id: 'r1'
});
writeln('posted canvas.create');
</script>
</body>
</html>
```

And `apps/sigil/test-mutation/child.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>html,body{margin:0;width:100%;height:100%;background:rgba(50,120,200,0.55);color:#fff;font:16px system-ui;}</style>
</head>
<body><div style="padding:16px;">child canvas</div></body>
</html>
```

Then:

```bash
./aos show create --id test-parent --url aos://sigil/test-mutation/index.html --at 100,100,400,300
sleep 1
./aos show list
```

**Expected:** `./aos show list` prints two canvases: `test-parent` and `child-a`. `/tmp/aos.log` contains `[canvas-mut] create ok caller=test-parent new=child-a`.

Also verify the parent canvas text shows `recv: {"type":"canvas.response","request_id":"r1","status":"ok","id":"child-a"}`.

- [ ] **Step 7: Clean up canvases (don't leave them running)**

```bash
./aos show remove --id child-a
./aos show remove --id test-parent
```

- [ ] **Step 8: Commit**

```bash
git add src/daemon/unified.swift apps/sigil/test-mutation/index.html apps/sigil/test-mutation/child.html
git commit -m "feat(daemon): canvas.create postMessage handler with ownership tracking"
```

---

### Task 4: Intercept `canvas.update` from JS

Fire-and-forget update path. Permission check, translate payload, call `canvasManager.handle(...)`. No response dispatch even if `request_id` is present — update is always silent (documented choice; see spec open questions).

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Replace the `handleCanvasUpdate` stub**

Replace the stub from Task 3 with:

```swift
private func handleCanvasUpdate(callerID: String, payload: [String: Any]) {
    guard let targetID = payload["id"] as? String, !targetID.isEmpty else {
        fputs("[canvas-mut] update dropped caller=\(callerID) reason=missing-id\n", stderr)
        return
    }

    // Permission check. `true` = allowed.
    let permitted: Bool = {
        if targetID == callerID { return true }
        canvasSubscriptionLock.lock()
        defer { canvasSubscriptionLock.unlock() }
        if let owner = canvasCreatedBy[targetID] { return owner == callerID }
        return true  // no recorded owner = CLI-origin = open per spec rule 3
    }()
    guard permitted else {
        fputs("[canvas-mut] update forbidden caller=\(callerID) target=\(targetID)\n", stderr)
        return
    }

    // Build the CanvasRequest. Only `frame` and `interactive` are accepted for update.
    var at: [CGFloat]? = nil
    if let arr = payload["frame"] as? [Any], arr.count == 4 {
        let parsed: [CGFloat] = arr.compactMap { ($0 as? NSNumber).map { CGFloat(truncating: $0) } }
        if parsed.count == 4 { at = parsed }
    }
    let interactive = payload["interactive"] as? Bool

    guard at != nil || interactive != nil else {
        fputs("[canvas-mut] update dropped caller=\(callerID) target=\(targetID) reason=no-fields\n", stderr)
        return
    }

    let req = CanvasRequest(
        action: "update",
        id: targetID,
        at: at,
        anchorWindow: nil, anchorChannel: nil, offset: nil,
        html: nil, url: nil,
        interactive: interactive,
        focus: nil, ttl: nil, js: nil, scope: nil,
        autoProject: nil, channel: nil, data: nil
    )

    DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        let response = self.canvasManager.handle(req)
        if response.status != "success" {
            fputs("[canvas-mut] update fail caller=\(callerID) target=\(targetID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
        }
        // Success path is intentionally silent — update is the 60Hz hot path.
    }
}
```

- [ ] **Step 2: Build and restart**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
bash build.sh
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

- [ ] **Step 3: Extend the test page to exercise update**

Replace `apps/sigil/test-mutation/index.html` with:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>body{margin:0;background:rgba(0,0,0,0.4);color:#fff;font:13px ui-monospace,monospace;padding:12px;}
button{font:13px ui-monospace,monospace;padding:6px 10px;margin:4px 4px 0 0;}
</style>
</head>
<body>
<div id="log">test-mutation ready</div>
<div>
  <button onclick="createChild()">create child-a</button>
  <button onclick="moveChild()">move child-a +50,+50</button>
  <button onclick="toggleInteractive()">toggle child-a interactive</button>
  <button onclick="removeChild()">remove child-a</button>
</div>
<script>
var log = document.getElementById('log');
var childFrame = [400, 400, 300, 200];
var childInteractive = false;
function writeln(s){ log.textContent += '\n' + s; }
window.headsup = window.headsup || {};
window.headsup.receive = function(b64){
  try { writeln('recv: ' + JSON.stringify(JSON.parse(atob(b64)))); }
  catch(e){ writeln('parse err: ' + e); }
};
function post(type, payload){
  window.webkit.messageHandlers.headsup.postMessage({type:type, payload:payload});
}
function createChild(){
  post('canvas.create', {
    id:'child-a', url:'aos://sigil/test-mutation/child.html',
    frame: childFrame.slice(), interactive: childInteractive, request_id:'r-create'
  });
  writeln('→ canvas.create');
}
function moveChild(){
  childFrame[0] += 50; childFrame[1] += 50;
  post('canvas.update', { id:'child-a', frame: childFrame.slice() });
  writeln('→ canvas.update frame=' + childFrame.join(','));
}
function toggleInteractive(){
  childInteractive = !childInteractive;
  post('canvas.update', { id:'child-a', interactive: childInteractive });
  writeln('→ canvas.update interactive=' + childInteractive);
}
function removeChild(){
  post('canvas.remove', { id:'child-a', request_id:'r-remove' });
  writeln('→ canvas.remove');
}
</script>
</body>
</html>
```

- [ ] **Step 4: Exercise the update path**

```bash
./aos show create --id test-parent --url aos://sigil/test-mutation/index.html --at 100,100,500,400 --interactive
```

Click "create child-a" (the child window appears at 400,400). Click "move child-a +50,+50" a few times. The child canvas should move diagonally across the screen. Click "toggle child-a interactive" and verify clicks pass through / are captured as expected.

**Verification:**
- Child canvas moves on each "move" click
- `/tmp/aos.log` shows no `[canvas-mut] update fail` lines
- Status text does NOT show any `canvas.response` from updates (they're silent)

- [ ] **Step 5: Clean up**

```bash
./aos show remove --id child-a 2>/dev/null
./aos show remove --id test-parent
```

- [ ] **Step 6: Commit**

```bash
git add src/daemon/unified.swift apps/sigil/test-mutation/index.html
git commit -m "feat(daemon): canvas.update postMessage handler (fire-and-forget)"
```

---

### Task 5: Intercept `canvas.remove` from JS with cascade

Permission check, cascade-remove children (unless `orphan_children: true`), then remove the target, then update ownership maps.

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Replace the `handleCanvasRemove` stub**

```swift
private func handleCanvasRemove(callerID: String, payload: [String: Any]) {
    let requestID = payload["request_id"] as? String
    let orphanChildren = (payload["orphan_children"] as? Bool) ?? false

    guard let targetID = payload["id"] as? String, !targetID.isEmpty else {
        dispatchCanvasResponse(to: callerID, requestID: requestID,
            status: "error", code: "MISSING_ID", message: "canvas.remove requires id")
        return
    }

    // Permission check — identical rule to update.
    let permitted: Bool = {
        if targetID == callerID { return true }
        canvasSubscriptionLock.lock()
        defer { canvasSubscriptionLock.unlock() }
        if let owner = canvasCreatedBy[targetID] { return owner == callerID }
        return true
    }()
    guard permitted else {
        dispatchCanvasResponse(to: callerID, requestID: requestID,
            status: "error", code: "FORBIDDEN",
            message: "caller \(callerID) may not remove \(targetID)")
        return
    }

    DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        self.performCascadeRemove(targetID: targetID, orphanChildren: orphanChildren)

        // performCascadeRemove logs per-canvas outcomes. For the response, report the target.
        // If the target itself didn't exist, `handle` would have returned NOT_FOUND — but
        // since the cascade does the actual work, we surface the target's result explicitly.
        let targetExisted = self.canvasManager.handle(
            CanvasRequest(action: "list", id: nil, at: nil,
                          anchorWindow: nil, anchorChannel: nil, offset: nil,
                          html: nil, url: nil, interactive: nil, focus: nil,
                          ttl: nil, js: nil, scope: nil, autoProject: nil,
                          channel: nil, data: nil)
        ).canvases?.contains(where: { $0.id == targetID }) ?? false
        if targetExisted {
            // We just asked to remove it and it's still there — that's a real error.
            self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "REMOVE_FAILED",
                message: "target \(targetID) still exists after remove")
        } else {
            self.dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok")
        }
    }
}

/// Must be called on the main thread. Removes children (recursively) before the target.
/// If orphanChildren is true, children are detached (createdBy[child] = nil) but not removed.
/// Updates ownership maps atomically under canvasSubscriptionLock.
private func performCascadeRemove(targetID: String, orphanChildren: Bool) {
    canvasSubscriptionLock.lock()
    let children = canvasChildren[targetID] ?? []
    if orphanChildren {
        for child in children {
            canvasCreatedBy.removeValue(forKey: child)
        }
        canvasChildren.removeValue(forKey: targetID)
    }
    canvasSubscriptionLock.unlock()

    if !orphanChildren {
        for child in children {
            performCascadeRemove(targetID: child, orphanChildren: false)
        }
    }

    // Remove the target itself via the standard pipeline.
    let req = CanvasRequest(
        action: "remove",
        id: targetID,
        at: nil, anchorWindow: nil, anchorChannel: nil, offset: nil,
        html: nil, url: nil, interactive: nil,
        focus: nil, ttl: nil, js: nil, scope: nil,
        autoProject: nil, channel: nil, data: nil
    )
    let response = canvasManager.handle(req)
    if response.status != "success" {
        fputs("[canvas-mut] remove fail target=\(targetID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
    } else {
        fputs("[canvas-mut] remove ok target=\(targetID) orphan=\(orphanChildren)\n", stderr)
    }

    // Ownership cleanup for the target itself — parent's children set, target's own rows.
    // (Note: the canvas_lifecycle "removed" handler in Task 6 also cleans these entries,
    // but doing it here keeps the post-condition local to this function.)
    canvasSubscriptionLock.lock()
    if let parent = canvasCreatedBy.removeValue(forKey: targetID) {
        if var peers = canvasChildren[parent] {
            peers.remove(targetID)
            if peers.isEmpty {
                canvasChildren.removeValue(forKey: parent)
            } else {
                canvasChildren[parent] = peers
            }
        }
    }
    canvasChildren.removeValue(forKey: targetID)
    canvasSubscriptionLock.unlock()
}
```

- [ ] **Step 2: Build and restart**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
bash build.sh
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

- [ ] **Step 3: Test remove end-to-end**

```bash
./aos show create --id test-parent --url aos://sigil/test-mutation/index.html --at 100,100,500,400 --interactive
```

Click "create child-a" → "remove child-a". Verify:
- Child disappears
- Parent's log shows `recv: {"type":"canvas.response","request_id":"r-remove","status":"ok"}`
- `./aos show list` (in another terminal) shows only `test-parent`

- [ ] **Step 4: Test cascade — remove parent, child auto-removed**

Click "create child-a". Then in another terminal:

```bash
./aos show remove --id test-parent
./aos show list
```

Because `aos show remove` removes the parent canvas (a WKWebView), the child still exists in the daemon — but our cascade only runs via the `canvas.remove` JS path, not the CLI remove. That's expected for this task; Task 6 covers the CLI-removed-parent cascade via the `canvas_lifecycle` handler.

**For now, verify:** `./aos show list` shows `child-a` still present. Clean it up:

```bash
./aos show remove --id child-a
```

- [ ] **Step 5: Test permission — JS tries to remove an unrelated JS canvas**

Restart daemon. Create two parents:

```bash
./aos show create --id parent-a --url aos://sigil/test-mutation/index.html --at 100,100,500,400 --interactive
./aos show create --id parent-b --url aos://sigil/test-mutation/index.html --at 650,100,500,400 --interactive
```

From `parent-a`, click "create child-a". From `parent-b`'s devtools or by modifying the test page temporarily: attempt `post('canvas.remove', { id: 'child-a', request_id: 'bad' })`.

Verify `parent-b`'s log shows `status: "error", code: "FORBIDDEN"`. Daemon log shows the forbidden attempt.

Clean up:

```bash
./aos show remove --id child-a
./aos show remove --id parent-a
./aos show remove --id parent-b
```

(If exercising this through devtools is impractical, skip this step — the test harness in Task 7 automates it.)

- [ ] **Step 6: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): canvas.remove postMessage handler with cascade"
```

---

### Task 6: Cascade ownership cleanup on canvas lifecycle removal

When a canvas is removed through *any* path (CLI `aos show remove`, cascade from another remove, crash, TTL expiry), its ownership rows and its children must be cleaned up. Extend the existing `canvas_lifecycle` `"removed"` handler (which already clears subscription rows) to also cascade-remove children and clean the ownership maps.

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Locate the existing lifecycle handler**

```bash
grep -n "action == \"removed\"" src/daemon/unified.swift
```

You'll find (around line 121):

```swift
if action == "removed" {
    self.canvasSubscriptionLock.lock()
    let had = self.canvasEventSubscriptions.removeValue(forKey: canvasID) != nil
    self.canvasSubscriptionLock.unlock()
    if had {
        fputs("[canvas-sub] cleared subscriptions for removed canvas=\(canvasID)\n", stderr)
    }
}
```

- [ ] **Step 2: Extend the handler with ownership cleanup + child cascade**

Replace the block with:

```swift
if action == "removed" {
    self.canvasSubscriptionLock.lock()
    let had = self.canvasEventSubscriptions.removeValue(forKey: canvasID) != nil
    let children = self.canvasChildren.removeValue(forKey: canvasID) ?? []
    // Detach this canvas from its parent's child set.
    if let parent = self.canvasCreatedBy.removeValue(forKey: canvasID) {
        if var peers = self.canvasChildren[parent] {
            peers.remove(canvasID)
            if peers.isEmpty {
                self.canvasChildren.removeValue(forKey: parent)
            } else {
                self.canvasChildren[parent] = peers
            }
        }
    }
    self.canvasSubscriptionLock.unlock()
    if had {
        fputs("[canvas-sub] cleared subscriptions for removed canvas=\(canvasID)\n", stderr)
    }
    // Cascade: any children whose parent just died are removed too.
    // Runs on main thread (this closure already does).
    for child in children {
        let req = CanvasRequest(
            action: "remove", id: child, at: nil,
            anchorWindow: nil, anchorChannel: nil, offset: nil,
            html: nil, url: nil, interactive: nil,
            focus: nil, ttl: nil, js: nil, scope: nil,
            autoProject: nil, channel: nil, data: nil
        )
        _ = self.canvasManager.handle(req)
        fputs("[canvas-mut] cascade-removed child=\(child) (parent=\(canvasID))\n", stderr)
    }
}
```

This handler fires for every removal path — CLI, JS, cascade, crash, TTL. Cascading here means `canvas.remove` from JS is simpler (it doesn't need to pre-cleanup; letting `handle(remove)` fire the lifecycle event is enough). But `performCascadeRemove` in Task 5 already walks children first — the duplicate cascade is protected against by the fact that children are removed from `canvasChildren` atomically before the inner `handle(remove)` fires, so when the lifecycle handler runs for the already-processed parent, its `children` set is empty.

- [ ] **Step 3: Simplify `performCascadeRemove` (optional cleanup)**

Now that the lifecycle handler cascades, `performCascadeRemove`'s manual recursion is redundant for the non-orphan path. Simplify it:

```swift
private func performCascadeRemove(targetID: String, orphanChildren: Bool) {
    if orphanChildren {
        canvasSubscriptionLock.lock()
        let children = canvasChildren.removeValue(forKey: targetID) ?? []
        for child in children {
            canvasCreatedBy.removeValue(forKey: child)
        }
        canvasSubscriptionLock.unlock()
    }
    // If not orphaning, the lifecycle handler does the cascade automatically
    // when handle(remove) fires below.

    let req = CanvasRequest(
        action: "remove", id: targetID, at: nil,
        anchorWindow: nil, anchorChannel: nil, offset: nil,
        html: nil, url: nil, interactive: nil,
        focus: nil, ttl: nil, js: nil, scope: nil,
        autoProject: nil, channel: nil, data: nil
    )
    let response = canvasManager.handle(req)
    if response.status != "success" {
        fputs("[canvas-mut] remove fail target=\(targetID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
    } else {
        fputs("[canvas-mut] remove ok target=\(targetID) orphan=\(orphanChildren)\n", stderr)
    }
}
```

The tail bookkeeping (detach from parent's children set, clear own rows) is no longer needed here — the lifecycle handler does it.

- [ ] **Step 4: Build and restart**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
bash build.sh
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

- [ ] **Step 5: Verify CLI-remove cascades to JS-spawned children**

```bash
./aos show create --id test-parent --url aos://sigil/test-mutation/index.html --at 100,100,500,400 --interactive
```

Click "create child-a" in the parent. Then in another terminal:

```bash
./aos show remove --id test-parent
sleep 1
./aos show list
```

**Expected:** `./aos show list` shows neither `test-parent` nor `child-a`. Daemon log shows:
```
[canvas-mut] cascade-removed child=child-a (parent=test-parent)
```

- [ ] **Step 6: Verify `orphan_children: true` keeps children alive**

Extend the test page temporarily (or use devtools) to call:
```js
post('canvas.remove', { id: 'self', orphan_children: true, request_id: 'orph' });
```
where 'self' refers to the calling canvas.

Simpler path — add a button to `index.html` near the others:

```html
<button onclick="removeSelfOrphan()">remove self (orphan children)</button>
```

```js
function removeSelfOrphan(){
  // 'test-parent' is the id of this very canvas in the smoke tests.
  post('canvas.remove', { id: 'test-parent', orphan_children: true, request_id: 'orph' });
}
```

Flow: create `test-parent` → click "create child-a" → click "remove self (orphan children)". Verify:
- `test-parent` disappears
- `child-a` is still visible on screen
- `./aos show list` shows `child-a` but not `test-parent`
- Daemon log shows `[canvas-mut] remove ok target=test-parent orphan=true` and NO `cascade-removed` line

Then clean up:

```bash
./aos show remove --id child-a
```

- [ ] **Step 7: Commit**

```bash
git add src/daemon/unified.swift apps/sigil/test-mutation/index.html
git commit -m "feat(daemon): cascade ownership cleanup on canvas lifecycle removal"
```

---

### Task 7: Full test harness — exercise every rule

Build a single interactive page that drives every scenario from the spec's test plan. This is the manual-test artifact; leave it in the repo for regression checking.

**Files:**
- Modify: `apps/sigil/test-mutation/index.html`

- [ ] **Step 1: Rewrite the harness with every test case**

Replace `apps/sigil/test-mutation/index.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
html,body{margin:0;background:rgba(0,0,0,0.6);color:#eee;font:13px ui-monospace,monospace;padding:12px;}
button{font:12px ui-monospace,monospace;padding:5px 8px;margin:2px;}
#log{white-space:pre-wrap;margin-top:8px;max-height:60vh;overflow:auto;border-top:1px solid #444;padding-top:6px;}
.group{margin:6px 0;padding:4px 6px;border-left:2px solid #555;}
.group b{color:#8ef;}
</style>
</head>
<body>
<div>canvas-mutation harness (caller id = <span id="self">?</span>)</div>
<div class="group"><b>create</b>
 <button onclick="testCreate()">valid child</button>
 <button onclick="testCreateDup()">duplicate id</button>
 <button onclick="testCreateBadFrame()">bad frame</button>
</div>
<div class="group"><b>update</b>
 <button onclick="testMove()">move child +50,+50</button>
 <button onclick="testMoveRapid()">move 60 times (hot path)</button>
 <button onclick="testToggleInteractive()">toggle interactive</button>
</div>
<div class="group"><b>remove</b>
 <button onclick="testRemove()">remove child</button>
 <button onclick="testRemoveOrphan()">remove self orphan-children</button>
</div>
<div class="group"><b>permission</b>
 <button onclick="testRemoveUnowned()">try to remove sibling (should FORBIDDEN)</button>
 <button onclick="testRemoveCLI()">try to remove a CLI canvas (should OK)</button>
</div>
<div id="log"></div>
<script>
var selfID = new URLSearchParams(location.search).get('id') || 'test-parent';
document.getElementById('self').textContent = selfID;
var logEl = document.getElementById('log');
var childFrame = [400, 400, 300, 200];
var childInteractive = false;

function logLine(s){ logEl.textContent += s + '\n'; logEl.scrollTop = logEl.scrollHeight; }

window.headsup = window.headsup || {};
window.headsup.receive = function(b64){
  try { logLine('← ' + JSON.stringify(JSON.parse(atob(b64)))); }
  catch(e){ logLine('parse err: ' + e); }
};
function post(type, payload){
  logLine('→ ' + type + ' ' + JSON.stringify(payload));
  window.webkit.messageHandlers.headsup.postMessage({type:type, payload:payload});
}
function testCreate(){
  post('canvas.create', {id:'child-a', url:'aos://sigil/test-mutation/child.html',
    frame: childFrame.slice(), interactive: childInteractive, request_id:'cr-1'});
}
function testCreateDup(){
  post('canvas.create', {id:'child-a', url:'aos://sigil/test-mutation/child.html',
    frame:[500,500,200,200], request_id:'cr-dup'});
}
function testCreateBadFrame(){
  post('canvas.create', {id:'child-bad', url:'aos://sigil/test-mutation/child.html',
    frame:[1,2,3], request_id:'cr-bad'});
}
function testMove(){
  childFrame[0]+=50; childFrame[1]+=50;
  post('canvas.update', {id:'child-a', frame: childFrame.slice()});
}
function testMoveRapid(){
  var base = childFrame.slice();
  var i = 0;
  var t = setInterval(function(){
    i++;
    post('canvas.update', {id:'child-a', frame:[base[0]+i, base[1]+i, base[2], base[3]]});
    if (i >= 60){ clearInterval(t); childFrame = [base[0]+60, base[1]+60, base[2], base[3]]; }
  }, 16);
}
function testToggleInteractive(){
  childInteractive = !childInteractive;
  post('canvas.update', {id:'child-a', interactive: childInteractive});
}
function testRemove(){
  post('canvas.remove', {id:'child-a', request_id:'rm-1'});
}
function testRemoveOrphan(){
  post('canvas.remove', {id: selfID, orphan_children:true, request_id:'rm-orph'});
}
function testRemoveUnowned(){
  // A sibling canvas created by a *different* parent. Requires two parents running.
  post('canvas.remove', {id:'child-b', request_id:'rm-unowned'});
}
function testRemoveCLI(){
  post('canvas.remove', {id:'cli-canvas', request_id:'rm-cli'});
}
</script>
</body>
</html>
```

The page accepts `?id=<caller-id>` so two instances can know their own id during the permission test.

- [ ] **Step 2: Run the full test sweep**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

Create the harness:

```bash
./aos show create --id harness-a --url 'aos://sigil/test-mutation/index.html?id=harness-a' --at 40,40,520,520 --interactive
```

Walk through each button and verify the log line in the harness matches the expectation:

| Button | Expected response |
|--------|-------------------|
| valid child | `status:"ok", id:"child-a"` |
| duplicate id | `status:"error", code:"DUPLICATE_ID"` |
| bad frame | `status:"error", code:"INVALID_FRAME"` |
| move child +50,+50 | (no response — silent) child visibly moves |
| move 60 times (hot path) | child slides diagonally; no response spam |
| toggle interactive | child toggles click-through |
| remove child | `status:"ok"` |
| remove self orphan-children | self disappears, child-a survives |

- [ ] **Step 3: Permission sweep — two parents**

Restart and create two harnesses:

```bash
./aos show create --id harness-a --url 'aos://sigil/test-mutation/index.html?id=harness-a' --at 40,40,520,520 --interactive
./aos show create --id harness-b --url 'aos://sigil/test-mutation/index.html?id=harness-b' --at 600,40,520,520 --interactive
```

From **harness-a**, click "valid child" (creates `child-a` owned by harness-a). From **harness-b**, click "try to remove sibling" (targets `child-b` — change the button's hardcoded id to `child-a` temporarily, or just directly test via the page's devtools calling `post('canvas.remove', {id:'child-a', request_id:'x'})`).

**Expected:** harness-b log shows `status:"error", code:"FORBIDDEN"`.

Now test the CLI-origin rule. In another terminal:

```bash
./aos show create --id cli-canvas --url aos://sigil/test-mutation/child.html --at 40,600,300,200
```

From harness-b, click "try to remove a CLI canvas". **Expected:** `status:"ok"`; the CLI canvas disappears.

Clean up:

```bash
./aos show remove --id child-a 2>/dev/null
./aos show remove --id harness-a 2>/dev/null
./aos show remove --id harness-b 2>/dev/null
```

- [ ] **Step 4: Commit**

```bash
git add apps/sigil/test-mutation/index.html
git commit -m "test(sigil): full canvas-mutation harness covering every rule"
```

---

### Task 8: Record findings and close out Phase 1

No new code. Summarize what landed, file any follow-ups discovered during testing, and post the handoff to the next session.

**Files:** none (handoff message + optional spec update)

- [ ] **Step 1: Walk through the spec's test plan and confirm every row passes**

Open `docs/superpowers/specs/2026-04-11-canvas-mutation-api.md` → "Test plan" section. For each row, note PASS / FAIL / observation. If any FAIL, debug before continuing.

- [ ] **Step 2: Verify no unintended changes slipped in**

```bash
git log origin/main..HEAD --oneline | head -30
```

Confirm only the Phase 1 commits are new beyond what was there before the session. The PoC's 8 commits should already be in place from the predecessor session.

- [ ] **Step 3: Check the CLI collision behavior flagged in the spec's open questions**

The spec noted: "Does CLI `aos show create --id <existing>` currently clobber or error?" — Answer: errors with `DUPLICATE_ID` (verified at `canvas.swift:339`). CLI and JS behavior are aligned. Close the open question with a one-line edit to the spec:

```bash
# Edit docs/superpowers/specs/2026-04-11-canvas-mutation-api.md
# In the "Open questions (for implementation, not blocking spec)" section,
# replace the first bullet with:
# - CLI `aos show create --id <existing>` already returns DUPLICATE_ID (canvas.swift:339). JS path aligned — same code, same semantics. Resolved.
git add docs/superpowers/specs/2026-04-11-canvas-mutation-api.md
git commit -m "docs(spec): resolve CLI collision behavior open question"
```

- [ ] **Step 4: Post handoff to the next session**

Using the `aos-gateway` MCP (or an equivalent shell invocation), post on channel `handoff`:

```json
{
  "to": "next-session",
  "type": "session_brief",
  "summary": "Phase 1 complete — canvas mutation API from JS ships. Next: Phase 2 display geometry stream OR Phase 3 hit-area canvas.",
  "context": {
    "what_shipped": [
      "canvas.create / canvas.update / canvas.remove postMessage handlers",
      "Ownership tracking (createdBy + children) with self + children + CLI-origin permission rule",
      "Cascade-remove via canvas_lifecycle (handles CLI, JS, crash, TTL paths uniformly)",
      "orphan_children flag for opt-out of cascade",
      "Async response via headsup.receive (reuses PoC plumbing)",
      "Full test harness at apps/sigil/test-mutation/"
    ],
    "branch_policy": "Still on main, do NOT push to origin — full avatar-sub elimination arc lands as one push",
    "remaining_phases": [
      "Phase 2 — Display geometry stream (mirrors PoC cursor stream)",
      "Phase 3 — Hit-area canvas + first state machine slice (follow-cursor)",
      "Phase 4 — Expand-on-mousedown for drag",
      "Phase 5 — Retire avatar-sub binary"
    ],
    "spec": "docs/superpowers/specs/2026-04-11-canvas-mutation-api.md",
    "plan": "docs/superpowers/plans/2026-04-11-canvas-mutation-api.md"
  }
}
```

(Ask the user for the preferred posting mechanism if MCP tools aren't configured in-session.)

- [ ] **Step 5: Invoke `superpowers:finishing-a-development-branch`** to get options for what happens next (stay on main for Phase 2, cut PR, etc.). User's branch-policy preference is no push, so this will most likely just confirm staying local.

---

## After this plan

With Phase 1 shipped, the hit-area canvas in Phase 3 is unblocked. Phase 2 (display geometry stream) is independent — can go in either order. Phase 3 will be the first real exercise of this API under non-toy load: the hit-area canvas gets `canvas.update`d at ~60Hz during cursor follow. If that shows lock contention in the ownership dicts, revisit the "single lock for all per-canvas state" decision; the spec's failure-modes table has the fallback already sketched.
