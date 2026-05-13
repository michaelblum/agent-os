# Display-First Annotation Mode Implementation Sequence V0

## Tracker

- Active issue: https://github.com/michaelblum/agent-os/issues/296
- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Foundation tracker: https://github.com/michaelblum/agent-os/issues/294
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Supersedes active routing from:
  `docs/design/work-cards/surface-inspector-annotation-layer-foundation-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

## Product Correction

Annotation Mode is display-first.

Surface Inspector supports entry, snapshot, current path, adapter evidence,
stale/blocker diagnostics, passive minimap evidence, and debug inspection. It
must not remain the primary annotation authoring UI. New implementation should
avoid treating inspector list rows, visible pin icons, or minimap actions as the
main workflow.

Core truths:

- a frame is a commentless annotation anchor;
- comments are optional text attached to anchors;
- subject address is truth;
- projection is derived live from the current subject/address state;
- snapshots are explicit point-in-time artifacts;
- current/deepest frame opacity is `1`;
- outer/root frame opacity floor is `0.75`.

## Sequence

### 1. Shared Session Model

Work card:
`docs/design/work-cards/display-first-annotation-session-model-v0.md`

Create a neutral in-memory annotation session model that all entry points can
share. This is the next practical slice for #296 because it lets Surface
Inspector, display overlays, and Sigil reticle work stop inventing separate
state machines.

Required concepts:

- `active`
- `entry_source`
- `root`
- `committed_scope_stack`
- `preview_scope_stack`
- `hover_candidate`
- `anchors`
- `snapshot_count`
- anchor address, optional comment text, projection/status, actor/timestamps
- opacity ladder helper with root floor `0.75` and current frame `1`

### 2. Display Overlay Renderer

Create one persistent overlay layer per display or active root that renders the
shared session model:

- committed frame ancestry;
- preview stack;
- hover candidate;
- optional lightweight comment input near the active anchor;
- comment chips where present;
- stale/blocked visual states.

The hot path should use cached direct-child candidates and update only when the
resolved candidate or preview stack changes. Do not create/destroy canvases per
hover.

### 3. Surface Inspector Support Demotion

Work card:
`docs/design/work-cards/display-first-annotation-surface-inspector-support-demotion-v0.md`

Refactor the current partial Surface Inspector annotation UI around the shared
session instead of owning it:

- keep entry/exit controls;
- keep snapshot/shutter;
- show current root/path and adapter evidence;
- show anchor count and stale/blocker diagnostics;
- keep minimap passive;
- remove or hide primary list-row/pin-icon authoring flows from new UX;
- ensure transient hover candidates never render as durable annotation rows.

Existing internal `pin` names may remain if renaming is not worth the churn.

### 4. Sigil Reticle Visual Validation

Build the Sigil radial reticle prototype in tandem with the shared session and
overlay renderer:

- reticle radial item enters Annotation Mode;
- drag vector switches to the corrected reticle/gold treatment;
- drag cursor drives preview scope selection;
- release commits preview scope and uses deterministic travel placement;
- returning to radial interior exits Annotation Mode;
- camera radial item triggers snapshot when anchors exist.

This is not a separate product fork; it is visual validation that Annotation
Mode is display-first and not inspector-first.

### 5. Settled Reprojection

Add settled reprojection after scroll, resize, window move, DOM mutation, AX
stale/absent updates, and AOS semantic target refresh. During motion, keep the
hot path cheap and mark projection stale rather than rediscovering on every
mousemove.

### 6. Snapshot Continuity

Integrate explicit snapshots with the shared session model. Snapshot artifacts
remain point-in-time evidence and must not become a hidden persistent live
annotation database.

## Retired Or Demoted Assumptions

- Surface Inspector list rows are not the main annotation creation path.
- The minimap is not an action surface.
- Visible pin controls are not the core display UX.
- A comment is not required to create an anchor.
- A last-known rectangle is not the source of truth.
- Browser DOM/CDP remains a later adapter boundary and should not block native
  AX or AOS-owned display-first progress.

## Acceptance Gates Across The Sequence

- All entry paths create or attach to the same annotation session type.
- Surface Inspector is not required to create the first anchor.
- Display root defaults to the display under the avatar at mode entry.
- If the avatar starts over a window, that window becomes the initial nested
  frame.
- Drag preview supports ancestor, sibling, and child movement.
- Frame opacity matches `0.75 -> 1`.
- Mousemove does not perform fresh AX/DOM/CDP discovery or create/destroy
  canvases.
- Live anchors disappear when their subject disappears.
- Snapshots capture evidence without claiming future reproducibility.
