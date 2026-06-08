# Surface Inspector Lower Pane Organization V0

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, display layout, annotation state, or prior live Surface Inspector state.
Read and rediscover before editing. Work in `/Users/Michael/Code/agent-os`, not
in `.docks/`.

## User Problem

Surface Inspector's lower pane is visually overloaded. In the current live
state, the lower pane simultaneously presents bundle status, event counters,
cursor/mouse/annotation toggles, canvas rows, per-canvas stats/tint/remove
actions, annotation support rows, annotation management rows, surface resources,
and diagnostic evidence. This density makes the surface hard to use for the
new annotation plus snapshot workflow.

This is not cosmetic polish. The near-term product direction is:

1. the human works normally;
2. the human annotates along the way;
3. the human uses the snapshot shortcut;
4. the resulting evidence becomes a playbook-like record for later automation.

Surface Inspector needs to help the human stay oriented while doing that work.

## Goal

Reorganize the Surface Inspector lower/list pane so annotation and snapshot work
has a calm, task-focused path, while the existing canvas/resource diagnostic
data remains available but no longer competes for primary attention.

The expected outcome is an information-architecture cleanup, not a redesign of
the annotation model.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/controls.md`
- `docs/api/toolkit/panel-window.md`
- `docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md`
- `docs/design/work-cards/recent-ui-live-regression-implementer-repairs-v0.md`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/surface-inspector/styles.css`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/adapters/zag/tabs.js`
- `tests/toolkit/surface-inspector.test.mjs`
- `tests/toolkit/zag-adapter-tabs.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json --files packages/toolkit/components/surface-inspector/index.js packages/toolkit/components/surface-inspector/styles.css tests/toolkit/surface-inspector.test.mjs
rg -n "renderTreeNode|renderAnnotationTree|renderAnnotationSupportRows|renderAnnotationManagementRows|renderStatusBar|renderCursorToggleRow|renderMouseEventsToggleRow|renderAnnotationModeToggleRow|createAosZagTabs" packages/toolkit/components/surface-inspector packages/toolkit/adapters/zag tests/toolkit/surface-inspector.test.mjs
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop repair.
Continue deterministic tests and report the live blocker. If ready passes, use
one bounded live screenshot after implementation.

## Current Evidence

Foreman captured the live Surface Inspector at `/tmp/surface-inspector-current.png`
on May 18, 2026. The lower pane showed:

- event counters and bundle-copy status compressed into a tiny status strip;
- a full canvas tree immediately below that strip;
- per-row `stats`, `tint`, and remove controls repeated on every canvas row;
- annotation mode active, but annotation work was not visually dominant;
- dense mono text and many small controls in one continuous list.

Implementer does not need that exact temp file. Reproduce locally with:

```bash
packages/toolkit/components/surface-inspector/launch.sh
./aos do key "ctrl+opt+a"
./aos see capture --canvas surface-inspector --perception --out /tmp/surface-inspector-before.png
```

## Required Behavior

### 1. Separate Human Work From Diagnostics

Add a clear lower-pane organization model. A good V0 shape is:

- **Annotate**: Annotation Mode status, snapshot readiness, scope, anchor/comment
  counts, active blockers, saved annotation management, and the small set of
  actions needed while annotating.
- **Surfaces**: canvas/display tree, selected canvas identity, and canvas actions
  such as stats/tint/remove.
- **Diagnostics**: event counters, cursor/mouse-event toggles, surface resources,
  raw projection/blocker evidence, and lower-level status rows.

Use the existing browser-safe `createAosZagTabs` adapter if it fits cleanly.
If a smaller segmented control is demonstrably less invasive for V0, use that,
but keep the sections semantically named and keyboard reachable. Do not import
bare `@zag-js/tabs` into browser-consumed code.

### 2. Make Annotation Mode The Primary Path When Active

When Annotation Mode is active, the first visible lower-pane state should help
the human answer:

- am I annotating?
- what scope am I in?
- how many anchors/comments exist?
- is snapshot capture ready?
- are any anchors stale, blocked, or unrevealable?
- what can I safely do next?

Canvas inventory and low-level resource diagnostics should remain accessible,
but they should not be the default visual center while annotation mode is active.

When Annotation Mode is inactive, the lower pane may default to Surfaces.

### 3. Reduce Repeated Row Noise

Avoid repeating every action as tiny text on every row when that makes scanning
hard. Prefer one of these narrow patterns:

- expose row actions only for the selected/hovered/focused row;
- move row actions into a compact selected-surface action strip;
- keep existing action buttons but visually demote them and make labels fit.

Do not remove existing capabilities. Stats, tint, remove, cursor tracking,
mouse-event tracking, annotation toggling, reveal, copy, expand, remove, delete,
and clear-anchors behavior must still be reachable.

### 4. Preserve Contracts

Do not change public annotation state, snapshot schema, emitted event names, or
daemon bundle behavior.

Keep these compatibility surfaces intact:

- `surface_inspector_annotation_snapshot`
- `canvas_inspector.capture_bundle`
- `canvas_inspector.annotation_state`
- `canvas_inspector.annotation_toggle`
- `canvas_inspector.annotation_open`
- `canvas_inspector.semantic_targets`
- `see.canvas_inspector_bundle.*`

Keep the Surface Inspector manifest and canvas id as `surface-inspector`.

### 5. Use Shared Toolkit Controls Where Practical

If the slice adds a new tab strip, segmented switch, toolbar, or selected action
strip, use existing toolkit controls/adapters where they fit:

- `createAosZagTabs` for tab semantics;
- `createButton`, `createButtonGroup`, `createToggle`, or text-field helpers
  for new DOM controls.

Do not do a broad shared-control retrofit of every existing row. Keep the slice
focused on lower-pane organization and cognitive load.

## Suggested Implementation Notes

Likely implementation path:

1. Introduce a small lower-pane view state, for example
   `listPaneView = "annotate" | "surfaces" | "diagnostics"`.
2. Add a render helper for the lower-pane mode switch and section panels.
3. Move the existing annotation support/management rows into the Annotate
   section.
4. Move the existing canvas tree rows into the Surfaces section.
5. Move event/cursor/mouse/resource/status diagnostics into Diagnostics, or at
   least expose them there while preserving current event subscriptions.
6. Default to `annotate` when Annotation Mode is active and `surfaces` when it
   is inactive, without surprising the user after they manually switch sections.
7. Add CSS that gives each section a stable height, readable labels, and avoids
   text overlap at the current default `360x520` launch frame.

Prefer small named helpers over expanding `renderTreeNode()` into more nested
string assembly.

## Verification

Run deterministic checks:

```bash
node --check packages/toolkit/components/surface-inspector/index.js
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/zag-adapter-tabs.test.mjs
git diff --check
```

Add focused tests that prove:

- the lower pane exposes separate annotation/surfaces/diagnostics sections or
  tabs;
- Annotation Mode defaults or switches to the annotation-focused section;
- existing annotation management controls remain present and bound;
- existing canvas actions remain reachable;
- no bare `@zag-js/tabs` import is introduced;
- public event/schema strings above remain intact.

If live AOS is ready, run a bounded live check:

```bash
./aos ready
packages/toolkit/components/surface-inspector/launch.sh
./aos do key "ctrl+opt+a"
./aos see capture --canvas surface-inspector --perception --out /tmp/surface-inspector-after.png
./aos do key "ctrl+opt+c"
```

Confirm:

- the first lower-pane view while annotating is calmer and annotation-focused;
- tabs/sections are readable at the default launch size;
- snapshot shortcut still writes a bundle path to the clipboard;
- `annotation-snapshot.json` still exists in the bundle.

## Hard Boundaries

- Do not redesign the annotation data model.
- Do not change snapshot schemas or bundle output.
- Do not move toolkit UI policy into the daemon.
- Do not add persistent annotation storage.
- Do not revive Surface-Zoom behavior.
- Do not refactor unrelated surfaces.
- Do not make a broad visual redesign of Surface Inspector's minimap or panel
  chrome unless needed to keep the lower pane coherent.

## Completion Report

Report:

- files changed;
- what lower-pane organization model was implemented;
- whether `createAosZagTabs` was used, and if not, why;
- what controls became less visually noisy;
- deterministic tests run and results;
- live screenshot/snapshot check result, or the exact readiness blocker;
- final `git status --short --branch`;
- any recommended follow-up for deeper Surface Inspector visual cleanup.
