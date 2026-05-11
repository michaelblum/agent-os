# Surface Inspector Annotation Layer Foundation V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Active issue: https://github.com/michaelblum/agent-os/issues/296
- Related foundation tracker: https://github.com/michaelblum/agent-os/issues/294
- Related human-intent epic: https://github.com/michaelblum/agent-os/issues/141
- Related control-surface epic: https://github.com/michaelblum/agent-os/issues/129

## Goal

Create the first implementation slice of the Surface Inspector annotation layer.
This is the replacement direction for the confusing Surface-Zoom annotation
prototype. The center of gravity is the actual inspector layer formerly known as
Canvas Inspector, not a fixture-only Markdown preview.

The outcome should be a usable foundation for ephemeral human annotations over
visible surfaces:

1. Surface Inspector can enter and exit Annotation Mode.
2. Annotation Mode creates frame pins and flat comment leaves against Spatial
   Subject Tree nodes.
3. Surface Inspector tree, minimap, controlled display overlays, and snapshot
   bundles are synchronized views over the same annotation state.
4. Unsupported or non-projectable adapters are explicit instead of silently
   drawing stale overlays.

Do not attempt the full adapter matrix in this slice. Build the model and first
controlled path well enough that later adapter work can plug into it.

## Background

The previous Surface-Zoom work proved useful contracts, but the UX failed in the
human review loop:

- persistent gold geometry competed with the subject;
- Markdown/content previews inside an inspector confused the mental model;
- synthetic rectangles could drift from scrolled content;
- the inspector exposed too much debug state and not enough human-facing
  annotation structure.

The corrected model is Surface Inspector plus an explicit Annotation Mode.
Normal Surface Inspector usage should show the surface tree and minimap without
annotation overlays. Annotation Mode is a deliberate layer that shows one active
annotation edge/path at a time.

## Existing Code To Inspect

Start by reading the live inspector and related contracts:

- `packages/toolkit/components/canvas-inspector/index.js`
- `packages/toolkit/components/canvas-inspector/tree.js`
- `packages/toolkit/components/canvas-inspector/styles.css`
- `packages/toolkit/components/canvas-inspector/semantics.js`
- `packages/toolkit/components/canvas-inspector/marks/`
- `packages/toolkit/runtime/spatial.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/surface-hit-test-inspect.js`
- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation-projection-v0.schema.json`
- `shared/schemas/spatial-subject-tree-v0.md`
- `src/daemon/canvas-inspector-bundle.swift`
- `src/commands/serve.swift`
- `src/commands/config-command.swift`
- `tests/toolkit/canvas-inspector*.test.mjs`
- `tests/canvas-inspector-*.sh`
- `docs/api/toolkit.md`
- `docs/api/aos.md`

The existing Surface-Zoom work-card
`docs/design/work-cards/surface-zoom-annotation-mode-pin-comment-tree-v0.md`
may be used as a UX failure/reference note only. Do not implement this as
another Surface-Zoom feature.

## Scope

Work in the smallest set of files needed, likely including:

- `packages/toolkit/components/canvas-inspector/`
- `packages/toolkit/workbench/` for a neutral annotation state/model helper
- `shared/schemas/` if a first-class Surface Inspector annotation snapshot or
  state schema is needed
- `src/daemon/` and `src/commands/` only for menu, shortcut, or bundle behavior
- focused tests under `tests/toolkit/` and existing canvas-inspector shell tests
- docs at the interface boundary when behavior changes

Keep the work generic. Do not add Employer Brand fields or workflow assumptions.

## Naming

Rename user-facing "Canvas Inspector" language touched by this path to
"Surface Inspector". Keep internal file paths stable unless a narrow rename is
required for correctness. A broad file/module rename is not required in V0.

Required user-facing updates:

- inspector title should read `Surface Inspector`;
- status/menu item should say `Surface Inspector`;
- docs/test labels changed by this work should use Surface Inspector;
- existing snapshot/bundle config names may remain backward-compatible if a
  config migration would make the slice too large.

If internal compatibility names remain, document that they are legacy aliases.

## Annotation Mode Entry Points

Add Annotation Mode as a Surface Inspector layer.

Required entry points:

- Surface Inspector UI toggle in the lower/tree control area.
- Tooltip or accessible label: `Annotation Mode: on` or
  `Annotation Mode: off`.
- Global shortcut `ctrl+opt+a`:
  - if Surface Inspector is closed, open it and turn Annotation Mode on;
  - if Surface Inspector is open and Annotation Mode is off, turn it on;
  - if Annotation Mode is on, request destructive confirmation when annotations
    exist, then clear annotations, turn Annotation Mode off, and close Surface
    Inspector.
- Status/menu item:
  - rename `Canvas Inspector` to `Surface Inspector`;
  - keep it clickable/toggleable for opening and closing SI;
  - add submenu item `Annotate Mode`;
  - clicking `Annotate Mode` opens SI if needed and toggles Annotation Mode.

Preserve `ctrl+opt+c` as the snapshot shortcut.

## Destructive Clear Semantics

Annotation state is ephemeral. Turning Annotation Mode off destroys in-memory
pins/comments unless they have already been captured in a snapshot.

If annotations exist, show a basic AOS confirm panel/modal before destructive
clear:

- message should plainly state that annotations will be lost;
- confirm clears annotations and exits mode;
- cancel keeps Annotation Mode active and preserves state.

This confirmation is required for:

- toggling Annotation Mode off;
- using `ctrl+opt+a` while Annotation Mode is already on;
- unpinning a frame that has descendant pins/comments.

## Data Model

Add a neutral model for Surface Inspector annotation state. It can be a helper,
schema, fixture shape, or combination, but tests must exercise it as data rather
than only DOM.

Minimum state:

- `annotation_mode.active`
- `active_edge_id`
- `active_frame_id`
- `pins[]`
- `comments[]`
- `projection_capabilities[]`
- `last_hover_candidate`
- `last_projection_blocker`
- `snapshot_version`

Pin record:

- stable id;
- kind `frame_pin`;
- root id and root label such as `main` or `extended1` when available;
- subject id/path;
- parent pin id, nullable for root;
- depth from root;
- adapter id;
- source tree node metadata;
- current visibility/projection status;
- created_at, updated_at, actor;
- status such as `active`, `stale`, `unsupported`, or `removed`.

Comment record:

- stable id;
- kind `comment`;
- pin id;
- subject id/path;
- text;
- status such as `open`, `resolved`, or `removed`;
- created_at, updated_at, actor.

Do not store presentation-only inset geometry as authoritative annotation
bounds. Store subject identity and adapter-derived bounds/projection metadata.

## Active Edge And Opacity

Only one active edge/path is rendered at a time. An edge is the path from the
root frame to the active local frame, plus descendant comments that belong under
that frame.

Frame path rendering:

- root frames are native windows or AOS root canvases;
- root frame opacity is `1.0`;
- local frame opacity is `0.25` for multi-level paths;
- intermediate frame opacities are evenly interpolated between `1.0` and
  `0.25`;
- if there is only one frame, opacity is `1.0`;
- frame color is gold.

Comment rendering:

- comment leaves are blue;
- comments render at opacity `1.0` regardless of parent frame opacity;
- comments take z-order precedence over frame rectangles in the minimap.

Minimap z-order:

1. base surface/canvas geometry;
2. gold frame path;
3. blue comment leaves.

## Hover And Pinning

In Annotation Mode, hover should behave like an element inspector cursor within
the current active frame.

V0 should support controlled AOS canvas/window subjects already present in the
Surface Inspector tree. Other subject classes should report unsupported or
not-projectable state until adapter work lands.

Hover rules:

- prefer direct children of the currently scoped frame when available;
- if candidates overlap, choose topmost visible candidate;
- if a lower candidate has an exposed visible sliver, it may be selected only
  over that exposed region;
- never draw a display overlay for absent, hidden, clipped, or unsupported
  candidates.

Hover affordance:

- translucent gold perimeter around exactly one candidate;
- for non-leaf candidates, show two icon buttons inside the perimeter, flush
  right and vertically centered:
  - blue `+`;
  - gold pin;
- for leaf candidates, show only blue `+`.

Use toolkit controls/icons where available. Do not create a one-off visual
language if the toolkit has an existing primitive.

## Plus And Comment Flow

Clicking `+`:

- pins the hovered frame if not already pinned;
- opens a modest annotation editor overlay anchored to the frame;
- avoids overlapping existing visible comment chips when practical.

Editor fields:

- single input with placeholder `Leave a comment`;
- buttons aligned right:
  - `Cancel`;
  - `Add Comment`.

Behavior:

- `Add Comment` remains disabled until input has text;
- `Cancel` closes the overlay and keeps the pin;
- `Add Comment` creates a blue comment leaf, closes the overlay, updates the SI
  tree, minimap, and display overlay state.

Multiple comments may attach to the same pinned frame.

## Pin And Unpin Flow

Clicking the gold pin:

- pins the hovered frame;
- sets it as the active local frame;
- constrains subsequent hover to the next level down inside that frame when the
  adapter supports child hit testing;
- records a gold frame/path item in the SI annotation tree and minimap.

Unpinning:

- removes that frame from the active path;
- prunes descendant pins and comments;
- requires confirmation if descendants exist;
- moves the active local frame to the nearest surviving ancestor.

Pins without comments are valid. A frame pin is itself a useful pointer to a
screen entity.

## Surface Inspector Annotation Tree

Add an annotation tree/list region to SI. It may be a new tab/pane inside the
existing lower expandable panel, but it must feel integrated into SI rather than
like a separate debug tool.

Tree rules:

- gold rows are frame paths/pins;
- blue rows are comments;
- empty pin chains may collapse into one gold branch item;
- comments are nested under their frame;
- descendant pins under a commented level appear as gold rows at the same indent
  as comments at that level;
- order by tree/path order, then creation order.

Gold path row:

- starts with root label when available, such as `main` or `extended1`;
- shows path fragments with a delimiter;
- stays one line by default;
- truncates safely;
- full path appears in tooltip;
- clicking expands full path inline;
- expanded path includes a small copy icon.

Blue comment row:

- slightly inset below its frame path;
- shows comment text;
- clicking selects the parent edge and opens the comment editor in edit mode.

## Display Tag Chips

When a frame/path is active, show descendant comments as tag chips over their
visible projected positions.

Tag chip appearance:

- rounded rect;
- solid blue `2px` border;
- black background;
- blue text;
- comment text truncated to 15 characters plus ellipsis when needed;
- includes edit and delete icons;
- full comment in tooltip.

Clicking text or edit:

- replaces the chip with edit overlay;
- input contains current comment;
- buttons are `Cancel` and `Update`;
- `Cancel` restores unchanged chip;
- `Update` commits changes and restores chip.

Clicking delete:

- removes only the comment;
- preserves explicit/remaining ancestor pins unless pruned by unpin behavior.

## Adapter And Projection Gate

This slice must not pretend to support every surface. Add a clear projection
gate.

Adapter result must be able to say:

- projectable with current visible display rect;
- visible in minimap/tree only;
- unsupported adapter;
- stale/anchor missing;
- clipped/hidden/not rendered.

Display overlays only render for projectable records. If an anchor cannot prove
current display coordinates, it should still appear in the SI tree/minimap as
blocked, stale, or unsupported.

V0 minimum support:

- controlled AOS canvas/window geometry already represented by SI;
- controlled SI tree/minimap state;
- adapter capability reporting for macOS AX, Chrome seam, 3D/canvas, and
  generic DOM as unsupported or planned unless genuinely implemented.

Do not implement broad native AX harvesting, Chrome DOM piercing, arbitrary live
website support, or 3D object projection in this first slice unless it falls out
trivially from existing structured bounds.

## Snapshot Bundle Extension

Extend the current inspector snapshot/bundle path so `ctrl+opt+c` can include
annotation state.

Required behavior:

- snapshot works with or without active annotations;
- default sink remains compatible with current bundle behavior;
- annotation payload includes pins, comments, active edge, adapter capability
  report, and projection blockers;
- image data is not embedded in annotation JSON;
- if an existing config namespace must remain `canvas_inspector_bundle`, keep it
  backward-compatible and document the legacy name.

Do not build the full disk-write settings surface from #298 in this slice unless
it is already trivial. It is enough for V0 to ensure the snapshot payload can
carry annotation state.

## Accessibility And Semantics

Controls must have macOS-style accessible names and actions:

- Surface Inspector toggle;
- Annotation Mode toggle;
- pin;
- add comment;
- cancel/add/update/delete comment;
- copy full path;
- confirm destructive clear.

Do not add agent-only visual controls with no semantic surface.

## Non-Goals

- No Employer Brand capture, locator, report, export, or workflow mutation.
- No continuation of the Surface-Zoom Markdown preview as the primary UI.
- No Chrome extension/sidebar port.
- No Chrome DOM piercing.
- No arbitrary live website annotation.
- No freehand drawing implementation.
- No threaded comments.
- No persistent annotation database.
- No image binary payloads embedded in JSON.
- No screenshot-pixel oracle for structured hit testing.

## Verification

Before implementation, run:

- `./aos dev recommend --json`

If Swift/daemon/config/menu/hotkey files are touched, follow the router's build
guidance and rebuild with `./aos dev build` when required.

Focused tests should cover:

- annotation state normalization;
- pin creation, comment creation, edit, delete, unpin/prune;
- destructive clear confirmation state;
- active edge selection;
- opacity ladder math;
- minimap z-order;
- unsupported/stale/projection blocker reporting;
- snapshot payload extension;
- UI state for Annotation Mode;
- shortcut/menu state where practical;
- existing Canvas/Surface Inspector tree behavior remains compatible.

Likely command set:

- `node --test tests/toolkit/canvas-inspector.test.mjs`
- `node --test tests/toolkit/canvas-inspector-tree.test.mjs`
- `node --test tests/toolkit/canvas-inspector-marks-normalize.test.mjs tests/toolkit/canvas-inspector-marks-render.test.mjs tests/toolkit/canvas-inspector-marks-reconcile.test.mjs`
- `node --test tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-hit-test-inspect.test.mjs`
- relevant schema tests if schemas are added or changed;
- `bash tests/canvas-inspector-see-bundle.sh` if bundle behavior changes;
- `bash tests/canvas-inspector-see-bundle-config.sh` if config changes;
- `bash tests/help-contract.sh` if CLI/help changes;
- `git diff --check`.

If `./aos ready` is available, run one bounded AOS smoke:

1. open Surface Inspector;
2. enable Annotation Mode;
3. create a controlled frame pin and one comment on an AOS canvas/window fixture;
4. verify SI tree row, minimap geometry, and display overlay are synchronized;
5. run snapshot shortcut or equivalent trigger and verify annotation payload is
   present;
6. toggle Annotation Mode off and verify confirmation/clear behavior.

If `./aos ready` is blocked, record the blocker and rely on deterministic tests.

## Completion Audit

Final report must include:

- issue #296 reference;
- files changed;
- whether user-facing Canvas Inspector naming was changed to Surface Inspector;
- implemented Annotation Mode entry points;
- data model summary;
- adapter support and unsupported states;
- snapshot behavior;
- exact verification commands and results;
- explicit statement that Employer Brand capture/locator/report/export/workflow
  artifacts were not mutated.
