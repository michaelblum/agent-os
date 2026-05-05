# heads-up Foundation Layers

**Date:** 2026-03-27
**Status:** Proposed
**Scope:** `packages/heads-up/`, display intelligence skill/library, orchestration patterns
**Depends on:** heads-up serve mode (✅), side-eye list (✅)

## Problem

heads-up serve mode works — canvases render, the daemon manages them, CLI commands control them. But three infrastructure gaps prevent real-world use:

1. **Canvases outlive their controllers.** A click-follower dies and the ball stays on screen forever. No TTL, no orphan detection, no connection-scoping.

2. **Multi-display is a manual nightmare.** macOS "Displays have separate Spaces" prevents single windows from spanning displays. The workaround (one canvas per display, viewport slicing, Date.now() sync) works but requires the caller to do all the topology math, HTML generation, and coordination.

3. **No bidirectional communication with canvas content.** The daemon can create/update/remove canvases and load HTML, but can't send messages to running JS inside a WKWebView, and canvas JS can't send events back to the orchestrator. This means no external control of animations, no interactive overlays that report back.

These three gaps are the foundation that everything else builds on — avatar systems, Slippy orb, Syborg chat interface, annotation overlays, agent UI.

## Architecture: The Revised Layer Cake

| Layer | Name | Where it lives | What it does |
|-------|------|---------------|-------------|
| **0** | Display Daemon | `packages/heads-up/` (Swift) | Canvas CRUD, window management, IPC | ✅ |
| **0.5** | Lifecycle | `packages/heads-up/` (Swift) | TTL, connection-scoping, groups, orphan detection |
| **1** | Display Intelligence | Skill / JS library | Topology queries, bounding boxes, viewport slicing, coordinate mapping |
| **2** | Host ↔ Content Bridge | `packages/heads-up/` (Swift) + JS convention | `eval` action, message handler relay, state sync |
| **3** | Animation Runtime | In-WKWebView JS | Three.js, easing, scene graph (Nested Hulls kinematics) |
| **4** | Content Library | In-WKWebView JS + HTML | Avatars (polyhedron, Slippy), rainbow ball, annotations, chat |
| **5** | Builder GUI | Web app | Visual sandbox, JSON config export |

**Layers 0–2 are infrastructure.** Every consumer benefits. This spec covers these.

**Layers 3–5 are content.** They run inside WKWebView and are invisible to heads-up. They're noted here for context but specified separately.

### Future Consumers (Layer 4+)

These will be built or refactored on top of this stack:

- **Slippy** — The orb prototype from `bridgehand` repo. 3D avatar that flies between windows, leaves tracer annotations, responds to agent state. The canonical avatar.
- **Syborg Chat Interface** — The Chrome extension sidebar's chat component, refactored as a portable session renderer. Can run in a heads-up canvas as a floating desktop window.
- **Avatar Library** — Stellated polyhedra, morphing shapes, the celestial prototype decoupled into renderer + builder.
- **Annotation Overlays** — Live badges/highlights on screen (extending the `--label` static approach into persistent, dynamic overlays).
- **Agent Prompts** — Approval dialogs, confirmation modals, status toasts — all rendered as interactive heads-up canvases.

## Layer 0.5: Canvas Lifecycle

### TTL (time-to-live)

Per-canvas optional expiry. The simplest and highest-value lifecycle primitive.

```bash
heads-up create --id toast --at 100,100,300,80 --html "..." --ttl 5s
heads-up create --id alert --at 100,100,300,80 --html "..." --ttl 30m
heads-up create --id orb   --at 100,100,160,160 --html "..."           # no TTL (default: lives forever)
```

Duration formats: `<number>s`, `<number>m`, `<number>h`, or `none` (default).

TTL is **resettable** — an orchestrator can extend the deadline:

```bash
heads-up update --id toast --ttl 10s   # reset the clock to 10s from now
```

This enables keepalive-by-renewal: orchestrator periodically extends TTL. If the orchestrator dies, TTL expires and the canvas is cleaned up automatically.

On TTL expiry, the canvas is removed. Future enhancement: configurable expiry behavior (fade out, fire callback event, etc.).

Protocol:
```json
{"action": "create", "id": "toast", "at": [100,100,300,80], "html": "...", "ttl": 5.0}
{"action": "update", "id": "toast", "ttl": 10.0}
```

Implementation: `DispatchSourceTimer` per canvas with TTL. Timer is reset on each `update --ttl`. Timer fires → canvas is removed → idle check.

### Ping

Health check and keepalive.

```json
{"action": "ping"}
→ {"status": "success", "canvases": 3, "uptime": 45.2}
```

Zero-overhead way for an orchestrator to (a) prove the daemon is alive, (b) keep a long-lived connection active, (c) check canvas count without listing all details.

### Connection-Scoped Canvases

Tie canvas lifetime to the socket connection that created it.

```bash
heads-up create --id cursor --at 100,100,40,40 --html "..." --scope connection
```

When the socket connection closes (cleanly or crash), all canvases created on that connection with `--scope connection` are removed.

This is the right default for orchestrator-owned overlays. The click-follower holds a long-lived socket connection. Process dies → OS closes fd → daemon detects EOF → connection-scoped canvases removed.

**Requires a new client pattern:** instead of connect → send → disconnect (current CLI behavior), the orchestrator opens a persistent connection. The daemon tracks connections and their owned canvases.

Protocol:
```json
{"action": "create", "id": "cursor", "scope": "connection", ...}
```

Implementation: The daemon's connection handler tracks which canvases were created with `scope: "connection"`. On connection close, those canvases are removed. Other canvases (`scope: "global"`, the default) are unaffected.

### Canvas Groups

Group related canvases for batch lifecycle management.

```bash
heads-up create --id ball-left  --group rainbow --at ... --html "..."
heads-up create --id ball-mid   --group rainbow --at ... --html "..."
heads-up create --id ball-right --group rainbow --at ... --html "..."

heads-up remove --group rainbow              # remove all three
heads-up update --group rainbow --ttl 30s    # TTL on entire group
```

Groups inherit lifecycle: if a group has a TTL, all canvases in it expire together. If a group is connection-scoped, all canvases in it are removed when the connection drops.

Protocol:
```json
{"action": "create", "id": "ball-left", "group": "rainbow", ...}
{"action": "remove", "group": "rainbow"}
{"action": "update", "group": "rainbow", "ttl": 30.0}
```

### Configurable Daemon Idle Timeout

```bash
heads-up serve --idle-timeout 5s       # current default
heads-up serve --idle-timeout 10m      # longer for development
heads-up serve --idle-timeout none     # manual shutdown only
```

Current behavior (5s after last canvas removed) is too aggressive for orchestrator patterns where the controller might briefly have zero canvases between operations.

**Revised idle condition:** no canvases AND no active connections. A connected orchestrator keeps the daemon alive even with zero canvases.

### Priority for Layer 0.5

| Feature | Value | Complexity | Build order |
|---------|-------|-----------|-------------|
| TTL | High — prevents orphans | Low — one timer per canvas | **First** |
| Ping | High — health check | Trivial — ~5 lines | **First** |
| Idle timeout flag | Medium — dev convenience | Low — one CLI arg | **First** |
| Connection-scoped | High — orchestrator pattern | Medium — connection tracking | **Second** |
| Groups | Medium — batch management | Medium — group index + dispatch | **Third** |

## Layer 1: Display Intelligence

This layer does NOT live in heads-up. heads-up is a dumb display server — it places canvases where told. Display intelligence lives in a higher layer (a skill, a JS library, or a Python/Swift helper).

### What it does

1. **Query display topology** — call `side-eye list`, parse display geometry
2. **Compute virtual canvas** — bounding box of all displays
3. **Generate per-display viewports** — offset, clip, and size for each display's slice of the virtual canvas
4. **Map coordinates** — CG global ↔ per-display local ↔ virtual canvas
5. **Identify display from point** — which display contains a given CG coordinate
6. **Create multi-display canvas sets** — given content and target displays, create the correct canvases

### Design Principles

- **heads-up stays dumb.** It never queries displays. It places windows where told.
- **side-eye stays a sensor.** It reports topology but doesn't act.
- **Display intelligence is the orchestrator's concern.** Different orchestrators may want different strategies (all displays, specific display, follow focus, etc.).

### Interface (future skill or library)

```bash
# Query topology and output virtual canvas bounding box
display-info bbox
→ {"origin": [-1920, 0], "size": [5352, 1371], "displays": [...]}

# Create a multi-display canvas set
display-info create-spanning --group anim --html-generator "python3 gen.py" --displays all

# Map a CG point to a display
display-info which-display 500,300
→ {"display": "Built-in Retina", "local": [500, 300]}
```

This layer is exploratory. We'll build it as patterns emerge from real use cases. The multi-display ball demo and click-follower are the first two patterns.

## Layer 2: Host ↔ Content Bridge

### eval Action

Run JavaScript in a canvas's WKWebView from the outside.

```json
{"action": "eval", "id": "orb", "js": "setPosition(100, 200)"}
→ {"status": "success", "result": null}

{"action": "eval", "id": "orb", "js": "getState()"}
→ {"status": "success", "result": {"x": 100, "y": 200, "mode": "idle"}}
```

Implementation: `canvas.webView.evaluateJavaScript(js)` on main thread, return the result (serialized to JSON) in the response.

This is the primary mechanism for external control of canvas content. The orchestrator sends state updates, triggers animations, queries content state — all without reloading the HTML.

Protocol addition to `CanvasRequest`:
```swift
var js: String?    // JavaScript to evaluate (for "eval" action)
```

Protocol addition to `CanvasResponse`:
```swift
var result: String?  // JSON-serialized return value from eval
```

### Message Handler Relay (Canvas → Orchestrator)

Canvas JavaScript sends events back to the orchestrator via WKWebView's native messaging:

```javascript
// In canvas HTML/JS:
window.webkit.messageHandlers.headsup.postMessage({
    event: "user_click",
    annotation: 3,
    position: { x: 150, y: 200 }
});
```

The daemon receives the message via `WKScriptMessageHandler` and relays it through any connected socket:

```json
{"type": "event", "id": "orb", "payload": {"event": "user_click", "annotation": 3, "position": {"x": 150, "y": 200}}}
```

Implementation:
1. Register `WKUserContentController` message handler named `"headsup"` on each canvas's WKWebView
2. When a message arrives, wrap it as `{"type": "event", "id": "<canvas-id>", "payload": <message>}`
3. Send to all connected clients (or to the connection that created the canvas, if connection-scoped)

This enables interactive overlays: the orchestrator creates a canvas with buttons/controls, the user interacts with them, events flow back to the orchestrator.

### State Synchronization Pattern

The combination of `eval` (host → content) and `messageHandler` (content → host) creates a full-duplex communication channel:

```
Orchestrator → {"action": "eval", "id": "chat", "js": "addMessage('Hello!')"} → Daemon → WKWebView
WKWebView → window.webkit.messageHandlers.headsup.postMessage({input: "Hi"}) → Daemon → {"type": "event", ...} → Orchestrator
```

**Convention for canvas content:**

Canvas HTML should expose a predictable API:
```javascript
// Receive state from orchestrator (called via eval)
function setState(state) { /* update rendering */ }
function handleCommand(cmd, args) { /* handle commands */ }

// Send events to orchestrator (called by user interaction)
function emitEvent(name, payload) {
    window.webkit.messageHandlers.headsup.postMessage({ event: name, ...payload });
}
```

This convention is not enforced by heads-up (it's content-agnostic), but it's the recommended pattern for Layer 3+ content.

### Priority for Layer 2

| Feature | Value | Complexity | Build order |
|---------|-------|-----------|-------------|
| eval action | Critical — external content control | Low — ~15 lines | **First** |
| Message handler relay | High — interactive overlays | Medium — WKScriptMessageHandler + socket relay | **Second** |

## Implementation Order

1. **Layer 0.5a: TTL + Ping + idle timeout flag** — prevent orphans, enable health checks
2. **Layer 2a: eval action** — unlock external control of canvas content
3. **Layer 0.5b: Connection-scoped canvases** — robust orchestrator lifecycle
4. **Layer 2b: Message handler relay** — interactive overlays
5. **Layer 0.5c: Groups** — batch canvas management
6. **Layer 1: Display intelligence** — grows organically from orchestration patterns

## What This Does NOT Cover

| Gap | Why | When |
|-----|-----|------|
| Animation runtime (Three.js, kinematics) | In-WKWebView JS, not infrastructure | When Slippy/avatar work begins |
| Avatar library | Content, not infrastructure | After foundation layers are solid |
| Builder GUI | Tool, not infrastructure | After avatar renderer is decoupled |
| Syborg chat refactor | Consumer of this stack | After bridge layer proves out |
| Config file (`~/.config/heads-up/config.json`) | Fleet management, not needed yet | When defaults need tuning |
| WebSocket listener for Chrome extension | Step 5 from original spec | After Unix socket patterns are proven |
| Window level as canvas option | Nice-to-have | When consumers need both .floating and .statusBar |
