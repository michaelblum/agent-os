---
type: entity
name: Sigil
description: Avatar presence system — the visual face of agent-os
tags: [display, avatar, presence, sigil]
---

# Sigil

Sigil is the avatar presence system for agent-os. It renders a Three.js celestial animation on full-screen transparent canvases, tracks cursor position across displays, exposes a 3D radial menu, and provides visual feedback for agent activity.

## Components

- **renderer/** — Three.js live renderer (bundled inline + ES-module boot) loaded by the daemon canvas into WKWebView. Owns the state machine, cursor tracking, and fast-travel animation in JS.
- **renderer/radial-menu/** — Sigil-owned radial menu item definitions and leaf action adapters over toolkit radial-menu contracts.
- **radial-item-editor/** and **radial-item-workbench/** — focused editor/workbench surfaces for radial menu items and 3D object controls.
- **agent-terminal/** and **codex-terminal/** — terminal-carrier surfaces for provider CLI sessions.
- **context-menu/** — Sigil-owned avatar context actions over toolkit interaction primitives.
- **diagnostics/** — Sigil-specific diagnostics surfaces.

## Parked Compatibility Paths

- `apps/sigil/studio/` is the historical avatar configuration URL path. It may remain useful for compatibility and old tests, but it is not a current product surface or brand and should not receive new platform work unless a fresh product decision revives it.
- `apps/sigil/workbench/` is the historical multi-tab Sigil shell. Use current toolkit Subject Browser and radial item workbench paths for new browser/editor work.
- `apps/sigil/chat/` is the legacy chat canvas. Future chat-native work should be rebuilt from Agent Terminal/toolkit primitives.

## Architecture

Sigil has no Swift process of its own — the renderer runs inside a full-display passthrough canvas (`aos show create --id avatar-main --url 'aos://sigil/renderer/index.html'`) and subscribes directly to the daemon's `input_event` and `display_geometry` streams via the content server.

## Related
- [Canvas System](./canvas-system.md)
- [Daemon](./daemon.md)
