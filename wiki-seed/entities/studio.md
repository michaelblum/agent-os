---
type: entity
name: Studio
description: Sigil customization UI — avatar appearance, surfaces, settings
tags: [display, ui, configuration]
---

# Studio

Studio is Sigil's customization interface, rendered as an interactive canvas. It provides controls for avatar appearance, companion surface management, and settings.

## Panels

- **Avatar** — visual appearance controls, animation parameters
- **Surfaces** — launch companion canvases (chat, inspector)
- **Settings** — voice, visual feedback toggles

## Runtime

Studio runs as a WKWebView canvas loaded via the content server. It communicates with the daemon through IPC — sends config changes, receives state updates.

## Location

`apps/sigil/studio/` — HTML, CSS, JavaScript files served by the content server.

## Related
- [Sigil](./sigil.md)
- [Canvas System](./canvas-system.md)
