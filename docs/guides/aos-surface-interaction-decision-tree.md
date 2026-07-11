# AOS Surface Interaction Decision Tree

Use this recipe before adding a WebView, daemon policy, private hit testing, or
new DesktopWorld stage layer. The goal is to pick the smallest interaction
mechanism that matches the surface.

## Decision Tree

1. **DOM interaction inside an already interactive canvas.** Use normal DOM
   controls and accessibility semantics when the visual and hit area live inside
   the same interactive WebView. This is the right answer for buttons, forms,
   menus, sliders, lists, and keyboard navigation that are already part of an
   interactive canvas.
2. **Toolkit panel/windowing behavior.** Use toolkit panel/windowing primitives
   for panel chrome, placement, drag, resize, minimize, maximize, restore, and
   close. Do not add app-private chrome for ordinary panel behavior.
3. **Passive DesktopWorld visual with small hit areas.** Use
   `createStageAffordance`, backed by `createResourceScope` and daemon input
   regions, when a passive DesktopWorld visual needs a few explicit hit areas.
   This is the default for minimized chips, lightweight global affordances,
   transient restore/close controls, and simple desktop markers that need
   clicks.
4. **Visual-only global decoration or diagnostic layer.** Use the shared
   DesktopWorld stage without input regions when there is no hit area. Examples
   include drag ghosts, telemetry overlays, and diagnostic marks that do not
   consume input.
5. **Full interactive surface.** Use a real canvas/WebView only when the UI
   needs rich DOM interaction, focus, forms, menus, keyboard navigation, or
   independent application state. Do not create a WebView for a passive visual
   plus one or two clicks.
6. **Private app renderer or 3D stage.** Allow this only when an external app
   needs a distinct renderer lifecycle, richer graphics, or product expression
   that the shared 2D stage cannot provide. Simple app panels, chips, and
   ordinary desktop markers should not use this path.
7. **Daemon primitive.** Add daemon work only for generic native capability:
   lifecycle, display topology, input routing, resource cleanup, identity, or
   performance primitives. Do not move product or toolkit windowing policy into
   the daemon.

## First Conformance Audit

This audit is a first routing map for #223. It is not a migration plan for
every app file. Status values mean:

- **Acceptable:** matches the tree now.
- **Transitional:** acceptable as a bridge, but not the target pattern.
- **Needs follow-up:** target mechanism is known, but a future slice owns it.

| Surface | Current mechanism | Target mechanism | Status | Tracker | Next slice |
| --- | --- | --- | --- | --- | --- |
| Default minimized chips | Toolkit `createMinimizeController` creates a passive DesktopWorld stage layer and binds restore/close/body daemon input regions through `createStageAffordance`. The V0 path has real-pointer proof: shared-stage readiness, prompt input-region registration, duplicate-minimize idempotence, restore/close cleanup, no default `aos-chip-*` WebView, and no shared-stage ownership denial. | Passive DesktopWorld visual with small hit areas. | Acceptable | #122, #223, #304 | Accepted V0 baseline; keep future work to confidence telemetry and follow-on affordance hardening. |
| Explicit WebView minimized-chip fallback | `packages/toolkit/panel/minimized-chip.html` remains the fallback when stage or input-region setup fails. Fallback timeout cleanup has been hardened so failed or late fallback creation does not strand stale chip canvases. | StageAffordance plus daemon input regions; WebView only if the chip needs richer DOM interaction. | Transitional | #261, #304 | Treat as explicit fallback only; retirement is a future confidence and telemetry decision, not the default path. |
| Panel chrome minimize, maximize, restore, close, drag, resize | Toolkit `createPanelWindowController` is the public policy path, and stock `mountChrome` routes through it for controls, drag, maximize/restore, minimize, resize, and final placement clamps. | Toolkit panel/windowing behavior. | Acceptable | #261 | Continue migrating private app shells to the public controller instead of hand-emitted window messages. |
| Drag transfer visuals | `packages/toolkit/panel/drag-transfer.js` is a legacy cross-display transfer-outline path. The active One-World path moves panels and draggable nodes through toolkit drag/drop in union coordinates. | Toolkit panel/windowing behavior for movement; visual-only global decoration only for non-interactive diagnostics. | Needs follow-up | #425 | Do not add callers. Continue splitting any still-useful stage helpers away from transfer-outline behavior, then remove the legacy path. |
| DesktopWorld stage layers | Shared toolkit stage accepts layer upsert/remove/replace/clear messages and stays non-interactive by default. Surface Inspector visibility for stage layers, owners, input regions, and affordance/resource metadata is now part of the V0 baseline. | Visual-only global decoration, or StageAffordance when small hit areas are required. | Acceptable | #122, #223 | Use the inspector visibility as the diagnostic baseline before adding new stage policy. |
| Surface Inspector/action controls | Surface Inspector is an interactive toolkit WebView with DOM controls, minimap, list panes, annotations, action buttons, and resource visibility for stage layers/input regions/affordances. | Full interactive surface using DOM controls and accessibility semantics. | Acceptable | #223 | Keep new inspector features focused on diagnostics, not hidden assumptions. |
| Daemon input regions and canvas lifecycle events | Daemon owns generic `input_region.*` registration/events, routed input identity, `canvas_lifecycle` routing, `canvas.info`, and warm/suspend/resume readiness helpers. | Daemon primitive. | Acceptable | #120, #123, #303 | Treat these as V0 baselines; restate only narrower generic compatibility gaps. |

## What Changed Since StageAffordance And ResourceScope

The StageAffordance and ResourceScope slices proved that a passive stage visual
can be bound to explicit daemon input regions with deterministic cleanup. This
recipe turns that implementation pattern into the default decision point: first
decide whether the visual needs DOM, a passive stage layer, a stage affordance,
a private renderer, or a daemon primitive, then add code at that layer.

## Guardrail

When a proposed change does not fit one of the seven choices, stop and write the
missing primitive or policy boundary into a work card. Do not invent a private
parallel interaction system in an app or move toolkit policy into Swift just to
make a local bug easier.
