# Surface Inspector Annotation Action Control Canvases V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Follows:
  `docs/design/work-cards/surface-inspector-annotation-mode-ux-corrections-v0.md`

## Goal

Complete the missing part of the Surface Inspector Annotation Mode UX
correction: hover action controls must be real AOS-hosted, mouse-listening
overlay canvases, not DOM buttons injected into the target surface and not
helper-state placeholders.

Foreman review found the previous slice still uses
`buildAnnotationOverlayEvalScript(...)` to inject `+` and pin text buttons into
the target canvas DOM and exposes `annotationActionControlHelperState` instead
of creating actual AOS control canvases. That does not satisfy the required UX.

## Required Correction

### 1. Remove DOM-Injected Hover Action Buttons

Do not inject hover action buttons into the target surface DOM.

Allowed in the target surface overlay:

- one perimeter-only gold frame candidate highlight;
- active-edge perimeter highlight;
- visible comment chips for the active edge.

Not allowed in the target surface DOM overlay:

- `+` button;
- pin button;
- edit/delete action buttons for hover candidate creation;
- text-button action controls.

### 2. Create Real AOS Overlay Control Canvases

When Annotation Mode has a projectable frame candidate, create one or two small
AOS overlay canvases positioned inside the candidate perimeter, flush right and
vertically centered:

- `+` control: add/start comment for current frame candidate;
- pin control: create frame anchor for current frame candidate when the
  candidate can have children.

The controls must:

- be separate AOS canvases visible in Surface Inspector's canvas list/minimap;
- be mouse-listening/clickable through normal AOS pointer input;
- sit above target content and display overlays;
- move as the hover candidate changes;
- be removed when Annotation Mode turns off, when hover clears, or when the
  target canvas disappears;
- use toolkit button/icon styling rather than raw text buttons;
- use a solid blue plus icon for `+`;
- use a solid gold pin icon for frame anchor;
- have a pronounced drop shadow;
- be vertically centered in the frame candidate.

If AOS currently lacks a reusable helper for tiny overlay action canvases,
implement the smallest platform/toolkit helper needed for this path. Do not
settle for helper-state-only representation.

### 3. Minimap Evidence

Surface Inspector minimap must show the action controls as canvases when they
exist.

The minimap remains passive:

- it may show the overlay control canvases as normal canvas rectangles;
- it must not contain `+`, pin, edit, delete, hover, or cursor action controls
  inside minimap geometry.

### 4. Perimeter-Only Highlight

Frame candidate and active-edge highlights should be perimeter-only. Remove the
visible gold interior wash from the target overlay.

Use a border/outline treatment that makes the frame readable without painting
the content.

### 5. Active Edge Guard

Keep the one-active-edge guarantee from the prior slice. This card should not
regress:

- toggling Annotation Mode on alone creates no display/window/canvas highlights;
- transient frame candidates do not become annotation list rows;
- list rows are only frame anchors and comment leaves;
- collapsed empty frame-anchor chains remain compact;
- comment chips only appear for active-edge comments.

## Suggested Implementation Areas

Inspect before editing:

- `packages/toolkit/components/canvas-inspector/index.js`
- `packages/toolkit/components/canvas-inspector/styles.css`
- AOS canvas creation/mutation/event APIs used by existing toolkit panel or
  overlay surfaces
- `tests/toolkit/canvas-inspector.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`

Remove or replace `annotationActionControlHelperState` if it only exists as a
placeholder for real canvases. If a diagnostic field remains, it must report the
actual overlay canvas ids/frames, not substitute for them.

## Verification

Run focused tests:

```bash
node --test tests/toolkit/canvas-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/html-workbench-expression.test.mjs
bash tests/help-contract.sh
git diff --check
```

Add/adjust tests to prove:

- target DOM overlay script no longer creates hover action buttons;
- hover action controls are modeled as actual AOS overlay canvas create/update
  records or equivalent emitted canvas lifecycle commands;
- overlay control canvas ids/frames are available in SI state;
- minimap sees those controls as canvases;
- controls are removed on hover clear/mode off;
- highlight overlay has no visible interior paint;
- one-active-edge/list-row/collapsed-address behavior still passes.

Run a bounded AOS smoke when `./aos ready` passes:

```bash
./aos ready
packages/toolkit/components/html-workbench-expression/launch.sh \
  docs/design/fixtures/aos-html-workbench-expression-v0/expression.json
```

Smoke expectations:

- Annotation Mode on by itself creates no gold-painted display;
- moving over a projectable frame candidate shows one perimeter-only highlight;
- `+` and pin controls appear as one or two separate AOS canvases in the SI
  canvas list/minimap;
- the controls are visually icon buttons, vertically centered, with shadow;
- clicking `+` opens the comment editor flow;
- clicking pin creates a frame anchor;
- clearing/mode-off removes the overlay control canvases.

## Non-Goals

- Do not continue Employer Brand alignment/capture/report work.
- Do not revive Surface-Zoom annotation behavior.
- Do not add minimap action controls.
- Do not add global pointer capture.
- Do not browse arbitrary live websites.
- Do not make generated HTML canonical.
