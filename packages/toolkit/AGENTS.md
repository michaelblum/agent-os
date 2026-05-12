@../../AGENTS.md

# Toolkit Boundary

`packages/toolkit/` is the reusable AOS surface layer between daemon primitives
and apps. It is where the default opt-in AOS windowing system belongs.

Layer intent:

- `runtime/`: universal in-canvas bridge over daemon primitives.
- `controls/`: reusable semantic app-control behavior for WKWebView surfaces.
- `panel/`: reusable panel/window policy: chrome, drag, resize, close,
  minimize, maximize, restore, placement, and surface-manager affordances.
- `workbench/`: subject descriptors and reusable workbench contracts.
- `components/`: reusable content units and stock surfaces built from the lower
  layers.

Toolkit policy must stay generic. If a behavior only makes sense for Sigil or a
specific product, it belongs in `apps/`. If toolkit code needs native help for
performance or correctness, add or request a daemon primitive instead of
inventing private app canvases or pushing toolkit policy into Swift.

The shared DesktopWorld stage is toolkit policy running on a daemon
DesktopWorld canvas primitive. Prefer it for ordinary desktop-wide visuals such
as chips, transfer outlines, drag ghosts, telemetry, avatar/radial visuals, and
temporary affordances. Pair visual layers with explicit interaction surfaces or
input regions; do not make the full visual stage interactive by default.

Before adding WebViews, stage layers, hit regions, or daemon work for a surface,
use `docs/recipes/aos-surface-interaction-decision-tree.md`. Keep local guidance
as a pointer to that canonical tree instead of copying the full policy here.

Consumer-facing toolkit contracts are indexed at `docs/api/toolkit.md`. Prefer
the scoped API file for the layer you are changing:
`docs/api/toolkit/runtime.md`, `docs/api/toolkit/panel-window.md`,
`docs/api/toolkit/workbench.md`, `docs/api/toolkit/components.md`, or
`docs/api/toolkit/content-host.md`.
