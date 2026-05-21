# Toolkit Components API

Consumer-facing reference for stock toolkit components and component-adjacent controls: Surface Inspector, Surface-Zoom Inspector, Spatial Telemetry, Render Performance, Object Transform Panel, Test Console, Integration Hub, launch surfaces, control defaults, theme tokens, and Markdown preview presentation.

## Controls

`packages/toolkit/controls/` contains reusable behavior for controls that need to
feel like AOS app controls instead of raw browser defaults. Controls attach to
ordinary semantic HTML and dispatch normal DOM events so panels can remain
domain-specific.

`number-field.js` provides focused wheel and arrow-key stepping for numeric
fields marked with `data-aos-control="number-field"`. It uses the field's
native `step`, `min`, and `max` attributes, dispatches bubbling `input` and
`change` events after a step, uses `Shift` for coarse stepping, and uses
`Option` for fine stepping.

`defaults.css` provides the stock visual control pack for toolkit panels. It is
optional and themeable through CSS custom properties. The first class set covers
buttons, chip buttons, selects, text inputs, number fields, textareas,
checkboxes, toggles, ranges, segmented controls, icon buttons, and selectable
list rows.

```html
<link rel="stylesheet" href="aos://toolkit/components/_base/theme.css">
<link rel="stylesheet" href="aos://toolkit/panel/defaults.css">
<link rel="stylesheet" href="aos://toolkit/controls/defaults.css">
```

## Theme Tokens

`components/_base/theme.css` is the shared visual contract for toolkit surfaces.
Consumers should override these custom properties after importing `theme.css`
instead of copying stock CSS or hardcoding parallel values.

Token groups:

- typography: `--aos-font-ui`, `--aos-font-mono`, `--aos-type-body`,
  `--aos-type-caption`, `--aos-type-label`, `--aos-type-toolbar`,
  `--aos-type-title`, `--aos-type-window-control`, `--aos-type-code`,
  `--aos-type-code-block`, `--aos-type-micro`, `--aos-type-micro-label`,
  and `--aos-type-numeric`
- panel chrome: `--aos-panel-bg`, `--aos-panel-header-bg`,
  `--aos-panel-border`, `--aos-panel-border-subtle`,
  `--aos-panel-radius`, `--aos-panel-shadow`,
  `--aos-panel-titlebar-min-height`,
  `--aos-panel-titlebar-padding-block`,
  `--aos-panel-titlebar-padding-inline`,
  `--aos-panel-titlebar-padding`, `--aos-panel-titlebar-gap`,
  `--aos-panel-control-gap`, and `--aos-panel-grip-color`
- controls: `--aos-control-height`, `--aos-control-padding`,
  `--aos-control-gap`, `--aos-control-radius`, `--aos-control-border`,
  `--aos-control-bg`, `--aos-control-bg-hover`,
  `--aos-control-compact-padding`, `--aos-control-compact-radius`,
  `--aos-control-compact-bg`, `--aos-control-compact-bg-active`,
  `--aos-icon-button-size`, and `--aos-focus-ring`
- window buttons: `--aos-window-button-size`,
  `--aos-window-button-border`, `--aos-window-button-bg`,
  `--aos-window-button-color`, plus hover state tokens for close, minimize,
  and maximize

Legacy aliases such as `--font-ui`, `--font-mono`, `--bg-panel`,
`--border-panel`, `--radius-panel`, and `--shadow-panel` remain available for
older surfaces, but new toolkit CSS should use the `--aos-*` contract.

## Markdown Preview

`markdown/render.js` owns the shared Markdown-to-HTML renderer. Surfaces that
display that rendered HTML should also import `markdown/preview.css` and put the
`aos-markdown-preview` class on their document preview element:

```html
<link rel="stylesheet" href="aos://toolkit/markdown/preview.css">
<article class="aos-markdown-preview">...</article>
```

The stylesheet owns only the document presentation layer: max width, padding,
type scale, heading/list spacing, code blocks, rules, and links. Workbenches
keep their own artifact chrome, panes, toolbars, loading states, semantic refs,
and edit/save affordances.

## HTML File Workbench

`packages/toolkit/components/html-file-workbench/` is the file-backed toolkit
workbench for standalone local `.html` and `.htm` files. It is separate from
`html-workbench-expression`: HTML File Workbench edits durable source files and
previews their current text, while HTML Workbench Expression hosts generated
annotation-ready projections with metadata.

Launch a local file with:

```bash
packages/toolkit/components/html-file-workbench/launch.sh /path/to/demo.html
```

The default canvas id is `html-file-workbench`; set `CANVAS_ID=...` to override
it. The launcher rejects missing files, non-HTML extensions, and files larger
than `AOS_HTML_FILE_WORKBENCH_MAX_BYTES` bytes, defaulting to 1 MiB.

The component accepts:

- `html_file.open` with `{ path, content }`
- `html_file.text.patch` with `{ content }`
- `html_file.save.result`
- `html_file.preview.reload`
- `html_file.revert`

It emits `html-file-workbench/save.requested` with
`{ type: "html_file.save.request", path, content, content_length }`. Agents can
persist the current editor content with:

```bash
packages/toolkit/components/html-file-workbench/save-current.sh html-file-workbench
```

The save helper reads `window.__htmlFileWorkbenchState` through
`./aos show eval`, refuses to create missing targets or save non-HTML paths,
writes UTF-8 text to the target file, and posts `html_file.save.result` back to
the panel so dirty state clears.

The live preview renders `state.previewContent` through an iframe `srcdoc` with
a sandbox that allows same-file scripts and form-style demo interaction but does
not include `allow-same-origin`, so preview scripts cannot directly reach the
workbench shell DOM. Reload Preview explicitly copies editor source into the
iframe; syntax or runtime errors inside the preview do not replace the editor.

Smoke tests can inspect `window.__htmlFileWorkbenchState`, which includes
`path`, `dirty`, `content`, `content_length`, `content_hash`, `preview_mode`,
`preview_revision`, `preview_content_length`, and `last_result`.

## Decision Gate

`aos://toolkit/components/decision-gate/index.html` is the blocking gate
surface used by `aos gate ask`. It resolves through `window.__gateResult` while
the creating process is alive.

`aos://toolkit/components/decision-gate/deferred.html` is the deferred
continuation surface. It accepts `continuation_id` plus `requestB64` query
parameters, renders the same `DecisionGate` controls, submits with the toolkit
`submitGateContinuation()` bridge helper, disables repeated submits while
pending, and leaves accessible terminal status text after success or duplicate
success.

## Surface-Zoom And Test Console Components

## Surface Inspector

Surface Inspector is the developer/admin inspector for live AOS surface
state. It still shows daemon canvases, display placement, object marks, cursor
state, and annotation controls, and it now also exposes toolkit-owned surface
resources under their owning canvas in the tree.

Inspector-visible resources include DesktopWorld stage layers published by the
shared stage, daemon input regions subscribed through `input_region`, and
affordance groups inferred when a stage layer and one or more input regions
share `metadata.toolkit_affordance_id`. Stage layers render as `stage` rows,
input regions render as `region` rows with semantic label and consume policy,
and coupled passive visual/hit-area groups render as `affordance` rows. Rows
carry stable resource data attributes such as `data-resource-type`,
`data-stage-layer-id`, `data-input-region-id`, and `data-affordance-id` for
deterministic tests and future Operator smoke.

`window.__canvasInspectorState.surfaceResources` contains normalized
`stageLayers`, `inputRegions`, `affordances`, and `counts`. The counts include
stage layer, input region, affordance, and stale/suspicious totals. Status
buckets include `active`, `orphaned_owner_missing`,
`stage_layer_without_region`, `region_without_stage_layer`, and
`cleanup_suspect` when they can be inferred from retained snapshots and live
events.

### Surface-Zoom Inspector Proof

`packages/toolkit/components/surface-zoom-inspector/` is the bounded local proof
of the "select a surface, inspect inside that surface, draft annotation" loop.
It loads a Spatial Subject Tree V0 fixture, renders only the outer
DesktopWorld/display/window/canvas/surface rows on the left, treats the selected
surface as a mini-map, draws surface-child node bounds inside that mini-map, and
shows the selected node's path, kind, label, source ids, adapter metadata,
bounds, capabilities, and state.

The proof keeps drafts in local component state. `createAnnotationDraftFromNode`
maps a selected neutral tree node into a structured annotation intent draft with
`actor.role=operator`, `actor.id=surface-zoom-inspector`, `status=draft`,
nearest surface identity, source path/URL when available, best available
coordinate space and bounds, semantic label/role, ancestor chain, selector
candidates, and a placeholder note.

The inspector also bridges Spatial Subject Tree mini-map points into Surface
Hit-Test Inspect V0. `window.surfaceZoomInspector.inspectPoint({ x, y,
coordinate_space })` builds a selected-surface inspect request, converts the
selected surface's child nodes into hit-test candidates, runs the neutral
deepest/most-specific candidate selector, updates `selected_node` from the
selected candidate, stores the full result as `last_inspect`, and creates a
distinct hit-test annotation draft with a Surface Hit-Test Inspect verification
seed when a candidate is selected. Misses keep the normalized candidates and
summary metadata but create no selected candidate, draft, or verification seed.

The launch path is:

```bash
packages/toolkit/components/surface-zoom-inspector/launch.sh
```

The corresponding AOS URL is:

```text
aos://toolkit/components/surface-zoom-inspector/index.html?tree=aos://repo/docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json
```

This component is fixture-only. It does not replace Surface Inspector, harvest
live AX trees, probe browser DOM, run capture/locator/report/export workflows,
or mutate Employer Brand artifacts.

Operator can add annotations without editing the underlying Markdown by using
the sidecar CLI before resume:

```bash
scripts/workbench-human-checkpoint-annotate.mjs \
  --checkpoint checkpoint.json \
  --annotation-file annotations.json \
  --commit \
  --output checkpoint.annotated.json
```

The sidecar file may be either an array of annotation records or an object with
`annotations: [...]`.

Canonical schema:
[`shared/schemas/workbench-human-checkpoint-v0.schema.json`](../../../shared/schemas/workbench-human-checkpoint-v0.schema.json)

CLI helpers:

```bash
scripts/workbench-human-checkpoint-start.mjs --target docs/example.md --output checkpoint.json
scripts/workbench-human-checkpoint-start.mjs --target docs/example.md --attach --canvas-id markdown-workbench
scripts/workbench-human-checkpoint-annotate.mjs --checkpoint checkpoint.json --annotation-json '{"kind":"point_comment","point":{"x":120,"y":80},"note":"Check this spot"}' --output checkpoint.annotated.json
scripts/workbench-human-checkpoint-annotations-push.mjs --checkpoint checkpoint.annotated.json --canvas-id markdown-workbench
scripts/workbench-human-checkpoint-resume.mjs --checkpoint checkpoint.json --behavior draft
scripts/workbench-human-checkpoint-resume.mjs --checkpoint checkpoint.json --behavior save --output resumed.json
scripts/workbench-human-checkpoint-validate.mjs checkpoint.json --require-committed-annotation
```

## Supervised Run Test Console

`packages/toolkit/components/test-console/` provides the V0 human-in-the-loop
console for one supplied Supervised Run step. It is a fixture/supplied-state
toolkit component: it renders operating path, step title, instruction,
expectation, automated-check status, evidence refs, artifact refs, and human
response controls. It accepts `test_console.load` with either a full
`aos.supervised_run` payload under `run` or a direct `step` payload.

The component emits request-shaped events only. Confirm, Fail, Blocked, and Add
note produce `test_console.human_response.captured` with a `response` object and
matching `timeline_event` shaped by `shared/schemas/aos-supervised-run-v0`.
Retry emits `test_console.retry.requested` without starting replay, repair, or
macro playback. Open evidence emits `test_console.evidence.open.requested`
without launching a second evidence viewer.

For the Supervised Run File Bridge V0, the console can also be launched against
a shell harness run directory:

```bash
RUN_DIR=/path/to/supervised-run \
  packages/toolkit/components/test-console/launch.sh
```

In run-dir mode, `launch.sh` reads the harness-owned `state/current-step.json`
and posts a `test_console.load` payload through `aos show post`. After a human
responds in the AOS-hosted console, the scoped bridge helper polls the existing
canvas state with `aos show eval` and appends the captured console event to the
run directory's `response-events.jsonl` queue:

```bash
RUN_DIR=/path/to/supervised-run \
  packages/toolkit/components/test-console/write-response.sh
```

The shell harness remains the single writer for canonical
`supervised.*` timeline events: it consumes the queued console response, writes
`human-responses.jsonl`, advances the current step, and finalizes `run.json`.
This V0 transport is file-backed and toolkit/test-helper scoped; it does not add
a daemon event channel, public `aos test run` command, replay, repair, macro
playback, Work Record mutation, or a second evidence viewer.

Stable AOS semantic refs use the `test-console-v0:*` surface namespace,
including `test-console-v0:response-confirm`, `test-console-v0:response-fail`,
`test-console-v0:response-blocked`, `test-console-v0:response-note`,
`test-console-v0:retry`, and evidence-specific
`test-console-v0:evidence:open:<ref>` refs. These refs are stamped through
`data-aos-ref`, `data-aos-action`, `data-aos-surface`, and
`data-semantic-target-id` so `aos see capture --canvas <id> --xray` can expose
`semantic_targets[].do_target` for `aos do click`.

The v-next direction keeps wiki document Subjects wiki-oriented and represents
domain concepts through separate domain Subjects plus Subject References. For
example, `createWikiPageSubject({ path: "sigil/agents/default.md" })` emits a
wiki document Subject, while `createSigilAgentSubject()` emits the separate
`sigil.agent` domain Subject. The Sigil helper writes that relationship through
top-level `subject_references[]`.

Writer policy is canonical-first for live output. Migrated writers omit
`views[]` and `controls[]`, put only the registry names documented in
`aos-subject-capabilities.md` in raw `capabilities[]`, and put dotted
operation/event strings in top-level `contracts[]` plus Facet-local
`contracts[]` where the operation belongs to one projection. The reader adapter
still accepts older descriptors that have dotted strings in `capabilities[]`
through `subjectContracts(subject)`, but live consumers should derive openable
projections and operations from `facets[]`, `facets[].hosts[]`,
`capabilities[]`, and `contracts[]`.

`deriveWorkbenchSubjectControls(subject)` in
`packages/toolkit/workbench/subject-controls.js` is the V0 pure helper for that
last step. It returns proposed Controls in the stable order `open`, `edit`,
`verify`, `replay`, and `export`, using high-level `capabilities[]` plus
canonical top-level and Facet-local `contracts[]` and `facets[]`. It does not
read legacy `views[]`, legacy `controls[]`, or dotted operation strings left in
raw `capabilities[]`.

`packages/toolkit/workbench/subject-entry-handle.js` is the V0 pure helper for
Subject Entry Handles. It parses the canonical `<facet-key>:<subject-id>` shape
with `parseSubjectEntryHandle(handle)`, validates handles with
`isSubjectEntryHandle(handle)`, extracts parts with
`subjectEntryHandleFacetKey(handle)` and
`subjectEntryHandleSubjectId(handle)`, and formats normalized handles with
`formatSubjectEntryHandle(facetKey, subjectId)` or
`formatSubjectEntryHandle({ facet_key, subject_id })`. The helper is parsing
and formatting only; it does not resolve or open Subjects.

## Stock Components Snapshot

Current reusable toolkit components include:

- `aos://toolkit/components/inspector-panel/index.html` - AX element inspector fed by `aos inspect`
- `aos://toolkit/components/log-console/index.html` - scrolling log console fed by `aos log`
- `aos://toolkit/components/integration-hub/index.html` - provider-neutral chat integration dashboard backed by the local integration broker snapshot API
- `aos://toolkit/components/surface-inspector/index.html` - canvas lifecycle and minimap inspector with optional live cursor and mouse-event overlays
- `aos://toolkit/components/spatial-telemetry/index.html` - live coordinate tables + event log for display, canvas, cursor, and object-mark debugging
- `aos://toolkit/components/render-performance/index.html` - live framerate, frame-time, and coarse renderer telemetry panel
- `aos://toolkit/components/wiki-kb/index.html` - wiki graph browser with Graph and Radial Graph layout modes
- `aos://toolkit/components/wiki-subject-browser/index.html` - Wiki Subject Browser V0 shell that composes Wiki KB and Markdown Workbench into a graph-first subject browser
- `aos://toolkit/components/artifact-bundle-workbench/index.html` - read-only Artifact Bundle Workbench V0 shell for gallery, preview, source, exports, provenance, and validation inspection
- `aos://toolkit/components/playbook-workbench/index.html` - Playbook Workbench V0 shell that gates one saved-evidence browser Playbook simulation and hands off the emitted Work Record read-only
- `aos://toolkit/components/object-transform-panel/index.html` - addressable canvas object transform editor for position/scale/rotation triplets
- `aos://toolkit/components/markdown-workbench/index.html` - Markdown source editor, rendered preview, outline, diagnostics, and explicit save handoff
- `aos://toolkit/components/desktop-world-stage/index.html` - shared click-through DesktopWorld visual stage for non-interactive layers such as transfer outlines

### Inline Canvas Stats

Every AOS WKWebView canvas receives a per-canvas `window.aosStats` controller at
document start. The controller is inert by default: it does not create DOM, run a
frame loop, or load `stats.js` until a consumer or agent enables it. When enabled,
it lazy-loads the vendored `stats.js` module from
`aos://toolkit/runtime/canvas-stats.js` and appends the stats overlay inside that
canvas only.

Agents can toggle a live canvas with eval:

```sh
./aos show eval --id my-canvas --js 'window.aosStats.toggle({ panel: 0 })'
```

Consumer code can use automatic sampling:

```js
window.aosStats.enable({ panel: 0, position: 'top-right' })
```

Or exact inline measurement around a render section:

```js
window.aosStats.enable({ panel: 1, mode: 'manual' })

function animate() {
  window.aosStats.begin()
  renderer.render(scene, camera)
  window.aosStats.end()
  requestAnimationFrame(animate)
}
```

Useful controller methods include `enable(options)`, `disable()`,
`toggle(options)`, `configure(options)`, `begin()`, `end()`, `update()`,
`showPanel(index)`, `load()`, and `status()`. `status()` includes the latest
readback sample as `{ frameMs, fps, ts, mode }` once sampling has started, which
lets agents compare inline stats against toolkit performance panels without
screen-scraping the stats canvas.

### Render Performance

`render-performance` is a reusable real-time performance panel for canvases and
renderer-heavy surfaces. Standalone, it samples its own `requestAnimationFrame`
loop and reports live FPS, frame time, P95 frame time, max frame time, over-budget
percentage, long frames, estimated dropped frames, device pixel ratio, viewport,
visibility, and JavaScript heap telemetry when the browser exposes it.

Renderer consumers can feed app-side samples through the component channel:

```json
{
  "type": "render-performance/sample",
  "payload": {
    "source": "sigil-avatar",
    "frameMs": 16.7,
    "renderMs": 5.4,
    "updateMs": 2.1,
    "gpuMs": 6.8,
    "drawCalls": 28,
    "triangles": 1840,
    "geometries": 12,
    "textures": 4
  }
}
```

Accepted message types:

- `render-performance/sample`, `render-performance/frame`, and
  `render-performance/metrics` append a renderer sample. Common aliases such as
  `fps`, `deltaMs`, `dt`, `duration`, and `calls` are normalized.
- `render-performance/mark` appends an operator-visible render event, for
  example `{ "type": "shader", "text": "fallback path active" }`.
- `render-performance/target_fps` changes the frame budget used for
  classification.
- `render-performance/reset` clears samples and marks.

### Integration Hub

`integration-hub` is the reusable operator surface for chat-driven broker work.

It polls a local broker HTTP endpoint (default `http://127.0.0.1:47231`) and
renders four shared surfaces from the broker snapshot:

- `jobs`
- `workflows`
- `integrations`
- `activity`

The component assumes the snapshot schema documented at:

- [`shared/schemas/integration-broker-snapshot.md`](../../../shared/schemas/integration-broker-snapshot.md)

Current behavior:

- shows provider status for Slack and future transports such as Discord
- shows the workflow catalog exposed through chat providers
- shows recent execution history with broker job IDs
- exposes a local simulation console that posts to `POST /api/integrations/simulate`

Consumer override:

- pass `IntegrationHub({ brokerUrl: 'http://127.0.0.1:48200' })` when the
  broker is not on the default port

`wiki-kb` accepts a graph snapshot on `wiki-kb/graph` (and tolerates raw
`wiki/graph` messages for imported-prototype compatibility). Canonical payload:

```json
{
  "nodes": [
    { "id": "alpha", "name": "Alpha", "type": "entity", "description": "..." }
  ],
  "links": [
    { "source": "alpha", "target": "beta" }
  ],
  "raw": {
    "alpha": "# Alpha\n\nMarkdown body"
  },
  "config": {
    "graphView": {
      "controls": { "collapsed": false },
      "defaults": {
        "mode": "local",
        "depth": 2,
        "labelMode": "selection",
        "showIsolated": true,
        "highlightNeighbors": true,
        "activeTypes": ["entity", "concept"]
      }
    }
  }
}
```

Graph `nodes[].type` is a wiki page kind for graph layout legends. It is
intentionally separate from Workbench Subject `subject_type`.
The V0 page-kind vocabulary is `page`, `concept`, `entity`, `workflow`, and
`reference`; incoming compatibility payloads normalize legacy `agent` to
`entity` and plugin reference pages to `reference` before deriving available
types or legend entries.

Incremental updates go to `wiki-kb/graph/update` and may include:

- `nodes`, `links`, `raw` for upserts
- `removeNodes`, `removeLinks`, `removeRaw` for targeted removals
- `replace`, `replaceLinks`, `clearRaw` for reset-style updates
- `config.graphView` to update Graph layout defaults and feature flags

Additional semantic intents:

- `wiki-kb/reveal` with `{ id | path | name, layoutMode?, openSidebar?, focus? }`
- `wiki-kb/clear-selection`
- `wiki-kb/set-layout-mode` with `{ layoutMode }`
- `wiki-kb/fit-layout`

Current emitted semantic event:

- `wiki-kb/selection` with `{ id, path, name, type, tags, plugin }` or `null`

`config.graphView` is intentionally generic rather than app-specific. Current
consumer-facing fields:

- `controls.enabled` / `controls.collapsed`
- `features.search`, `features.types`, `features.tags`, `features.scope`, `features.depth`, `features.labels`, `features.isolated`, `features.neighbors`, `features.path`, `features.freeze`, `features.focus`, `features.fit`, `features.reset`, `features.legend`
- `defaults.mode` (`global` or `local`)
- `defaults.depth`
- `defaults.labelMode` (`all`, `selection`, or `hover`)
- `defaults.showIsolated`
- `defaults.highlightNeighbors`
- `defaults.frozen`
- `defaults.activeTypes`
- `defaults.activeTags`
- `defaults.searchQuery`
- `defaults.tagMatchMode` (`any` or `all`)
- `limits.minDepth` / `limits.maxDepth`

### Markdown Workbench

`markdown-workbench` is the first file-backed Markdown editing surface. It owns
the in-canvas edit state and renders a source pane, rendered preview, outline,
and diagnostics. The canvas does not write files directly. Pressing Save emits a
structured handoff so an agent, app, or future persistence adapter can write the
accepted content to the correct source of truth.

Launch the sample or a repo file:

```bash
packages/toolkit/components/markdown-workbench/launch.sh
packages/toolkit/components/markdown-workbench/launch.sh docs/design/aos-workbench-pattern.md
packages/toolkit/components/markdown-workbench/launch.sh wiki:aos/concepts/runtime-modes.md
```

Persist the current canvas state from an agent shell:

```bash
packages/toolkit/components/markdown-workbench/save-current.sh markdown-workbench
```

Accepted messages:

- `markdown_document.open` with `{ path, content }` replaces the current subject
  and clears dirty state. Wiki-backed opens may include
  `{ source: { kind: "wiki", path, page? } }`.
- `markdown_document.text.patch` with `{ patch: { content } }` replaces the
  editable source and recomputes preview/diagnostics.
- `markdown_document.save.result` with `{ status: "saved" | "rejected",
  message? }` acknowledges a previous save request. `saved` clears dirty state.

Save requests are emitted as `markdown-workbench/save.requested` with payload:

```json
{
  "type": "markdown_document.save.requested",
  "schema_version": "2026-05-03",
  "request_id": "markdown-save-example",
  "subject": {
    "type": "aos.workbench.subject",
    "schema_version": "2026-05-03",
    "id": "file:docs/example.md",
    "subject_type": "markdown.document",
    "label": "example.md",
    "owner": "markdown-workbench"
  },
  "path": "docs/example.md",
  "content": "# Example\n\nUpdated body",
  "diagnostics": {
    "line_count": 3,
    "word_count": 3,
    "heading_count": 1,
    "headings": [{ "depth": 1, "text": "Example", "line": 1 }],
    "mermaid_blocks": [],
    "unclosed_fence": false
  }
}
```

Current renderer support is intentionally small: frontmatter is skipped,
headings up to depth 3 render, lists render, inline code/bold/emphasis render,
and unsafe links are stripped. Mermaid fences render as constrained diagram
containers with escaped source preserved in `data-mermaid-source`, so Markdown
Workbench and Artifact Bundle previews can show diagram content safely without
depending on a global Mermaid runtime.

`save-current.sh` persists file-backed documents by writing the source file and
wiki-backed documents by PUT-ing to the local wiki content server. The canvas
still only emits save requests; the helper performs the privileged write and
posts `markdown_document.save.result` back to the canvas.

When enabled, the graph controls can also expose:

- configurable label density (`all`, `selection`, `hover`)
- one-hop neighbor highlighting around the current selection or hover target
- shortest-path highlighting between a saved path start and the current selection
- selection focus actions that fit the selected node plus its current highlight context

### Surface Inspector — Annotation Layer And Object Marks

The user-facing inspector surface is now **Surface Inspector**. The stable
component id, manifest name, and route use `surface-inspector`. The see-bundle
configuration namespace remains `see.canvas_inspector_bundle.*`.

Surface Inspector exposes an explicit Annotation Mode for ephemeral human
annotations over controlled AOS surfaces. Normal inspector use shows the tree
and minimap without annotation overlays. Annotation Mode can be toggled from
the lower tree control row, from the status-item `Annotation Mode` menu item, or
with the daemon-owned `ctrl+opt+a` shortcut. Turning Annotation Mode off clears
in-memory frame anchors/comments after confirmation when annotations exist.

The live annotation snapshot carried in `window.__canvasInspectorState.annotation`
uses `schema: "surface_inspector_annotation_state"` and includes
`annotation_mode.active`, `active_edge_id`, `active_frame_id`, `pins[]`
(the internal payload field for frame anchors),
`comments[]`, `projection_capabilities[]`, `last_hover_candidate`,
`last_projection_blocker`, and `snapshot_version`. Frame anchors store subject identity
and adapter projection metadata, not presentation-only inset geometry. V0
projects controlled AOS canvas/window geometry; macOS AX, Chrome seam, generic
DOM, and 3D/canvas adapters report unsupported/planned states until dedicated
adapters land.

In Annotation Mode, the minimap is passive abstract geometry only. It renders
the base surface geometry plus active frame-path rectangles and comment markers;
it does not render add-comment or frame-anchor controls, hover target buttons, or
object marks that could be mistaken for annotation targets. When the controlled
AOS canvas/window adapter can prove a current visible rect, Surface Inspector
uses the owning canvas as a documented V0 action-control helper: it renders
toolkit-styled add-comment and frame-anchor affordances inside the
perimeter-only frame-candidate overlay and exposes their projected helper state
in `window.__canvasInspectorState.annotationActionControlHelperState`. The true
tiny child-canvas path is deferred until canvas mutation/eval remains stable
while those child controls are present. When projection is unavailable, Surface
Inspector exposes explicit tree/list actions for the selected frame anchor
instead.

`ctrl+opt+c` see bundles include a first-class public
`annotation-snapshot.json` artifact using
`schema: "surface_inspector_annotation_snapshot"` and `version: "0.1.0"`.
The artifact is distinct from the raw debug state and is derived through the
shared display-first `aos_annotation_session` boundary. It records capture
metadata, entry source, active root/scope context, committed and preview scope
stacks, hover candidate as preview evidence only, live frame anchors with
optional comments, projection and reveal proof, stale/blocker evidence, adapter
capability summaries, explicit blockers, successful snapshot count, and
bundle-relative asset references. It is written even when Annotation Mode is
inactive or empty, with `empty_state=true`. Image data is not embedded in
annotation JSON.

### Surface Inspector — Object Marks

Consumer canvases can publish ephemeral "object marks" that the
Surface Inspector renders on its minimap and in the tree list beneath the
parent canvas. Marks represent sub-canvas objects whose position you want to
surface (e.g. Sigil's avatar, a hit-test target, a highlighted widget).

**Wire contract** — a `canvas_object.marks` event with a full-snapshot
replace payload:

```json
{
  "type": "canvas_object.marks",
  "payload": {
    "canvas_id": "avatar-main",
    "objects": [
      {
        "id": "avatar",
        "x": 942,
        "y": 540,
        "name": "Avatar",
        "color": "#ff66cc",
        "w": 20,
        "h": 20,
        "rect": true,
        "ellipse": true,
        "cross": true
      }
    ]
  }
}
```

Required fields: `id`, `x`, `y`. `x` and `y` are DesktopWorld coordinates,
not local canvas coordinates; they use the same desktop CG space as
`canvas.at`. Optional fields:

- `name` — display label (defaults to `id`)
- `color` — stroke color for the marker (defaults to a stable hash of `id`)
- `w`, `h` — marker-local logical units (default `20`, clamped to
  `[4, 128]`). By default these are minimap-local logical pixels for stable
  fixed-size markers.
- `minimapSizeMode` — size interpretation for `w`/`h`:
  - `"minimap"` (default) keeps `w`/`h` fixed in mini-map pixels. Use this for
    points, cursors, debug pings, object centers, and other marks that should
    remain visually stable as the minimap scale changes.
  - `"desktop_world"` treats `w`/`h` as DesktopWorld dimensions and projects
    them by the current mini-map scale. Use this for hit boxes, radial target
    extents, child surface bounds, or any mark meant to show geographic size.
  Accepted wire aliases are `minimapSizeMode`, `minimap_size_mode`, `sizeMode`,
  and `size_mode`; new producers should prefer `minimapSizeMode`.
- `rect`, `ellipse`, `cross` — boolean primitive toggles (default `true`
  each). The default marker is a `20 × 20` square outline with an inscribed
  ellipse and a corner-to-corner `X`. Any combination is valid; set a
  primitive to `false` to omit that layer.

Snapshot semantics:

- Each emit fully replaces the mark list for `canvas_id`. Omit a previously
  published mark and it disappears on the next emit.
- `"objects": []` drops the canvas entry outright.
- An entry is also evicted when the parent canvas emits
  `canvas_lifecycle action: "removed"`.
- If a canvas stops emitting, its entry expires after a 10 s TTL.

Emit patterns:

- **Event-driven** — post on position/visibility changes. The inspector
  applies snapshots idempotently, so duplicate emits are cheap.
- **Low-rate heartbeat (optional)** — if you want marks to survive a long
  idle period for late-joining inspectors, emit every ~5 s while visible.
  Avoid an always-on high-rate heartbeat.

Subscribe side is handled for you — Surface Inspector subscribes to
`canvas_object.marks` via its manifest. Any canvas that subscribes will
receive the daemon's fan-out.

### Addressable Canvas Object Control

`canvas_object.registry`, `canvas_object.transform.patch`,
`canvas_object.transform.result`, `canvas_object.effects.patch`, and
`canvas_object.effects.result` define the addressable object control contract
for reusable transform/effect editors. This is a control contract, not a
replacement for `canvas_object.marks`: marks are visual/debug telemetry, while
registry, transform, and effect messages describe objects that a canvas owner
explicitly exposes for remote control.

The schema source of truth is
[`shared/schemas/canvas-object-control.schema.json`](../../../shared/schemas/canvas-object-control.schema.json)
and the reference narrative is
[`shared/schemas/canvas-object-control.md`](../../../shared/schemas/canvas-object-control.md).

Addresses use `canvas_id + object_id`:

```json
{
  "canvas_id": "avatar-main",
  "object_id": "radial.wiki-brain.tree"
}
```

Sigil's wiki-brain adopter currently exposes a group object for the whole menu
item composition plus the outer shell, a nested fiber-optics group, the
fiber-optic stem, fiber-optic bloom, and fractal tree layers as separate
objects. Transform controllers can tune the whole composition relative to the
radial menu item orbit path or tune each layer independently.

Those object ids are registry resources under the owning canvas/menu subject,
not wiki graph nodes by default. A workbench or subject browser should route to
them through Facets and resource paths such as a radial menu `object-controls`
Facet unless a separate durable source document or domain subject explicitly
owns the object.

Registry snapshots are retained-state messages. A canvas owner publishes a full
replacement list of addressable objects with current transform values, units,
parent links, optional natural-language descriptors, optional JSON-declared
effect controls, and capabilities:

```json
{
  "type": "canvas_object.registry",
  "schema_version": "2026-05-03",
  "canvas_id": "avatar-main",
  "objects": [
    {
      "object_id": "radial.wiki-brain.group",
      "name": "Wiki Brain",
      "kind": "three.object3d",
      "capabilities": ["transform.read", "transform.patch", "visibility.read", "visibility.patch"],
      "transform": {
        "position": { "x": 0, "y": 0, "z": 0 },
        "scale": { "x": 1, "y": 1, "z": 1 },
        "rotation_degrees": { "x": 0, "y": 0, "z": 0 }
      },
      "units": {
        "position": "scene",
        "scale": "multiplier",
        "rotation": "degrees"
      },
      "visible": true,
      "descriptors": {
        "geometry": "Complete wiki-graph menu item composition made from shell, fiber, and fractal-tree layers.",
        "animation_effects": "Whole composition scales and reveals against the radial menu item orbit path."
      },
      "metadata": {
        "role": "group",
        "target": "item-composition",
        "frame": "radial-item-orbit"
      }
    },
    {
      "object_id": "radial.wiki-brain.fractal-tree",
      "parent_object_id": "radial.wiki-brain.group",
      "name": "Fractal Tree",
      "kind": "three.object3d",
      "capabilities": ["transform.read", "transform.patch", "visibility.read", "visibility.patch", "effects.read", "effects.patch"],
      "transform": {
        "position": { "x": 0.008, "y": -0.018, "z": 0.012 },
        "scale": { "x": 1.26, "y": 1.34, "z": 1.16 },
        "rotation_degrees": { "x": -9, "y": 0, "z": 0 }
      },
      "units": {
        "position": "scene",
        "scale": "multiplier",
        "rotation": "degrees"
      },
      "visible": true,
      "descriptors": {
        "geometry": "Recursive neural tree nested inside the glass brain shell.",
        "animation_effects": "Tree growth, glow, and branch-travel particles react to reveal pressure."
      },
      "controls": {
        "animation_effects": [
          {
            "id": "fractalPulse.intensity",
            "label": "Tree pulse",
            "type": "range",
            "value": 1,
            "min": 0,
            "max": 3,
            "step": 0.05,
            "tooltip": "Scale branch-travel particle pulse intensity"
          }
        ]
      }
    }
  ]
}
```

Effect patches are commands for JSON-declared controls. Controllers send changed
control values by id and correlate the owner response by `request_id`:

```json
{
  "type": "canvas_object.effects.patch",
  "schema_version": "2026-05-03",
  "request_id": "req-effects-42",
  "target": {
    "canvas_id": "avatar-main",
    "object_id": "radial.wiki-brain.fractal-tree"
  },
  "patch": {
    "controls": {
      "fractalPulse.intensity": 1.35
    }
  }
}
```

Transform patches are commands. Controllers send a partial transform update to
one addressed object and correlate the owner response by `request_id`:

```json
{
  "type": "canvas_object.transform.patch",
  "schema_version": "2026-05-03",
  "request_id": "req-42",
  "target": {
    "canvas_id": "avatar-main",
    "object_id": "radial.wiki-brain.tree"
  },
  "patch": {
    "scale": { "x": 1.4, "y": 1.5, "z": 1.25 }
  }
}
```

V0 routing uses existing AOS canvas plumbing:

- owners emit registry snapshots through toolkit `emit()` and daemon fan-out to
  canvases subscribed to `canvas_object.registry`
- transform editors subscribe through toolkit `subscribe()`
- transform/effects patches are delivered to the owning `canvas_id` with existing
  canvas message delivery
- owner results are direct replies or subscribed result messages, depending on
  the controller surface

Keep bus-shaped discipline at this boundary: typed messages, structured
addresses, separate state snapshots from commands, and include `request_id` for
mutating requests. Do not introduce a general AOS bus for this contract.

### Object Transform Panel

`object-transform-panel` is the reusable controller for the addressable canvas
object control contract. It subscribes to `canvas_object.registry` and
`canvas_object.transform.result`/`canvas_object.effects.result`, renders
advertised objects by `canvas_id + object_id`, and emits transform, visibility,
and JSON-declared effect edits through existing `canvas.send` routing to the
owning canvas. The panel does not inspect another canvas or assume the object is
backed by Three.js.

The object list is intentionally layer-like: rows represent the addressable
objects that collectively make up a larger visual composition. A group object
uses `metadata.role = "group"` and child objects use `parent_object_id` to form
a nested list. The checkbox is the object's advertised visibility; group rows
can show a mixed visual state when child visibility is split. The editor pane
also exposes optional local natural-language descriptors for geometry and
animation/effects. The animation/effects area has three views: natural-language
description, editable JSON control definitions, and a rendered mini-form driven
by that JSON. Single-object transform editing is the current behavior.
Multi-select, grouped edits over arbitrary subsets, and dockable/collapsible
object-list panes belong to the split-pane/docking surface layer rather than
the control contract itself.

Default launcher:

```bash
bash packages/toolkit/components/object-transform-panel/launch.sh
```

Machine-readable state is exposed for agents via:

```bash
./aos show eval --id object-transform-panel \
  --js 'JSON.stringify(window.__objectTransformPanelState)'
```

The inspector's minimap cursor is operator-toggleable and starts hidden by
default. Turning it on subscribes to `input_event` on demand and requests a
snapshot so the current cursor dot appears immediately instead of waiting for
the next mouse move.

The inspector also exposes a separate `mouse events` toggle directly beneath
`minimap cursor`. It shares the same on-demand `input_event` subscription but
renders gesture overlays instead of the live cursor dot: left-button hold and
drag origin markers, drag lines, release collapse/fade, left-click expanding
circle pulses, `Esc` cancel collapse back to origin, and right-click expanding
square pulses.

The inspector also supports a daemon-owned global export hotkey:
`ctrl+opt+c`. When `surface-inspector` exists, that combo captures a
point-in-time see bundle without relying on mouse interaction. The daemon
writes a temp bundle directory containing:

- `capture.png` — a `see capture --region <inspector-at-trigger> --perception` image
- `capture.json` — the capture response metadata
- `annotation-snapshot.json` — the public point-in-time Annotation Mode artifact
- `inspector-state.json` — the surface's live JS/debug snapshot
- `display-geometry.json` — the daemon display snapshot at export time
- `canvas-list.json` — the daemon canvas list at export time
- `bundle.json` — manifest/status for the bundle

The bundle directory path is copied to the system clipboard, and the inspector
status bar reflects pending/success/error state for the export.

That export is configured under the daemon-owned `see` subtree rather than in
Sigil or toolkit-local settings:

```bash
aos config get see.canvas_inspector_bundle --json
aos config set see.canvas_inspector_bundle.hotkey cmd+shift+x
aos config set see.canvas_inspector_bundle.output.mode clipboard_payload
aos config set see.canvas_inspector_bundle.include.annotation_snapshot false
aos config set see.canvas_inspector_bundle.include.canvas_list false
aos config set see.canvas_inspector_bundle.include.xray true
```

`see.canvas_inspector_bundle.output.mode` defaults to `bundle_path`. In that
mode the daemon preserves the existing temp bundle directory contract and copies
the directory path to the system clipboard. The alternate `clipboard_payload`
mode does not create a temp bundle directory for the export; it copies a JSON
payload with `kind: "canvas_inspector_see_bundle_clipboard_payload"`, status,
timestamp, trigger, shortcut, source canvas id, resolved include toggles,
inline inspector/display/canvas-list data when those toggles are enabled, and
the public `surface_inspector_annotation_snapshot` payload when
`include.annotation_snapshot=true`. Capture image, capture metadata, and xray
artifacts are represented as skipped or disabled evidence in clipboard mode
instead of embedding image binary, base64, or `data:image/...` values in JSON.
The status bar shows whether the shortcut will copy a bundle path or JSON
payload.

Supported include toggles today:

- `capture_image`
- `capture_metadata`
- `annotation_snapshot`
- `inspector_state`
- `display_geometry`
- `canvas_list`
- `xray`

`xray` writes an additional `xray.json` artifact containing the AX-derived
element list from `aos see capture --xray`. Canvas-id captures can also include
`semantic_targets`, the fixed AOS projection of toolkit-stamped DOM/AX/ARIA
target metadata. Current region-based inspector bundle exports remain AX-only
unless their runner switches to `--canvas <id>`. This config shape is
intentionally under `see` so future `see` bundle/record presets can grow beside
the current inspector export path instead of being trapped in inspector-only
settings.

### Spatial Telemetry

`spatial-telemetry` is the permanent coordinate-debug surface for multi-display
work. It keeps all of these live streams subscribed all the time:

- `display_geometry`
- `canvas_lifecycle`
- `input_event`
- `canvas_object.marks`

It renders live tables for:

- union bounds
- per-display bounds + visible bounds
- canvas rects in global, union-local, and per-display-local coordinates
- mark points in global, union-local, canvas-local, and per-display-local coordinates
- cursor position in global, union-local, and per-display-local coordinates
- a rolling event log so geometry changes can be correlated with the raw event stream

Default launcher:

```bash
bash packages/toolkit/components/spatial-telemetry/launch.sh
```

Standard display-debug battery:

```bash
bash tests/display-debug-battery.sh
```

Machine-readable state is exposed for agents via:

```bash
./aos show eval --id spatial-telemetry \
  --js 'JSON.stringify(window.__spatialTelemetryState?.snapshot)'
```
