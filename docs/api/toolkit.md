# Toolkit API

Consumer-facing reference for `packages/toolkit`.

Use this doc when you are:

- building a canvas surface that runs inside `aos`
- composing reusable toolkit content
- reviewing changes to runtime, panel, or content contracts

For broader architecture, see [packages/toolkit/CLAUDE.md](../../packages/toolkit/CLAUDE.md).

## What The Toolkit Is

The toolkit is the reusable web layer for `aos` canvases.

It is split into three layers:

| Layer | Path | Purpose |
| --- | --- | --- |
| Runtime | `packages/toolkit/runtime/` | bridge, subscriptions, canvas mutation helpers, manifest handshake |
| Controls | `packages/toolkit/controls/` | reusable app-control behavior for WKWebView surfaces |
| Panel | `packages/toolkit/panel/` | structure and composition primitives (`mountPanel`, `Single`, `Tabs`) |
| Workbench | `packages/toolkit/workbench/` | shared subject descriptors, workbench contracts, and stock workbench shell styling |
| Components | `packages/toolkit/components/` | reusable content units and optional stock styles |

### DesktopWorld Surface Runtime

`packages/toolkit/runtime/desktop-world-surface.js` provides
`DesktopWorldSurfaceAdapter`, the base adapter for canvases whose contract is
"draw across DesktopWorld." One adapter instance runs in each display segment
web view. The adapter consumes `canvas_topology_settled`, elects primary from
`segment.index === 0`, and exposes `runOnPrimary(fn)` so apps can gate
once-per-surface side effects.

`packages/toolkit/runtime/desktop-world-surface-2d.js` provides
`DesktopWorldSurface2D`, a DOM/Canvas2D helper that identifies its segment from
`window.__aosSegmentDisplayId` and applies the DesktopWorld origin translation
to a local root node.

`packages/toolkit/runtime/desktop-world-surface-three.js` provides
`DesktopWorldSurfaceThree` / `DesktopWorldSurface3D`, segment-carved
orthographic camera helpers, and a BroadcastChannel-backed state replication
hook for Three.js consumers.

The stock shared stage lives at
`aos://toolkit/components/desktop-world-stage/index.html`. It should be launched
as `--surface desktop-world` and stays non-interactive. Consumers update it with
`canvas.send` messages:

```json
{
  "type": "desktop_world_stage.layer.upsert",
  "payload": {
    "id": "panel-transfer-outline",
    "kind": "outline",
    "frame": [1920, 64, 720, 520],
    "label": "Move here"
  }
}
```

Accepted stage messages are `desktop_world_stage.layer.upsert`,
`desktop_world_stage.layer.remove`, `desktop_world_stage.layers.replace`, and
`desktop_world_stage.clear`.

## Import / Hosting Model

Toolkit files are normally served through the AOS content server:

```bash
aos set content.roots.toolkit packages/toolkit
```

Then a canvas can load:

```bash
aos show create \
  --id my-panel \
  --at 100,100,320,220 \
  --interactive \
  --url 'aos://toolkit/components/inspector-panel/index.html'
```

Within toolkit HTML, imports typically use relative module paths.

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

## Workbench Contracts

Workbench surfaces should describe the thing being edited with
`aos.workbench.subject`. The descriptor is intentionally small: it names stable
identity, subject type, owner, source, capabilities, views, controls,
persistence, artifacts, and current state. It does not move domain ownership
into the toolkit.

`workbench/defaults.css` provides the stock dual-pane workbench shell used when
a surface needs a rich preview/editor composition instead of a plain panel body.
It covers the draggable titlebar, grip, optional window-action strip, workbench
toolbar, pane toolbar, stage action strip, preview pane, controls pane, pane
title, form band, and scrollable work area. Domain editors still own their
subject model and renderer; the shell only normalizes the frame.

```html
<link rel="stylesheet" href="aos://toolkit/components/_base/theme.css">
<link rel="stylesheet" href="aos://toolkit/workbench/defaults.css">
<link rel="stylesheet" href="aos://toolkit/controls/defaults.css">
```

Canonical schema:
[`shared/schemas/aos-workbench-subject.schema.json`](../../shared/schemas/aos-workbench-subject.schema.json)

Create descriptors with:

```js
import { createWorkbenchSubject } from '../workbench/subject.js'
```

Wiki pages can be projected from `aos wiki list/show --json` shapes with:

```js
import { createWikiPageSubject } from '../workbench/wiki-subject.js'
```

Design-stage work records can be projected from schema-shaped work-record
objects with:

```js
import { createWorkRecordSubject } from '../workbench/work-record-subject.js'
```

Wiki workflow maps can be projected into a chain descriptor without creating a
workflow engine:

```js
import { createWikiWorkflowSubject } from '../workbench/workflow-subject.js'
```

The current schema version is `2026-05-03`. The first adopters are:

- Sigil radial item editor subjects: `sigil.radial_menu.item_3d`
- Markdown workbench subjects: `markdown.document`
- Wiki page subjects: `wiki.concept`, `wiki.entity`, `wiki.workflow`,
  `wiki.reference`, and `sigil.agent`
- Workflow chain subjects: `wiki.workflow_chain`
- Work-record subjects: `aos.do_step` and `aos.recipe_health_event`

Subject descriptors are included in lock-in/save handoff payloads so agents,
apps, and future workbench shells can reason about different editors using one
vocabulary.

Wiki subject ids use `wiki:<path>`, for example
`wiki:aos/concepts/runtime-modes.md`. Their source uses `{ kind: "wiki", path,
namespace, plugin }`, and their persistence route is the wiki write/change-event
handoff rather than direct canvas filesystem access.

Workflow chain subjects use `workflow:<root-wiki-path>`. They project a wiki
workflow page or concept workflow map into ordered steps, child workflow refs,
artifact refs, outputs, approval-gate placeholders, and validation state. The
first projection reads the employer-brand workflow map's stage-contract table
and resolves linked wiki pages into `wiki:<path>` child subjects. This is a
view/model contract only: invocation stays with existing `aos wiki invoke` or
agent-driven workflow instructions, and run/evidence/repair layers attach later
through the work-record model.

Work-record subject ids use `work-record:<id>`. They expose the natural-language
intent, execution map, evidence artifacts, and health state as workbench views.
The helper is a projection layer only; recording, replay, repair, and retirement
remain owned by the work-record model in
[`docs/design/aos-work-records-and-self-healing-recipes.md`](../design/aos-work-records-and-self-healing-recipes.md).

The stock work-record workbench lives at:

- `aos://toolkit/components/work-record-workbench/index.html`

It accepts `work_record.open` and `work_record.patch.result`, emits
`work-record-workbench/patch.requested`, and intentionally stays manual-first:
it edits the NL intent and execution-map JSON while displaying health and
evidence. `work_record.open` may include a file `source`, which is preserved in
snapshots and patch requests. The companion
`packages/toolkit/components/work-record-workbench/save-current.sh` helper can
persist the current edited record JSON back to that file source or an explicit
output path. It does not record, replay, repair, or retire recipes by itself.

## Stock Components Snapshot

Current reusable toolkit components include:

- `aos://toolkit/components/inspector-panel/index.html` - AX element inspector fed by `aos inspect`
- `aos://toolkit/components/log-console/index.html` - scrolling log console fed by `aos log`
- `aos://toolkit/components/integration-hub/index.html` - provider-neutral chat integration dashboard backed by the local integration broker snapshot API
- `aos://toolkit/components/canvas-inspector/index.html` - canvas lifecycle and minimap inspector with optional live cursor and mouse-event overlays
- `aos://toolkit/components/spatial-telemetry/index.html` - live coordinate tables + event log for display, canvas, cursor, and object-mark debugging
- `aos://toolkit/components/render-performance/index.html` - live framerate, frame-time, and coarse renderer telemetry panel
- `aos://toolkit/components/wiki-kb/index.html` - wiki graph browser with force-graph and mind-map views
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

- [`shared/schemas/integration-broker-snapshot.md`](../../shared/schemas/integration-broker-snapshot.md)

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

Incremental updates go to `wiki-kb/graph/update` and may include:

- `nodes`, `links`, `raw` for upserts
- `removeNodes`, `removeLinks`, `removeRaw` for targeted removals
- `replace`, `replaceLinks`, `clearRaw` for reset-style updates
- `config.graphView` to update graph-view defaults and feature flags

Additional semantic intents:

- `wiki-kb/reveal` with `{ id | path | name, view?, openSidebar?, focus? }`
- `wiki-kb/clear-selection`
- `wiki-kb/set-view` with `{ view }`

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
and unsafe links are stripped. Mermaid fences are detected for diagnostics but
not rendered yet.

`save-current.sh` persists file-backed documents by writing the source file and
wiki-backed documents by PUT-ing to the local wiki content server. The canvas
still only emits save requests; the helper performs the privileged write and
posts `markdown_document.save.result` back to the canvas.

When enabled, the graph controls can also expose:

- configurable label density (`all`, `selection`, `hover`)
- one-hop neighbor highlighting around the current selection or hover target
- shortest-path highlighting between a saved path start and the current selection
- selection focus actions that fit the selected node plus its current highlight context

### Canvas Inspector — Object Marks

Consumer canvases can publish ephemeral "object marks" that the
`canvas-inspector` renders on its minimap and in the tree list beneath the
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

Required fields: `id`, `x`, `y`. `x` and `y` are in desktop CG coordinates,
the same space as `canvas.at`. Optional fields:

- `name` — display label (defaults to `id`)
- `color` — stroke color for the marker (defaults to a stable hash of `id`)
- `w`, `h` — marker-local logical units in minimap pixels (default `20`,
  clamped to `[4, 128]`). Stable visual size regardless of display DPI.
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

Subscribe side is handled for you — the canvas-inspector subscribes to
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
[`shared/schemas/canvas-object-control.schema.json`](../../shared/schemas/canvas-object-control.schema.json)
and the reference narrative is
[`shared/schemas/canvas-object-control.md`](../../shared/schemas/canvas-object-control.md).

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
`ctrl+opt+c`. When `canvas-inspector` exists, that combo captures a
point-in-time see bundle without relying on mouse interaction. The daemon
writes a temp bundle directory containing:

- `capture.png` — a `see capture --region <inspector-at-trigger> --perception` image
- `capture.json` — the capture response metadata
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
aos config set see.canvas_inspector_bundle.include.canvas_list false
aos config set see.canvas_inspector_bundle.include.xray true
```

Supported include toggles today:

- `capture_image`
- `capture_metadata`
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

## Runtime API

Convenience re-export:

```js
import {
  wireBridge,
  emit,
  esc,
  subscribe,
  unsubscribe,
  spawnChild,
  mutateSelf,
  removeSelf,
  setInteractive,
  evalCanvas,
  move,
  declareManifest,
  emitReady,
  emitLifecycleComplete,
  onReady,
} from 'aos://toolkit/runtime/index.js'
```

### `wireBridge(handler)`

Installs an inbound message handler for daemon-to-canvas messages.

```js
wireBridge((msg) => {
  if (msg.type === 'hello') console.log(msg.payload)
})
```

Notes:

- safe to call more than once
- each handler is retained and invoked for every inbound message
- inbound messages arrive through `window.headsup.receive(base64Json)`

### `emit(type, payload?)`

Sends a message from the canvas back to the daemon / host bridge.

```js
emit('log/append', { text: 'hello', level: 'info' })
```

### `esc(value)`

HTML-escape helper for rendering untrusted text into `innerHTML`.

### `subscribe(events, options?)` / `unsubscribe(events)`

Manage daemon event subscriptions.

```js
subscribe(['canvas_lifecycle', 'display_geometry'], { snapshot: true })
unsubscribe('display_geometry')
```

Options:

- `snapshot: true` asks the daemon to replay the current state for supported
  streams immediately after subscribing. Today that includes
  `display_geometry`, `canvas_lifecycle`, and `input_event` (replayed as the
  current cursor position).
- `canvas_lifecycle` snapshots and live updates now share one rich payload
  shape: top-level compatibility fields (`canvas_id`, `action`, `at`) plus
  metadata such as `parent`, `track`, `interactive`, `scope`, and a nested
  `canvas` object mirroring `aos show list`.

### `spawnChild(opts)`

Creates a child canvas and returns a promise that resolves after the daemon ack.

```js
await spawnChild({
  id: 'child',
  url: 'aos://toolkit/components/log-console/index.html',
  at: [100, 100, 320, 240],
  interactive: true,
})
```

### `mutateSelf(opts)`

Fire-and-forget update for the current canvas.

```js
mutateSelf({ interactive: true })
```

### `removeSelf(opts?)`

Removes the current canvas and resolves after daemon ack.

### `setInteractive(boolean)`

Convenience wrapper over `mutateSelf({ interactive })`.

### `evalCanvas(id, js, options?)`

Evaluates JavaScript inside another canvas and resolves with the daemon's eval result string.

```js
await evalCanvas('avatar-main', 'document.title')
```

Options:

- `timeoutMs`: override the default 5000ms request timeout

### `move(dx, dy)`

Relative move helper for the current canvas.

Used by the stock draggable header; intended for live drag behavior rather than absolute positioning.

### `declareManifest(manifest)`

Declares the canvas manifest on `window.headsup.manifest`.

### `emitReady()`

Signals that the canvas is loaded and ready for host-side post-load actions.

### `emitLifecycleComplete(action, payload?)`

Acknowledges that a renderer-managed lifecycle transition actually finished.

```js
emitLifecycleComplete('resume')
emitLifecycleComplete('exit', { reason: 'animation_done' })
```

Use this for transition acks such as `resume`, `enter`, or `exit` when the
daemon should wait on real renderer completion instead of a guessed delay.

### `onReady(handler)`

Convenience hook for inbound `ready` events.

## Panel API

Public entrypoint:

```js
import {
  createDragController,
  createResizeController,
  createSplitPane,
  createMaximizeController,
  dragFrameFromPointer,
  mountPanel,
  mountChrome,
  resizeFrame,
  Single,
  SplitPane,
  Tabs,
  wireDrag,
  wireResize,
} from 'aos://toolkit/panel/index.js'
```

### `mountChrome(container, options?)`

Builds the panel shell without mounting content or wiring messages.

```js
const chrome = mountChrome(document.body, {
  title: 'My Panel',
  draggable: true,
})
```

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | `string` | header title |
| `draggable` | `boolean` | whether header drag emits absolute move updates plus `drag_start` / `drag_end` lifecycle messages |
| `drag` | `object` | optional drag controller settings; stock chrome clamps final placement by default |
| `close` | `boolean` | whether to show the stock close control, default `true` |
| `minimize` | `boolean` | whether to show the stock minimize control, default `true` |
| `maximize` | `boolean` | whether to show the stock maximize/restore control, default `false` |
| `resizable` | `boolean` | whether to add stock edge/corner resize handles, default `false` |
| `resize` | `object` | optional resize controller settings such as min/max width and height |
| `onClose` | `function` | optional close override |
| `onMinimize` | `function` | optional minimize override |
| `onMaximize` | `function` | optional maximize/restore override; receives the maximize controller |

Returns an object with:

| Field / method | Meaning |
| --- | --- |
| `panelEl` | outer panel element |
| `headerEl` | header element |
| `titleEl` | title slot element |
| `controlsEl` | controls slot element |
| `customControlsEl` | app controls slot element |
| `windowControlsEl` | stock lifecycle controls slot element |
| `contentEl` | content mount element |
| `maximizeController` | controller when `maximize: true`, otherwise `null` |
| `dragController` | controller when `draggable: true`, otherwise `null` |
| `resizeController` | controller wrapper when `resizable: true`, otherwise `null` |
| `setTitle(text)` | update the title slot |
| `setControls(html)` | replace controls slot contents with HTML |

Notes:

- `mountChrome()` adds the `aos-panel-root` class to the mount container
- the returned slot refs are the behavioral contract; consumers should not rely on querying `.aos-*` classes for runtime behavior
- when draggable, the stock header emits `drag_start` once on primary-button
  pointerdown, drives window movement through absolute drag updates, then emits
  `drag_end` on pointerup / cancel / lost capture
- stock chrome clamps final drag placement to the current display work area so
  titlebars and window controls remain reachable; custom surfaces can call
  `wireDrag(..., { clampOnEnd: true })` to opt into the same behavior
- when maximize is enabled, the stock controller stores the current canvas frame,
  updates the canvas to the current display work area, and restores the stored
  frame on the next toggle
- when resize is enabled, stock handles emit `resize_start` / `resize_end`,
  resize through `canvas.update`, and use the same frame/work-area helpers as
  maximize/restore

### `mountPanel(options)`

Creates a panel shell and mounts a layout.

```js
mountPanel({
  title: 'My Panel',
  layout: Single(MyContent),
  draggable: true,
  container: document.body,
})
```

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | `string` | header title |
| `layout` | layout object | required |
| `draggable` | `boolean` | whether the mounted stock header emits absolute drag updates plus `drag_start` / `drag_end` lifecycle messages |
| `drag` | `object` | optional drag controller settings |
| `close` | `boolean` | whether to show the stock close control, default `true` |
| `minimize` | `boolean` | whether to show the stock minimize control, default `true` |
| `maximize` | `boolean` | whether to show the stock maximize/restore control, default `false` |
| `resizable` | `boolean` | whether to add stock edge/corner resize handles, default `false` |
| `resize` | `object` | optional resize controller settings |
| `container` | `HTMLElement` | mount target, default `document.body` |

### `createDragController(options?)`

Creates the toolkit-owned panel drag state used by stock panel chrome and custom
workbench titlebars.

```js
const controller = createDragController({ clampOnEnd: true })
```

By default the controller sends absolute drag updates through `move_abs`. When
`clampOnEnd` is true, it reads the current window frame at drag completion,
clamps it to the current display work area, and writes the corrected frame
through `canvas.update` only when the panel would otherwise be stranded.

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `move` | `function` | absolute drag writer, default `move_abs` |
| `getFrame` | `function` | current `[x, y, width, height]`, default current window frame |
| `getWorkArea` | `function` | current display work area, default `window.screen.avail*` |
| `updateFrame` | `function` | frame writer for final clamp, default `canvas.update` |
| `clampOnEnd` | `boolean` | whether to clamp final drag placement, default `false` |
| `minVisibleWidth` / `minVisibleHeight` | `number` | visible affordance retained when clamping oversized frames |
| `onStateChange` | `function` | receives drag state snapshots |

`dragFrameFromPointer(pointer, offsetX, offsetY, frame?)` is the pure geometry
helper for tests and custom hosts.

`wireDrag(headerEl, controlsEl, options?)` wires primary-button titlebar dragging
to a DOM element. It ignores events originating inside `controlsEl`, emits
`drag_start` / `drag_end`, returns the drag controller, and accepts
`onStart` / `onEnd` hooks for custom surfaces such as workbenches that need to
restore from maximized state before moving.

### `createMaximizeController(options?)`

Creates the toolkit-owned maximize/restore state used by stock panel chrome and
by custom workbench titlebars that need the same behavior.

```js
const controller = createMaximizeController()
controller.maximize()
controller.restore()
controller.toggle()
```

By default the controller reads `window.screenX/screenY` and
`window.innerWidth/innerHeight` for the restore frame, reads
`window.screen.avail*` for the current display work area, and updates the
calling canvas through `canvas.update`. If the browser does not expose a display
origin, the helper keeps the current window origin as the safest fallback. Tests
and custom hosts can override `getFrame`, `getWorkArea`, `updateFrame`, and
`onStateChange`.

The controller state is:

```js
{
  maximized: true,
  restoreFrame: [x, y, width, height]
}
```

### `createResizeController(options?)`

Creates the toolkit-owned edge/corner resize state used by stock panel chrome.

```js
const controller = createResizeController({
  minWidth: 320,
  minHeight: 220,
})
controller.resize('se', 24, 16)
```

Supported edges are `n`, `s`, `e`, `w`, `ne`, `nw`, `se`, and `sw`. The helper
also accepts common words such as `top`, `left`, and `bottom-right`.

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `getFrame` | `function` | current `[x, y, width, height]`, default current window frame |
| `getWorkArea` | `function` | current display work area, default `window.screen.avail*` |
| `updateFrame` | `function` | frame writer, default `canvas.update` |
| `minWidth` / `minHeight` | `number` | minimum surface size |
| `maxWidth` / `maxHeight` | `number` | optional maximum surface size |
| `onStateChange` | `function` | receives resize state snapshots |

`resizeFrame(frame, edge, dx, dy, constraints?)` is the pure geometry helper
behind the controller. It preserves the opposite edge for north/west resizes,
enforces min/max dimensions, and clamps to the supplied work area so panel
chrome remains reachable.

`wireResize(panelEl, options?)` appends stock edge/corner handles to a custom
panel or workbench shell and returns `{ controller, handles }`. `mountChrome`
uses this internally when `resizable: true`.

### `Single(factoryOrContent)`

Wraps one content unit.

### `createSplitPane(options?)`

Builds or wires a two-pane DOM layout with a draggable accessible separator.
This helper is for custom workbench shells that already own their HTML.

```js
const split = createSplitPane({
  root: document.querySelector('.workbench-main'),
  startPane: document.querySelector('.preview-pane'),
  endPane: document.querySelector('.controls-pane'),
  orientation: 'horizontal',
  initialRatio: 0.58,
  minStart: 360,
  minEnd: 320,
  storageKey: 'my-workbench.split',
})
```

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `root` | `HTMLElement` | existing root to wire; created when omitted |
| `startPane` / `endPane` | `HTMLElement` | existing panes to wire; created when omitted |
| `divider` | `HTMLElement` | existing separator; created when omitted |
| `orientation` | `'horizontal' \| 'vertical'` | left-right or top-bottom split, default `horizontal` |
| `initialRatio` | `number` | start pane ratio before restore, default `0.5` |
| `restoreState` | `object \| number` | explicit restored state or ratio; objects may include `closedPane` |
| `storageKey` | `string` | optional localStorage-backed ratio and closed-pane persistence |
| `minStart` / `minEnd` | `number` | minimum start/end pane size in pixels |
| `maxStart` / `maxEnd` | `number` | optional maximum start/end pane size in pixels |
| `keyboardStep` | `number` | arrow-key resize step in pixels |
| `ariaLabel` | `string` | accessible separator label |
| `onChange` | `function` | called with `{ orientation, ratio, startSize, endSize, availableSize, closedPane }` |

The returned controller exposes:

| Field / method | Meaning |
| --- | --- |
| `root`, `startPane`, `endPane`, `divider` | wired DOM nodes |
| `getState()` | current normalized split state |
| `setRatio(ratio, options?)` | update by ratio |
| `setStartSize(px, options?)` | update by start pane pixels |
| `closePane('start' \| 'end')` | close one pane and let the other fill the split root |
| `openPane('start' \| 'end')` | reopen a closed pane and restore the last ratio |
| `togglePane('start' \| 'end')` | close/open one pane |
| `isPaneOpen('start' \| 'end')` | return whether a pane is currently open |
| `destroy()` | remove controller event listeners |

The separator uses `role="separator"`, `aria-orientation`, `aria-valuenow`,
and pointer/keyboard semantics. Apps should treat `.aos-split-pane*` classes as
styling hooks and the controller state as the behavior contract.

### `SplitPane(startFactoryOrContent, endFactoryOrContent, options?)`

Wraps two content units in a toolkit split-pane layout for `mountPanel`.

```js
mountPanel({
  title: 'Workbench',
  layout: SplitPane(PreviewContent, ControlsContent, {
    initialRatio: 0.6,
    minStart: 320,
    minEnd: 280,
  }),
})
```

`SplitPane` accepts the same geometry options as `createSplitPane`. It emits
`split-pane/resized` and declares a panel manifest with the two pane contents.
Individual content units are routed by their existing `manifest.channelPrefix`.

### `Tabs(factoriesOrContents, options?)`

Wraps multiple content units and shows one at a time.

```js
Tabs([
  AlphaContent,
  BetaContent,
], {
  onActivate(info, host) {
    console.log(info.index, info.title)
  },
})
```

Options:

| Field | Type | Meaning |
| --- | --- | --- |
| `onActivate` | `function` | optional callback invoked when the active tab changes, including the initial `0` activation |

Activation callback info:

| Field | Meaning |
| --- | --- |
| `index` | active tab index |
| `title` | resolved tab label (`manifest.title`, then `manifest.name`) |
| `manifest` | active content manifest or `null` |

Important boundary:

- `Tabs` provides structure and activation behavior
- `Tabs` may notify consumers when activation changes through `onActivate(info, host)`
- `Tabs` does **not** define a canonical visual design

Panel-level control/event surface:

- `tabs/activate` with `{ index }`, `{ name }`, or `{ title }`
- `tabs/activated` emitted when activation changes with `{ index, title, name }`
- the returned layout object also exposes `activate(payload)` for same-canvas programmatic activation
- consumers own the CSS for `.aos-tabs`, `.aos-tab`, `.aos-tab.active`, and `.aos-tab-content`
- `Tabs` mounts its strip into `chrome.controlsEl`; consumers should treat slot refs as the behavioral API and `.aos-*` classes as styling hooks
- active tab state is exposed via `.active`, `data-active`, `aria-selected`, and the `hidden` attribute on tab panels

## Content Contract

Content units are plain objects with a small lifecycle surface.

```js
export default function MyContent() {
  let contentEl = null

  return {
    manifest: {
      name: 'my-content',
      title: 'My Content',
      accepts: ['ping'],
      emits: ['pong'],
      channelPrefix: 'my',
      defaultSize: { w: 320, h: 200 },
      requires: ['canvas_lifecycle'],
    },

    render(host) {
      contentEl = document.createElement('div')
      contentEl.textContent = 'hello'
      return contentEl
    },

    onMessage(msg, host) {
      if (msg.type === 'ping') host.emit('pong', { ok: true })
    },

    serialize() {
      return { text: contentEl?.textContent || '' }
    },

    restore(state) {
      if (contentEl && state?.text) contentEl.textContent = state.text
    },
  }
}
```

### `manifest`

Current consumer-facing fields:

| Field | Meaning |
| --- | --- |
| `name` | required unique content/canvas name |
| `title` | human-readable title, including tab label in `Tabs` |
| `accepts` | inbound message types this content handles |
| `emits` | outbound message types this content may emit |
| `channelPrefix` | routing prefix used by the panel router |
| `defaultSize` | preferred standalone size |
| `icon` | optional launcher/tab icon metadata |
| `requires` | daemon event streams to auto-subscribe |

### `render(host)`

Returns either:

- a `Node`
- an HTML `string`

### `onMessage(msg, host)`

Receives routed messages.

Routing rule:

- if a message type is prefixed with `channelPrefix/`, the router strips the prefix and delivers the remainder
- unmatched messages are broadcast to all contents that implement `onMessage`

### `serialize()` / `restore(state, host)`

Optional hooks for state transfer or future tear-off / redock flows.

## `ContentHost` Contract

Contents receive a host object from the panel layout.

Current host surface:

| Method / field | Meaning |
| --- | --- |
| `contentEl` | the content mount element |
| `setTitle(text)` | change panel title in `Single`; no-op in `Tabs` |
| `emit(type, payload?)` | emit a message, auto-prefixed by `channelPrefix` when present |
| `subscribe(events)` | subscribe to daemon streams |
| `spawnChild(opts)` | create a child canvas |
| `evalCanvas(id, js)` | run JS in another canvas |

## Styling Boundary

This is intentional and should be preserved.

- `panel/` JavaScript is structure and behavior, not canonical visual design.
- `components/_base/theme.css` provides shared tokens and minimal reset utilities only.
- `panel/defaults.css` is an optional stock layout/look baseline for standalone toolkit panels.
- apps, demos, and product surfaces may replace `panel/defaults.css` entirely.
- if you omit `panel/defaults.css`, you own the layout CSS for `aos-panel-root`, `aos-panel`, header/content slots, and any tab treatment
- stock typography, overflow, and scrollbar treatment belong in `panel/defaults.css` or consumer CSS, not in panel behavior code or content internals
- content-specific styling should target content-owned classes, not shell classes such as `.aos-content`

## Minimal Standalone Template

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="../_base/theme.css">
  <link rel="stylesheet" href="../../panel/defaults.css">
  <style>
    .body {
      padding: 12px;
    }
  </style>
</head>
<body>
<script type="module">
import { mountPanel, Single } from '../../panel/index.js'

function Hello() {
  return {
    manifest: { name: 'hello', title: 'Hello' },
    render() {
      const el = document.createElement('div')
      el.className = 'body'
      el.textContent = 'hello'
      return el
    },
  }
}

mountPanel({ title: 'Hello', layout: Single(Hello) })
</script>
</body>
</html>
```

## Guidance For Maintainers

- update this doc when exported runtime/panel functions change
- update this doc when the content or host contract changes
- do not document `_dev/` demos as canon APIs
