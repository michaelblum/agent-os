# Surface Inspector Annotation Mode UX Corrections V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Related adapter issue: https://github.com/michaelblum/agent-os/issues/297
- Related settings/snapshot issue: https://github.com/michaelblum/agent-os/issues/298
- Supersedes UX assumptions in:
  `docs/design/work-cards/surface-inspector-annotation-layer-foundation-v0.md`
  where those assumptions conflict with this card.
- Maintainer follow-up: GitHub issue #295 still needs the terminology update
  posted by someone with write access; the prior integration attempt returned
  403.

## Goal

Correct the Surface Inspector Annotation Mode UX before continuing Employer
Brand alignment review.

Current observed defects:

- turning Annotation Mode on decorates both displays gold;
- gold overlays include interior paint instead of perimeter-only emphasis;
- more than one edge appears highlighted;
- the annotation list shows many sibling frame rows that are not real user
  annotations;
- frame path rows are too long and visually noisy;
- hover frame overlays are not appearing reliably;
- `+` and pin controls are text buttons, top-right positioned, and not styled or
  hosted like AOS toolkit controls;
- overlay action controls do not appear as their own mouse-listening AOS canvases
  in the minimap.

Fix these as Surface Inspector platform behavior. Do not resume Employer Brand
capture or alignment work in this slice.

## Terms

Use these user-facing terms consistently in docs, issue comments, tests, and UI
labels touched by this work:

- **Annotation Mode**: explicit Surface Inspector mode for creating/selecting
  contextual annotations.
- **Frame candidate**: ephemeral hover target under the annotation cursor. It is
  not a durable annotation and must not appear as a list row.
- **Frame anchor**: durable contextual annotation created by the pin icon/action.
  Existing internal function names may still contain `pin` if a broad rename is
  not worth the churn, but user-facing docs/UI should prefer `frame anchor`.
- **Comment leaf**: blue comment annotation attached to a frame anchor.
- **Active edge**: the single highlighted path from root frame anchor to the
  active frame anchor/comment.
- **Frame address**: human-readable path for a frame anchor or active edge.

If GitHub issue text/comments are updated during this slice, use the same terms.

## Required Behavior

### 1. Annotation Mode Does Not Paint Everything

Turning Annotation Mode on by itself must not decorate every display, window, or
canvas.

Expected behavior:

- no display/window/canvas gets a gold perimeter merely because mode is on;
- no interior gold wash/paint;
- at most one edge is highlighted at a time;
- highlighting appears only for:
  - the current hover frame candidate, or
  - the selected/active frame anchor edge, or
  - a selected comment leaf's parent edge.

When a frame candidate is highlighted, use perimeter-only gold treatment with no
interior fill, or with a near-transparent fill so subtle that it does not read
as painted content.

### 2. One Active Edge

Only one active edge may render display/canvas highlights at a time.

Selecting a frame anchor or comment leaf:

- selects one active edge;
- clears/de-emphasizes any previous edge highlight;
- highlights only the active edge's frame path;
- projects descendant comment chips only for the active edge when their targets
  are visible/projectable.

### 3. List Rows Only For Real Annotations

The Surface Inspector annotation list/tree must not show transient sibling frame
candidates.

Rows should be emitted only for:

- frame anchors;
- comment leaves;
- later non-frame leaves such as drawings, if/when those exist.

Frame candidates discovered by hover/hit-test stay ephemeral and appear only as
hover highlight/action controls.

### 4. Collapse Consecutive Empty Frame Anchors

Consecutive frame anchors with no intervening comment/non-frame leaf should
collapse into one gold row.

Example:

```text
main / display / window / canvas
```

should not become four separate rows when there are no comment leaves between
those anchors. The collapsed row represents the frame address/path, not a pile
of sibling nodes.

When a comment leaf exists under an intermediate frame anchor, preserve the
local hierarchy:

```text
main / ... / canvas
  comment: "Needs review"
  panel / ... / button
```

Exact indentation can follow existing SI row conventions, but the result should
read like a compact file explorer rather than a debug dump.

### 5. Frame Address Display

Gold frame-anchor rows should show a compact frame address.

Required display behavior:

- start with root label such as `main` or `extended1`;
- show a fragment count, such as `main / 5 fragments`, when the full address is
  too long;
- keep the row to one line by default;
- truncate safely without horizontal scrolling;
- tooltip exposes the full frame address;
- clicking an address affordance can expand it inline;
- a small inline copy icon/control copies the full address.

Use consistent terms in accessible labels, for example:

- `Frame address`
- `Copy full frame address`
- `Expand frame address`

### 6. Restore Hover Frame Candidate Overlays

Annotation Mode should behave like an element inspector:

- moving over a window/AOS canvas/frame candidate shows a gold translucent
  perimeter around exactly that candidate;
- the candidate is scoped by the current active frame anchor when one exists;
- the hover candidate should update as the cursor moves;
- when the cursor leaves a projectable candidate, the hover overlay clears.

Do not use the minimap as the action surface. The minimap remains passive
abstract geometry.

### 7. AOS-Hosted Action Controls

Hover action controls must be AOS-hosted mouse-listening surfaces rather than
DOM text buttons injected inside the target surface.

Required controls:

- `+` icon button: starts/adds a comment for the current frame candidate;
- pin icon button: creates a frame anchor and scopes future hover to the next
  level down when children exist;
- individual controls should appear as one or two AOS canvases in the minimap;
- controls should be vertically centered inside the highlighted perimeter,
  flush right;
- controls must render above target content and other overlays;
- controls need pronounced drop shadow;
- use AOS toolkit button/icon styling, not ad-hoc text buttons;
- if a frame candidate cannot have children, omit or disable the pin control and
  keep only `+`.

If the current AOS surface API cannot yet create tiny overlay canvases cheaply,
implement the smallest reusable helper needed for this specific control overlay
path and document the limitation. Do not fall back to hidden JSON-only controls.

### 8. Comment Editor And Chips

Keep the existing comment editor behavior but align it with the corrected
active-edge model:

- `+` opens a modest comment editor with one input placeholder
  `Leave a comment`;
- `Add Comment` stays disabled until text is present;
- `Cancel` closes the editor and leaves the frame anchor state as designed by
  the selected action;
- added comments appear as blue comment leaves in the SI list/tree;
- visible active-edge comments project as blue chips near their anchored target;
- chips show truncated comment text plus edit/delete icon affordances;
- hovering a chip shows the full comment.

Do not show comment chips for inactive edges.

### 9. Passive Minimap

The minimap is passive abstract geometry only.

Allowed:

- passive indication of the one active edge/frame path;
- passive indication of comment leaf locations;
- showing AOS overlay control canvases as canvases if they exist.

Not allowed:

- `+`, pin, edit, delete, hover, or cursor action controls inside minimap
  geometry.

## Implementation Notes

Likely files:

- `packages/toolkit/components/canvas-inspector/index.js`
- `packages/toolkit/components/canvas-inspector/styles.css`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/toolkit/canvas-inspector.test.mjs`
- docs/work-card or issue references that use older/ambiguous terms.

The existing internals use `pin` heavily. Avoid a broad mechanical rename unless
it is cheap and safe. It is acceptable for internal APIs to keep names like
`pinSurfaceInspectorFrame` during V0, as long as user-facing terms and docs are
consistent.

## Verification

Run focused tests:

```bash
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/canvas-inspector.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/html-workbench-expression.test.mjs
bash tests/help-contract.sh
git diff --check
```

Add/adjust tests to prove:

- toggling Annotation Mode on with no hover/anchors does not create display
  highlights;
- only one active edge can be highlighted;
- transient frame candidates do not become annotation list rows;
- consecutive empty frame anchors collapse into one row;
- compact frame addresses truncate and expose full-address/copy affordances;
- hover overlays appear and clear correctly;
- action controls are represented as AOS canvases or an explicitly documented
  AOS overlay helper state;
- minimap remains passive and contains no action controls.

Run a bounded AOS smoke when `./aos ready` passes:

```bash
./aos ready
packages/toolkit/components/html-workbench-expression/launch.sh \
  docs/design/fixtures/aos-html-workbench-expression-v0/expression.json
```

Smoke expectations:

- enabling Annotation Mode alone does not gold-paint both displays;
- moving the cursor over a target shows exactly one perimeter-only hover
  highlight;
- `+` and pin icon controls are vertically centered, toolkit-styled, above
  target content, and represented as AOS overlay canvases or documented helper
  state;
- creating frame anchors/comments yields compact list rows;
- selecting one row highlights one active edge only;
- clearing returns overlays/list state to empty.

## Non-Goals

- Do not resume Employer Brand live capture, locator repair, URL opening,
  crawling, report rendering, export, or workflow execution.
- Do not continue the Employer Brand human-alignment HTML expression slice until
  these SI annotation-mode UX corrections are complete.
- Do not revive Surface-Zoom annotation behavior.
- Do not add minimap action controls.
- Do not add global pointer capture.
- Do not browse arbitrary live websites.
- Do not make generated HTML canonical.
