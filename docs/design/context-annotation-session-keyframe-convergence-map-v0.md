# Context Annotation Session + Keyframe Convergence Map V0

Status: planning map with implemented convergence checkpoints.

This note maps the current annotation, snapshot, and recording concepts onto
one canonical model family. It started as a contract-first plan. The current
implementation now includes the context session/keyframe foundation, the
`aos_context_recording` contract, Surface Inspector and Sigil reticle adapters,
canonical radial camera and see-bundle context exports, a deterministic
Selection Mode helper, a live Sigil Selection Mode runtime path, and a
renderer-local active context provider. It still does not rename schemas, remove
compatibility artifacts, add a full recorder UI, or add always-on pointer
capture.

## Evidence Basis

Current repo state shows these accepted boundaries:

- `packages/toolkit/workbench/annotation-session.js` defines the shared
  in-memory `aos_annotation_session` model.
- `packages/toolkit/workbench/annotation-candidates.js` defines neutral
  candidate construction, normalization, direct-child filtering, and ranking.
- `packages/toolkit/workbench/annotation-overlay-renderer.js` renders
  `aos_annotation_session` into display overlay groups.
- `packages/toolkit/workbench/surface-inspector-annotations.js` adapts Surface
  Inspector pins/comments into `aos_annotation_session` and produces the public
  `surface_inspector_annotation_snapshot` artifact.
- Sigil's reticle controller writes the shared session shape and commits
  preview paths with `commitAnnotationPreview`.
- `ctrl+opt+c` and Sigil radial camera bundle requests route through
  `canvas_inspector.capture_bundle`; the daemon preserves that transport while
  adding canonical `context-session.json` and `context-keyframe.json` files or
  clipboard fields beside the compatibility annotation snapshot.
- `aos see cursor`, `aos inspect`, `surface-hit-test-inspect`, AX/window
  evidence, semantic targets, and browser DOM bridge evidence are acquisition
  or diagnostic inputs, not separate annotation truth stores.

## Inventory

| Surface or artifact | Current owner | Current shape | Classification | Convergence disposition |
| --- | --- | --- | --- | --- |
| Neutral annotation session | Toolkit workbench: `annotation-session.js` | `aos_annotation_session` with root, committed/preview scope stacks, hover candidate, anchors, optional `comment_text`, projection/status, and `snapshot_count` | Canonical candidate | Keep as canonical V0. Harden into the canonical session/artifact boundary rather than replacing it. |
| Annotation candidate helpers | Toolkit workbench: `annotation-candidates.js` | Normalized candidates, adapter capability summaries, scoped direct-child filtering, decision reports | Support primitive | Keep as shared acquisition support for reticle, Selection Mode, Surface Inspector, and future exporters. |
| Annotation overlay renderer | Toolkit workbench: `annotation-overlay-renderer.js` | Session-to-render-plan helper with committed frames, preview frames, hover, comment chips, and stale/blocked states | Support primitive | Keep adapter-neutral. It should render canonical sessions, not own acquisition or persistence. |
| Sigil reticle session and overlay | Sigil app: `annotation-reticle.js`, `main.js`, `interaction-overlay.js` | `annotationReticle` debug state wrapping `aos_annotation_session`; live overlay projected into Sigil scene | Acquisition surface | Keep as top-down, intent-first authoring. It should write canonical context artifacts and export canonical keyframes. |
| Sigil radial camera action | Sigil app radial menu plus daemon bundle route | `annotation-camera` posts `canvas_inspector.capture_bundle` with trigger `sigil_radial_camera` after live anchors exist | Export trigger | Keep as a shutter. It should request a canonical context keyframe, with Surface Inspector bundle output only one transport. |
| Surface Inspector pins/comments/state | Toolkit component plus `surface-inspector-annotations.js` | `surface_inspector_annotation_state` with frame pins, comments, active edge/frame, scope stack, projection refresh, reveal/debug state | Compatibility layer and support/editor surface | Demote from truth owner. Keep as diagnostic/editor/export support and adapter until canonical session state can be inspected directly. |
| Surface Inspector annotation snapshot | Shared schema and daemon bundle export | `surface_inspector_annotation_snapshot` with capture metadata, embedded `session`, pins/comments, blockers, reveal, and source state | Compatibility export artifact | Keep public V0 for existing bundles. Add a new canonical keyframe wrapper when broadening beyond Surface Inspector. |
| Surface Inspector see bundle export | Daemon: `surface-inspector-bundle.swift` | `canvas_inspector_see_bundle` directory or `canvas_inspector_see_bundle_clipboard_payload` with optional annotation snapshot | Export transport | Keep as transport. It should include canonical context keyframe data without making Surface Inspector the source of truth. |
| `ctrl+opt+c` see bundle | Daemon config under `see.canvas_inspector_bundle.*` | Hotkey-triggered Surface Inspector bundle with `annotation-snapshot.json` when enabled | Export transport | Keep hotkey behavior. Later include canonical keyframe/session from the active context-session provider. |
| `aos see cursor` | CLI/native perception: `src/perceive/cursor.swift` | One-shot cursor, display, frontmost window, and AX element payload | Acquisition evidence primitive | Keep as evidence source for Selection Mode and diagnostics; do not make it an annotation model. |
| `aos inspect` | CLI/toolkit inspector panel | Live AX overlay showing element and cursor messages | Diagnostic primitive | Keep as live inspection support; not a context artifact owner. |
| Surface hit-test inspect | Toolkit/script/tests | Fixture-based hit-test reports and annotation drafts for representative surfaces | Support/debug primitive | Keep for adapter validation and Selection Mode test seeding; map selected candidates into canonical acquisition evidence. |
| Show Me / recording contract | Design work card and current guided-user-signal concepts | Ordered records over annotation sessions/snapshots, actions, blocker states, and comments | Migration candidate | Fold into the keyframe/recording family. Use canonical keyframes plus events, not a separate annotation model. |

## Canonical Vocabulary

Use these terms for new contracts and product-facing docs:

- **Context session**: a live, in-memory workspace-context authoring session.
  It may contain one or more context artifacts and an ordered keyframe list. The
  current `aos_annotation_session` is close enough to be V0 of this concept, but
  it needs a context/artifact layer for multiple independent selections.
- **Context artifact**: one authored unit of context inside a session. It has a
  root-to-leaf path, an active target selected from that path, acquisition
  evidence, comments, projection state, and keyframe membership.
- **Path node**: one root, ancestor, active, or leaf subject in an artifact path.
  New product docs should prefer "path node", "scope", or "frame"; internal
  compatibility names such as `pin` may remain behind adapters.
- **Active target**: the node the user means. It may be the clicked/hovered leaf
  or any ancestor chosen through reticle drill-down or Selection Mode
  disambiguation.
- **Acquisition evidence**: the facts that led to an artifact or path node:
  pointer point, clicked leaf, hovered target, AX/window/DOM/semantic candidate,
  candidate rankings, rejection reasons, source event ids, and adapter blockers.
- **Anchor/frame**: the displayable attachment for a path node or target. A
  frame can be commentless; an anchor may also have comments.
- **Comment**: human or agent text attached to any path node, anchor, or
  artifact. Product copy should say "comment"; `comment_text` can remain the V0
  internal field until multi-comment support lands.
- **Snapshot/keyframe**: a point-in-time capture of the context session or a
  subset of artifacts plus projection/evidence state. "Snapshot" can remain the
  human-facing shutter word; "keyframe" is the machine-readable recording unit.
- **Recording**: an ordered sequence of keyframes plus optional user/action/text
  events between them. A recording is not a video file and not a persistent live
  annotation database.

Compatibility names that can remain temporarily:

- `aos_annotation_session`: keep as the canonical in-memory session schema name
  for V0.
- `surface_inspector_annotation_snapshot`: keep as the public Surface Inspector
  bundle artifact name.
- `pin`, `frame_pin`, and Surface Inspector row/action names: keep inside the
  Surface Inspector compatibility adapter and UI until canonical artifacts can
  fully replace those data paths.
- `annotation_snapshot`: keep as a transport/file key in see bundles while
  adding canonical keyframe fields alongside it.

## Target Model Sketch

The target model should be a small extension around the existing session, not a
parallel rewrite. The canonical shape needs to support multiple artifacts in
one session, each with a path, active target, leaf evidence, comments, and
per-node projection or blocker state.

```json
{
  "schema": "aos_context_session",
  "version": "0.1.0",
  "session_id": "context-session:2026-05-28T12:00:00Z",
  "active": true,
  "entry_source": "sigil_radial|selection_mode|surface_inspector|hotkey|status_menu",
  "artifacts": [
    {
      "id": "context-artifact:primary-cta",
      "kind": "frame|comment|selection|workspace_moment",
      "path": [
        {
          "id": "node:display",
          "address": "subject:display:1",
          "role": "display",
          "label": "Built-in Display",
          "projection": { "current_render_status": "visible" },
          "blocker": null,
          "comments": []
        },
        {
          "id": "node:window",
          "address": "subject:macos-ax:native-window:195",
          "role": "native_window",
          "label": "Comet",
          "projection": { "current_render_status": "visible" },
          "blocker": null,
          "comments": [
            {
              "id": "comment:window-1",
              "text": "This is the intended app context.",
              "actor": { "role": "operator", "id": "human" }
            }
          ]
        },
        {
          "id": "node:leaf",
          "address": "subject:aos-browser-dom-element-picker:button-submit",
          "role": "button",
          "label": "Submit",
          "projection": { "current_render_status": "visible" },
          "blocker": null,
          "comments": []
        }
      ],
      "active_target_node_id": "node:window",
      "acquisition": {
        "mode": "selection_mode",
        "pointer": { "x": 450, "y": 280, "coordinate_space": "desktop_world" },
        "leaf_node_id": "node:leaf",
        "selected_node_id": "node:window",
        "candidate_report": {
          "selected": "node:leaf",
          "rejected": [],
          "fallback_reason": ""
        }
      },
      "anchors": [
        {
          "id": "anchor:window",
          "node_id": "node:window",
          "status": "live",
          "projection": { "can_project_display_overlay": true },
          "comments": ["comment:window-1"]
        }
      ],
      "source_session_ref": {
        "schema": "aos_annotation_session",
        "anchor_addresses": ["subject:display:1", "subject:macos-ax:native-window:195"]
      }
    }
  ],
  "keyframes": [
    {
      "id": "keyframe:001",
      "captured_at": "2026-05-28T12:00:03.000Z",
      "trigger": "sigil_radial_camera",
      "artifact_ids": ["context-artifact:primary-cta"],
      "session": { "schema": "aos_annotation_session", "version": "0.1.0" },
      "asset_refs": {
        "surface_inspector_annotation_snapshot": "annotation-snapshot.json"
      }
    }
  ],
  "recording": {
    "id": "recording:demo",
    "keyframe_refs": ["keyframe:001"],
    "events": [
      {
        "id": "event:001",
        "kind": "user_action|text|blocker|agent_note",
        "after_keyframe_id": "keyframe:001"
      }
    ]
  }
}
```

Minimum representation for multiple selections across different surfaces:

- one session id;
- one artifact per selected/contextual subject;
- each artifact path with normalized node addresses;
- one active target per artifact;
- one leaf evidence record per acquisition event;
- per-node projection/blocker state;
- comments attached by node or anchor id;
- keyframes that list artifact ids and current projection/evidence refs.

This is enough for several selections to "paint a picture" of a workspace
moment without requiring a recorder UI or persistent database.

## Mode Mapping

### Reticle Mode

Reticle mode is top-down, intent-first, and narrative. The user enters through
the Sigil radial reticle, starts from a display/root scope, drills into
children, and can attach commentless frames or comments at nested levels.

Current Sigil behavior already maps to the canonical line:

- entry source is `sigil_radial`;
- preview and release use shared annotation candidates;
- release commits the preview stack into `aos_annotation_session` anchors;
- camera availability derives from live anchors;
- the radial camera posts a snapshot/export request.

Required convergence:

- expose committed reticle artifacts as canonical context artifacts, not only
  Sigil debug state;
- preserve candidate decision reports and fallback reasons as acquisition
  evidence;
- make the radial camera capture a canonical keyframe, with see-bundle output as
  one transport.

### Selection Mode

Selection Mode is bottom-up, object-first, and disambiguating. The user clicks
a leaf, sees its ancestor chain, chooses the intended scope, and preserves both
the clicked leaf and selected target.

The donor browser extension is useful only as a reference pattern: it collects a
visible ancestor chain, skips visually identical ancestors, derives human labels
and selectors, and keeps overlays positioned from current element rectangles.
The canonical AOS implementation should generalize that idea across AX,
semantic targets, canvas/window subjects, browser DOM, and other adapters.

Required convergence:

- the clicked leaf becomes acquisition evidence;
- the selected ancestor or leaf becomes `active_target_node_id`;
- the full ancestry becomes the artifact path;
- comments can attach to any node or anchor in that path;
- output writes the same context artifact/session family as reticle mode.

### Surface Inspector

Surface Inspector should remain diagnostic/editor/export support. It is valuable
for current path display, adapter evidence, projection blockers, reveal state,
snapshot export, tree/list debugging, and compatibility editing. It should not
be the sole owner of annotation truth.

Required convergence:

- keep `surfaceInspectorAnnotationStateToSession` as a compatibility adapter;
- add a path for Surface Inspector to inspect/edit canonical session artifacts;
- preserve `surface_inspector_annotation_snapshot` as a bundle artifact until a
  canonical keyframe wrapper fully covers downstream consumers.

## Delta Map

### Build

- Add a canonical context session/artifact/keyframe design and schema layer
  around `aos_annotation_session`.
- Add artifact-level support for multiple independent selections in one
  session.
- Add acquisition evidence records that preserve pointer, clicked leaf,
  selected target, candidate reports, source event ids, and fallback/blocker
  reasons.
- Add canonical keyframe export that can include existing
  `surface_inspector_annotation_snapshot` as a compatibility asset.
- Add a recording contract as ordered keyframe refs plus optional events.

### Refactor

- Move Surface Inspector-specific `pin` state behind an adapter boundary when
  writing canonical artifacts.
- Refactor daemon bundle snapshot collection so `ctrl+opt+c` and Sigil radial
  camera can include active canonical session/keyframe data without reading
  truth only from the Surface Inspector canvas.
- Refactor Sigil radial camera export from "ask Surface Inspector bundle owner"
  toward "capture active context keyframe, optionally through see-bundle
  transport."

### Migrate

- Migrate Surface Inspector pins/comments into canonical artifacts when an
  active context session exists.
- Migrate Sigil reticle debug/session state into canonical context artifacts and
  keyframes.
- Migrate Show Me record language to "recording" over keyframes and events.

### Demote Or Remove

- Demote Surface Inspector pins/comments from product truth to support/editor
  compatibility state.
- Demote `surface_inspector_annotation_snapshot` from broad public canonical
  snapshot name to a Surface Inspector bundle artifact embedded or referenced by
  canonical keyframes.
- Remove compatibility names only after new writers, readers, tests, and bundle
  fixtures prove equivalent data is available through canonical fields.

### Stay As-Is

- Keep `aos see cursor` as a one-shot perception primitive.
- Keep `aos inspect` as live AX diagnostic UI.
- Keep `surface-hit-test-inspect` as representative-surface validation support.
- Keep annotation candidate helpers and overlay renderer as toolkit primitives.
- Keep current hotkey behavior while broadening what the export includes.

## Required Analysis Answers

**Is `annotation-session.js` close enough to be canonical?**

Yes for V0 in-memory authoring. It should remain the canonical session core
because it already has neutral addresses, root/preview/committed stacks,
anchors, optional comments, projection status, stale/absent/blocker handling,
and tests. It needs a sibling or wrapper for context artifacts, multiple
selections, acquisition evidence, keyframes, and recordings. Rename later only
if a schema-versioned replacement proves necessary; do not block convergence on
renaming.

**Should `surface_inspector_annotation_snapshot` remain public or be wrapped?**

Keep it public as the Surface Inspector see-bundle artifact for V0. Add a new
canonical keyframe wrapper rather than broadening the Surface Inspector-named
schema into the cross-product name. The wrapper can reference or embed the
existing artifact for compatibility.

**How should Sigil reticle sessions become visible to `ctrl+opt+c` without
making Surface Inspector truth owner?**

Expose an active context-session provider or daemon-readable canonical session
state that Sigil updates when reticle commits. `ctrl+opt+c` should ask the
active provider for canonical session/keyframe data, then include that data in
the see bundle. Surface Inspector may still render or adapt that state, but the
daemon export should not require Surface Inspector pins/comments to be the only
truth source.

**What is the minimum multi-selection representation?**

A session with artifacts. Each artifact needs a root-to-leaf path, active target
node id, clicked/hovered leaf evidence, acquisition mode/source, per-node
projection/blocker state, anchors, and comments. A workspace moment is then a
keyframe listing artifact ids plus asset/evidence refs.

**How should recordings reference snapshots?**

Use both embedded keyframes and artifact refs. A recording should order
keyframe refs for compactness and portability, while each keyframe may embed a
small canonical session/artifact snapshot and reference heavier bundle assets
such as images, xray, and the compatibility Surface Inspector annotation
snapshot.

**Which compatibility names can remain temporarily, and what gates remove
them?**

`aos_annotation_session`, `surface_inspector_annotation_snapshot`,
`annotation_snapshot`, `pin`, and `frame_pin` can remain temporarily. Remove or
hide old names only after canonical session/artifact/keyframe schemas exist,
Sigil and Surface Inspector both write/read them, see-bundle fixtures include
canonical keyframes, adapter round trips pass, and docs stop naming Surface
Inspector as the truth owner.

## Implementation Ladder

### 1. Canonical Session And Artifact Hardening

Goal: define the context artifact wrapper without replacing
`aos_annotation_session`.

Likely files:

- `docs/api/toolkit/workbench.md`
- `shared/schemas/aos-context-session-v0.md`
- `shared/schemas/aos-context-session-v0.schema.json`
- `packages/toolkit/workbench/annotation-session.js`
- `tests/toolkit/annotation-session.test.mjs`
- new schema fixtures/tests if schema work stays bounded

Tests:

- artifact path can include root, ancestor, active target, and leaf;
- active target can differ from clicked leaf;
- comments attach to nodes/anchors;
- projection/blocker state survives normalization;
- V0 `aos_annotation_session` still round-trips.

### 2. Surface Inspector Adapter Demotion

Goal: make Surface Inspector a writer/reader adapter for canonical artifacts.

Likely files:

- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.md`

Tests:

- pins/comments convert to canonical artifacts and back;
- old `surface_inspector_annotation_snapshot` still validates;
- stale, absent, reveal, and blocker evidence remains explicit;
- Surface Inspector rows stay diagnostic/editor support.

### 3. Sigil Reticle Canonical Write And Export Path

Goal: reticle commits create/update canonical context artifacts alongside the
existing session snapshot.

Likely files:

- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`

Tests:

- reticle commit produces a canonical artifact;
- candidate decision reports become acquisition evidence;
- display fallback remains explicit;
- comments and nested scope paths can map to artifact nodes.

### 4. Radial Camera And `ctrl+opt+c` Canonical Keyframe Inclusion

Goal: both export triggers include canonical keyframes while preserving current
bundle behavior.

Likely files:

- `src/daemon/surface-inspector-bundle.swift`
- `apps/sigil/renderer/live-modules/main.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `tests/surface-inspector-see-bundle.sh`
- `tests/surface-inspector-see-bundle-config.sh`
- `tests/renderer/annotation-reticle.test.mjs`

Tests:

- radial camera request includes the active canonical keyframe/session;
- `ctrl+opt+c` includes canonical keyframe data when available;
- `annotation-snapshot.json` remains present when configured;
- source canvas and bundle owner evidence remain clear.

### 5. Selection Mode Acquisition Path

Goal: implement leaf-up ancestry disambiguation as another acquisition mode,
writing the same artifacts.

Implemented checkpoint: `packages/toolkit/workbench/selection-mode.js` exposes
`createSelectionModeContextSession(input)` and `selectionModeContextArtifact`.
The helper accepts pointer/click evidence, a clicked leaf candidate, ordered
root-to-leaf candidates, selected target id/address, ambiguity/rejection/skipped
ancestor reports, adapter blockers, and comments. It returns an
`aos_context_session` with one artifact whose `acquisition.mode` is
`selection_mode`, preserving both `leaf_node_id` and `selected_node_id`.
Sigil now has a live runtime path: double-clicking the avatar enters Selection
Mode, an active-only daemon input-region claim captures Selection Mode clicks,
and the existing interaction overlay draws cursor decoration, target highlights,
and ancestor badges. A selection click populates `selectionMode.leaf_candidate`,
`path_candidates`, `selected_node_id`, `context_session`, `events`, and
`blocker`; keyboard/debug selection can move the active target from the clicked
leaf to an ancestor before commit. `Escape`, cancel, successful commit, or a
second avatar double-click exits without adding an always-on capture canvas or
pointer stream watcher.

The debug construction entry point remains:
`window.__sigilDebug.createSelectionModeContext(input)`. Additional debug hooks
attach comments to path nodes and append/export ordered context recordings from
the active context keyframe.

Likely files:

- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/surface-hit-test-inspect.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- Selection Mode and Sigil renderer tests.

Tests:

- clicked leaf and selected target can differ;
- full ancestry is preserved;
- candidate ambiguity is explicit;
- no fresh expensive discovery on every pointer move;
- output artifact matches reticle-created artifact shape.

### 6. Keyframe And Recording Contract

Goal: define recording as ordered keyframes plus optional events.

Likely files:

- `docs/design/show-me-record-contract-v0.md` or successor note
- `docs/api/toolkit/workbench.md`
- `shared/schemas/aos-context-keyframe-v0.md`
- `shared/schemas/aos-context-recording-v0.md`
- schema fixtures/tests

Tests:

- keyframes can embed compact session/artifact data and reference bundle assets;
- recordings preserve keyframe order;
- optional text/action/blocker events validate;
- no video/blob requirement is introduced.

### 7. Cleanup And Removal Gates

Goal: remove compatibility leakage only after consumers converge.

Gates:

- canonical context session/artifact/keyframe schema docs are stable;
- Sigil reticle and Surface Inspector both write canonical artifacts;
- radial camera and `ctrl+opt+c` exports include canonical keyframes;
- old bundle fixtures still validate during the compatibility window;
- new fixtures prove canonical data covers all old snapshot fields needed by
  consumers;
- product docs no longer treat Surface Inspector as the annotation truth owner.

## Test Plan

- Unit tests for canonical session/artifact behavior: multiple artifacts,
  root-to-leaf paths, active target selection, commentless frames, multiple
  comments, projection states, stale/absent/blocker preservation.
- Adapter round-trip tests for Surface Inspector: pins/comments/state to
  canonical artifacts, canonical artifacts back to support rows, and snapshot
  compatibility output.
- Reticle commit tests proving canonical artifacts: projectable semantic/native
  candidates, display fallback, nested scope commits, camera availability, and
  preserved acquisition evidence.
- Selection Mode tests: clicked leaf ancestry, selected ancestor, ambiguous
  candidates, adapter blockers, artifact output parity with reticle mode, live
  state wiring, active-mode click capture, escape/cancel paths, overlay output,
  and comment preservation.
- Snapshot/export tests for radial camera and `ctrl+opt+c`: bundle path mode,
  clipboard payload mode, canonical keyframe inclusion, compatibility
  annotation snapshot inclusion, source canvas evidence, and disabled toggles.
- Recording/keyframe schema tests: ordered keyframes, refs to context artifacts,
  optional event ordering, blocker events, text events, and asset refs without
  embedded image binary.
- Visual/runtime smoke tests only after runtime behavior changes: reticle live
  smoke, Surface Inspector support view smoke, and Selection Mode
  human-in-the-loop smoke. Route those later checks through
  `tests/README.md` and
  `docs/guides/test-harness-ladder-and-prep.md` before choosing live,
  supervised, visual, or daemon-level evidence.

## Open Questions / Product Decisions

- Should the product-facing name be "context session", "annotation session", or
  "workspace moment" in user-visible UI? Recommendation: "context" for product
  surfaces, `annotation` for compatibility internals.
- Should comments support multiple entries per node in the first canonical
  schema, or should V0 retain single `comment_text` and reserve
  `comments[]`? Recommendation: model `comments[]` now, adapt single
  `comment_text` into one comment.
- Which surface owns the active context-session provider beyond Sigil V0:
  daemon state, toolkit shared module, or app-published session events?
  Recommendation: keep the current Sigil renderer-local provider for V0, then
  add a daemon-visible provider/event channel when another app or `ctrl+opt+c`
  needs cross-renderer active context.
- How much of a keyframe should be embedded versus asset-referenced?
  Recommendation: embed compact canonical context data; reference heavyweight
  images, xray, and compatibility bundle artifacts.
- When should compatibility names be renamed? Recommendation: after export
  parity and fixture coverage, not before.

## Proposed First Slice

Start with canonical session/schema hardening: define `aos_context_session`
and/or `aos_context_artifact` as a wrapper around `aos_annotation_session`
without changing runtime behavior. This is the smallest reversible slice that
unblocks Surface Inspector demotion, Sigil reticle export, Selection Mode, and
recording without forcing a hotkey or UI change.
