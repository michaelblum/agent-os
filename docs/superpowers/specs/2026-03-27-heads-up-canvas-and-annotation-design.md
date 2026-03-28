# heads-up: Display Server & Annotation Schema

**Date:** 2026-03-27
**Status:** Approved. Steps 1–3 implemented (`402e33f`). Steps 4–5 (serve mode, browser backend) queued.
**Scope:** `packages/heads-up/`, `shared/schemas/annotation.schema.json`, `packages/side-eye/` (`--label` flag)

## Problem

The ecosystem has three contexts where agents need to draw visual overlays:

1. **On a screenshot** — numbered badges so vision models can reference elements by index instead of guessing pixel coordinates (OmniParser's set-of-marks pattern)
2. **On the OS desktop** — floating overlays like a spotlight, an animated orb, a chat interface, approval prompts
3. **On a web page** — in-page annotation overlays (content script injection into the DOM)

Today, side-eye hand-rolls every drawing primitive in CoreGraphics (`--draw-rect`, `--highlight-cursor`, `--grid`). Adding badges means another bespoke function. Arrows would be another. Each new visual is more Swift drawing code that only works in the screenshot context.

Meanwhile, Syborg's annotation system renders the same concepts (rects, badges, arrows, a cursor donut aura) using HTML/CSS/SVG in the browser. That rendering vocabulary already works.

## Insight

If the rendering surface is a WKWebView, all three contexts can share the same HTML/CSS/SVG drawing vocabulary:

- **OS overlay:** transparent borderless NSWindow containing a WKWebView
- **Screenshot bake-in:** offscreen WKWebView → rasterize to bitmap → composite onto screenshot
- **Web page:** send the same HTML content to a Chrome extension content script for DOM injection

One rendering language. Three delivery mechanisms.

## Design

### heads-up: The Display Server

heads-up manages rendering surfaces. It accepts HTML/CSS/SVG content and delivers it to the right renderer. It is the single point of contact for all visual output in the ecosystem.

#### Three rendering backends

| Backend | How it works | Use cases |
|---|---|---|
| **OS overlay** | Transparent NSWindow + WKWebView, positioned on screen | Spotlight, orb, chat, prompts |
| **Render-to-bitmap** | Offscreen WKWebView → `takeSnapshot()` → PNG/base64 | Screenshot annotation (side-eye --label) |
| **Browser injection** | Send content to Chrome extension via WebSocket | In-page annotation overlays |

The caller specifies what to render and where. heads-up handles the how.

#### Process model

**Render mode** is stateless, fire-and-exit:

```bash
heads-up render --width 1920 --height 1080 --base64 --html "<svg>...</svg>"
heads-up render --width 500 --height 400 --file overlay.html --out /tmp/overlay.png
cat content.html | heads-up render --width 1920 --height 1080 --base64
```

Spins up NSApplication, creates an offscreen WKWebView, loads content, calls `takeSnapshot()`, outputs the bitmap, exits. No permissions needed beyond normal app execution — it's rendering its own content, not capturing the screen.

**Transparency is critical.** The output PNG must have a working alpha channel so it composites cleanly over screenshots. WKWebView defaults to an opaque background. The implementation must explicitly configure transparency before anything else:

```swift
webView.setValue(false, forKey: "drawsBackground")
webView.layer?.backgroundColor = NSColor.clear.cgColor
webView.isOpaque = false
```

This should be the first thing validated in step 2 of implementation — if `takeSnapshot()` drops the alpha channel, the entire render pipeline breaks.

**Serve mode** is a daemon for persistent surfaces:

```bash
heads-up create --id orb --anchor-window 4521 --offset 10,10,80,80 --file orb.html --interactive
heads-up create --id spotlight --at 0,0,1920,1080 --html "..."
heads-up create --id chat --at 1600,100,320,800 --url http://localhost:3000/session --interactive
heads-up create --id badges --target chrome --tab-id 123 --html "..."

heads-up update --id spotlight --html "<div>new content</div>"
heads-up update --id orb --offset 50,20,80,80

heads-up remove --id orb
heads-up list
heads-up remove-all
```

The daemon is an NSApplication that manages transparent NSWindows. It exposes two listener interfaces:

- **Unix domain socket** (`~/.config/heads-up/sock`) — for local CLI clients (side-eye, hand-off, orchestrator). Fast, no port conflicts.
- **WebSocket on localhost** (`ws://127.0.0.1:<port>`) — for the Chrome extension, which cannot connect to Unix sockets. The extension initiates the outbound connection to heads-up's local server.

The daemon auto-starts on first `create` if not running, and auto-exits when idle (no canvases, no connections).

#### Content sources

| Flag | Source |
|---|---|
| `--html "..."` | Inline HTML string |
| `--file path.html` | Local file |
| `--url http://...` | URL (for full apps like the chat interface) |
| stdin | Piped content |

#### Positioning

**Absolute:** `--at x,y,width,height` in global CG coordinates.

**Window-anchored:** `--anchor-window <window_id> --offset x,y,width,height` where offset is in LCS (relative to window top-left). heads-up watches the window's position via AX observer notifications (`AXWindowMoved`, `AXWindowResized`) and repositions the overlay to track.

**Element-anchored:** Not supported natively — element positions come from `--xray` point-in-time snapshots, and elements don't broadcast position changes. For element tracking, the orchestrator would poll side-eye and call `heads-up update` to reposition. This is an orchestrator concern, not a heads-up concern.

#### Interactivity

By default, canvases are click-through. The preferred mechanism is **alpha-based hit testing** rather than a binary `ignoresMouseEvents` toggle: if the NSWindow has no background and the WKWebView is transparent, macOS automatically passes clicks through transparent pixels and only catches clicks on rendered DOM elements. This means a floating orb on a transparent canvas receives clicks on the orb itself while the desktop underneath remains fully interactive — no mode switching needed.

`--interactive` is a canvas-level override for cases where the entire window surface should capture input (e.g., a fullscreen modal prompt). For most use cases, alpha-based hit testing is the right default.

#### Two-way communication

WKWebView provides native bidirectional messaging:

- **Host → WebView:** `webView.evaluateJavaScript("handleMessage({...})")` — push state updates
- **WebView → Host:** JS calls `window.webkit.messageHandlers.headsup.postMessage({...})` — send events back

For the daemon, events from canvases flow back through the Unix socket as JSON:

```json
{"type": "event", "id": "chat", "event": "user_click", "payload": {"annotation": 3}}
```

This enables interactive overlays: the orchestrator creates a canvas, the user interacts with it, events flow back to the orchestrator.

For render mode (stateless bitmap output), there is no communication channel — render, snapshot, exit.

#### Browser backend

For in-page overlays, heads-up routes content to the Chrome extension rather than rendering in a local window.

`--target chrome --tab-id <id>` sends the HTML content to the extension's content script for injection into the page's shadow DOM. The extension connects to heads-up's daemon via a WebSocket (the extension initiates the outbound connection to heads-up's local server, sidestepping Chrome's network restrictions).

Events from the page (user clicked an annotation) flow back through the same WebSocket → Unix socket path.

This means the orchestrator uses the same interface regardless of rendering target:

```bash
# These use identical content, different delivery
heads-up create --id labels --anchor-window 4521 --offset 0,0,800,600 --html "..."  # OS overlay
heads-up create --id labels --target chrome --tab-id 123 --html "..."               # In-page overlay
heads-up render --width 800 --height 600 --html "..." --base64                      # Screenshot bitmap
```

### Annotation Schema

`shared/schemas/annotation.schema.json` — a minimal data format describing labeled regions on a surface.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/michaelblum/agent-os/shared/schemas/annotation.schema.json",
  "title": "Annotations",
  "description": "Labeled regions for agent-os ecosystem tools. Array position = display ordinal (0-based index, render as 1-based label).",
  "type": "object",
  "required": ["schema", "version", "annotations"],
  "additionalProperties": false,
  "properties": {
    "schema": {
      "const": "annotations"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "Semver. Current: 0.1.0."
    },
    "annotations": {
      "type": "array",
      "items": { "$ref": "#/$defs/Annotation" },
      "description": "Labeled regions. Array index = ordinal (display as index + 1)."
    }
  },
  "$defs": {
    "Bounds": {
      "type": "object",
      "required": ["x", "y", "width", "height"],
      "additionalProperties": false,
      "properties": {
        "x": { "type": "number", "description": "Left edge." },
        "y": { "type": "number", "description": "Top edge." },
        "width": { "type": "number", "description": "Width." },
        "height": { "type": "number", "description": "Height." }
      },
      "description": "Rectangle. Coordinate space is determined by context (LCS for screenshots/windows, global CG for topology)."
    },
    "Annotation": {
      "type": "object",
      "required": ["bounds"],
      "additionalProperties": false,
      "properties": {
        "bounds": {
          "$ref": "#/$defs/Bounds",
          "description": "Region this annotation labels."
        },
        "label": {
          "type": "string",
          "description": "Human-readable label. If omitted, the ordinal number is used."
        }
      }
    }
  }
}
```

An annotation is: a rectangular region + an optional text label. Array position is the ordinal — no explicit ordinal field.

The schema is deliberately minimal. It describes WHAT to label, not HOW to render it. Rendering decisions (badge style, colors, fonts) belong to the HTML template that consumes this data.

The coordinate space is context-dependent and not encoded in the schema. When side-eye produces annotations, bounds are in LCS. When used with the spatial topology, bounds are in global CG. The consumer knows which space it's operating in.

### side-eye --label

The first consumer. Combines `--xray` element detection with heads-up bitmap rendering to produce screenshots with numbered badges.

#### Flow

```
side-eye main --label --out screenshot.png
```

1. Capture the screenshot (existing pipeline)
2. Run `--xray` on the frontmost app (existing code)
3. Generate annotation data from xray elements: each element's bounds + AX label/title → annotation array
4. Generate an HTML string with SVG badges positioned at each annotation's bounds (ordinal number in a circle, placed at top-left corner of each element). This template logic lives in side-eye for now — extract to shared/ if a second producer needs it.
5. Call `heads-up render --width <W> --height <H> --base64 --html "<generated>"` to rasterize the badge overlay as a transparent PNG
6. Composite the badge overlay onto the screenshot
7. Emit JSON response with both the annotated screenshot and the annotation array

#### Output

```json
{
  "status": "success",
  "files": ["/tmp/screenshot.png"],
  "annotations": [
    { "bounds": { "x": 100, "y": 200, "width": 50, "height": 30 }, "label": "Search" },
    { "bounds": { "x": 300, "y": 400, "width": 120, "height": 25 }, "label": "Submit" }
  ]
}
```

The `annotations` array matches the schema. Index 0 renders as badge "1" on the screenshot, index 1 as "2", etc. An agent seeing the screenshot reads badge "3" and knows to reference `annotations[2]` for its bounds.

#### Dependency

`--label` requires `heads-up` to be installed (for bitmap rendering). Core side-eye features (capture, xray, cursor, selection) remain independent with no heads-up dependency. If heads-up is not found, `--label` exits with a clear error: `{"error": "heads-up not found. Install heads-up for --label support.", "code": "MISSING_DEPENDENCY"}`.

### Migration path for existing side-eye drawing

side-eye's existing drawing features (`--draw-rect`, `--highlight-cursor`, `--grid`) are currently implemented in CoreGraphics. These could eventually migrate to the heads-up render pipeline:

- `--draw-rect` → annotation with bounds + colored rect template
- `--highlight-cursor` → annotation at cursor position + circle template
- `--grid` → grid template

This migration is not part of this spec. The existing CoreGraphics implementations continue to work. New drawing features should use heads-up render.

## Architectural Notes

### heads-up is the exception to stateless CLIs

Every other tool in the ecosystem is fire-and-forget. heads-up's serve mode is a daemon because rendering surfaces must persist. This is an intentional exception — a display server *should* be the one stateful piece. The render mode remains stateless for the common screenshot use case.

### Sensor / Projector separation preserved

side-eye remains a pure sensor. It does not draw — it asks heads-up to render, then captures what's on screen (for the serve/overlay case) or composites a bitmap (for the render case). heads-up is purely projection — it never captures or mutates.

### heads-up as display server

heads-up routes content to the appropriate renderer (OS overlay, offscreen bitmap, or browser extension). The orchestrator talks to heads-up without knowing the rendering topology. This makes heads-up more central than other tools, but that's the correct role for a display server.

### The annotation schema is rendering-agnostic

The schema describes data (bounds + label), not presentation. An HTML/CSS/SVG template turns annotation data into visual content. Different templates produce different visual styles (numbered badges, colored rects, spotlight masks) from the same underlying data. Templates ship with the ecosystem but are not part of the schema.

## What This Does NOT Cover

| Gap | Why | Future |
|---|---|---|
| Template system / theming | No second template consumer yet | Extract when patterns emerge |
| Animation / behavioral rules | Orb behavior, spotlight tracking are orchestrator concerns | Design when heads-up serve mode is built |
| Extension WebSocket protocol | Depends on Chrome extension architecture decisions | Design when browser backend is built |
| Accessibility of overlay content | Overlays are agent-facing, not end-user-facing initially | Revisit for human-interactive overlays |
| Multi-display canvas management | Single-display is sufficient for v1 | Extend when needed — global CG coordinates already support multi-display positioning |
| Migration of side-eye drawing code | Existing CoreGraphics drawing works fine | Migrate incrementally |

## Implementation Order

1. **Annotation schema** (`shared/schemas/annotation.schema.json`) — the data contract
2. **heads-up render mode** (`packages/heads-up/`) — stateless HTML→bitmap pipeline
3. **side-eye --label** — generate annotations from xray, render via heads-up, composite
4. **heads-up serve mode** — daemon with persistent canvases, window anchoring
5. **Browser backend** — WebSocket bridge to Chrome extension content script

Steps 1–3 are the minimum viable feature. Steps 4–5 unlock the full display server vision.
