# Toolkit Workbench API

Consumer-facing reference for workbench contracts, subject models, human checkpoint flows, HTML and Markdown workbench expressions, work records, artifact bundles, playbooks, and wiki workbench subjects. Stock component surfaces live in [components.md](./components.md).

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
[`shared/schemas/aos-workbench-subject.schema.json`](../../../shared/schemas/aos-workbench-subject.schema.json)

V-next schema design notes:
[`shared/schemas/aos-workbench-subject-vnext.md`](../../../shared/schemas/aos-workbench-subject-vnext.md)
and
[`shared/schemas/aos-subject-capabilities.md`](../../../shared/schemas/aos-subject-capabilities.md)

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

### Annotation Session V0

`packages/toolkit/workbench/annotation-session.js` provides the neutral
display-first in-memory Annotation Mode session model. It is shared toolkit
state for future display overlays, Surface Inspector support views, and Sigil
reticle entry; it is not a persistent annotation database.

Sessions use schema `aos_annotation_session` version `0.1.0` and carry
`active`, `entry_source`, `root`, `committed_scope_stack`,
`preview_scope_stack`, `hover_candidate`, `anchors`, `snapshot_count`, and
`updated_at`. Subject addresses are authoritative. Projection records are copied
only as current evidence, so absent or stale subjects use `absent` or `stale`
anchor status rather than preserving old overlay rectangles as truth.

Frames are represented as anchors whose `comment_text` is an empty string.
Adding comment text updates the anchor at the same subject address or creates a
new anchor with text. Hover candidates update preview state only, while
committing preview creates or updates anchors for the selected scope chain.
Clearing or exiting resets live session state and preserves `snapshot_count`;
snapshots remain explicit point-in-time artifacts.

The display-first opacity helper is:

```js
import { opacityForDepth } from '../workbench/annotation-session.js'
```

`opacityForDepth(index, count, floor = 0.75)` returns `1` for the current or
only frame, `0.75` for the outer/root frame when ancestry exists, and evenly
interpolates intermediate frames between those values.

### Annotation Overlay Renderer V0

`packages/toolkit/workbench/annotation-overlay-renderer.js` converts an
`aos_annotation_session` into an adapter-neutral display overlay render plan.
The renderer is pure toolkit policy: it does not discover AX, DOM, CDP, or
canvas state, and it does not create overlay canvases. Callers provide the
current session and projection evidence; the renderer groups frames and chips by
target display/root/canvas and emits stable signatures for idempotent updates.

Render plans use schema `aos_annotation_overlay_render_plan` version `0.1.0`.
Each group carries `target`, `committed_frames`, `preview_frames`,
`hover_candidate`, `comment_chips`, optional `active_comment_input`, and
explicit `frame_states` for stale, absent, blocked, or non-projectable records.
Each group also carries its own `signature` so overlay consumers can update one
target without treating the whole plan as changed.
Live frame rectangles require current visible projection evidence. Last-known
rectangles are retained only as `evidence_rect` on non-live states and must not
be treated as live overlay truth.

Use:

```js
import { buildAnnotationOverlayRenderPlan } from '../workbench/annotation-overlay-renderer.js'
```

`buildAnnotationOverlayRenderPlan(session)` applies the display-first opacity
ladder from `annotation-session.js`, keeps committed, preview, and hover frames
distinguishable, renders commentless anchors as frames, and emits comment chips
only for anchors with non-empty `comment_text`.

### Annotation Candidate Helpers V0

`packages/toolkit/workbench/annotation-candidates.js` owns neutral annotation
candidate construction, normalization, and ranking for toolkit and app
consumers:

```js
import {
  buildNativeAxElementAnnotationCandidate,
  buildNativeWindowAnnotationCandidate,
  chooseAnnotationCandidate,
  normalizeAnnotationAdapterCapabilitySummary,
  normalizeAnnotationCandidate,
  normalizeAnnotationProjectionCapabilities,
} from '../workbench/annotation-candidates.js'
```

`chooseAnnotationCandidate(candidates, point)` ranks visible, projectable
candidates and filters implicit desktop/display roots. It prefers specific
semantic or actionable subjects over broad passive containers. Native macOS AX
candidate builders emit `macos-ax` annotation candidates using native window
roots, keep bounded AX elements scoped to the selected native window root, and
preserve stale or unsupported blocker reasons when cursor evidence no longer
matches or bounded projection is unavailable.

### Surface Inspector Annotation Support V0

`packages/toolkit/workbench/surface-inspector-annotations.js` owns Surface
Inspector annotation compatibility and support helpers. It converts current
Surface Inspector pin/comment state into the neutral `aos_annotation_session`
boundary, builds snapshot artifacts, and handles settled reprojection:

```js
import {
  surfaceInspectorAnnotationStateToSession,
  markSurfaceInspectorAnnotationProjectionsStale,
  refreshSurfaceInspectorAnnotationProjectionsFromEvidence,
} from '../workbench/surface-inspector-annotations.js'
```

`surfaceInspectorAnnotationStateToSession(state)` is the compatibility adapter
for the current Surface Inspector support path. Surface Inspector see-bundle
snapshots use it to embed the session-derived root, committed and preview
scopes, hover candidate, anchors, comments, projection states, stale/blocker
evidence, and `snapshot_count` in the public `annotation-snapshot.json`
artifact without making the snapshot artifact the source of truth for future
live annotations. Future entry paths should produce the shared session model
directly instead of adding more product-specific adapters to the neutral
session or renderer modules.

`markSurfaceInspectorAnnotationProjectionsStale(state, reason)` marks saved frame
anchors, committed scope entries, preview/hover evidence, and support diagnostics
as stale without dropping subject addresses, comments, or scope paths. Stale
projection records clear live `display_space_rect` values so display overlays do
not draw old rectangles as truth.

`refreshSurfaceInspectorAnnotationProjectionsFromEvidence(state, evidence)` uses
already-available bounded evidence, such as canvas frames, AOS semantic target
broadcasts, native window events, or native AX focus events, to restore live
projections after a source settles. If no matching source evidence exists, the
anchor remains present with blocker reason `projection_refresh_source_missing`.
Canvas Inspector exposes `projection_refresh` in annotation snapshots and debug
state so support surfaces can show pending settle reason, refresh generation,
and the last refresh result.

### Guided User Signal Session V0

`packages/toolkit/workbench/guided-user-signal-session.js` defines the first
provider-neutral Guided User Signal Session record and a small reusable shell
plan for "show me what you mean" checkpoints. The contract is
`aos.guided-user-signal.session.v1` and the canonical schema is
[`shared/schemas/aos.guided-user-signal.session.v1.json`](../../../shared/schemas/aos.guided-user-signal.session.v1.json).

A session record links one paused source operation to one live subject, a set of
simple guidance descriptors (`callout`, `highlight`, `arrow`, `label`, or
`overlay`), one capture request (`click`, `point`, `region`, or `annotation`),
one optional capture result, optional gate/continuation/resume-event links,
lifecycle state, runtime-mode storage, and explicit redaction policy for prompt
bodies, free text, and answer payloads. Prompt bodies and answer payloads are
redacted by default.

The toolkit owns reusable presentation policy only. `buildGuidedUserSignalShellPlan`
turns a durable record into a render/capture plan that can draw guidance and
collect one response. Native mouse capture remains daemon-owned through
`input_region` or future `daemon_native_full_screen_input_capture`; the shell
plan records that boundary as `input_boundary.authoritative_input_owner:
"daemon"`. A toolkit surface must pair visual overlays with daemon input
regions or native input streams rather than making a full-screen WebView the
input owner.

When a guided session includes a gate question, the toolkit plan carries the
deferred continuation id and points callers at the runtime
`submitGateContinuation()` helper. Guided sessions must not duplicate
`gate.submit` logic and must not give WebView content arbitrary command
execution.

Use:

```js
import {
  GuidedUserSignalSessionStore,
  buildGuidedUserSignalShellPlan,
  completeGuidedUserSignalSession,
  createGuidedUserSignalSession,
} from '../workbench/guided-user-signal-session.js'
```

`GuidedUserSignalSessionStore` writes records under
`$AOS_STATE_ROOT/{repo|installed}/guided-user-signal/sessions/` or
`~/.config/aos/{repo|installed}/guided-user-signal/sessions/` when no override
is set. Terminal completion is idempotent: after a session reaches `captured`,
`gate_submitted`, `dismissed`, `cancelled`, `expired`, or `error`, later
completion attempts return the existing terminal record unchanged.

### HTML Workbench Expression V0

`packages/toolkit/workbench/html-workbench-expression.js` builds the V0 rich
human-facing expression for supported Markdown artifacts. V0 supports only
`artifact_kind: "work_card"` and `artifact_kind: "human_alignment_pack"`. The
source Markdown remains the durable file, JSON remains the machine-readable
sidecar, and generated HTML is only the review and annotation surface. The
builder uses the shared Markdown renderer path, wraps heading sections in
stable semantic containers, preserves Mermaid fences as safe preview containers,
stamps target elements with `data-aos-ref`, `data-aos-surface`,
`data-semantic-target-id`, source path, and source line metadata, and emits a
metadata payload next to the HTML.

Generated workbench expressions follow the repo-wide generated-artifact
lifecycle policy in
[`docs/design/generated-artifact-lifecycle-policy.md`](../../design/generated-artifact-lifecycle-policy.md).
New producers must define the canonical source, generated output locator,
source hash/provenance, human-facing target map, cleanup/archive policy,
privacy/redaction policy, and the structured sidecar/result that survives if
the projection is deleted.

Canonical metadata schema:
[`shared/schemas/aos-html-workbench-expression-v0.schema.json`](../../../shared/schemas/aos-html-workbench-expression-v0.schema.json)

The fixture and CLI prove the initial work-card path:

```bash
node scripts/aos-html-workbench-expression.mjs
packages/toolkit/components/html-workbench-expression/launch.sh \
  docs/design/fixtures/aos-html-workbench-expression-v0/expression.json
```

The Employer Brand human-alignment pack fixture uses the same launch helper and
does not authorize live capture or source-page collection:

```bash
node scripts/aos-html-workbench-expression.mjs \
  --input docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md \
  --output-dir docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit \
  --output-basename human-alignment-pack.expression \
  --artifact-kind human_alignment_pack
packages/toolkit/components/html-workbench-expression/launch.sh \
  docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.expression.json
```

The metadata contract records `schema`, `version`, `expression_id`, source kind
and path, source content hash, generated timestamp, artifact kind, generated
HTML path, semantic targets, source map entries, Mermaid block records,
annotation/checkpoint/export capability flags, security policy, and resume
behavior. Each semantic target has an id, `data-aos-ref`, kind, accessible
label, source line range, selector, annotation eligibility, and reveal
eligibility.

The AOS-hosted surface lives at
`packages/toolkit/components/html-workbench-expression/`. It receives
`html_workbench_expression.open` with `{ metadata, html }`, renders the HTML in
the component DOM after stripping script elements and inline event attributes,
and exposes `window.__htmlWorkbenchExpressionState` for verification. Rendering
inside the component DOM lets Surface Inspector see the generated
`data-aos-ref` semantic targets. The surface may show repo-owned generated
markup, but source-authored script execution is not part of the contract.

Checkpoint/resume helpers emit structured sidecars. `buildHtmlWorkbenchExpressionCheckpoint`
creates a normal `aos.workbench_human_checkpoint` record whose subject type is
`html_workbench_expression`. `buildHtmlWorkbenchExpressionResumePayload` can
return `annotation_sidecar`, `decision_sidecar`, `proposed_markdown_patch`, or
`noop_approval` payloads. V0 never mutates the Markdown source automatically;
later Foreman/GDI steps decide whether to apply a proposed patch.

Security defaults are conservative: source-authored HTML is escaped by the
shared Markdown renderer, unsafe links are stripped, Mermaid source is preserved
as text/source metadata, source-authored inline event handlers are not emitted,
and source-authored JavaScript is not executed. The generated HTML fixture may
include a JSON metadata script tag with escaped content; that tag is
repo-generated data, not source-authored executable script.

### Workbench Human Checkpoint V0

`packages/toolkit/workbench/human-checkpoint.js` provides the V0 durable record
for handing an editable workbench surface to a human and resuming later without
depending on terminal state. The first concrete adapter is
`packages/toolkit/components/markdown-workbench/checkpoint.js`.

The Operator pattern is:

```text
readiness -> launch/attach surface -> human edits -> human replies -> resume -> diff/save/continue
```

Start commands must run `./aos ready` or explicitly record the caller-supplied
readiness gate before opening a surface. If readiness is blocked, the checkpoint
record uses `status: "blocked_readiness"`, includes concrete repair
instructions, and leaves `canvas_id` null. If readiness passes, the Markdown
adapter launches or attaches the Markdown Workbench, records the subject path or
wiki source, canvas id, initial content hash, diagnostics, expected human
action, and resume condition, then emits concise human-facing instructions.
Launch records only use `status: "launched"` after the Markdown Workbench
canvas exposes usable state. If the launch command or verification fails, the
record uses `status: "aborted"`, leaves `canvas_id` null, stores
`metadata.launch_attempts`, and the handoff text describes repair rather than
claiming the surface opened.

On resume, the adapter reads `window.__markdownWorkbenchState` from the recorded
canvas, compares it with the checkpoint's initial snapshot, and stores a
deterministic diff summary: changed/unchanged, line-count delta,
heading/diagnostic deltas, and a short unified diff snippet when useful.
Resume behavior is explicit: `save` persists through the existing
`markdown-workbench/save-current.sh` helper and records the resulting
`markdown_document.save.result`; `draft` preserves the edited canvas state
without saving; `abort` records that the resume was rejected.

Structured annotations are checkpoint metadata in V0. They are intent records,
not pixels: each record has an explicit ordinal, kind, surface id, source path
or URL, coordinate space, optional point and bounds, selector candidates, text
excerpt, role/label, ancestor chain, note, actor, lifecycle state, and capture
prepare/restore hints. Supported V0 kinds are `point_comment`,
`region_comment`, `element_selection`, and `selection_comment`. Status values
are `draft`, `committed`, `resolved`, and `rejected`; resolving or rejecting
keeps the record for auditability. Resume records include committed, resolved,
and rejected annotations in `resume.annotations`.

Markdown Workbench can display committed, resolved, and rejected structured
annotation intent records without editing or saving the Markdown body. Send a
`markdown_workbench.annotations.replace` message with `payload.annotations` to
load or reload the visible badge layer, and send
`markdown_workbench.annotations.clear` to clear it. The visible projection layer
can also be controlled with `markdown_workbench.annotations.show`,
`markdown_workbench.annotations.hide`, and
`markdown_workbench.annotations.toggle`.

The current inspectable `window.__markdownWorkbenchState` snapshot includes
both durable `annotations` and derived `annotation_projection`. An annotation
record is stable intent: ordinal, status, actor, note, source identity, and
anchor metadata. The projection record is current surface output: viewport,
scroll state, resolution status, viewport-local rects, and decorator placement.
Line and text-range anchors resolve to source-editor line geometry when the
source view is active, and to rendered preview elements carrying
`data-source-line` when preview geometry is available. Decorators are compact
ordinal badges placed outside the anchor rect where possible; note/details
expand on hover, click, or focus. Legacy `{ bounds, label }` screenshot records
are not displayed unless normalized into structured annotation intent records
first.

`shared/schemas/annotation-projection-v0.schema.json` is the neutral projection
result contract. In addition to legacy viewport-local annotation projections,
it carries adapter reachability results for Surface Inspector annotation rows:
`visible`, `clipped`, `offscreen_scrollable`, `virtualized`, `hidden`,
`absent`, `stale`, and `unsupported`. Adapter rows also state whether display
overlay projection and explicit `Reveal Target` are supported, include known
local/display rects and ancestor clip/scroll chains, and surface blocker
reasons without using screenshot pixels as source of truth. Browser pages,
Mermaid/SVG, 3D scenes, PDFs, images, and generic canvases are future consumers
of the same contract; each future adapter owns coordinate-system-specific
anchor resolution and returns the shared projection result rather than adding
Employer Brand-specific fields or treating annotations as fixed UI positions.
Browser seams and native AX/window payloads remain conservative slots: they may
represent explicit structured window/content bounds, but they do not pierce
arbitrary Chrome DOM or harvest broad background AX trees.

`buildBrowserContentSeamAdapterResult(record, context)` is the neutral helper
for browser session/tab/content seam diagnostics. It emits adapter id
`browser-content-seam`, subject kind `browser_content_seam`, the stable target
grammar `browser:<session>`, registry evidence such as mode, attach kind,
headless state, active URL, and local `browser_window_id`, and explicit
blockers such as `browser_session_not_local`,
`browser_content_inset_unresolved`, `browser_tab_identity_unresolved`, and
`browser_dom_cdp_deferred`. The helper always returns
`can_project_display_overlay: false` and `can_reveal: false` for the seam until
a later contract can prove a precise current content rectangle or a safe reveal
operation. Controlled browser DOM fixtures remain a separate accepted adapter
path through `browser-dom-element-picker.js` and
`controlled-browser-dom-surface.js`; their selector candidates and element
rectangles do not promote arbitrary browser-page DOM/CDP access.

`shared/schemas/spatial-subject-tree-v0.schema.json` is the neutral tree
contract above topology and projection results. Spatial topology owns
DesktopWorld, displays, windows, canvas placement, z-order, and coarse
visibility. Semantic targets describe AOS-owned child controls inside canvases.
Annotation intent records preserve what a human or agent meant, while
annotation projection records describe where that intent resolves on the
current surface. Spatial Subject Tree ties those layers together as visible or
addressable nodes with stable paths, bounds in named coordinate spaces, adapter
metadata, child-discovery state, and capabilities such as hit-test, annotate,
project annotation, action, capture, and inspect children.

Surface Inspector can consume the outer tree to explain display/window/canvas
state. A future Annotation Inspector or surface-zoom inspector can start from a
DesktopWorld point, resolve display/window/canvas through spatial topology,
enter the surface adapter, ask for the deepest adapter-owned hit target, and
then convert the selected node path into annotation intent. Live global pointer
capture, arbitrary website browsing, generic user-app AX harvesting, capture
locator repair, report/export/workflow execution, and Employer Brand capture
state changes remain outside this tree contract unless a separate bounded
adapter explicitly owns that work.

`shared/schemas/surface-hit-test-inspect-v0.schema.json` is the neutral inspect
contract between Spatial Subject Tree and Annotation Perception Verification.
It takes a surface-bound pointer-like coordinate, normalizes structured
candidate responses from a surface adapter or explicit fixture adapter, chooses
the deepest candidate whose bounds contain the point, and emits a structured
annotation draft plus an optional verification seed. The deterministic selector
orders hits by path depth, adapter confidence, smaller target area, and stable
path order; tied candidates are preserved in the case summary as ambiguity even
when a stable selection is made.

`packages/toolkit/workbench/surface-hit-test-inspect.js` provides the local
helper. It normalizes inspect requests, normalizes adapter candidate records,
converts selected candidates into draft annotation intent records, and builds
reports whose `verification_seed` entries can be passed to
`buildAnnotationPerceptionVerificationCase`. The representative CLI is:

```bash
node scripts/surface-hit-test-inspect.mjs --default-output
```

The generated report lives at
`docs/design/fixtures/surface-hit-test-inspect-v0/representative-surfaces.report.json`.
V0 includes passing structured local cases for AOS canvas semantic targets,
Markdown Workbench text ranges, controlled local HTML/DOM, and AOS-owned Mac
window/topology. Generic AX, Mermaid/SVG, Three.js, and PDF/image cases are
fixture-backed and marked with explicit missing-live-adapter blockers.

`packages/toolkit/workbench/markdown-spatial-subject-tree.js` provides a
deterministic Markdown document builder for Spatial Subject Tree V0. It loads
Markdown text, creates DesktopWorld/display/window/canvas/surface scaffolding,
models the Markdown document as the selected surface, and emits direct
surface-child nodes for headings, decision targets, tables, Mermaid blocks, and
important text ranges. Node ids and paths are stable line/slug derivatives, and
each node preserves source file identity, line ranges, text excerpts, role
metadata, adapter metadata, and capabilities.

The builder is intentionally not a rendered-pixel oracle. Bounds are synthetic,
line-based rectangles in `markdown_line_document_v0`, stored as the surface's
local `parent_local` coordinate space so existing Surface-Zoom and Hit-Test
helpers can inspect them deterministically. The adapter metadata identifies the
tree as a Markdown fixture/builder, not a live browser, AX tree, screenshot, or
capture adapter, and generated nodes keep `capture=false`.

The Employer Brand Human Alignment Pack seed is generated by:

```bash
node scripts/markdown-spatial-subject-tree.mjs
```

The checked-in fixture lives at
`docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json`
and points back to
`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md`.
It includes inspectable targets for current assumptions, company/competitor
set, desired evidence elements and the 4 visibility-adjusted executable slots,
what not to collect, the KILOS interpretation table, LinkedIn/source-unavailable
policy, report tone/direction, and the explicit human decision table.

`shared/schemas/annotation-perception-verification-v0.schema.json` is the
neutral report contract for deterministic annotation round-trip verification.
The loop is structured-only: choose a target from perception state, create an
annotation intent from that target, project/render the annotation, re-perceive
the surface through structured AOS or adapter state, and assert target identity,
bounds overlap, decorator discoverability, layer behavior, and content mutation
guards where the surface exposes them. Bounds checks use explicit
intersection-over-union ratios with a default threshold of `0.75`.

`packages/toolkit/workbench/annotation-perception-verification.js` provides the
shared helper. It builds cases from structured targets, derives annotation
intent, normalizes annotation projection results, normalizes re-perception
state, classifies cases as `passed`, `failed`, `blocked`, or
`adapter_fixture_only`, and emits a report shape that can be schema-validated.
The representative CLI is:

```bash
node scripts/annotation-perception-verify.mjs --default-output
```

The generated report lives at
`docs/design/fixtures/annotation-perception-verification-v0/representative-surfaces.report.json`.
V0 requires passing structured cases for AOS canvas semantic targets, Markdown
Workbench text ranges, and Mac window/topology. Controlled local browser/DOM
verification is represented without external browsing. Generic AX,
Mermaid/SVG, Three.js, and PDF/image cases are explicit `adapter_fixture_only`
fixtures until live deterministic adapters exist.

## Wiki And Subject Workbench Contracts

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
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/subject.json
```

The example fixture describes one HTML prototype artifact and one
Markdown/report artifact. The Employer Brand fixture is the first comparative
audit bundle: it carries a Markdown report artifact plus `sources.json`
source/provenance metadata, an Employer Brand Audit Project V0 intake fixture
under `intake/`, a project-derived Browser Evidence planning manifest skeleton
plus local-fixture Browser Evidence Capture V0 manifest and registry under
`browser-evidence/`, Company Brand Audit V0 JSON files under `company-audits/`,
one Comparative Brand Audit V0 JSON file under `comparative-audits/`, and a
linked schema-v0 Work Record fixture. Both fixtures
use one stable `aos.workbench.subject` with `subject_type:
"aos.artifact_bundle"`. The descriptors use canonical v-next fields only:
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

The launch helper opens the default example fixture or any supplied Artifact
Bundle subject fixture through the same read-only workbench path:

```bash
packages/toolkit/components/artifact-bundle-workbench/launch.sh
packages/toolkit/components/artifact-bundle-workbench/launch.sh \
  docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/subject.json
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

The inspector also renders a compact Work Record evidence summary for the
selected artifact. Before the linked record is opened, the summary shows the
artifact-scoped evidence refs. After the handoff opens the existing Work Record
Workbench path, the summary is hydrated from the linked Work Record snapshot and
surfaces evidence count, claim status, verifier status, and health state without
creating a second evidence viewer.

The inspector also surfaces source/evidence file metadata from the selected
artifact's own `files[]`, including Employer Brand Audit Project V0 intake
paths, Browser Evidence Capture V0 planning manifest skeleton, capture
manifest, registry, local fixture page, crop asset paths, and Company Brand
Audit V0 JSON paths plus Comparative Brand Audit V0 JSON paths when present.
For Browser Evidence fixtures, source metadata can also carry a read-only
planning-vs-captured coverage summary. The helper
`summarizeBrowserEvidencePlanningCoverage(planningManifest, capturedRegistry)`
compares a planning manifest with a captured registry by stable `request_id`,
reports planned and captured counts, missing planned request IDs, extra captured
request IDs, and per-company/source-category coverage rows. The Employer Brand
fixture exposes that summary on the existing Browser Evidence registry file
metadata in the Artifact Bundle inspector.
This metadata is inspectable and provenance-only inside the existing Artifact
Bundle inspector. It does not add another evidence viewer, project viewer,
company audit viewer, comparative audit viewer, browser collection route,
replay/repair control, exporter, workflow engine, or public `aos` command.

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
[`docs/design/aos-work-records-and-self-healing-recipes.md`](../../design/aos-work-records-and-self-healing-recipes.md).
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

`packages/toolkit/workbench/browser-evidence-capture.js` exposes Browser
Evidence Capture V0 for the Employer Brand audit pilot. It accepts a local
manifest shaped by `shared/schemas/browser-evidence-capture-v0.schema.json`,
opens only relative fixture, `file:`, `data:`, or localhost URLs through
`playwright-cli`, captures CSS selector and/or XPath element crops, extracts
element text, and emits an `aos.browser_evidence_registry`. The helper is a
script/test-callable bridge above the daemon; it does not add a public `aos`
command, autonomous browsing, report rendering, replay, repair, or an
AOS-native Browser Host.

`packages/toolkit/workbench/employer-brand-project-browser-evidence.js` exposes
the deterministic planning bridge from Employer Brand Audit Project V0 to
Browser Evidence Capture V0. Use
`compileBrowserEvidenceManifestFromEmployerBrandAuditProject(project)` to derive
a local-only manifest skeleton from explicit project data: the client company,
competitor companies, and applicable `source_categories[]`. The helper emits
one request per explicit company/category pair, uses local placeholder fixture
page paths and selectors, leaves KILOS evidence arrays empty instead of
inventing analysis, and records metadata flags showing that the result is a
skeleton. The wrapper script is
`node scripts/employer-brand-project-browser-evidence-manifest.mjs --project <project.json> --out <manifest.json>`.
This bridge does not collect websites, infer competitors, generate reports,
execute exports, replay, repair, run macros, create a workflow engine, or add a
public `aos` command. The checked-in Employer Brand fixture stores that compiler
output as `browser-evidence/planning-manifest-skeleton.json`; it is
planned-request provenance, not captured evidence.
The companion coverage helper compares that skeleton with the captured
`browser-evidence/registry.json` fixture and is deterministic metadata only; it
does not collect, replay, repair, browse, generate reports, execute exports, or
start a workflow.

The Employer Brand Artifact Bundle fixture demonstrates the handoff at:

```text
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/browser-evidence/manifest.json
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/browser-evidence/planning-manifest-skeleton.json
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/browser-evidence/registry.json
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/intake/project.json
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/company-audits/*.json
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/comparative-audits/*.json
```

Those files are generated or derived from a read-only project/intake fixture,
local fixture pages, and local Company Brand Audit fixtures only. They are
linked from the bundle subject plus the Work Record evidence trail as read-only
provenance. The Symphony Talent, Phenom, and Radancy fixture is one project
instance under the generic Employer Brand Audit Project V0 contract, not the
workflow itself.
