# Selection Mode Top Display Lineage Bar Correction V13

## Recipient

GDI.

## Transfer Kind

Correction round after user UX rejection of the Selection Mode ancestor ladder.

## Source Artifact

- Branch/work surface: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Observed Foreman head before this card:
  `e49d6f01 fix(sigil): fade selection pointer effect trails`
- Current source state includes a dirty working tree on that branch. The
  Selection Mode ladder implementation to correct is in that working tree, not
  necessarily in a pushed remote ref.
- User reference UX: syborg unified annotation Select element mode:
  `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/unified-annotation.ts`
  around `handleSelectMouseMove`, `handleSelectClick`,
  `#syborg-select-badge-bar`, and select commit handling.

## Fresh Context Contract

GDI starts from the assigned transfer, not from parent chat memory. Read and
rediscover before editing.

For this correction, the source artifact is the current dirty worktree. Do not
run a hard reset, do not switch branches, and do not run the dock pickup flow if
it would reset the worktree. Stop and report `misrouted` if you are not already
in `/Users/Michael/Code/agent-os` on
`gdi/selection-mode-cursor-ancestor-ladder-v0` with the current Selection Mode
working-tree changes present.

## Single Goal

Replace the Selection Mode cursor-adjacent ancestor badge ladder/fan-out UX with
a syborg-like selectable lineage bar pinned to the top of the active display.

The lineage is not DOM-only. It must represent the Selection Mode path across
DesktopWorld, display, app/window/canvas, layout/container, and leaf target
seams.

## Branch / Base

- `branch_from`: current dirty worktree on
  `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: current dirty worktree, not a commit ref
- Output branch/work surface: keep using
  `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Do not push, open or update PRs, mutate GitHub state, or broadly checkpoint
  unrelated dirty files.
- Do not commit unless Foreman explicitly asks after reviewing the corrected
  diff; the baseline is already dirty and needs Foreman acceptance first.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- This card
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-badges.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `apps/sigil/renderer/live-modules/selection-mode-input.js`
- `apps/sigil/renderer/live-modules/ux-tree.js`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-selection-mode-performance.test.mjs`
- `tests/renderer/sigil-ux-tree.test.mjs`
- Reference only, do not edit:
  `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/unified-annotation.ts`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD
./aos ready --json
rg -n "selection-mode-badges|badgeLayout|badgeGroups|ancestor_badges|Selection Ancestor Badges|hitTestSelectionModeBadge|selectBadge" apps/sigil tests docs/design/work-cards
```

If `./aos ready --json` reports repo-mode Accessibility, Input Monitoring, or
inactive input-tap blockers and you need live input, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

This slice can be completed deterministically. Do not block on live smoke unless
your implementation needs it.

## Required Behavior

### Remove The Ladder UX

Selection Mode must no longer render the diagonal cursor-adjacent ancestor
ladder, secondary fan-out badges, or connector lines between grouped badges.

Keep the target/ancestor frame outlines and the avatar-derived cursor behavior
unless a narrow edit is required for the new bar. The complaint is the ancestor
selection UX, not the whole Selection Mode overlay.

### Add A Top Display Lineage Bar

After acquisition, render one compact lineage bar at the top of the active
display. Use the acquisition pointer's display when available; otherwise use the
current pointer display; otherwise fall back to the display/root candidate in
the path.

Placement rules:

- The bar is display-scoped, not union-viewport-scoped.
- Pin it near the top center of the active display's visible bounds; protect
  the menu bar/work-area inset by using visible bounds when available.
- Clamp the bar within that display's visible bounds, including negative-x or
  non-main displays.
- Keep it horizontally scrollable or internally elided when the lineage is long;
  it must not spill into another display.

The bar should resemble syborg's unified annotation select bar in interaction
shape: a row of clickable lineage pills with separators. Styling should be
Sigil-native and avatar-color-derived, but subdued enough not to compete with
the target frames or cursor.

### Lineage Semantics

The lineage order should read root-to-leaf:

```text
Desktop / Display > App / Window / Canvas > Layout / Container > Leaf
```

Use the existing Selection Mode context session path as the source of truth.
Do not invent a DOM-only vocabulary. Labels may be compressed, but important
seam nodes should remain recognizable:

- display or desktop root;
- app/native window/canvas;
- layout/container when materially distinct;
- selected leaf target.

Visually equivalent or noisy repeated ancestors may be grouped or collapsed, but
the user must still be able to choose every selectable path node through the bar
or an explicit overflow/group affordance. Do not silently remove selectable
ancestors that the context session can target.

### Retarget And Preview

- Hovering a lineage pill previews that node by shifting the active frame
  highlight to that target.
- Clicking a lineage pill retargets the active Selection Mode target while
  preserving original acquisition pointer, clicked leaf evidence, and path.
- Moving away from the bar clears hover preview and returns highlight to the
  clicked leaf unless the existing selected target is intentionally highlighted
  by the runtime contract.
- Keyboard cycling and Enter/Escape behavior must keep working.
- Input hit testing should target lineage bar items, not old ladder badge rects.

Prefer snapping internal names and tests toward `lineage` / `lineageBar` rather
than preserving stale `ancestor_badges` vocabulary. Compatibility aliases are
acceptable only if they are needed to keep this correction small; if kept, name
the removal gate in the completion report.

### UX Tree / Diagnostics

Update Sigil UX tree/debug terminology so diagnostics no longer advertise
`Selection Ancestor Badges` as the active visual concept. Use a name like
`Selection Lineage Bar` and keep debug snapshots useful for the bar items,
active display, and hover/selected node ids.

## Suggested Implementation Areas

Likely approach after inspection:

- Replace or refactor `selection-mode-badges.js` into a lineage-bar model
  helper. It can stay at the same path if that keeps the slice smaller, but the
  exported model should describe a top display bar rather than a diagonal badge
  ladder.
- Extend `buildProjectedSelectionModeOverlay(...)` in
  `selection-mode-runtime.js` to include `lineageBar` data:
  active display id/rect, bar rect, item rects, path order, labels, selected,
  hovered, leaf, and style.
- Update `hitTestBadge` / input routing to hit test lineage items. The command
  can remain `selectBadge` only as a temporary compatibility path; prefer a
  clearer command if the change stays local.
- Update `interaction-overlay.js` drawing to render the bar and remove badge
  fan-out/connector drawing.
- Update `ux-tree.js` and adjacent tests for the renamed diagnostic surface.

## Hard Boundaries / Non-Goals

- Do not edit the syborg repo; it is only the UX reference.
- Do not redesign Selection Mode acquisition, context-session data shape,
  candidate ranking, or commit behavior.
- Do not resume avatar editor, toolkit controls, context-menu, or unrelated
  dirty work in this branch.
- Do not add a DOM overlay or new canvas surface unless the existing interaction
  overlay cannot support the required hit testing.
- Do not run broad destructive git cleanup.

## Verification

Run at minimum:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/selection-mode-runtime.js
node --check apps/sigil/renderer/live-modules/selection-mode-badges.js
node --check apps/sigil/renderer/live-modules/interaction-overlay.js
node --check apps/sigil/renderer/live-modules/selection-mode-input.js
node --check apps/sigil/renderer/live-modules/ux-tree.js
node --test tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs tests/renderer/sigil-ux-tree.test.mjs
```

If you rename `selection-mode-badges.js`, adjust the `node --check` command to
the new path and remove stale imports.

If the deterministic change touches broader input-region or render-loop
behavior, also run:

```bash
node --test tests/renderer/sigil-selection-mode-input.test.mjs tests/renderer/sigil-input-regions.test.mjs tests/renderer/sigil-render-loop.test.mjs
```

Live smoke remains a Foreman/Operator follow-up after deterministic review
unless you can run a short local check without disturbing the dirty baseline.

## Completion Report

Return a path-scoped report:

- branch and head SHA;
- whether you worked in-place without reset/switch;
- files changed for this correction only;
- exact old ladder/fan-out surfaces removed or left as compatibility aliases;
- lineage bar placement rule and active-display source;
- how retarget and hover hit testing work now;
- tests run with exact pass/fail result;
- `./aos ready --json` result or why live readiness was skipped;
- unrelated dirty files or baseline state you intentionally left untouched;
- remaining follow-up recommendation, if any.
