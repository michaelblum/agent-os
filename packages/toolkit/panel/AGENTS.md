@../../../AGENTS.md
@../AGENTS.md

# Toolkit Panel / Windowing

`panel/` is the default opt-in AOS windowing layer for window-shaped canvases.
It owns reusable policy for panel chrome, drag, resize, close, minimize,
maximize, restore, safe placement, and cross-display affordances.

This layer is not the daemon and not an app. Keep the policy generic and
customizable:

- call daemon primitives for native lifecycle, frame, visibility, display, and
  input work;
- use DesktopWorld stage layers for lightweight global visuals when possible;
- use explicit interaction surfaces or future daemon input regions for hit
  areas;
- let apps provide content, actions, titles, theme overrides, and product
  behavior.

Avoid one-WebView-per-affordance when a stage layer plus small hit region would
do. The current minimized-chip HTML surface is a transitional implementation,
not the architectural ideal for cheap panel state changes.

Use `docs/guides/aos-surface-interaction-decision-tree.md` before adding new
panel chrome or surface affordances. Ordinary panel behavior belongs here;
simple passive DesktopWorld hit targets should prefer StageAffordance, and full
interactive canvases should be reserved for real DOM interaction needs.

Use `docs/api/toolkit/panel-window.md` for the consumer-facing panel/window
contract, including `mountChrome`, `createPanelWindowController`, layout
helpers, and `createStageAffordance`.
