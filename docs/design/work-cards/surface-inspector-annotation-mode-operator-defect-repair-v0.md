# Surface Inspector Annotation Mode Operator Defect Repair V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Follows:
  `docs/design/work-cards/surface-inspector-annotation-action-control-canvases-v0.md`

## Goal

Repair the defects found by Operator and human review after the first real AOS
overlay-canvas implementation for Surface Inspector Annotation Mode.

The previous slice created real `surface-inspector-annotation-action-*` canvases,
but the workflow still does not match the intended user interaction model. This
slice should make Annotation Mode usable enough for the next human-facing
alignment pass.

Do not continue Employer Brand alignment/capture/report work until this repair
is complete.

## Observed Defects

Operator verified:

- overlay action canvases exist and are removed on mode-off;
- minimap remains passive;
- plus/pin controls are real AOS canvases;
- perimeter-only highlight is possible.

But Operator and human review found these defects:

1. Turning Annotation Mode on while the cursor is already inside a broad
   `avatar-main`/desktop-world-like canvas immediately resolves that broad frame
   as `last_hover_candidate` and creates action controls.
2. Hover over the intended HTML Workbench Expression still resolves to
   `avatar-main` instead of the narrower workbench/canvas target.
3. The gold perimeter and controls can be centered relative to the wrong broad
   frame, so controls appear near a display/menu-bar area instead of the
   immediate target frame.
4. The root desktop-world/display frame should be implied and must not get a
   gold rectangle or action controls.
5. Clicking the plus overlay through normal AOS pointer targeting reports
   success but does not open the comment editor. A diagnostic DOM click works,
   so the child canvas exists but the normal action path is not reliable.
6. The Surface Inspector list shows duplicate `AOS HTML Workbench Expres...`
   rows.
7. Unanchored semantic targets appear under the `html-workbench` row even though
   no frame anchor/comment exists yet.
8. SI row buttons `anchor`, `comment`, `Reveal`, `more`, `copy`, `remove`, and
   `del` are visible as primary workflow controls. This is not the current
   intended interaction.
9. Comments can still be added from SI rows. For now, frame anchors and comments
   should be created through overlay icon buttons and the comment overlay only.
10. The `+` and pin controls are not yet clear pictograms; pin is rendered like
    a text label/state rather than a pin icon toggle with pushed/unpinned states.
11. Anchoring the first HTML Workbench target can draw a gold rect far beyond
    the root AOS panel's visible rect, likely using unclipped geometry instead
    of visible display geometry.
12. Anchors cannot be toggled off from the overlay/control path.
13. Comment tag/chip overlays have not been observed after adding a comment.
14. Resizing Surface Inspector taller gives the wrong pane the extra vertical
    space; the top minimap/overview should maintain its screen ratio, while the
    bottom list panel should receive excess vertical space through a draggable
    split/collapsible seam.

## Required Behavior

### 1. Candidate Selection Must Prefer Specific Visible Frames

Annotation hover should resolve to the most specific visible projectable frame
under the cursor, not the broad desktop-world/display/root canvas when a
narrower AOS canvas or semantic target is available.

Rules:

- desktop world and displays are implicit context, not actionable frame
  candidates;
- broad root frames should lose to contained child canvases/semantic targets;
- action controls should be positioned relative to the immediate selected frame
  candidate;
- if only the desktop world/display is under the cursor, show no gold perimeter
  and no overlay action controls.

Add tests for overlapping candidates where a broad parent contains a narrower
child and the child must win.

### 2. Annotation Mode Alone Must Be Quiet

Turning Annotation Mode on must not create a hover frame, action control
canvases, or gold perimeter until a valid non-root frame candidate is actually
under the cursor and selected by the candidate rules.

If cursor state is stale or points at an implicit root, clear
`last_hover_candidate`.

### 3. Remove Unanchored Target Rows From The Main Annotation List

The annotation list/tree should show only:

- frame anchors;
- comment leaves;
- later explicit non-frame annotation leaves.

Do not show unanchored semantic targets as rows under a canvas just because
Annotation Mode is on. Do not show `anchor` buttons for every semantic target in
the main tree.

Surface Inspector can still use semantic targets internally for hover/reveal and
projection, but unanchored targets should not clutter the annotation list.

### 4. Overlay Is The Only Creation Path For Now

For this V0 correction, creation must flow through the target overlay controls:

- `+` overlay control opens the comment overlay/editor;
- pin overlay control creates/toggles a frame anchor;
- SI list rows may select, reveal, copy, expand, or remove existing anchors if
  needed, but they must not be the primary add-comment/create-anchor workflow.

Specifically:

- remove or hide row-level `comment` controls for anchors in the default
  workflow;
- remove unanchored semantic `anchor` buttons;
- comments should not be added from SI rows in this slice;
- keep any debug/test hooks out of the visible user flow.

### 5. Overlay Plus Must Work Through Normal AOS Pointer Targeting

Clicking the `+` overlay canvas through normal AOS pointer/canvas targeting must
open the comment editor. A DOM-only diagnostic click is not enough.

The action control canvas should emit a message that Surface Inspector consumes
reliably, regardless of focus quirks.

Add a focused test or smoke evidence around the exact event/message path.

### 6. Pin Control Must Be A Pin Toggle

The pin control should be a pictogram, not a `P` text label.

Behavior:

- unpinned candidate shows unpinned pin icon;
- clicking creates a frame anchor and changes to pushed/pinned state when the
  same candidate remains active;
- clicking again toggles/removes that frame anchor if it has no descendant
  comments/anchors requiring confirmation;
- pinned state is visible in the icon/control styling.

Keep the user-facing term **frame anchor** in labels/tooltips.

### 7. Visible Geometry Must Be Clipped To Displayed Bounds

Frame candidate and active-edge projection should use visible/projectable
display geometry, not unclipped source/local geometry.

For scrollable/offscreen semantic targets:

- if the target is not visible, do not draw a huge unclipped gold rect;
- expose reveal state in SI if relevant;
- draw only after reveal/visibility projection has a current display-space rect.

### 8. Comment Tags Must Project For Active Edge Comments

After adding a comment through the overlay:

- a blue comment leaf appears in the annotation list;
- a comment tag/chip appears spatially over the active edge target when visible;
- tag text is truncated but has a tooltip/full value;
- tag appears only for the active edge.

### 9. Surface Inspector Split Layout

When Surface Inspector is resized taller:

- the top overview/minimap panel should preserve its screen ratio and not absorb
  all extra vertical space;
- the bottom list/details panel should receive excess vertical space;
- the seam between overview and bottom panel should be draggable or at least
  behave like an intentional split/collapsible seam;
- avoid creating a large empty black gap between overview and list.

### 10. Duplicate Rows

Remove duplicate `AOS HTML Workbench Expres...` rows caused by mixing canvas
rows, semantic document rows, and/or unanchored semantic rows.

Canvas row and anchored annotation rows should be visually distinct and not
duplicated under the same role.

## Verification

Run focused tests:

```bash
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/html-workbench-expression.test.mjs
bash tests/help-contract.sh
git diff --check
```

Add or adjust tests to prove:

- overlapping candidate selection chooses the most specific child;
- implicit desktop/display roots do not receive hover controls;
- Annotation Mode on with only implicit root under cursor stays quiet;
- unanchored semantic targets do not appear as annotation list rows;
- overlay plus click path opens the comment editor through the normal AOS
  control message;
- pin control toggles frame anchor state;
- visible geometry is clipped and does not draw huge off-panel rectangles;
- active-edge comment tags project after overlay comment creation;
- bottom panel gets extra vertical space on taller resize.

Run a bounded AOS smoke when `./aos ready` passes:

```bash
./aos ready
packages/toolkit/components/html-workbench-expression/launch.sh \
  docs/design/fixtures/aos-html-workbench-expression-v0/expression.json
```

Smoke expectations:

- Annotation Mode alone does not paint displays or spawn action controls;
- hover over HTML Workbench Expression resolves to that surface or a specific
  semantic target, not `avatar-main`;
- exactly one perimeter-only highlight appears;
- overlay `+` opens comment editor via normal AOS click;
- overlay pin toggles frame anchor on/off;
- no unanchored semantic target rows or row-level `anchor` buttons appear;
- adding a comment via overlay creates a blue list leaf and visible tag chip;
- selecting rows highlights one active edge;
- resizing SI taller gives extra height to the bottom panel/list, not a blank
  gap.

## Non-Goals

- Do not continue Employer Brand alignment/capture/report work.
- Do not revive Surface-Zoom annotation behavior.
- Do not add minimap action controls.
- Do not add global pointer capture.
- Do not browse arbitrary live websites.
- Do not make generated HTML canonical.
