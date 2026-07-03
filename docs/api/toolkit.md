# Toolkit API

Consumer-facing map for `packages/toolkit`. This page is the entry point; the detailed contracts live in smaller boundary files so agents and humans can read only the layer they are changing.

Use this index when you are building an AOS canvas surface, composing reusable toolkit content, or reviewing a consumer-facing runtime, panel/window, workbench, component, or content-hosting change. For broader architecture, see [packages/toolkit/AGENTS.md](../../packages/toolkit/AGENTS.md).

## API Map

| Boundary | Scoped reference | Use it for |
| --- | --- | --- |
| Runtime primitives | [toolkit/runtime.md](./toolkit/runtime.md) | runtime bridge, canvas lifecycle helpers, subscriptions, `createResourceScope`, DesktopWorld surface runtime, input regions/events |
| Controls | [toolkit/controls.md](./toolkit/controls.md) | plain DOM control factories, stock control CSS classes, timer bar, number-field enhancement |
| Panel/window policy | [toolkit/panel-window.md](./toolkit/panel-window.md) | `mountChrome`, `createPanelWindowController`, drag/resize/maximize/minimize/restore, placement, `createStageAffordance`, split panes, tabs, single layout |
| Workbench contracts | [toolkit/workbench.md](./toolkit/workbench.md) | `aos.workbench.subject`, human checkpoint, HTML/Markdown/work-record/artifact/playbook/wiki workbench contracts |
| Components | [toolkit/components.md](./toolkit/components.md) | Surface Inspector, Surface-Zoom Inspector, Spatial Telemetry, Render Performance, Object Transform Panel, Test Console, Integration Hub, component launch surfaces, controls, theme tokens, Markdown preview |
| Content host | [toolkit/content-host.md](./toolkit/content-host.md) | content roots, import/hosting model, Content factories, `ContentHost`, styling boundary, minimal standalone template |

## What The Toolkit Is

The toolkit is the reusable web layer for `aos` canvases and the home of the default opt-in AOS surface/windowing system. It builds on daemon primitives; it does not replace the daemon, and it does not own app product behavior.

It is split into these layers:

| Layer | Path | Purpose |
| --- | --- | --- |
| Runtime | `packages/toolkit/runtime/` | bridge, subscriptions, canvas mutation helpers, manifest handshake, DesktopWorld adapters, input-region helpers, resource scopes |
| Controls | `packages/toolkit/controls/` | reusable app-control behavior for WKWebView surfaces |
| Panel | `packages/toolkit/panel/` | panel/window policy, chrome, placement, StageAffordance, and composition primitives |
| Workbench | `packages/toolkit/workbench/` | shared subject descriptors, workbench contracts, and stock workbench shell styling |
| Components | `packages/toolkit/components/` | reusable content units, stock surfaces, launchers, and optional stock styles |

Layer boundary:

- daemon: native lifecycle, frames, display topology, input streams, content serving, and generic routing primitives;
- toolkit: panel/window policy, controls, workbench shells, DesktopWorld stage policy, and visual/interaction binding helpers;
- apps: content, domain behavior, theming, product state, and special expression.

When a toolkit behavior is too heavy in WebView space, add or request a cheaper daemon primitive and keep the reusable policy here.

## Surface Interaction Decision Tree

Before adding a WebView, daemon policy, app-private hit testing, or a new DesktopWorld stage layer, use the canonical decision tree in [docs/guides/aos-surface-interaction-decision-tree.md](../guides/aos-surface-interaction-decision-tree.md). The short version is:

1. use DOM controls when the visual and hit area already live in the same interactive canvas;
2. use toolkit panel/windowing primitives for ordinary chrome, placement, minimize, maximize, restore, close, drag, and resize;
3. use `createStageAffordance` plus `createResourceScope` and daemon input regions for passive DesktopWorld visuals with small hit areas;
4. use the shared DesktopWorld stage without input regions for visual-only decoration and diagnostics;
5. create a full interactive canvas only for rich DOM interaction, focus, keyboard navigation, or independent application state;
6. keep a private app renderer or 3D stage only for distinct renderer lifecycle, richer graphics, or product expression;
7. add daemon work only for generic native primitives, not product or toolkit windowing policy.

## One-Click Contract Index

- `createResourceScope`: [runtime resource scope](./toolkit/runtime.md#desktopworld-surface-runtime).
- `createStageAffordance`: [panel/window StageAffordance](./toolkit/panel-window.md#stageaffordance).
- `createPanelWindowController`: [panel/window controller](./toolkit/panel-window.md#createpanelwindowcontrolleroptions).
- `mountChrome`: [panel chrome](./toolkit/panel-window.md#mountchromecontainer-options).
- controls: [controls API](./toolkit/controls.md#factories) and [form harness](./toolkit/panel-window.md#createformcontainer-fields-options).
- DesktopWorld stage/surface runtime: [runtime DesktopWorld surface runtime](./toolkit/runtime.md#desktopworld-surface-runtime) and [components DesktopWorld stage](./toolkit/components.md#stock-components-snapshot).
- input regions/events: [runtime input regions and events](./toolkit/runtime.md#input-regions-and-events).
- workbench contracts: [workbench API](./toolkit/workbench.md#workbench-contracts).
- Surface Inspector and Surface-Zoom Inspector: [components API](./toolkit/components.md#stock-components-snapshot) and [Surface-Zoom proof](./toolkit/components.md#surface-zoom-inspector-proof).
- content/host contract: [content host API](./toolkit/content-host.md#content-contract).
- styling boundary: [content host styling boundary](./toolkit/content-host.md#styling-boundary).

## Maintenance Contract

Keep this page as a map, not a component manual. Detailed contract prose belongs in the scoped files above. If a change affects a consumer-facing toolkit interface, update the scoped file in the same change and add or update a deterministic docs contract test when the routing itself matters.

Do not duplicate the full [surface interaction decision tree](../guides/aos-surface-interaction-decision-tree.md) in API docs; link to the guide so it remains canonical. Keep active design or audit status in `docs/design/`, not in this API map.
