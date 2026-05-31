# Toolkit Surface Audit

Work card: `docs/dev/work-cards/research-toolkit-surfaces.md`

## Shared Control Exports

`packages/toolkit/controls/index.js` currently exports:

- `createButton`
- `createButtonGroup`
- `createToggle`
- `createTextField`
- `createCheckboxGroup`
- `createSelect`
- `createTimerBar`
- `handleNumberFieldKeydown`
- `handleNumberFieldWheel`
- `numberFieldBaseStep`
- `numberFieldStepForEvent`
- `stepNumberField`
- `wheelDirection`
- `wireNumberFieldControls`

## Component Classification

| Component | Uses shared controls? | Has inline controls? | Display-only? | Purpose |
|---|---:|---:|---:|---|
| `_base` | No | No | No | Support directory without a component `index.js`; not classified as a surface entrypoint. |
| `_dev` | No | No | No | Development/demo directory without a component `index.js`; not classified as a surface entrypoint. |
| `artifact-bundle-workbench` | No | Yes | No | Artifact bundle preview and evidence/provenance workbench; renders an inline Open Work Record button. |
| `canvas-inspector` | No | Yes | No | Surface/canvas inspector, minimap, annotation, and tree controls; hand-rolls many action buttons and a comment input. |
| `decision-gate` | Yes | No | No | Human decision gate surface using `createForm` from `../../panel/form.js` and `createTimerBar` from `../../controls/timer-bar.js`. |
| `desktop-world-stage` | No | No | Yes | DesktopWorld visual stage renderer; no native form or button controls in the component entrypoint. |
| `html-workbench-expression` | No | No | Yes | HTML workbench expression state/projection bridge; renders hosted content without local controls. |
| `inspector-panel` | No | No | Yes | Read-only element inspector panel for selected data. |
| `integration-hub` | No | Yes | No | Integration provider/workflow/job dashboard; hand-rolls command input plus Send, Refresh, and surface action buttons. |
| `log-console` | No | No | Yes | Log/event console display surface. |
| `markdown-workbench` | No | Yes | No | Markdown preview/source workbench; hand-rolls view toggles, outline/annotation buttons, save/revert/close buttons, and a source textarea. |
| `object-transform-panel` | Yes | Yes | No | Object transform editor; uses `wireNumberFieldControls` from the shared number-field layer but still hand-rolls object selection buttons, visibility/effect checkboxes, number/range inputs, mode buttons, and descriptor textareas. |
| `step-descriptor-workbench` | No | Yes | No | Step Descriptor diagnostics and gate simulator; hand-rolls gate ref/token inputs plus Apply Gate, Simulate, and Open Work Record buttons. |
| `render-performance` | No | No | Yes | Render performance metrics, sparkline, source summary, and event log display. |
| `spatial-telemetry` | No | No | Yes | Spatial telemetry display for displays, canvases, marks, cursor, and events. |
| `surface-zoom-inspector` | No | Yes | No | Zoomed surface/semantic target inspector; hand-rolls tree/list/mini-map buttons, checkbox, selects, and zoom/draft/reset action buttons. |
| `test-console` | No | Yes | No | Test supervision console; component model hand-rolls evidence, confirm/fail/blocked/note/retry buttons and a supervisor note textarea. |
| `wiki-kb` | No | Yes | No | Wiki knowledge-base graph/detail surface; hand-rolls view select, refresh/sidebar buttons, and markdown/raw toggle buttons. |
| `wiki-subject-browser` | No | Yes | No | Wiki subject catalog/browser; hand-rolls search input, facet selects, and reset button. |
| `work-record-workbench` | No | Yes | No | Work record editor/verifier surface; hand-rolls Apply JSON/Revert/Save buttons and multiple textareas. |

## Retrofit Candidates

- `canvas-inspector`: replace repeated `stats`, `tint`, remove, annotation action, breadcrumb, and management `<button>` markup with `createButton` or `createButtonGroup`; replace on/off button rows for cursor, mouse events, and annotation mode with `createToggle`; replace the annotation comment `<input>` with `createTextField`.
- `markdown-workbench`: replace preview/source segmented buttons with `createButtonGroup`; replace outline/annotation/save/revert/close buttons with `createButton`; the source editor textarea has no direct shared textarea export today.
- `object-transform-panel`: keep `wireNumberFieldControls` for numeric stepping, but replace mode buttons with `createButtonGroup`, object selection/action buttons with `createButton`, visibility/effect checkboxes with `createCheckboxGroup` or shared toggle semantics, and descriptor text-like fields with `createTextField` where single-line fields are sufficient.
- `integration-hub`: replace the command input with `createTextField`, Send/Refresh/surface buttons with `createButton`, and any mutually exclusive provider/workflow controls with `createButtonGroup` if they become explicit controls.
- `surface-zoom-inspector`: replace toolbar buttons with `createButton`/`createButtonGroup`, overlay checkbox with `createToggle` or `createCheckboxGroup`, and label-density/map-display selects with `createSelect`.
- `wiki-kb`: replace graph view `<select>` with `createSelect`, refresh/sidebar/toggle buttons with `createButton` or `createButtonGroup`, and the graph view controls in `views/graph.js` with `createTextField`, `createSelect`, `createToggle`, `createButton`, and `createButtonGroup` as appropriate.
- `wiki-subject-browser`: replace the search input with `createTextField`, facet selects with `createSelect`, and reset button with `createButton`.
- `work-record-workbench`: replace Apply JSON/Revert/Save buttons with `createButton`/`createButtonGroup`; multi-line JSON and intent textareas have no direct shared textarea export today.
- `step-descriptor-workbench`: replace gate ref/token inputs with `createTextField` and Apply Gate/Simulate/Open Work Record buttons with `createButton` or `createButtonGroup`.
- `test-console`: replace supervisor action buttons with `createButtonGroup` or `createButton`; the note textarea has no direct shared textarea export today.
- `artifact-bundle-workbench`: replace the Open Work Record button with `createButton`.

## UI-Rendering Code Outside `packages/toolkit/`

Shallow path scan only; these paths contain HTML/control-like markup or direct UI rendering outside `packages/toolkit/`:

- `apps/sigil/agent-terminal/index.html`
- `apps/sigil/chat/index.html`
- `apps/sigil/codex-terminal/index.html` (historical compatibility wrapper for
  Agent Terminal)
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/diagnostics/interaction-trace/index.html`
- `apps/sigil/diagnostics/interaction-trace/index.js`
- `apps/sigil/radial-item-editor/index.html`
- `apps/sigil/radial-item-workbench/index.html`
- `apps/sigil/radial-item-workbench/index.js`
- `apps/sigil/renderer/hit-area.html`
- `apps/sigil/renderer/index.html`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/radial-menu-surface.html`
- retired avatar configuration surface HTML and JS files under the old
  sequestered tree
- `apps/sigil/tests/agent-loader-test.html`
- `apps/sigil/tests/appearance-roundtrip.html`
- `apps/sigil/tests/birthplace-resolver-test.html`
- `apps/sigil/tests/cursor/index.html`
- `apps/sigil/tests/display-geometry/index.html`
- `apps/sigil/tests/input-events/index.html`
- `apps/sigil/tests/mutation/child.html`
- `apps/sigil/tests/mutation/index.html`
- `apps/sigil/tests/session-vitality/index.html`
- `apps/sigil/workbench/index.html`
- `shared/schemas/fixtures/browser-evidence-capture-v0/html/example-careers.html`
- `src/display/autoprojection.swift`
- `src/display/canvas.swift`
- `src/display/protocol.swift`
- `src/perceive/capture-pipeline.swift`
- `manifests/commands/aos-commands.json`
