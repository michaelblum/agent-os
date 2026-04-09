---
type: entity
name: Sigil
description: Avatar presence system — the visual face of agent-os
tags: [display, avatar, presence]
---

# Sigil

Sigil is the avatar presence system for agent-os. It renders a Three.js celestial animation on full-screen transparent canvases, tracks cursor position across displays, and provides visual feedback for agent activity.

## Components

- **avatar-sub** — Swift binary, Sigil's entry point. Manages state machine, IPC, and animation loop.
- **renderer/** — Three.js live renderer (bundled single HTML for WKWebView compatibility)
- **studio/** — Customization UI for avatar appearance and behavior
- **chat/** — Chat surface for agent conversations (in development)

## Architecture

Sigil runs as a separate process from the daemon. It connects via Unix socket IPC, receives cursor position and event updates, and sends scene-position commands to its canvases.

## Related
- [Canvas System](./canvas-system.md)
- [Daemon](./daemon.md)
- [Studio](./studio.md)
