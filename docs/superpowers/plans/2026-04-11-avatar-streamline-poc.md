# Avatar-Streamline PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the daemon can push cursor events to a full-display canvas smoothly enough to drive JS-based cursor rendering, as the critical viability check before replacing `avatar-sub`.

**Architecture:** Extend the daemon (`src/daemon/unified.swift`) with a per-canvas event-subscription table. When a canvas posts `{type: 'subscribe', payload: {events: ['input_event']}}` the daemon records it; thereafter, every input event broadcast is also evaluated as `headsup.receive(<base64 JSON>)` on the canvas's WKWebView. A new test page (`apps/sigil/test-cursor/index.html`) subscribes, receives events, and draws a dot at the cursor position via `requestAnimationFrame`. No Three.js, no state machine — just the plumbing.

**Tech Stack:** Swift (daemon, AppKit, WebKit), vanilla HTML/CSS/JS, `aos show create` / `aos show remove`, existing `headsup.receive` / `webView.evaluateJavaScript` paths.

**Spec:** `docs/superpowers/specs/2026-04-11-avatar-streamline-poc.md`

---

## Pre-flight

Before starting, confirm the dev runtime state. Run these from the repo root (`/Users/Michael/Code/agent-os`):

```bash
# Confirm content root is registered
./aos set content.roots.sigil apps/sigil

# If a daemon is already running, stop it so later tasks can start a fresh build cleanly
pkill -f "aos serve" 2>/dev/null || true
```

The daemon will be rebuilt and restarted multiple times across these tasks. A typical rebuild cycle is:

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
bash build.sh
./aos serve > /tmp/aos.log 2>&1 &
sleep 1   # let daemon come up
```

Each task that needs a restarted daemon will reference this cycle.

### Positioning the test canvas

`aos show create` requires an `--at x,y,w,h` rectangle. For the PoC we want the canvas to cover the primary display so screen pixels map 1:1 to canvas pixels (the architectural invariant the spec relies on).

Use this helper snippet wherever a task creates the `test-cursor` canvas — it queries the primary display and assembles the rect:

```bash
AT=$(./aos graph displays --json | python3 -c "import sys,json; d=json.load(sys.stdin); m=next(x for x in d['displays'] if x['is_main']); b=m['bounds']; print(f\"{b['x']},{b['y']},{b['w']},{b['h']}\")")
./aos show create --id test-cursor --url aos://sigil/test-cursor/index.html --at "$AT"
```

A tiny arbitrary rect works for the baseline delivery check in Task 1 because cursor coordinates aren't involved there. From Task 5 onward, use the full-display `$AT` snippet above.

---

### Task 1: Baseline — create a stub test page and verify delivery

The first task proves the content server + canvas creation path works for a brand-new page. If this fails, fix it before touching Swift.

**Files:**
- Create: `apps/sigil/test-cursor/index.html`

- [ ] **Step 1: Create the stub page**

```bash
mkdir -p apps/sigil/test-cursor
```

Write `apps/sigil/test-cursor/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
#hello {
  position: absolute;
  top: 40%;
  left: 40%;
  color: white;
  font: 48px system-ui, sans-serif;
  text-shadow: 0 2px 12px rgba(0,0,0,0.8);
}
</style>
</head>
<body>
<div id="hello">hello, canvas</div>
<script>
// Phase 1 stub — only confirms the page loads in the canvas. Later tasks
// replace this with subscribe logic and a cursor dot.
console.log('[test-cursor] loaded');
</script>
</body>
</html>
```

- [ ] **Step 2: Start or restart the daemon**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

(No rebuild needed — we didn't change Swift yet.)

- [ ] **Step 3: Create the canvas**

```bash
./aos show create --id test-cursor --url aos://sigil/test-cursor/index.html --at 0,0,800,600
```

Expected: a transparent overlay appears on the primary display showing "hello, canvas" near the upper-left. Clicks should pass through to whatever is underneath.

(Full-display sizing is not needed here — this task only proves content delivery. Tasks 5+ use the `$AT` full-display snippet from Pre-flight.)

- [ ] **Step 4: Clean up the canvas**

```bash
./aos show remove --id test-cursor
```

If the overlay didn't appear, stop here and diagnose (check `/tmp/aos.log`, confirm `./aos content status --json` shows the sigil root, confirm `curl http://127.0.0.1:PORT/sigil/test-cursor/index.html` returns the HTML). Do not proceed to Task 2 until the baseline works.

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/test-cursor/index.html
git commit -m "feat(sigil): add test-cursor baseline page for PoC"
```

---

### Task 2: Add `evalAsync` helper on `CanvasManager`

The existing eval path runs through the external-request router and blocks on a semaphore — too expensive for 60Hz per-canvas fan-out. Add a fire-and-forget helper on the canvas manager for the forwarding path.

**Files:**
- Modify: `src/display/canvas.swift`

- [ ] **Step 1: Locate the CanvasManager class**

```bash
grep -n "class CanvasManager" src/display/canvas.swift
```

Note the class location. The helper goes inside this class.

- [ ] **Step 2: Add the helper method**

Add this method to the `CanvasManager` class (near the other eval-related code, typically after `handleEval`):

```swift
/// Fire-and-forget JavaScript evaluation on a canvas. Non-blocking.
/// Used by the broadcast paths that fan out input events to subscribed canvases at
/// high frequency. Unlike `handleEval`, this does not wait for a result or return
/// a value — callers should not rely on ordering or completion.
func evalAsync(canvasID: String, js: String) {
    DispatchQueue.main.async { [weak self] in
        guard let self = self,
              let canvas = self.canvases[canvasID] else { return }
        canvas.webView.evaluateJavaScript(js, completionHandler: nil)
    }
}
```

Notes:
- The `canvases` property on `CanvasManager` is a `[String: Canvas]` (or equivalent). If its name differs, use the actual property name — grep for `canvases[` in canvas.swift to confirm.
- `weak self` prevents retain cycles in the async block.

- [ ] **Step 3: Verify it compiles**

```bash
bash build.sh
```

Expected: build completes with no errors. The helper isn't called yet, but the Swift compiler catches signature issues immediately.

- [ ] **Step 4: Commit**

```bash
git add src/display/canvas.swift
git commit -m "feat(daemon): add CanvasManager.evalAsync for fire-and-forget JS eval"
```

---

### Task 3: Add canvas subscription table to `UnifiedDaemon`

Add the data structure that tracks which canvases want which events. No behavior yet — just the state.

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Add the properties**

Grep for an existing lock in the file to find the locking conventions:

```bash
grep -n "NSLock\|subscriberLock" src/daemon/unified.swift
```

Near the existing `subscribers` map (search for `var subscribers:`), add:

```swift
// Canvas-side event subscriptions: canvas ID → set of event-type names it wants.
// Populated when a canvas posts {type: 'subscribe', payload: {events: [...]}}.
var canvasEventSubscriptions: [String: Set<String>] = [:]
let canvasSubscriptionLock = NSLock()
```

- [ ] **Step 2: Verify it compiles**

```bash
bash build.sh
```

Expected: clean build. The properties are unused so far; Swift will not warn in a class context.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): add canvasEventSubscriptions state for PoC"
```

---

### Task 4: Intercept `subscribe` / `unsubscribe` messages from canvases

Modify `canvasManager.onEvent` so that `{type: "subscribe"}` and `{type: "unsubscribe"}` messages update the subscription table instead of being broadcast as `canvas_message`.

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Locate the existing handler**

```bash
grep -n "canvasManager.onEvent" src/daemon/unified.swift
```

You should find:

```swift
canvasManager.onEvent = { [weak self] canvasID, payload in
    guard let self = self else { return }
    let data: [String: Any] = ["id": canvasID, "payload": payload]
    self.broadcastEvent(service: "display", event: "canvas_message", data: data)
}
```

- [ ] **Step 2: Replace it with an intercepting version**

```swift
canvasManager.onEvent = { [weak self] canvasID, payload in
    guard let self = self else { return }

    // Intercept subscribe/unsubscribe before relay — these configure daemon
    // state, not events for other subscribers to observe.
    if let dict = payload as? [String: Any],
       let type = dict["type"] as? String,
       type == "subscribe" || type == "unsubscribe" {
        let inner = dict["payload"] as? [String: Any]
        let events = (inner?["events"] as? [String]) ?? []
        self.handleCanvasSubscription(canvasID: canvasID, type: type, events: events)
        return
    }

    let data: [String: Any] = ["id": canvasID, "payload": payload]
    self.broadcastEvent(service: "display", event: "canvas_message", data: data)
}
```

- [ ] **Step 3: Add the handler method**

Add as a method on the same class (search for other `private func` definitions and place near the broadcasting methods):

```swift
private func handleCanvasSubscription(canvasID: String, type: String, events: [String]) {
    guard !events.isEmpty else { return }
    canvasSubscriptionLock.lock()
    if type == "subscribe" {
        var current = canvasEventSubscriptions[canvasID] ?? []
        for ev in events { current.insert(ev) }
        canvasEventSubscriptions[canvasID] = current
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
}
```

The `fputs` goes to the daemon log (`/tmp/aos.log` per the pre-flight convention). This is the verification signal for Task 5.

- [ ] **Step 4: Verify it compiles**

```bash
bash build.sh
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): intercept canvas subscribe/unsubscribe messages"
```

---

### Task 5: Update test page to subscribe and log receipts

Teach the test page to ask the daemon for `input_event` and log anything it receives. This proves the subscription path works end-to-end, independent of whether forwarding has been wired up yet.

**Files:**
- Modify: `apps/sigil/test-cursor/index.html`

- [ ] **Step 1: Replace the page with the subscribing version**

Rewrite `apps/sigil/test-cursor/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
#status {
  position: absolute;
  top: 20px;
  left: 20px;
  padding: 8px 12px;
  background: rgba(0,0,0,0.6);
  color: #8ef;
  font: 13px/1.4 ui-monospace, monospace;
  border-radius: 4px;
  pointer-events: none;
}
</style>
</head>
<body>
<div id="status">test-cursor: subscribing...</div>
<script>
var statusEl = document.getElementById('status');
var eventCount = 0;
var lastRateCalc = performance.now();
var eventsAtLastRate = 0;
var currentRate = 0;

function setStatus(text) {
  statusEl.textContent = text;
}

function postToHost(type, payload) {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
    window.webkit.messageHandlers.headsup.postMessage(
      payload !== undefined ? { type: type, payload: payload } : { type: type }
    );
  }
}

window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
  try {
    var msg = JSON.parse(atob(b64));
    eventCount++;
    // Later: branch on msg.type and extract x/y. For now just prove receipt.
    console.log('[test-cursor] received', msg);
  } catch (e) {
    console.error('[test-cursor] parse error', e);
  }
};

// Event-rate sampler — updates the status line once per second.
setInterval(function() {
  var now = performance.now();
  var dt = (now - lastRateCalc) / 1000;
  currentRate = Math.round((eventCount - eventsAtLastRate) / dt);
  eventsAtLastRate = eventCount;
  lastRateCalc = now;
  setStatus('test-cursor: events=' + eventCount + ' rate=' + currentRate + '/s');
}, 1000);

// Subscribe on load.
postToHost('subscribe', { events: ['input_event'] });
setStatus('test-cursor: subscribed, waiting for events...');
console.log('[test-cursor] subscribed to input_event');
</script>
</body>
</html>
```

- [ ] **Step 2: Restart the daemon (it must be the rebuilt one with Task 4 changes)**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

- [ ] **Step 3: Create the canvas and verify the subscription was registered**

```bash
AT=$(./aos graph displays --json | python3 -c "import sys,json; d=json.load(sys.stdin); m=next(x for x in d['displays'] if x['is_main']); b=m['bounds']; print(f\"{b['x']},{b['y']},{b['w']},{b['h']}\")")
./aos show create --id test-cursor --url aos://sigil/test-cursor/index.html --at "$AT"
sleep 1
grep '\[canvas-sub\]' /tmp/aos.log
```

Expected: one line like
```
[canvas-sub] subscribe canvas=test-cursor events=["input_event"] current=["input_event"]
```

- [ ] **Step 4: Verify no events arrive yet**

The status banner should read `events=0 rate=0/s` even as you move the mouse. Events don't flow until Task 6. If events are arriving now, something unintended is forwarding — stop and investigate.

- [ ] **Step 5: Clean up**

```bash
./aos show remove --id test-cursor
```

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/test-cursor/index.html
git commit -m "feat(sigil): test-cursor subscribes to input_event and logs receipts"
```

---

### Task 6: Forward input events to subscribed canvases

The forwarding itself — after Unix-socket fan-out in `broadcastInputEvent`, iterate the subscription table and call `evalAsync` for each canvas that wants `input_event`.

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Locate `broadcastInputEvent`**

```bash
grep -n "func broadcastInputEvent" src/daemon/unified.swift
```

You should find the current implementation around line 488 (exact line will drift):

```swift
private func broadcastInputEvent(service: String, event: String, data: [String: Any]) {
    guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }

    subscriberLock.lock()
    let fds = subscribers.values.filter { $0.isSubscribed && $0.wantsInputEvents }.map(\.fd)
    subscriberLock.unlock()

    guard !fds.isEmpty else { return }
    // ... eventWriteQueue.async write loop ...
}
```

- [ ] **Step 2: Add the forwarding block**

Modify the function — after the Unix-socket fan-out block (not before, not instead of — both paths fire), add:

```swift
private func broadcastInputEvent(service: String, event: String, data: [String: Any]) {
    guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }

    subscriberLock.lock()
    let fds = subscribers.values.filter { $0.isSubscribed && $0.wantsInputEvents }.map(\.fd)
    subscriberLock.unlock()

    if !fds.isEmpty {
        let byteArray = [UInt8](bytes)
        eventWriteQueue.async {
            for fd in fds {
                byteArray.withUnsafeBufferPointer { ptr in
                    _ = write(fd, ptr.baseAddress!, ptr.count)
                }
            }
        }
    }

    // Forward to subscribed canvases via JS eval. Non-blocking; no response required.
    forwardInputEventToCanvases(data: data)
}
```

(Adjust to keep the existing structure — the key addition is the new `forwardInputEventToCanvases(data:)` call at the end.)

- [ ] **Step 3: Add the forwarding method**

Near `handleCanvasSubscription` (added in Task 4), add:

```swift
private func forwardInputEventToCanvases(data: [String: Any]) {
    canvasSubscriptionLock.lock()
    let targets = canvasEventSubscriptions
        .filter { $0.value.contains("input_event") }
        .map { $0.key }
    canvasSubscriptionLock.unlock()

    guard !targets.isEmpty else { return }

    // Serialize once, base64 once, reuse across canvases.
    guard let json = try? JSONSerialization.data(withJSONObject: data, options: []) else { return }
    let b64 = json.base64EncodedString()
    let js = "window.headsup && window.headsup.receive && window.headsup.receive('\(b64)')"

    for canvasID in targets {
        canvasManager.evalAsync(canvasID: canvasID, js: js)
    }
}
```

- [ ] **Step 4: Build and restart daemon**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
bash build.sh
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

- [ ] **Step 5: Create the canvas and verify events arrive**

```bash
AT=$(./aos graph displays --json | python3 -c "import sys,json; d=json.load(sys.stdin); m=next(x for x in d['displays'] if x['is_main']); b=m['bounds']; print(f\"{b['x']},{b['y']},{b['w']},{b['h']}\")")
./aos show create --id test-cursor --url aos://sigil/test-cursor/index.html --at "$AT"
```

Move the mouse. The status banner should now show `events=N rate=R/s` with `R` climbing to tens per second while the mouse is moving.

**Verification checklist:**
- `events` counter climbs when moving the mouse
- `rate` during sustained movement is ≥30/s (ideally 60+/s)
- `rate` drops to 0 when the mouse is still (no spurious events)
- `/tmp/aos.log` shows no errors

If the counter stays at 0, diagnose in this order:
1. Does `/tmp/aos.log` show `[canvas-sub] subscribe`? → if no, Task 4 subscription intercept is broken.
2. Is `canvasEventSubscriptions` populated when `forwardInputEventToCanvases` runs? (Add a temporary `fputs` at the top of that method to confirm.)
3. Is `evalAsync` finding the canvas? (Add a temporary log inside the guard.)
4. Does the page's `headsup.receive` ever fire? (Attach Safari Web Inspector to the WKWebView or add a DOM-visible log.)

- [ ] **Step 6: Clean up**

```bash
./aos show remove --id test-cursor
```

- [ ] **Step 7: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): forward input_event to subscribed canvases via evalAsync"
```

---

### Task 7: Draw the cursor dot

Replace the status-only page with one that actually tracks the cursor and renders a dot. This is the visible PoC result.

**Files:**
- Modify: `apps/sigil/test-cursor/index.html`

- [ ] **Step 1: Rewrite the page with drawing**

Replace `apps/sigil/test-cursor/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
#view { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; }
#status {
  position: absolute;
  top: 20px;
  left: 20px;
  padding: 8px 12px;
  background: rgba(0,0,0,0.6);
  color: #8ef;
  font: 13px/1.4 ui-monospace, monospace;
  border-radius: 4px;
  pointer-events: none;
}
</style>
</head>
<body>
<canvas id="view"></canvas>
<div id="status">test-cursor: subscribing...</div>
<script>
var canvas = document.getElementById('view');
var ctx = canvas.getContext('2d');
var statusEl = document.getElementById('status');

function resize() {
  var dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.floor(window.innerWidth  * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width  = window.innerWidth  + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// Cursor state updated by daemon-pushed events.
var cursor = { x: -100, y: -100, valid: false };

// Rolling metrics for the status banner.
var eventCount = 0;
var eventsAtLastRate = 0;
var lastRateCalc = performance.now();
var currentRate = 0;

function postToHost(type, payload) {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
    window.webkit.messageHandlers.headsup.postMessage(
      payload !== undefined ? { type: type, payload: payload } : { type: type }
    );
  }
}

window.headsup = window.headsup || {};
window.headsup.receive = function(b64) {
  try {
    var msg = JSON.parse(atob(b64));
    eventCount++;
    // Mouse events carry {type: 'mouse_moved' | 'left_mouse_dragged' | ..., x, y}.
    // Key events carry {type: 'key_down', keyCode}. We only care about x/y.
    if (typeof msg.x === 'number' && typeof msg.y === 'number') {
      cursor.x = msg.x;
      cursor.y = msg.y;
      cursor.valid = true;
    }
  } catch (e) {
    console.error('[test-cursor] parse error', e);
  }
};

// Event-rate sampler.
setInterval(function() {
  var now = performance.now();
  var dt = (now - lastRateCalc) / 1000;
  currentRate = Math.round((eventCount - eventsAtLastRate) / dt);
  eventsAtLastRate = eventCount;
  lastRateCalc = now;
  statusEl.textContent = 'test-cursor: events=' + eventCount + ' rate=' + currentRate + '/s' +
                         ' cursor=' + (cursor.valid ? Math.round(cursor.x) + ',' + Math.round(cursor.y) : '—');
}, 500);

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (cursor.valid) {
    // Outer ring
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 18, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(140, 220, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Inner filled dot
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(140, 220, 255, 0.95)';
    ctx.fill();
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

postToHost('subscribe', { events: ['input_event'] });
console.log('[test-cursor] subscribed');
</script>
</body>
</html>
```

- [ ] **Step 2: Restart the daemon (no Swift changes, but convenient to start fresh)**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

- [ ] **Step 3: Run the PoC and observe**

```bash
AT=$(./aos graph displays --json | python3 -c "import sys,json; d=json.load(sys.stdin); m=next(x for x in d['displays'] if x['is_main']); b=m['bounds']; print(f\"{b['x']},{b['y']},{b['w']},{b['h']}\")")
./aos show create --id test-cursor --url aos://sigil/test-cursor/index.html --at "$AT"
```

Move the mouse. Expected behavior:
- A small cyan ring with a filled center dot tracks the cursor
- Status banner shows rising `events` count, `rate` in the 30–120/s range during motion, and the current cursor coordinates
- Clicks pass through to whatever is underneath the overlay

**Subjective check — the primary success criterion:** does the dot visually sit on the cursor, or is there perceptible lag? If it feels glued to the cursor, the architecture is proven. If it drifts visibly behind during fast movement, capture a screen recording and investigate before moving on.

- [ ] **Step 4: Leave it running for the verification task, then clean up**

```bash
# When done observing:
./aos show remove --id test-cursor
```

- [ ] **Step 5: Commit**

```bash
git add apps/sigil/test-cursor/index.html
git commit -m "feat(sigil): test-cursor draws cursor dot via daemon-pushed events"
```

---

### Task 8: Clean up subscriptions on canvas close

Subscriptions should not leak when a canvas is removed. The daemon already broadcasts a `canvas_lifecycle` event with `action: "removed"` when `aos show remove` runs; use that to drop the subscription row.

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Locate the canvas lifecycle handler**

```bash
grep -n "onCanvasLifecycle" src/daemon/unified.swift
```

You should find:

```swift
canvasManager.onCanvasLifecycle = { [weak self] canvasID, action, at in
    guard let self = self else { return }
    self.updateSigilCanvasState(canvasID: canvasID, action: action, at: at)
    var data: [String: Any] = ["canvas_id": canvasID, "action": action]
    if let at = at { data["at"] = at }
    self.broadcastEvent(service: "display", event: "canvas_lifecycle", data: data)
}
```

- [ ] **Step 2: Add the subscription cleanup**

Modify the closure:

```swift
canvasManager.onCanvasLifecycle = { [weak self] canvasID, action, at in
    guard let self = self else { return }
    self.updateSigilCanvasState(canvasID: canvasID, action: action, at: at)

    // Drop event subscriptions when the canvas is gone.
    if action == "removed" {
        self.canvasSubscriptionLock.lock()
        let had = self.canvasEventSubscriptions.removeValue(forKey: canvasID) != nil
        self.canvasSubscriptionLock.unlock()
        if had {
            fputs("[canvas-sub] cleared subscriptions for removed canvas=\(canvasID)\n", stderr)
        }
    }

    var data: [String: Any] = ["canvas_id": canvasID, "action": action]
    if let at = at { data["at"] = at }
    self.broadcastEvent(service: "display", event: "canvas_lifecycle", data: data)
}
```

(The literal `"removed"` matches the strings passed by `canvasManager` to `onCanvasLifecycle` — confirmed at `src/display/canvas.swift:298`, `:310`, `:738`, `:750`.)

- [ ] **Step 3: Build and restart**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
bash build.sh
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
```

- [ ] **Step 4: Verify cleanup**

```bash
AT=$(./aos graph displays --json | python3 -c "import sys,json; d=json.load(sys.stdin); m=next(x for x in d['displays'] if x['is_main']); b=m['bounds']; print(f\"{b['x']},{b['y']},{b['w']},{b['h']}\")")
./aos show create --id test-cursor --url aos://sigil/test-cursor/index.html --at "$AT"
sleep 1
./aos show remove --id test-cursor
sleep 1
grep '\[canvas-sub\]' /tmp/aos.log
```

Expected: one `subscribe` line followed by one `cleared subscriptions` line for `canvas=test-cursor`.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): drop canvas event subscriptions on canvas removal"
```

---

### Task 9: Run the success-criteria sweep

Final verification pass against the spec's success criteria. No new code — just evidence gathering and a decision.

**Files:** none (verification only)

- [ ] **Step 1: Start fresh and create the canvas**

```bash
pkill -f "aos serve" 2>/dev/null; sleep 1
./aos serve > /tmp/aos.log 2>&1 &
sleep 1
AT=$(./aos graph displays --json | python3 -c "import sys,json; d=json.load(sys.stdin); m=next(x for x in d['displays'] if x['is_main']); b=m['bounds']; print(f\"{b['x']},{b['y']},{b['w']},{b['h']}\")")
./aos show create --id test-cursor --url aos://sigil/test-cursor/index.html --at "$AT"
```

- [ ] **Step 2: Smoothness check (primary criterion)**

Move the cursor through slow circles, fast swipes, and diagonal traversals. Observe the dot. Record subjectively whether it feels glued to the cursor or drifts behind.

**Pass:** Dot sits on the cursor; no visible lag.
**Fail:** Dot visibly trails the cursor during fast movement.

- [ ] **Step 3: Event-rate check**

Watch the `rate=N/s` reading in the status banner during sustained movement (draw continuous circles for ~3 seconds).

**Pass:** ≥30 during movement. Record the typical peak (should be in the 60–120 range on a standard mouse).

- [ ] **Step 4: CPU impact check**

In another terminal:

```bash
# Find the daemon PID:
ps aux | grep -m1 "aos serve" | awk '{print $2}'
```

Then watch with:

```bash
top -pid <daemon_pid> -stats pid,cpu,mem -l 5
```

Swirl the cursor for ~5 seconds while `top` samples. Note CPU%.

**Pass:** Daemon CPU stays under a few % during sustained movement.

Also sample the WebContent process (the WKWebView). `ps aux | grep WebContent` can reveal the PID; check the same way.

- [ ] **Step 5: Multi-display check (if you have more than one display)**

Drag the cursor onto a second display. Note whether the dot continues to track there.

**Expected partial behavior:** The canvas is created on one display. On a second display, the cursor position reported by the daemon is still accurate (global coordinates), but the canvas may not render there. This is expected — full multi-display coverage is a follow-on primitive, not a PoC requirement. Record whether tracking is continuous within a display and what happens at the boundary.

- [ ] **Step 6: Clean up**

```bash
./aos show remove --id test-cursor
```

- [ ] **Step 7: Record findings and make the go/no-go call**

Summarize results in the spec or as a comment on issue #20 / the brief reply. Use this template:

```
PoC results (2026-MM-DD):
- Smoothness: PASS/FAIL — [observation]
- Event rate: ~N/s sustained
- CPU (daemon): ~N% during motion, idle ~N%
- CPU (WebContent): ~N% during motion, idle ~N%
- Multi-display: [observation]
- Decision: proceed with full plan / redesign with [alternative]
```

Reply on the `handoff` channel so the parent session (`avatar-config`) and any next session sees the outcome.

- [ ] **Step 8: Commit any verification notes**

If you captured results in a file, commit it:

```bash
git add docs/superpowers/specs/2026-04-11-avatar-streamline-poc.md  # if updated with results
git commit -m "docs(specs): record PoC verification results"
```

Otherwise no commit is needed — the code changes already landed in earlier tasks.

---

## After this plan

If smoothness passes and rates are healthy, the next plan covers:

- Canvas mutation API from JS (`canvas.create`, `canvas.update`, `canvas.remove`)
- Display-geometry stream (second event type through the same forwarding mechanism)
- Hit-area canvas tracking the avatar + expand-on-mousedown for drag
- First JS state-machine slice (follow-cursor behavior)

Each is a separate brainstorm → spec → plan cycle. This plan's sole deliverable is the viability answer.

If smoothness fails, the scratchpad (`memory/scratchpad/avatar-sub-elimination.md`) and the spec's failure-modes table guide the redesign.
