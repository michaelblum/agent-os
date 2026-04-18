# Canvas Inspector — Object Marks Design Spec

**Date:** 2026-04-18
**Scope:** Let consumer canvases publish ephemeral, visual "object marks" that canvas-inspector renders on its minimap and list — so a rendered object inside a canvas (e.g. Sigil's avatar) can be cross-referenced visually from the inspector.
**Status:** Draft — not yet implemented.

## Problem

`canvas-inspector` renders the set of canvases the daemon knows about: minimap (spatial layout) plus a list (ids, dims, flags). This is useful for canvas-level debugging, but consumers (like Sigil) render interesting sub-objects *inside* a canvas that the inspector cannot see — the avatar, particle systems, future multi-actor scenes. There is currently no way to ask "where on the minimap is Sigil's avatar actually positioned right now?" or "what do that canvas's sub-objects look like?"

We want a small, elegant extension that:

- Lets any consumer mark one or more objects inside its own canvas.
- Renders each mark on the inspector's minimap at the object's real desktop position.
- Lists each object indented under its parent canvas entry.
- Supports three visual modes in order of cost: built-in default shape, consumer-provided shape/icon, and a `capture` mode backed by `aos see`.
- Does not require schema changes in existing consumers that don't care about this feature.

## Design

### Wire contract

Consumer canvases push full-list snapshots for the objects they own. Inspector subscribes via the existing canvas subscription mechanism. Push-only; no pull, no daemon registry.

**Event type:** `canvas_object.marks`

**Payload (consumer → daemon):**

```jsonc
{
  "type": "canvas_object.marks",
  "payload": {
    "canvas_id": "avatar-main",          // parent canvas that owns these objects
    "objects": [ /* full current list, replaces prior list for this canvas */ ]
  }
}
```

**Object schema:**

```jsonc
{
  "id":     "avatar",                    // optional; default: "obj-<N>" auto-assigned by inspector
  "x":      942,                         // required, desktop CG points (same space as canvas.at)
  "y":      540,                         // required, desktop CG points
  "size":   20,                          // optional, minimap pixels, default 20
  "color":  "#ff66cc",                   // optional, any CSS color; default: stable random per id
  "name":   "avatar",                    // optional, list label; default: id
  "shape":  "<svg>...</svg>" | "circle", // optional, inline SVG markup or primitive name
  "icon":   "data:image/jpeg;base64,..." // optional, image URL (see Icon Modes below)
                                         // OR literal string "capture" — see Tier 3
  "icon_region": { "x": 900, "y": 500, "w": 80, "h": 80 }, // required when icon == "capture"
  "icon_hz":    1                        // optional capture cadence (Hz), default 1, max 10
}
```

Stateless on inspector: every emit replaces the prior list for that `canvas_id`. To clear marks, emit `objects: []`. To partially update, emit the full desired list.

### Lifecycle + TTL

- **Idle TTL:** 10 seconds after last emit for a given `canvas_id` → inspector drops all marks for that canvas. Handles consumer crash / dev-inspector-only paths.
- **Parent removal:** inspector drops marks when it observes a matching `canvas_lifecycle` `action: "removed"` for that canvas. Immediate, no TTL wait.
- **Re-emit resets TTL.** Consumers SHOULD emit at ~1 Hz minimum to keep marks alive; 10 Hz is recommended for moving objects (Sigil avatar).

### Visual rendering

**Minimap:**

1. After drawing canvases, for each live mark: project `(x, y)` through the existing `projectPointToMinimap(layout, point)` helper.
2. Draw a `size × size` box centered on the projected point (`size` is minimap pixels — not scaled with the minimap zoom).
3. Resolve the visual in precedence order: `icon` > `shape` > default.

**Default shape** (used when neither `icon` nor `shape` is provided):
- 2px outline of circle inscribed in a square, with an x-crosshair from corner to corner.
- Stroked in `color` (defaults to a stable random color derived from `id`).
- Baked into canvas-inspector as a template SVG string.

**`shape`** — either:
- A primitive name from a small built-in set (`"circle"`, `"square"`, `"diamond"`, `"triangle"`) — inspector renders via inline SVG using `color` + `size`.
- Raw inline SVG markup. Inspector injects into a `size×size` `<svg>` viewport, lightly sanitized (no `<script>`, no external refs).

**`icon`** — URL string. Inspector renders `<img src=icon width=size height=size object-fit="contain">`. See Icon Modes below.

**List entry:**

```
▾ avatar-main   1920×2062 @ -191,0   [union]
    ● avatar              942, 540    [thumbnail]
    ● particle-swarm       —          [default shape]
```

- Indent 16px under the parent canvas row.
- Smaller font than parent.
- Left-most visual: color swatch (default shape) or a 12×12 copy of the mark's resolved visual.
- Middle: `name`, then coords if present.
- No action buttons in v1 (view-only).

### Icon Modes

Consumer picks exactly one of three cost tiers. Inspector chooses rendering based on the `icon` field.

#### Tier 1 — Consumer self-produced data URL (cheapest)

For web-canvas consumers, re-use pixels you already rendered. 10-line pattern:

```js
// in consumer's render loop, throttled to ~1 Hz:
const thumb = document.createElement('canvas');
thumb.width = 20; thumb.height = 20;
thumb.getContext('2d').drawImage(
  state.renderer.domElement,   // already-rendered GPU canvas
  sx, sy, sw, sh,              // source region in canvas pixels
  0, 0, 20, 20                 // dest 20x20
);
this.thumbUrl = thumb.toDataURL('image/jpeg', 0.3);
// emit with icon=this.thumbUrl (same string between re-bakes → inspector caches)
```

**Cost:** ~1-2ms, no IPC, no daemon round trip. Tier 1 is the recommended path for any web consumer.

#### Tier 2 — Pre-baked asset URL

Consumer points at a stable asset:
- `aos://<root>/<path>.png` — consumer hosts via existing content server.
- `http://127.0.0.1:<port>/...` — any other source.
- `data:image/png;base64,...` — inline but baked once.

Inspector uses `<img src=icon>`. WKWebView caches by URL; no extra work.

#### Tier 3 — `icon: "capture"` (inspector-side `aos see`)

For consumers that don't render pixels themselves, or when the interesting visual is a specific desktop region not owned by the consumer:

```jsonc
{ "id": "win-123", "x": ..., "y": ...,
  "icon": "capture",
  "icon_region": { "x": 900, "y": 500, "w": 80, "h": 80 },
  "icon_hz": 1 }
```

Inspector:

1. Per-mark timer, at most `icon_hz` captures/sec (default 1, clamped to 10).
2. If `icon_region` unchanged since last capture and cached TTL not expired, skip.
3. Issue a daemon request equivalent to `aos see capture --region x,y,w,h --base64 --format jpg --quality low`.
4. Cache the returned base64 string keyed by `(canvas_id, id)`; render as `<img src="data:image/jpeg;base64,...">`.
5. On capture error, log once per mark, fall through to `shape` / default.

**Cost:** ScreenCaptureKit @ jpg@low on a ~80×80 region ≈ 5-10ms per capture, including daemon IPC. At default 1 Hz for a handful of marks, fraction of a percent CPU.

### Mode comparison

| Mode | Consumer provides | Cost / frame | Best for |
|---|---|---|---|
| default shape | nothing | ~0 | quick marker with no asset |
| `shape` (SVG / primitive) | vector spec | ~0 | exact vector icon, no raster |
| `icon` (tier 1/2) | URL or data URL | ~1-2ms per re-bake (tier 1), 0 per render (tier 2) | web consumers with already-rendered pixels |
| `icon: "capture"` (tier 3) | bbox + optional Hz | ~5-10ms at 1 Hz per mark | non-web regions or consumers that don't self-render |

### Daemon wiring

Pub/sub only. Mirror the existing `forwardWikiPageChangedToCanvases` / `forwardCanvasMessageToCanvases` fan-out pattern in `src/daemon/unified.swift`:

```swift
func forwardCanvasObjectMarks(data: [String: Any]) {
    canvasSubscriptionLock.lock()
    let targets = canvasEventSubscriptions
        .filter { $0.value.contains("canvas_object.marks") }
        .map { $0.key }
    canvasSubscriptionLock.unlock()
    guard !targets.isEmpty else { return }

    var msg: [String: Any] = ["type": "canvas_object.marks"]
    for (k, v) in data { msg[k] = v }
    for canvasID in targets {
        canvasManager.postMessageAsync(canvasID: canvasID, payload: msg)
    }
}
```

Plus the one-line branch in the canvas-message dispatch that recognizes the event name. ~20 LOC Swift.

For Tier 3 capture, the inspector issues a capture request through the existing daemon request path (the same path `aos see capture` uses). This should be reusable with minor additions to the capture command surface to accept it from a canvas context — concrete mechanism to be worked out in implementation plan but no new Swift *subsystem* is needed, only a small capture entry point.

### Inspector-side state

```js
// inside the CanvasInspector component:
marksByCanvas = new Map(); // canvas_id -> { objects, expiresAt }
iconCache    = new Map();  // key: normalized icon URL OR "capture:<canvas_id>:<id>"
                           // value: { src, capturedAt }
nextObjIndex = new Map();  // canvas_id -> running counter for default 'obj-N' names
```

Subscribe alongside existing subscriptions:

```js
subscribe(['canvas_lifecycle', 'display_geometry', 'input_event', 'canvas_object.marks']);
```

Apply on message:

```js
if (msg.type === 'canvas_object.marks') {
  const { canvas_id, objects } = msg.payload || msg;
  marksByCanvas.set(canvas_id, {
    objects: normalizeMarks(canvas_id, objects),
    expiresAt: Date.now() + 10_000,
  });
  scheduleRerender();
}
```

`normalizeMarks` assigns default ids (`obj-N`), default color (stable random per id), default size (20), and runs the light SVG sanitizer for `shape`. Sweep expired entries on each rerender tick.

### Consumer example (Sigil)

Tier 1 (recommended for Sigil). Sketch — not copy-paste-ready; implementation plan resolves DPR and canvas-local coordinate details:

```js
// apps/sigil/renderer/live-modules/persistent-stage.js
let thumbUrl = null;
let lastThumbAt = 0;

function rebakeThumb() {
  // Derive canvas-local (DPR-aware) source rect around avatarPos from the union
  // canvas window origin, then drawImage into a 20x20 offscreen canvas and
  // toDataURL('image/jpeg', 0.3). Details handled in implementation plan.
  thumbUrl = /* base64 data URL */ thumbUrl;
  lastThumbAt = performance.now();
}

function emitMarks() {
  if (!liveJs.avatarPos.valid || !liveJs.visible) return;
  if (performance.now() - lastThumbAt > 1000) rebakeThumb();
  host.post('canvas_object.marks', {
    canvas_id: 'avatar-main',
    objects: [{
      id: 'avatar',
      name: liveJs.avatarName ?? 'Avatar',
      x: Math.round(liveJs.avatarPos.x),
      y: Math.round(liveJs.avatarPos.y),
      size: 20,
      icon: thumbUrl,
    }],
  });
}
// call emitMarks() at ~10 Hz from the render loop (gated by a throttle).
```

## Error handling

- **Schema errors** (missing `canvas_id`, malformed `objects`): inspector logs once per distinct shape, ignores the message. Never throws.
- **Unknown `canvas_id`** (no matching canvas in `show list`): still rendered on minimap if inside the union; listed under a synthetic `(unknown canvas)` group in the list.
- **`icon` load failure**: `<img onerror>` falls through to `shape` / default. Logged once per icon URL.
- **Tier 3 capture failure**: logged once per mark, falls back to `shape` / default until next successful capture clears the sticky error flag.
- **Sanitizer reject** on `shape`: logged once per offending mark id, falls back to default.

## Security notes

- `shape` accepts raw SVG. Inspector strips `<script>`, inline event handlers (`on*=`), and any `xlink:href` / `href` referencing non-`data:` URLs. Renders inside the inspector's own WKWebView — same process boundary as existing canvas-inspector code.
- `icon` URLs load in the inspector WKWebView. `data:` and `aos://` are recommended; arbitrary `http(s)://` is permitted but left to operator discretion, matching how existing consumer-provided content flows work.
- No `eval`, no `innerHTML` injection of untrusted strings outside the sanitized SVG path.

## Testing

**Unit (Node, no WebView):**
- `normalizeMarks` default assignment: id fill-in, color determinism, size clamp, name fallback.
- Sanitizer: strips `<script>`, event handlers, external refs; preserves benign SVG.
- TTL sweep: expired entries removed; non-expired entries untouched.
- Precedence: `icon` > `shape` > default.

**Integration (shell under `tests/`):**
- Launch canvas-inspector + a scripted consumer canvas that emits marks on a timer. Assert via `aos show eval` on the inspector that `window.__canvasInspectorState.marksByCanvas` reflects the emitted set.
- Emit `objects: []` → inspector drops them.
- Stop consumer → inspector drops marks after 10s TTL.

**Manual (Sigil, HITL):**
- With canvas-inspector open, move the Sigil avatar. Avatar position marker on the minimap follows. Thumbnail reflects current geometry/color.

## Non-goals (v1)

- Click-to-pan / click-to-highlight-in-parent-canvas (defer).
- Bidirectional marks (inspector → consumer annotations — see issue #69 for that direction).
- Long-lived daemon-side mark registry (marks that outlive the consumer process). Ephemeral pub/sub only in v1.
- Multi-inspector broadcast with shared state.
- Mark editing from inspector UI.

## Open questions

None currently blocking. Raise during implementation-plan writing if discovered.
