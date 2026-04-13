---
type: entity
name: Sigil
description: Avatar presence system — the visual face of agent-os
tags: [display, avatar, presence]
---

# Sigil

Sigil is the avatar presence system for agent-os. It renders a Three.js celestial animation on full-screen transparent canvases, tracks cursor position across displays, and provides visual feedback for agent activity.

## Components

- **renderer/** — Three.js live renderer (bundled inline + ES-module boot) loaded by the daemon canvas into WKWebView. Owns the state machine, cursor tracking, and fast-travel animation in JS.
- **studio/** — Customization UI for avatar appearance and the agent roster
- **chat/** — Chat surface for agent conversations (in development)

## Architecture

Sigil has no Swift process of its own — the renderer runs inside a full-display passthrough canvas (`aos show create --id avatar-main --url 'aos://sigil/renderer/index.html'`) and subscribes directly to the daemon's `input_event` and `display_geometry` streams via the content server.

## Related
- [Canvas System](./canvas-system.md)
- [Daemon](./daemon.md)
- [Studio](./studio.md)
