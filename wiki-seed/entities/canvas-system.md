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

- **Interactive** (`.floating` level) — receive clicks. Used for studio, chat, inspector.
- **Overlay** (`.statusBar` level) — click-through. Used for display overlays, annotations.

## Content Loading

Canvases load content from the daemon's content server via `aos://` URLs, which resolve to `http://127.0.0.1:PORT/...`. This allows multi-file web apps (ES modules, CSS) without bundling.

## Related
- [Content Server](../concepts/content-server.md)
- [Daemon](./daemon.md)
- [Sigil](./sigil.md)
