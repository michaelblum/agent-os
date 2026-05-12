# Surface-Zoom Annotation Mode Pin/Comment Tree V0

## Goal

Replace the always-visible synthetic rectangle overlay with an explicit annotation mode for pinning structured subjects and adding comments.

The current Surface-Zoom overlay is doing too many jobs at once. It is visible by default, it visually competes with the rendered subject, and it breaks down when the Markdown preview scrolls because some gold rectangles stay visually fixed while only some track the rendered lines. The right model is not "always show all abstract boxes." The right model is:

1. normal review mode shows the rendered subject and selected target;
2. annotation mode turns the cursor into an inspector;
3. hover highlights exactly one candidate subject at the active frame level;
4. the user can pin that subject or add a comment to it;
5. pins/comments appear in a left-pane tree and as spatial chips when their frame is active;
6. the minimap remains abstract and only shows pinned window/panel/element chains.

This work is a controlled Surface-Zoom/AOS-canvas implementation. Do not attempt global pointer capture over arbitrary user applications in this slice.

## Scope

Work in:

- `packages/toolkit/components/surface-zoom-inspector/`
- `packages/toolkit/workbench/` only if a small neutral annotation-mode helper is needed
- `shared/schemas/` only if a first-class annotation-mode record schema is needed
- `tests/toolkit/surface-zoom-inspector.test.mjs`
- adjacent focused tests only if needed

Keep this generic. Do not add Employer Brand-specific behavior.

## Current Problems To Fix

- Synthetic gold boxes must not be visible at all times.
- Synthetic boxes in `Both` preview mode must not float independently of the scrolled rendered Markdown.
- The insets were a bad fit now that rendered Markdown is visible underneath.
- The overlay should be a mode-driven interaction affordance, not the default view.
- The left pane needs a durable pin/comment tree, not just a target navigator.

## Required Interaction Model

### 1. Add `Annotations` Status Icon/Menu

Add a new status icon/menu labeled `Annotations`.

When annotation mode is off:

- rendered Markdown preview remains readable;
- no generic gold rectangle field is visible by default;
- selected/last-hit state may be shown modestly in the inspector and target navigator;
- diagnostic geometry remains available only in `Overlay` mode or Diagnostics.

When annotation mode is on:

- the cursor over the active Surface-Zoom subject area should behave like an element inspector cursor;
- hover reveals a single candidate highlight at the current active annotation frame level;
- the hover highlight is a translucent gold perimeter around the candidate subject;
- the hover highlight must track the rendered subject correctly if the preview scrolls;
- the highlighted candidate should expose action buttons.

### 2. Hover Actions

For hover candidates above leaf/individual element level, show two icon buttons inside the highlighted perimeter, flush right and vertically centered:

- left button: solid blue `+` icon;
- right button: solid gold `pin` icon.

For leaf/individual elements, show only the blue `+` icon.

Use toolkit controls/icons where available. Do not draw bespoke controls if toolkit primitives exist.

### 3. Add Comment Flow

Clicking the blue `+`:

- pins the candidate subject if it is not already pinned;
- toggles the sister pin icon into pinned state if visible;
- opens a discreet annotation editor overlay anchored to that candidate;
- overlay has one input field with placeholder `Leave a comment`;
- under the input, render two buttons aligned to the right:
  - `Cancel`
  - `Add Comment`
- `Add Comment` is disabled until there is non-empty text.

`Cancel` behavior for a new comment:

- closes the editor overlay;
- keeps the pin if the plus action created/preserved a pin.

`Add Comment` behavior:

- creates a comment scoped to the candidate tree node;
- closes the editor overlay;
- creates or updates the left-pane annotation tree;
- renders a spatial tag chip for the comment when the pinned frame is active.

### 4. Pin Flow

Clicking the gold pin:

- pins the candidate subject as the active annotation frame of reference;
- records the pin in the annotation tree;
- constrains subsequent hover/inspector candidates to the next level down inside that pinned frame;
- supports repeated pinning from window/canvas level down to panels/elements.

Each pin adds a gold line in the annotation tree. If a pin has no leaf comments, the pin and its ancestors may collapse into a single branch item showing the current pinned path.

### 5. Left-Pane Pin/Comment Tree

Add an annotation tree/list region in the Surface-Zoom Inspector left pane or secondary region. It should behave like a file explorer tree:

- pins are gold items;
- comments are blue items nested under their pinned subject;
- descendant pins under a commented level are gold items at the same indent as comments at that level;
- empty pin chains collapse into a single branch line where reasonable;
- items are ordered by tree/path order, then creation order.

Gold pin/path line:

- starts with root level `main` or `extended1`;
- shows path fragments ahead of the annotation;
- uses a delimiter between path fragments;
- remains one line by default;
- truncates the whole path, individual path fragments, or both;
- full path is available as a tooltip;
- clicking into the path expands the full path inline;
- expanded path includes a small inline copy icon.

Blue comment line:

- slightly inset below its gold path line;
- shows the comment text;
- is associated with the tree node/pin above it.

### 6. Spatial Tag Chips

When a pinned frame is active, show descendant annotation comments as spatial tag chips over the corresponding subject positions.

Tag chip appearance:

- rounded rectangle;
- solid blue `2px` border;
- black background;
- blue text;
- comment text truncated to 15 characters plus ellipsis when needed;
- includes pen/edit icon and trash/delete icon;
- hover tooltip shows the full comment.

Clicking tag text or pen icon:

- replaces the tag chip with the full annotation editor overlay;
- input contains current comment text;
- buttons are:
  - `Cancel`
  - `Update`
- `Cancel` dismisses the editor and restores the unchanged tag;
- `Update` commits changes, dismisses editor, and updates the tag text.

Clicking trash:

- removes the comment;
- removes the tag;
- preserves its ancestor pins unless no longer needed by the tree model.

### 7. Selecting Tree Items

Clicking a gold pin/path item:

- selects the pinned subject;
- highlights the ancestor chain on the minimap;
- brings the pinned frame forward if it is an AOS canvas/window Surface-Zoom can address;
- decorates that frame perimeter with the translucent gold outline;
- shows descendant annotation tag chips for that frame.

Clicking a blue comment item:

- does everything the parent pin item does;
- also opens the annotation editor in edit mode for that comment.

### 8. Minimap Role

Surface-Zoom should only show abstract boxes like the Surface Inspector does, on a minimap, for pinned chains.

In normal Markdown preview mode:

- do not show all synthetic line/region boxes persistently.

In annotation mode:

- show hover candidate perimeter on the rendered preview;
- show pinned chains on the minimap;
- clicking tree items highlights ancestor chain on the minimap.

In diagnostic `Overlay` mode:

- full synthetic geometry can still be shown for debugging, but this is not the default human review surface.

## Data Model Requirements

Add or reuse structured records for:

- annotation mode active/inactive;
- active annotation frame/pinned subject;
- pinned subjects with stable ids, tree node id, path, root label (`main`/`extended1`), parent pin id, created_at, actor;
- comments with stable ids, pinned subject id, tree node id, text, status, created_at, updated_at, actor;
- spatial chip projection data derived from current subject bounds, not independently stored as truth;
- collapsed/expanded path UI state.

Do not store presentation-only inset geometry as authoritative annotation bounds.

## Bounds And Scroll Correctness

This is critical:

- hover highlight and tag chips must spatially track the rendered subject when the Markdown preview scrolls;
- if the preview scrolls, pinned/comment chips must move with the rendered content;
- any fixed-position controls must be relative to the highlighted candidate's visible viewport rect, not stale document coordinates;
- original hit-test coordinates, stored bounds, annotation draft bounds, and verification seed bounds must remain unchanged.

If robust scroll tracking cannot be implemented for a candidate class in V0, hide chips/highlights for that class and report a blocker rather than rendering misleading fixed overlays.

## Tests

Add focused tests for:

- annotation mode defaults off;
- generic synthetic boxes are not visible in normal Markdown `Both` review mode;
- `Annotations` status/menu toggles mode on/off;
- hover candidate model exposes one candidate at the active frame level;
- plus action creates/preserves a pin and opens a new comment editor;
- `Add Comment` disabled until text is present;
- adding a comment creates a blue nested tree item and spatial tag chip;
- pin action changes the active frame and subsequent candidates are one level deeper;
- pin/comment tree renders collapsed gold paths and nested blue comment lines;
- path truncation/tooltip/expand/copy affordance exists;
- tag edit and delete flows update/remove comments;
- selecting gold/blue tree items updates selected frame/ancestor-chain/minimap state;
- scroll/focus metadata shows overlays track with rendered Markdown viewport, or an explicit blocker is emitted.

Run:

- `node --test tests/toolkit/surface-zoom-inspector.test.mjs`
- `node --test tests/toolkit/surface-hit-test-inspect.test.mjs`
- `node --test tests/toolkit/annotation-perception-verification.test.mjs`
- `node --test tests/toolkit/workbench-shell.test.mjs`
- `node --test tests/toolkit/style-contracts.test.mjs`
- `bash tests/help-contract.sh`
- `git diff --check`

If `./aos ready` passes, run a bounded AOS smoke with the Employer Brand Markdown tree fixture and remove the smoke canvas afterward.

Smoke must verify:

- annotation mode is initially off;
- Markdown preview is readable with no persistent wall of gold boxes;
- turning annotation mode on enables hover/inspect affordance;
- adding a comment creates a nested tree item and a spatial chip;
- scrolling the preview keeps the chip/highlight anchored to the rendered subject, or the UI hides it and reports a blocker;
- selecting tree items updates minimap/selection state;
- diagnostics remain hidden by default.

## Non-Goals

- Do not resume Employer Brand Operator alignment.
- Do not resume live Employer Brand capture.
- Do not open target company URLs.
- Do not run locator resolution, codegen, screenshots, clips, report rendering/export, or workflow execution.
- Do not mutate Employer Brand capture manifests, repair patches, diagnostics, data bundles, or source evidence fixtures.
- Do not implement global pointer capture over arbitrary macOS apps.
- Do not harvest arbitrary user-app AX trees.
- Do not port Syborg/Chrome-extension transport.
- Do not build persistence beyond deterministic in-memory/fixture state unless a narrow schema is needed for tests.

## Completion Report

Report:

- changed files;
- which parts of the annotation mode were implemented;
- any explicit blockers/deferred pieces;
- how scroll anchoring is handled;
- AOS smoke evidence or exact readiness blocker;
- verification commands and results.
