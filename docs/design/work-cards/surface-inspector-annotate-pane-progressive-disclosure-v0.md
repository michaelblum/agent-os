# Surface Inspector Annotate Pane Progressive Disclosure V0

## Fresh Context Contract

GDI starts from a fresh context window. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`. Do not assume daemon,
display, canvas, Operator artifact, clipboard, or prior Surface Inspector state.
Rediscover before editing.

This is a narrow IA/layout correction after the lower-pane tab organization
landed. It is not a new annotation model, not playbook-seed shaping, and not a
general Surface Inspector redesign. It is also not a mandate to create a new
generic tree component.

## User Problem

The lower pane is now different, but not yet clearly more decipherable. The
Annotate tab still repeats the same state in several forms and exposes debug
phrases where the human needs capture guidance.

Michael's current critique:

> annotate tab seems to have redundant expressions of "annotation mode on"

Operator live verification agreed with this direction. The tabs hide some noise,
but the Annotate pane still reads like debug state below the summary.

## Foreman Review Disposition

GDI's first pass at `289fd01` is not accepted as final. It made useful progress
by selecting Annotate on mode activation, moving raw debug rows to Diagnostics,
and demoting repeated surface row actions, but the default Annotate pane is still
not the right information architecture.

The live screenshot at:

```text
/tmp/surface-inspector-annotate-pane-progressive-disclosure-v0.png
```

still shows four summary cards (`mode`, `anchors`, `comments`, `snapshot`) above
rows that repeat the same concepts (`anchors 0 frames / 0 comments`, scope, and
snapshot). That is still a counter/status dashboard, not an easy-to-parse view
of the actual annotation information.

Michael's review direction:

> the four buttons at the top of the annotations tab are redundant - there's
> "comments 0": why not just let the comments below speak for them selves? Same
> with Anchors. below there is "anchors" 0 frames 0 comments...
>
> why not a tree? why not nest anchors under their frames, collapsing frames with
> no child anchors to contiguous "path fragments" like vs code does e.g.
> this_folder/has_no_children/so_its_one_node

Treat this as a request-changes correction on the same branch. The ask is visual
sensemaking: make the information easier to understand at a glance. Do not
over-interpret this as a request for a new annotation workspace.

## Tree Component Plan

Do not introduce a new shared tree component by default in this slice.

The repo currently has Zag adapters for tabs, menu, accordion, collapsible,
select, splitter, and related controls, but no `@zag-js/tree-view` dependency
and no `createAosZagTreeView` adapter. Adding a real Zag Tree View path would
be a separate toolkit component-adapter slice:

1. add the Zag tree-view package and lockfile entry, or provide a browser-safe
   local adapter if direct bare imports cannot run inside `aos://` pages;
2. add `packages/toolkit/adapters/zag/tree-view.js` plus focused adapter tests;
3. define the data/DOM contract for tree items, branches, expansion, selection,
   and keyboard navigation;
4. only then adopt it in Surface Inspector.

That is more machinery than this correction probably needs. For this card, start
with the existing annotation data and row rendering:

- `buildSurfaceInspectorAnnotationTreeRows(...)` already emits pin/comment rows;
- `collapseAnchorChain(...)` already collapses consecutive empty frame anchors;
- `buildSurfaceInspectorFrameAddress(...)` already creates compact/full frame
  path labels.

Use those helpers to render a tree-shaped, indented annotation view with clear
visual hierarchy. Add ARIA tree roles if practical, but do not block the
usability correction on a new generic Zag adapter. If the existing row model
cannot support expansion/selection/focus cleanly, report that as the evidence
for a follow-up Zag Tree View adapter instead of half-building one inside
Surface Inspector.

## Evidence To Inspect

Operator artifacts:

```text
/tmp/aos-operator-surface-inspector-org-check-v0/
```

Important captures:

```text
/tmp/aos-operator-surface-inspector-org-check-v0/surface-inspector-annotate-tab.png
/tmp/aos-operator-surface-inspector-org-check-v0/surface-inspector-diagnostics.png
/tmp/aos-operator-surface-inspector-org-check-v0/surface-inspector-resized.png
/tmp/aos-operator-surface-inspector-org-check-v0/inspector-state-after-annotation-toggle.json
/tmp/aos-operator-surface-inspector-org-check-v0/state-annotate-tab.json
```

The real snapshot bundle from the same pass:

```text
/var/folders/hm/d5_18wks38q0lrdhtjpkpw8h0000gq/T/aos-surface-inspector-see-bundle-3137963E-4A7E-4194-AC95-CC91125F8A53
```

That bundle contains `annotation-snapshot.json`, `bundle.json`,
`capture.json`, `capture.png`, `display-geometry.json`,
`inspector-state.json`, and `canvas-list.json`. The annotation snapshot is an
empty real capture with Annotation Mode active and no executable actions; do not
force it into a playbook step.

Operator findings to preserve:

- Performance was a partial pass. No clear tabbed lower-pane regression appeared
  during tab switching, resize, snapshot, or cleanup.
- Launch/focus lifecycle friction remains: launch-to-wait took about 10.1s and
  `launch.err` recorded `CANVAS_WAIT_TIMEOUT`.
- Progressive disclosure was partial. Diagnostics hides event/cursor/resource
  noise, and Annotate summarizes mode/anchors/comments/snapshot, but the
  Annotate body still exposes raw support rows such as `mode active`,
  `root pending`, `scope main`, and `minimap 0 projected markers, passive`.
- After manually viewing Diagnostics, `ctrl+opt+a` enabled Annotation Mode but
  left Diagnostics selected. Operator's state file confirmed
  `annotationMode.active=true` while `visiblePanels=["diagnostics"]`.
- The Surfaces pane still repeats `stats`, `tint`, and remove actions on rows,
  which remains visually noisy.

## Goal

Make the Annotate tab read as the primary annotation/snapshot workflow instead
of a debug dump, while preserving the diagnostics and controls added by the
lower-pane organization slice.

The user should be able to glance at Annotate and answer:

- Annotation Mode is on or off.
- Snapshot capture is ready, capturing, blocked, or complete.
- What annotations exist, as a tree of frame anchors and comment leaves.
- Where the current scope or active frame sits in that tree.
- Any blocker is actionable.

The user should not see the same "Annotation Mode is on" fact repeated as a
summary card, an all-caps section title, a toggle state, and a raw support row.
The user should also not see anchor/comment counts repeated above a tree or list
that can communicate the same information directly.

## Required Behavior

### 1. Annotation Mode Activation Selects Annotate

When Annotation Mode is activated through the hotkey, toolbar/toggle, or
incoming `canvas_inspector.annotation_toggle`, the lower pane should switch to
Annotate even if the user had manually selected Diagnostics or Surfaces.

Rationale: activating Annotation Mode is an explicit workflow transition. The
manual tab preference should not keep the human inside Diagnostics while the
annotation workflow has just started.

When Annotation Mode is turned off, preserve the existing default behavior unless
there is a clearer local pattern. Do not surprise the user by bouncing tabs on
ordinary state refreshes.

### 2. Collapse Redundant Mode Expressions

In the Annotate pane, present Annotation Mode status once as the primary summary
state. Avoid separate visible rows that restate:

- `Annotation Mode Active`;
- `mode active`;
- an `on` chip next to the same heading;
- duplicate active/off wording from the toggle row.

Keep the actual toggle reachable, but it can be compact, demoted, or integrated
with the primary summary instead of occupying a second "mode is on" statement.

### 3. Make Annotate Hierarchical And Easy To Scan

The default Annotate pane should make the annotation hierarchy legible instead
of presenting a four-card metrics dashboard.

Use the existing annotation row model where possible:

- frame anchors are tree nodes;
- comments are child leaves under their frame anchors;
- nested frame anchors appear under their parent frames;
- consecutive frame anchors with no intervening child anchors or comments
  collapse into one compact path-fragment node, VS Code-style;
- the collapsed node exposes the full path in a tooltip and through the existing
  full-address controls;
- the empty state is a single concise row such as "No annotations yet. Hover a
  frame, then pin or add a comment."

Do not put `anchors 0` and `comments 0` in prominent cards when there are no
anchors or comments. Let the empty hierarchical view speak for that. When
anchors or comments exist, the rows should be the primary evidence; counts may
be secondary metadata only if they do not compete with the visible information.

There is already relevant logic in
`packages/toolkit/workbench/surface-inspector-annotations.js`:

- `buildSurfaceInspectorAnnotationTreeRows(...)`;
- `collapseAnchorChain(...)`;
- `buildSurfaceInspectorFrameAddress(...)`.

Strengthen or reuse that path before adding another parallel tree/list model.

### 4. Replace Raw Support Rows With Human Workflow Rows

Raw support rows should move to Diagnostics or be collapsed behind a debug
details affordance. In Annotate, prefer workflow language:

- compact mode/snapshot status in a toolbar or single status line;
- current scope as a selected tree node or compact breadcrumb, not a repeated
  support row;
- snapshot: ready/capturing/blocked/last bundle;
- blockers: one concise reason when present;
- next action only as the tree empty state when no annotations exist.

Do not show debug phrases like `root pending`, `minimap 0 projected markers,
passive`, adapter capability dumps, or `anchors 0 frames / 0 comments` in the
default Annotate view.

### 5. Demote Repeated Surface Row Actions

The Surfaces pane can remain diagnostic, but repeated `stats`, `tint`, and `x`
actions should be less visually dominant. Choose the smallest local correction:

- show row actions only for hover/focus/selected rows;
- or move common actions into a selected-surface action strip;
- or visually demote repeated actions enough that canvas identity is dominant.

Do not remove these actions. Stats, tint, and remove must remain reachable.

### 6. Preserve Contracts

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

Do not touch `src/` unless a deterministic reason appears. This should stay in
toolkit Surface Inspector UI code and tests.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/work-cards/surface-inspector-lower-pane-organization-v0.md`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/surface-inspector/styles.css`
- `tests/toolkit/surface-inspector.test.mjs`
- `tests/toolkit/zag-adapter-tabs.test.mjs`

## Suggested Implementation Notes

Likely areas:

- `renderAnnotatePane()`
- `renderAnnotationSupportRows()`
- `renderAnnotationModeToggleRow()`
- `renderAnnotationManagementRows()` and `renderAnnotationManagementRow()`
- `buildSurfaceInspectorAnnotationTreeRows(...)`
- `syncListPaneDefault()`, `setAnnotationMode()`, and message handling around
  `canvas_inspector.annotation_toggle`
- Surface row action rendering and CSS in the Surfaces pane

Add small named helpers if needed. Avoid growing one large string-building
function.

Prefer preserving the existing `createAosZagTabs` path. Do not import bare
`@zag-js/tabs` into browser-consumed code.

## Verification

Run deterministic checks:

```bash
node --check packages/toolkit/components/surface-inspector/index.js
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/zag-adapter-tabs.test.mjs
git diff --check
```

Add or update focused tests that prove:

- activating Annotation Mode selects Annotate even after Diagnostics was
  manually selected;
- Annotate does not render duplicate visible mode-active rows;
- Annotate does not render prominent anchor/comment count cards above an empty
  or populated annotation tree;
- the default Annotate body is hierarchy-first: empty state when no annotations,
  frame-anchor rows when anchors exist, and comment rows nested under their
  frame anchors;
- consecutive empty frame anchors collapse into one compact path-fragment node;
- raw support/debug rows are not visible in the default Annotate body;
- diagnostics still exposes the lower-level state needed for debugging;
- stats/tint/remove remain reachable in Surfaces.

If `./aos ready` passes, run a bounded live check:

```bash
./aos ready
./aos show remove-all || true
packages/toolkit/components/surface-inspector/launch.sh
./aos show wait --id surface-inspector --manifest surface-inspector --timeout 5s
./aos do key "ctrl+opt+a"
./aos see capture --canvas surface-inspector --perception --out /tmp/surface-inspector-annotate-pane-progressive-disclosure-v0.png
./aos do key "ctrl+opt+c"
```

Confirm:

- Annotation Mode activation lands on Annotate.
- Annotate has one clear mode/snapshot status area, not repeated mode-active
  rows or duplicate anchor/comment counters.
- An empty annotation state reads as a tree/list empty state, not as a metrics
  dashboard.
- Diagnostics still hides and exposes raw evidence when selected.
- Snapshot shortcut still produces a bundle with `annotation-snapshot.json`.

If launch/focus lifecycle friction appears again, record it but do not broaden
this slice unless the change caused it.

## Hard Boundaries

- Do not shape playbook seeds from this empty capture.
- Do not redesign the annotation data model.
- Do not change snapshot schemas or bundle output.
- Do not move toolkit UI policy into the daemon.
- Do not add persistent annotation storage.
- Do not refactor unrelated surfaces.
- Do not solve the 10s launch/focus lifecycle issue in this slice unless it is
  directly caused by the edited code.

## Completion Report

Report:

- files changed;
- how duplicate Annotation Mode expressions were removed or collapsed;
- how Annotate became hierarchy-first rather than counter-first;
- how empty annotations, frame anchors, nested anchors, collapsed path
  fragments, and comment leaves render;
- how Annotate differs from Diagnostics after the change;
- whether Annotation Mode activation now selects Annotate after Diagnostics;
- what happened to repeated Surfaces row actions;
- deterministic tests run and results;
- live screenshot/snapshot result or exact readiness blocker;
- final `git status --short --branch`;
- any remaining narrow follow-up, especially launch/focus lifecycle friction if
  still reproducible.
