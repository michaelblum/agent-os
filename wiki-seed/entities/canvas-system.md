---
type: entity
name: Canvas System
description: Daemon-managed transparent overlay windows for HTML content
tags: [display, canvas, overlay]
---

# Canvas System

Canvases are transparent NSWindow overlays managed by the aos daemon. Each canvas loads HTML content via WKWebView and communicates bidirectionally with the daemon through JavaScript evaluation.

## Operations

- `create` — create a canvas with ID, position, and URL
- `update` — modify canvas content, position, or style
- `remove` — destroy a canvas
- `eval` — run JavaScript in a canvas context
- `list` — enumerate active canvases

## Canvas Types

- **Interactive** (`.statusBar` level, mouse-enabled) — receive clicks and keyboard focus. Used for studio, chat, inspector.
- **Overlay** (`.statusBar` level, click-through) — ignore mouse events while staying visually above the desktop. Used for display overlays, annotations.

## Toolkit Debug Surfaces

The toolkit ships `canvas-inspector`, a daemon-backed debug surface that renders
live canvas geometry on a minimap. Its operator controls are demand-driven:

- `minimap cursor` subscribes to `input_event` only when toggled on and draws a
  live cursor marker on the minimap.
- `mouse events` is a separate toggle that renders click/drag telemetry on the
  same minimap: hold rings, drag lines, release collapse/fade, `Esc` cancel
  collapse, and left/right click pulses.
- the inspector's `see` bundle export is daemon-configurable under
  `see.canvas_inspector_bundle.*`. The current default hotkey is `ctrl+opt+c`,
  and the daemon writes a temp bundle directory with the selected artifacts
  before copying the bundle path to the clipboard.

This keeps the inspector quiet by default while still making raw input behavior
available when debugging spatial or interaction issues.

## Content Loading

Canvases load content from the daemon's content server via `aos://` URLs, which resolve to `http://127.0.0.1:PORT/...`. This allows multi-file web apps (ES modules, CSS) without bundling.

## Related
- [Content Server](../concepts/content-server.md)
- [Daemon](./daemon.md)
- [Sigil](./sigil.md)
