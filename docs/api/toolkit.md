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
  `--aos-panel-titlebar-min-height`, `--aos-panel-titlebar-padding`,
  `--aos-panel-titlebar-gap`, `--aos-panel-control-gap`, and
  `--aos-panel-grip-color`
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

## Workbench Contracts

Workbench surfaces should describe the thing being edited with
`aos.workbench.subject`. The descriptor is intentionally small: it names stable
identity, subject type, owner, source, capabilities, operation contracts, Subject
References, Facets, legacy views, legacy controls, persistence, artifacts, and
current state. It does not move domain ownership into the toolkit.

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

V-next schema design notes:
[`shared/schemas/aos-workbench-subject-vnext.md`](../../shared/schemas/aos-workbench-subject-vnext.md)
and
[`shared/schemas/aos-subject-capabilities.md`](../../shared/schemas/aos-subject-capabilities.md)

Create descriptors with:

```js
import { createWorkbenchSubject } from '../workbench/subject.js'
```

Wiki pages can be projected from `aos wiki list/show --json` shapes with:

```js
import { createWikiPageSubject } from '../workbench/wiki-subject.js'
```

Sigil agent domain Subjects can be projected from their source wiki document
shape with:

```js
import { createSigilAgentSubject } from '../workbench/sigil-subject.js'
```

Design-stage work records can be projected from schema-shaped work-record
objects with:

```js
import { createWorkRecordSubject } from '../workbench/work-record.js'
```

Wiki workflow maps can be projected into a chain descriptor without creating a
workflow engine:

```js
import { createWikiWorkflowSubject } from '../workbench/workflow-subject.js'
```

The current schema version is `2026-05-03`. Live Workbench Subject writers use
the v-next descriptor shape: high-level registry names in `capabilities[]`,
operation/event strings in `contracts[]`, typed links in
`subject_references[]`, projections in `facets[]`, and Host implementations in
`facets[].hosts[]`. `views[]` and `controls[]` are deprecated legacy boundary
fields for archived fixtures or old persisted imports; live writers should not
emit them. Consumers should use the toolkit helpers in `workbench/subject.js`
when reading descriptors:

- `subjectCapabilities(subject)` returns high-level capabilities such as
  `inspectable`, `editable`, `verifier-target`, `replayable`, and `exportable`.
- `subjectContracts(subject)` returns top-level `contracts[]` plus legacy
  dotted operation/event strings still present in `capabilities[]`.
- `subjectCanonicalContracts(subject)` returns only live top-level
  `contracts[]` and does not read legacy dotted raw capabilities.
- `subjectReferences(subject)` reads top-level `subject_references[]`; it also
  contains the only legacy fallback for archived descriptors that stored
  references under `metadata.subject_references[]`.
- `subjectCanonicalReferences(subject)` returns only live top-level
  `subject_references[]`.
- `subjectFacets(subject)` and `subjectHosts(subject)` expose canonical
  projections and Host entries. `subjectLegacyViews(subject)` and
  `subjectLegacyControls(subject)` are legacy adapter helpers only; do not use
  them in live consumer logic.

The first adopters are:

- Sigil radial item editor subjects: `sigil.radial_menu.item_3d`
- Markdown workbench subjects: `markdown.document`
- Wiki page subjects: `wiki.concept`, `wiki.entity`, `wiki.workflow`,
  `wiki.reference`, and `wiki.page`
- Sigil agent domain subjects: `sigil.agent`
- Workflow chain subjects: `wiki.workflow_chain`
- Work-record subjects: `aos.do_step` and `aos.recipe_health_event`

Subject descriptors are included in lock-in/save handoff payloads so agents,
apps, and future workbench shells can reason about different editors using one
vocabulary.

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

### Wiki Subject Selection And Opening

Browser-hosted wiki graph surfaces should bridge graph selection to workbench
opening through `workbench/wiki-subject-opening.js`, not through private editor
state. `WikiKB` keeps emitting the legacy `selection` event with node-shaped
fields (`id`, `path`, `name`, `type`, `tags`, and `plugin`) and also emits the
explicit `wiki.subject.selection` event for selected graph nodes. The explicit
payload contains:

```json
{
  "type": "wiki.subject.selection",
  "schema_version": "2026-05-06",
  "path": "aos/concepts/runtime-modes.md",
  "entry_handle": "wiki:aos/concepts/runtime-modes.md",
  "subject": {
    "type": "aos.workbench.subject"
  }
}
```

Openers should call `createMarkdownOpenRequestFromWikiSelection(selection)` or
the lower-level `wikiSubjectSelectionCanOpenInMarkdownWorkbench(selection)` and
`createWikiSubjectOpenRequest(selection)` helpers. Those helpers read descriptors
through the canonical descriptor API (`subjectFacets`, `subjectHosts`,
`subjectContracts`, and `subjectReferences`) so graph selections open only when
the selected Subject advertises the Markdown facet, Host, and contracts needed
by the Markdown Workbench.

Wiki KB remains generic: it publishes selected wiki identity and a Workbench
Subject descriptor. Markdown Workbench remains responsible for fetching,
opening, editing, and saving wiki-backed Markdown through its existing
`markdown_document.open` and `markdown_document.save.requested` behavior.

### Wiki Subject Browser V0

The named V0 shell lives at:

```text
aos://toolkit/components/wiki-subject-browser/index.html
```

Launch it in repo mode with:

```bash
packages/toolkit/components/wiki-subject-browser/launch.sh
packages/toolkit/components/wiki-subject-browser/launch.sh wiki:aos/concepts/runtime-modes.md
```

The shell manifest name is `wiki-subject-browser-v0`. It is a browser-hosted
composition surface over the existing Wiki KB graph and Markdown Workbench, not
a new `aos` command and not a new wiki persistence owner. It starts graph-first:
the Wiki KB graph is the primary pane and the Markdown Workbench content pane is
closed until a wiki subject selection opens a page. It also accepts a small
canonical Subject Catalog payload for non-wiki Subjects and can open a
read-only Work Record through the existing Work Record Workbench. The shell sets
`window.__wikiSubjectBrowserState` for inspection and exposes stable refs such
as `wiki-subject-browser-v0:root`, `markdown-workbench:wiki-graph`,
`markdown-workbench:content-pane`, `markdown-workbench:content-close`, and
`markdown-workbench:source-editor`. Catalog refs include
`wiki-subject-browser-v0:subject-catalog`,
`wiki-subject-browser-v0:subject-catalog-status`, and
`wiki-subject-browser-v0:subject-catalog:open:<catalog-key>`. The small
graph/index inspection refs are `wiki-subject-browser-v0:subject-index` and
`wiki-subject-browser-v0:subject-index-status`. Search/navigation refs include
`wiki-subject-browser-v0:subject-search`,
`wiki-subject-browser-v0:subject-filters`,
`wiki-subject-browser-v0:subject-filter:subject-type`,
`wiki-subject-browser-v0:subject-filter:relationship-type`,
`wiki-subject-browser-v0:subject-filter:layer`,
`wiki-subject-browser-v0:subject-filter:capability`,
`wiki-subject-browser-v0:subject-filter:health`,
`wiki-subject-browser-v0:subject-filters:reset`,
`wiki-subject-browser-v0:subject-list`,
`wiki-subject-browser-v0:subject-list-status`,
`wiki-subject-browser-v0:subject-list:entry:<subject-key>`,
`wiki-subject-browser-v0:subject-list:inspect:<subject-key>`,
`wiki-subject-browser-v0:subject-list:open:<subject-key>`,
`wiki-subject-browser-v0:subject-details`,
`wiki-subject-browser-v0:subject-details-status`,
`wiki-subject-browser-v0:subject-details-body`,
`wiki-subject-browser-v0:subject-details:subject:<subject-key>`,
`wiki-subject-browser-v0:subject-details:facet:<subject-key>:<facet-key>`,
`wiki-subject-browser-v0:subject-details:host:<subject-key>:<host-key>`,
`wiki-subject-browser-v0:subject-details:outgoing:reference:<edge-key>`,
`wiki-subject-browser-v0:subject-details:incoming:reference:<edge-key>`,
`wiki-subject-browser-v0:subject-details:related:target:<subject-key>`,
`wiki-subject-browser-v0:subject-details:related:open:<subject-key>`,
`wiki-subject-browser-v0:subject-details:related:unresolved:<target-key>`,
`wiki-subject-browser-v0:subject-details:clear`,
`wiki-subject-browser-v0:navigation-trail`,
`wiki-subject-browser-v0:navigation-trail-status`,
`wiki-subject-browser-v0:navigation-trail-list`, and
`wiki-subject-browser-v0:navigation-trail:open:<subject-key>`.

The V0 navigation state is intentionally compact and derived from the local
Subject Graph Index snapshot. `subject_search_query` stores the current query,
and `subject_index_filters` stores the selected graph-index filters:

```json
{
  "subject_type": "aos.work_record",
  "relationship_type": "origin_subject",
  "layer": "descriptor",
  "capability": "inspectable",
  "health": "valid"
}
```

All filter values are optional strings; an empty string means "all". The V0
filters are derived from canonical graph/index fields only:

- `subject_type` reads `subject_graph_index.nodes[].subject_type`.
- `relationship_type` reads `subject_graph_index.edges[].relationship` and
  matches indexed Subjects that participate in that relationship.
- `layer` reads `subject_graph_index.facet_summaries[].layer` and matches
  Subjects with a Facet in that layer.
- `capability` reads canonical node and Facet `capabilities[]`.
- `health` reads the node health summary status, verdict, or verifier status.

`subject_index_filter_options` exposes deterministic option lists with
`value`, `label`, `count`, and `semantic_ref` fields for `subject_types`,
`relationship_types`, `layers`, `capabilities`, and `health`. Counts represent
the number of indexed Subjects that would match that option. The selected
filters compose with text search; reset clears selected filters without
changing the current search query.

`subject_index_entries[]` is the deterministic search-and-filtered list derived
from `subject_graph_index.nodes[]`, sorted by label, Subject type, then Subject
id. Each entry has this shape:

```json
{
  "type": "aos.subject_browser.index_entry",
  "schema_version": "2026-05-06",
  "key": "work-record-aos-browser-click-status-2026-05-06",
  "subject_node_id": "subject:work-record:aos-browser-click-status-2026-05-06",
  "subject_id": "work-record:aos-browser-click-status-2026-05-06",
  "subject_type": "aos.work_record",
  "label": "Browser Click Status",
  "owner": "aos-work-record",
  "entry_handle": "work-record:aos-browser-click-status-2026-05-06",
  "source_kind": "catalog_entry",
  "catalog_entry_id": "subject-catalog:work-record-aos-browser-click-status-2026-05-06",
  "wiki_path": null,
  "capabilities": ["inspectable", "verifier-target", "exportable"],
  "contracts": ["work_record.intent.view"],
  "facet_count": 8,
  "host_count": 8,
  "reference_count": 1,
  "semantic_ref": "wiki-subject-browser-v0:subject-list:entry:work-record-aos-browser-click-status-2026-05-06",
  "open_ref": "wiki-subject-browser-v0:subject-list:open:work-record-aos-browser-click-status-2026-05-06"
}
```

The Subject index also exposes a separate Inspect action for each row. Inspect
does not open a page or spawn a child workbench; it stores the focused Subject
identity and recomputes `focused_subject_details` from the same
`subject_graph_index` snapshot. `focused_subject_details` is `null` until a row
is focused, and then has this shape:

```json
{
  "type": "aos.subject_browser.focused_subject_details",
  "schema_version": "2026-05-06",
  "key": "work-record-aos-browser-click-status-2026-05-06",
  "subject_node_id": "subject:work-record:aos-browser-click-status-2026-05-06",
  "subject_id": "work-record:aos-browser-click-status-2026-05-06",
  "subject_type": "aos.work_record",
  "label": "Browser Click Status",
  "entry_handle": "work-record:aos-browser-click-status-2026-05-06",
  "source_kind": "catalog_entry",
  "catalog_entry_id": "subject-catalog:work-record-aos-browser-click-status-2026-05-06",
  "wiki_path": null,
  "index_entry": {},
  "facets": [],
  "hosts": [],
  "outgoing_references": [],
  "incoming_references": [],
  "summary": {
    "outgoing_reference_count": 1,
    "incoming_reference_count": 0,
    "reference_count": 1,
    "resolved_reference_count": 0,
    "unresolved_reference_count": 1,
    "facet_count": 8,
    "host_count": 8
  },
  "semantic_ref": "wiki-subject-browser-v0:subject-details:subject:work-record-aos-browser-click-status-2026-05-06",
  "clear_ref": "wiki-subject-browser-v0:subject-details:clear"
}
```

The details object is a graph-neighborhood projection, not a second graph
index. `facets[]` mirrors the focused Subject's
`subject_graph_index.facet_summaries[]` rows and adds a stable `semantic_ref`.
`hosts[]` mirrors matching `subject_graph_index.host_references[]` rows and
adds a stable `semantic_ref`. `outgoing_references[]` and
`incoming_references[]` contain `subject_reference` and
`facet_source_reference` edges only; `has_facet` and `hosted_by` edges stay in
the graph index and are summarized through the Facet and Host sections.

Each reference summary includes a `related_subject` record. When the related
endpoint resolves to an indexed Subject node, `related_subject.resolved` is
`true`, `index_entry` carries the same normalized Subject index entry shape used
by the list, and `open_ref` is populated. When the endpoint does not resolve,
the relationship remains visible with cached handle/type/layer metadata,
`resolved` is `false`, and `open_ref` / `index_entry` are `null`; UI open
controls must render disabled for those unresolved targets.

Related open actions reuse the existing Subject Browser opening paths. Wiki
targets open through the current wiki/Markdown Workbench selection flow, and
catalog targets open only when their loaded catalog entry advertises an
openable canonical opener. Related navigation does not add a URL router, public
`aos` command, replay/repair path, macro playback, live browser execution, or a
replacement for the existing Wiki KB graph projection.

Opening a wiki Subject or catalog Subject appends a compact navigation entry to
`navigation_history[]`; `navigation_trail[]` is the last five unique handles
from that history. Duplicate handles move to the latest position. Trail entries
use Subject Entry Handles instead of route state:

```json
{
  "type": "aos.subject_browser.navigation_entry",
  "schema_version": "2026-05-06",
  "key": "wiki-aos-concepts-runtime-modes-md",
  "label": "Runtime Modes",
  "subject_id": "wiki:aos/concepts/runtime-modes.md",
  "subject_type": "wiki.concept",
  "entry_handle": "wiki:aos/concepts/runtime-modes.md",
  "source_kind": "wiki",
  "wiki_path": "aos/concepts/runtime-modes.md",
  "catalog_entry_id": null,
  "opener_id": null,
  "opened_at_sequence": 1,
  "semantic_ref": "wiki-subject-browser-v0:navigation-trail:entry:wiki-aos-concepts-runtime-modes-md",
  "open_ref": "wiki-subject-browser-v0:navigation-trail:open:wiki-aos-concepts-runtime-modes-md"
}
```

The search/list/filter affordance does not read Wiki KB `nodes[]` or `links[]`
internals. It only filters the local `subject_graph_index`, which is derived
from canonical Workbench Subject descriptors and loaded Subject Catalog entries.
The filters are an index navigation aid, not a graph derivation algorithm, not a
replacement for the existing wiki graph projection, and not a URL router,
breadcrumb ontology, replay log, repair surface, or macro playback surface. The
trail is a lightweight recent-open history.

V0 event contract:

- `wiki.subject.selection` carries the selected wiki path, entry handle, and
  `aos.workbench.subject` descriptor from Wiki KB.
- `wiki_subject.open.requested` carries the normalized open request created via
  `createWikiSubjectOpenRequest(selection)` after the selection is known to be
  openable through its canonical Markdown Facet, Host, and contracts.
- `subject_catalog.load` carries `{ entries: [...] }` where each entry is an
  `aos.subject_catalog.entry` built from an `aos.workbench.subject` descriptor
  plus the owner-provided open payload needed by the target workbench.
- `subject.open.requested` carries the selected catalog entry handle, Subject
  descriptor, selected Facet, selected Host entry, opener metadata, and the
  workbench-specific `open_message`.
- `subject.open.result` reports the status of the V0 handoff. For Work Records,
  it includes the opened record id, child Work Record Workbench canvas id, and
  whether the `work_record.open` message was posted to the child.
- `markdown_document.open`, `markdown_document.text.patch`, and
  `markdown_document.save.result` remain Markdown Workbench messages.
- `markdown-workbench/save.requested` and `markdown-workbench/save.result`
  remain the Markdown Workbench save handoff messages.

V0 boundaries:

- The shell does not add Playbook UI, replay, repair, macro playback, or a new
  CLI surface.
- The shell does not replace the graph projection work tracked separately by
  #72; it composes the current Wiki KB graph.
- The shell does not write wiki pages directly. Wiki-backed open/save stays with
  Markdown Workbench and its existing `markdown_document.open` /
  `markdown_document.save.requested` behavior.
- The shell does not add a second Work Record viewer. V0 Work Record catalog
  opens spawn the stock `work-record-workbench` and post its existing
  `work_record.open` message.
- Catalog/open decisions use high-level `capabilities[]`, live `contracts[]`,
  `facets[]`, `facets[].hosts[]`, and top-level `subject_references[]`.
  `views[]`, `controls[]`, and dotted raw `capabilities[]` are not live
  catalog/open dependencies.
- The shell derives a local Subject Graph Index V0 snapshot for inspection from
  the selected wiki Subject and loaded catalog entries. It exposes the full
  payload on `window.__wikiSubjectBrowserState.subject_graph_index`, a
  filtered `subject_index_entries[]` list, and compact navigation history/trail
  arrays in the right sidebar. This is not a replacement for the embedded Wiki
  KB graph.

### Subject Catalog And Opening V0

The canonical catalog/open helper lives at:

```js
import {
  createSubjectCatalogEntry,
  createWorkRecordSubjectCatalogEntry,
  createSubjectOpenRequestFromCatalogEntry,
} from '../workbench/subject-catalog.js'
```

An `aos.subject_catalog.entry` is a browser/workbench navigation record, not a
new source of truth for the Subject. It contains the canonical Subject
descriptor, a Subject Entry Handle, normalized high-level capabilities, live
contracts, top-level Subject References, Facets, derived affordances, and an
owner-provided `open_payload`. The open payload is intentionally separate from
the descriptor because a descriptor says what can be opened, while the owner
still supplies the data needed by the target workbench.

V0 supports the first non-wiki route: Work Record descriptors with an
`inspectable` capability, canonical `work_record.*` contracts, and a
`work-record-workbench` Host entry can produce a `subject.open.requested`
message whose `open_message` is the existing `work_record.open` payload. This
opens the stock read-only Work Record Workbench path for schema-v0 records.

V0 boundaries:

- no new public `aos` command surface;
- no broad Subject graph rewrite;
- no replay, repair, macro playback, live browser execution, or background
  loop;
- no generic Playbook execution UI;
- no dependency on legacy `views[]`, `controls[]`, or dotted raw
  `capabilities[]` summaries.

### Artifact Bundle Subject V0

Artifact bundles are the first generated-output Subject type in the shared
Workbench Subject substrate:

```js
import {
  createArtifactBundleSubject,
} from '../workbench/artifact-bundle-subject.js'
```

The V0 fixture lives at:

```text
docs/design/fixtures/aos-artifacts/example-design-pass/subject.json
```

It describes one HTML prototype artifact and one Markdown/report artifact under
one stable `aos.workbench.subject` with `subject_type:
"aos.artifact_bundle"`. The descriptor uses canonical v-next fields only:
high-level `capabilities[]`, dotted operation contracts in `contracts[]`,
top-level `subject_references[]`, concrete `facets[]`, and
`facets[].hosts[]`. Live artifact-bundle writers must not emit legacy `views[]`,
legacy `controls[]`, or dotted raw `capabilities[]`.

Artifact metadata remains in `artifacts[]` for V0. Each artifact record should
carry an `id`, `kind`, `entry`, `renderer.id`, `files[]`, `exports[]`,
`provenance`, `work_record`, and `validation`. Export entries are metadata
records only; V0 does not execute exporters or require export files to exist.
The top-level Subject `source` names the source folder, while per-artifact
`entry` and `files[]` name entry and supporting files inside that folder.

The read-only workbench model lives at:

```js
import {
  createArtifactBundleWorkbenchState,
  openArtifactBundle,
  artifactBundleWorkbenchSnapshot,
} from '../components/artifact-bundle-workbench/model.js'
```

The named component lives at:

```text
aos://toolkit/components/artifact-bundle-workbench/index.html
```

It accepts `artifact_bundle.open`, exposes
`window.__artifactBundleWorkbenchState`, renders a gallery/preview/inspector
snapshot, and preserves artifact payloads without rewriting them. It can preview
HTML through a provided AOS content-root URL, fetch and render Markdown artifacts
with the shared toolkit Markdown renderer plus shared Markdown preview
presentation, and fall back to metadata inspection for artifacts without a
resolvable preview URL.

When an artifact carries `work_record.path`, `work_record.record`, or
`work_record.open_message`, the workbench renders a Work Record Evidence action.
The action reuses the existing `work-record-workbench` child surface and emits
`artifact_bundle.work_record.open.result` after preparing the read-only
`work_record.open` payload. This is a visible provenance/evidence handoff only:
it does not add replay, repair, macro playback, export execution, or a public
`aos` command.

The Subject Catalog supports artifact bundles through
`createArtifactBundleSubjectCatalogEntry()`. The opener reuses the existing
`subject.open.requested` shape with `artifact_bundle.open` as the workbench
message. The Wiki Subject Browser can list, inspect, and route an artifact
bundle catalog entry through that opener. This is read-only catalog/opening
plumbing, not generation, save/lock-in, export execution, renderer registry,
replay, repair, macro playback, or a new public `aos` command.

The pattern adapts Open Design's artifact workspace lesson to AOS's Subject
model. It is not a Sigil-owned feature, not a copied Open Design daemon or
`.od` state model, and not a streamed `<artifact>` tag interface.

### Subject Graph Index V0

The bounded cross-subject navigation index lives at:

```js
import {
  deriveSubjectGraphIndex,
  summarizeSubjectGraphIndex,
} from '../workbench/subject-graph.js'
```

`deriveSubjectGraphIndex()` is pure toolkit logic. It accepts canonical
`aos.workbench.subject` descriptors, `aos.subject_catalog.entry` records, or an
object with `{ subjects, entries }`, and returns a deterministic payload:

```json
{
  "type": "aos.subject_graph.index",
  "schema_version": "2026-05-06-subject-graph-index-v0",
  "nodes": [],
  "facet_summaries": [],
  "host_references": [],
  "edges": [],
  "metadata": {
    "subject_count": 0,
    "facet_count": 0,
    "host_count": 0,
    "edge_count": 0,
    "catalog_entry_count": 0,
    "descriptor_count": 0,
    "health": {}
  }
}
```

V0 node and edge shape:

- `nodes[]` contains Subject nodes only. Each node carries stable
  `subject_id`, `subject_type`, `label`, `owner`, `entry_handle`, high-level
  `capabilities[]`, top-level canonical `contracts[]`, descriptor `source`,
  source-record metadata, counts, and health/evidence summaries when those are
  present on the descriptor.
- `facet_summaries[]` contains one summary per canonical Facet with `key`,
  `layer`, `label`, Facet-local `capabilities[]`, Facet-local `contracts[]`,
  `source`, `source_ref`, and `host_count`.
- `host_references[]` contains descriptive Host entries for Facets:
  `kind`, `target_dialect`, typed `entry`, `preferred`,
  `browser_compatible`, and notes where present. Host references do not launch
  canvases or browser sessions.
- `edges[]` contains typed relationships. V0 emits `has_facet`,
  `hosted_by`, top-level Subject Reference edges using each reference's
  `relationship`, and `facet_source_reference` when a Facet `source_ref`
  points at a canonical Subject Reference.

The index deliberately reads only canonical descriptor fields:
`subjectCapabilities()`, `subjectCanonicalContracts()`,
`subjectCanonicalReferences()`, and `subjectFacets()` plus Facet-local
`hosts[]`. It does not read legacy `views[]`, legacy `controls[]`,
`metadata.subject_references[]`, or dotted raw operation strings left in
`capabilities[]`. The archived-descriptor fallback remains available through
separate compatibility helpers, but it is not part of live graph derivation.

This index is a cross-subject navigation aid for Subject Browsers and agents.
It is not the wiki graph projection and does not replace the force-graph or
mind-map layout work tracked by #72. The wiki graph projection continues to
consume wiki graph snapshots with `nodes[]`, `links[]`, `raw`, and
`config.graphView`; Subject graph index V0 consumes Workbench Subject
descriptors and catalog entries.

### Playbook Workbench V0

The named V0 shell lives at:

```text
aos://toolkit/components/playbook-workbench/index.html
```

Launch the fixture-backed shell in repo mode with:

```bash
packages/toolkit/components/playbook-workbench/launch.sh
```

The shell manifest name is `playbook-workbench-v0`. It is a browser-hosted,
fixture-backed, report-only shell around the existing browser Playbook
prototype APIs. It uses `createBrowserPlaybookPrototype()`,
`runBrowserPlaybookPrototype()`, `runOneStepPlaybookHarness()`, and the existing
read-only Work Record workbench open model. It simulates exactly one saved AOS
browser action evidence source only after an explicit workflow gate ref and
token are provided.

The launch script loads:

- `shared/schemas/fixtures/aos-playbook-step-v0/valid/browser-click-status.json`
- `shared/schemas/fixtures/aos-work-record-v0/evidence/aos-browser-click-status.json`

The shell sets `window.__playbookWorkbenchState` for inspection and exposes
stable refs such as `playbook-workbench-v0:root`,
`playbook-workbench-v0:gate-ref`, `playbook-workbench-v0:gate-token`,
`playbook-workbench-v0:simulate`, `playbook-workbench-v0:verifier-status`,
`playbook-workbench-v0:diagnostics`,
`playbook-workbench-v0:work-record-summary`, and
`playbook-workbench-v0:open-work-record`.

V0 message contract:

- `playbook_workbench.load` carries `{ playbook_step, evidence_source,
  work_record_workbench_url?, work_record_canvas_id? }` and loads the fixture
  payloads into the shell.
- `playbook_workbench.workflow_gate.set` carries `{ ref, token }` and records
  the explicit workflow gate candidate without running the harness.
- `playbook_workbench.simulate.requested` runs the existing prototype in
  `simulate` mode. Missing tokens or undeclared refs are rejected before a Work
  Record is emitted.
- `playbook_workbench.simulate.result` reports harness status, reason, verifier
  status, diagnostics, and the emitted Work Record id when present.
- `playbook_workbench.work_record.open.requested` creates a `work_record.open`
  payload with `source.kind: "browser_playbook_prototype"` and opens it through
  the existing Work Record workbench model. The UI also attempts to spawn the
  stock `work-record-workbench` canvas and post the same `work_record.open`
  message to it.
- `playbook_workbench.work_record.open.result` reports the read-only handoff
  status, Work Record id, and child Work Record workbench canvas id.

V0 boundaries:

- The shell is not a general Playbook UI and does not list, edit, or execute
  arbitrary Playbooks.
- The shell does not add `aos playbook`, `aos verify`, `aos audit`, recorder,
  replay, repair, or macro command surfaces.
- The shell does not perform live browser execution, autonomous replay,
  autonomous repair, macro playback, or a background loop.
- The shell does not create a second Work Record viewer. It shows only an
  emitted-record summary and hands off the full record to the existing
  read-only Work Record workbench path.

Before migration, older helper output often looked like this:

```json
{
  "capabilities": [
    "inspectable",
    "editable",
    "wiki.read",
    "markdown_document.text.patch"
  ]
}
```

The migrated writer shape is:

```json
{
  "capabilities": ["inspectable", "editable"],
  "contracts": ["wiki.read", "markdown_document.text.patch"],
  "facets": [
    {
      "key": "wiki-markdown",
      "layer": "narrative",
      "capabilities": ["inspectable", "editable"],
      "contracts": ["markdown_document.text.patch"]
    }
  ]
}
```

Concrete helper examples:

- `createWikiPageSubject()` keeps a wiki document as a wiki-oriented Subject and
  emits separate Facets for Markdown source, rendered Markdown preview, and the
  wiki graph projection. These Facets are currently Canvas-Host entries for the
  existing `markdown-workbench` and `wiki-kb` components.
- `createSigilAgentSubject()` emits a separate `sigil.agent` domain Subject with
  a `subject_references[]` narrative source pointing back to the wiki document's
  `wiki-markdown` Facet. Its avatar preview and appearance controls are
  Canvas-Host entries because the live Sigil renderer and studio are AOS canvas
  surfaces.
- `createWorkRecordSubject()` maps Work Record intent, execution-map, evidence,
  claims/verifier, and health views into Facets backed by the existing
  `work-record-workbench` Canvas Host. Recording, replay, repair, and retirement
  remain Work Record model responsibilities, not Host behavior.
- `buildRadialItemWorkbenchSubject()` describes the selected radial item's
  object registry, object controls, and radial preview as Facets hosted by the
  current editor canvas id. The `canvas-id` entry is a runtime assumption about
  an already running editor canvas, not a command to create one.

Host metadata is descriptive. A Host entry says which target dialect and known
component or canvas assumption can render a Facet; it does not launch a browser
session, create an AOS canvas, focus a window, or choose policy. Add Browser
Host entries only when a real browser route or session surface exists. Add
Canvas Host `aos-url` entries only for existing AOS components, and use
`canvas-id` entries only when the helper is describing a live canvas it already
owns or was handed.

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
intent, execution map, evidence artifacts, and health state as workbench Facets.
The helper is a projection layer only; recording, replay, repair, and retirement
remain owned by the work-record model in
[`docs/design/aos-work-records-and-self-healing-recipes.md`](../design/aos-work-records-and-self-healing-recipes.md).
The Work Record payload adapter accepts both the older helper-shaped records and
schema-v0 records from `shared/schemas/fixtures/aos-work-record-v0/`. Legacy
records keep their existing edit handoff. Schema-v0 records project as
read-only `aos.work_record` Subjects with intent, execution-map postconditions,
evidence, claims, claim results, verifier report, and health Facets.

The stock work-record workbench lives at:

- `aos://toolkit/components/work-record-workbench/index.html`

It accepts `work_record.open` and `work_record.patch.result`, emits
`work-record-workbench/patch.requested`, and intentionally stays manual-first:
it edits the NL intent and execution-map JSON while displaying health and
evidence. `work_record.open` may include a file `source`, which is preserved in
snapshots and patch requests. The companion
`packages/toolkit/components/work-record-workbench/save-current.sh` helper can
persist the current edited record JSON back to that file source or an explicit
output path. Schema-v0 records are opened read-only and do not emit patch
requests. It does not record, replay, repair, or retire recipes by itself.

The public Work Record facade lives at
`packages/toolkit/workbench/work-record.js`. Consumers that need Work Record
build, verify, evidence-adapter, adapter, or subject-projection operations should
prefer that facade over importing multiple Work Record internal helper files.
The facade is shallow; behavior remains owned by the focused helper modules it
re-exports.

`packages/toolkit/workbench/work-record-verifier.js` exposes a deterministic
report-only checker for schema-v0 records. It validates internal claim,
postcondition, evidence, verifier-report, and health references, derives
verifier indexes from `claim_results[]`, reports diagnostics, and never mutates
the record. Replay and repair remain gated by explicit workflow policy fields.
The named profile entrypoint is:

```js
runWorkRecordVerifierProfile(record, {
  profileId: 'aos.verifier.work-record.v0.report-only',
})
```

`packages/toolkit/workbench/work-record-capture.js` exposes the first narrow
capture builders. `buildWorkRecordV0FromCommandEvidence()` turns one bounded
repo command evidence source into a completed Work Record v0.
`buildWorkRecordV0FromAosActionEvidence()` does the same for one saved AOS
`see -> do -> see` action evidence source, preserving before perception, action
metadata, after perception, target dialect, Target-with-Ref, State IDs where
available, immutable evidence refs, Claims, Postconditions, Claim Results, a
Verifier Report, and Health. This is report-only substrate for later browser,
canvas, or Playbook steps; it does not add replay, repair, or a broad CLI
command surface.

## Stock Components Snapshot

Current reusable toolkit components include:

- `aos://toolkit/components/inspector-panel/index.html` - AX element inspector fed by `aos inspect`
- `aos://toolkit/components/log-console/index.html` - scrolling log console fed by `aos log`
- `aos://toolkit/components/integration-hub/index.html` - provider-neutral chat integration dashboard backed by the local integration broker snapshot API
- `aos://toolkit/components/canvas-inspector/index.html` - canvas lifecycle and minimap inspector with optional live cursor and mouse-event overlays
- `aos://toolkit/components/spatial-telemetry/index.html` - live coordinate tables + event log for display, canvas, cursor, and object-mark debugging
- `aos://toolkit/components/render-performance/index.html` - live framerate, frame-time, and coarse renderer telemetry panel
- `aos://toolkit/components/wiki-kb/index.html` - wiki graph browser with force-graph and mind-map views
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

Graph `nodes[].type` is a wiki page kind for the force graph and mind map
legend. It is intentionally separate from Workbench Subject `subject_type`.
The V0 page-kind vocabulary is `page`, `concept`, `entity`, `workflow`, and
`reference`; incoming compatibility payloads normalize legacy `agent` to
`entity` and plugin reference pages to `reference` before deriving available
types or legend entries.

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
  MENU_ACTIVATION_PHASES,
  createMenuActivationRequest,
  advanceMenuActivation,
} from 'aos://toolkit/runtime/index.js'
```

### Menu Activation Model

`packages/toolkit/runtime/menu-activation.js` defines the provider-neutral
activation envelope for menu-like surfaces. It is intentionally independent of
radial geometry, 3D rendering, and Sigil-specific actions.

Canonical phases are:

```js
[
  'requested',
  'item_transition',
  'menu_transition',
  'surface_transition',
  'completed',
  'cancelled',
  'failed',
]
```

Use `createMenuActivationRequest({ menuId, item, input, source, targetSurface,
transition })` when a menu item commits. The request keeps legacy
`input` / `source` string fields, but also includes `input_source` for richer
click, gesture, keyboard, or accessibility metadata. `surface` and
`target_surface` are aliases for the requested destination surface descriptor.

Use `advanceMenuActivation(request, phase, extra?)` to move through the
lifecycle. Unknown phases throw, so provider or app mismatches fail loudly
instead of creating ad-hoc status names.

`packages/toolkit/runtime/radial-item-transition.js` defines the companion
transition contract for 3D radial menu items. The vanilla preset,
`radial-3d-vanilla`, describes item focus/zoom/hold, menu fade/dissolve, incoming
surface fade, and cancel restore slots. Consumers can put an
`activationTransition` object on a radial item to override those slots without
mixing transition state into static geometry tuning data. Use
`resolveRadialItemActivationTransition(item)` before attaching the result to a
menu activation request.

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
  createPanelTransferController,
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
  wirePanelTransferDisplayGeometry,
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
| `drag` | `object` | optional drag controller settings; stock chrome clamps final placement and enables cross-display transfer by default |
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
  `wireDrag(..., { clampOnEnd: true, transfer: true })` to opt into the same
  cross-display behavior
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
`drag_start` / `drag_end`, returns the drag controller, and accepts `onStart` /
`onEnd` hooks for custom surfaces such as workbenches that need to restore from
maximized state before moving. When `transfer: true`, the controller subscribes
to `display_geometry`, sends destination-outline layers to the shared
DesktopWorld stage, reports `state.transferActive` while that outline is active,
and on release moves the panel to the destination outline frame. Stock panel and
workbench styles dim the origin surface to `0.75` opacity during transfer. The
stage is best-effort: if it is not running, release placement still uses the
computed destination display frame.

`createPanelTransferController(options?)` is the lower-level transfer state
machine used by `createDragController`. It computes destination display outlines
from daemon display geometry and sends `desktop_world_stage.layer.upsert/remove`
messages to the shared stage.

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
