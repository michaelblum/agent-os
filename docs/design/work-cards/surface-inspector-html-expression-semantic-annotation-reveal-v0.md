# Surface Inspector HTML Expression Semantic Annotation + Reveal V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Related adapter issue: https://github.com/michaelblum/agent-os/issues/297
- HTML expression issue: https://github.com/michaelblum/agent-os/issues/301

## Goal

Close the first Operator smoke gap between Surface Inspector Annotation Mode and
the new HTML Workbench Expression surface.

The HTML Workbench Expression V0 surface is readable and exposes semantic
targets, but the Operator smoke found two integration gaps:

1. Surface Inspector can create a semantic pin on
   `html-workbench-expression:goal`, but no comment editor/control is exposed
   for that semantic pin, so the Operator cannot add an actual comment.
2. Surface Inspector reports `can_reveal=false` for semantic pins even though
   the rendered HTML expression can reveal the same targets by scrolling or
   outline navigation.

Implement the smallest platform-level correction that makes AOS-owned semantic
targets in HTML Workbench Expression usable annotation targets in Surface
Inspector.

## Scope

This is not a Surface-Zoom task. Treat prior Surface-Zoom annotation behavior as
prototype prior art only.

This slice is specifically about Surface Inspector working with AOS-owned
semantic targets inside the HTML Workbench Expression canvas:

- semantic target rows/pins can expose an add-comment path;
- semantic target comments are stored in the existing SI annotation state;
- semantic target comments project to the target when visible;
- semantic target rows report reveal capability when the owning canvas can
  reveal the target;
- reveal scrolls or focuses the target through adapter-owned behavior and then
  refreshes projection state.

Keep Markdown/JSON canonical. Do not make generated HTML the source of truth.

## Baseline Evidence

Operator smoke on `docs/design/fixtures/aos-html-workbench-expression-v0/expression.json`:

- `./aos ready` passed.
- Canvas id: `html-workbench-expression`.
- The surface was readable and had no horizontal scroll failure.
- Surface Inspector observed 39 semantic DOM projections, including:
  - `html-workbench-expression:document`
  - `html-workbench-expression:goal`
  - `html-workbench-expression:suggested-verification`
- Outline clicks revealed `#goal` and `#suggested-verification`.
- SI Annotation Mode could create one semantic pin on `goal`.
- Final annotation state was `pinCount=1`, path
  `canvas / html-workbench-expression / semantic / goal`, projection visible,
  but `commentCount=0`.
- No comment editor/control was exposed for the semantic pin.
- SI reported `can_reveal=false` for the semantic pin.

## Required Behavior

### Semantic Target Comment Path

When SI Annotation Mode creates or selects a pin for an AOS-owned semantic
target such as `html-workbench-expression:goal`, the user must have a visible,
accessible path to add a comment.

Acceptable entry points:

- the selected SI tree/list row;
- the target display overlay;
- an explicit fallback action in SI for selected semantic target rows.

Not acceptable:

- minimap action controls;
- hidden debug-only state mutation;
- Surface-Zoom controls;
- requiring manual JSON edits.

The comment path should use the existing SI annotation model. Do not introduce a
parallel annotation store just for HTML Workbench Expression.

Minimum outcome:

- create one pin on `html-workbench-expression:goal`;
- add one comment through the same supported SI UI/API path an Operator can use;
- SI state reports `pinCount=1` and `commentCount=1`;
- the comment is anchored to the semantic target path/ref;
- clear/remove returns annotation state to empty.

### Semantic Target Reveal

For AOS-owned semantic DOM targets stamped with `data-aos-ref`,
`data-aos-surface`, `data-semantic-target-id`, and source-line metadata, report
`can_reveal=true` when the owning canvas can safely reveal the target by
structured DOM behavior.

For HTML Workbench Expression, reveal may use an owner-canvas DOM helper that:

- resolves the target by `data-aos-ref`, `data-semantic-target-id`, or the
  stored selector;
- calls `scrollIntoView` or equivalent inside the expression content viewport;
- optionally moves focus only when the target is focusable or a safe focus
  target exists;
- returns one of the existing reveal result states such as `already_visible`,
  `revealed`, `target_absent`, `unsupported`, or `adapter_error`;
- refreshes SI projection state after reveal.

Required smoke targets:

- `html-workbench-expression:goal`
- `html-workbench-expression:suggested-verification`

For each target, the smoke should prove:

- SI row/pin has `can_reveal=true`;
- reveal returns `already_visible` or `revealed`;
- target becomes visible in the HTML expression viewport;
- projection state refreshes after reveal.

### Passive Minimap

Do not add annotation action controls to the minimap. The minimap remains passive
abstract geometry only.

### Offscreen Targets

If a semantic target is rendered but currently outside the expression viewport,
it should remain reachable through the SI tree/list and reveal action. Display
overlays should only render when the target is visible and projectable.

## Suggested Implementation Areas

Inspect current Surface Inspector and legacy Surface Inspector paths before
editing. The right files may include:

- Surface Inspector annotation state/model helpers;
- semantic target projection/reveal adapter helpers;
- AOS canvas semantic target xray/reveal code;
- `packages/toolkit/components/html-workbench-expression/`;
- tests that already cover annotation projection and semantic target adapters.

Keep the implementation generic for AOS-owned semantic targets. HTML Workbench
Expression should be the first concrete smoke surface, not a one-off special
case with app-specific annotation storage.

## Verification

Run focused tests that cover:

- semantic target projection/reveal adapter behavior;
- Surface Inspector annotation state with semantic pin plus comment;
- HTML Workbench Expression target metadata still present;
- existing annotation projection tests;
- no minimap action regression;
- schema tests if any schema/fixture changes are made.

Suggested commands:

```bash
node --test tests/toolkit/html-workbench-expression.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/schemas/aos-html-workbench-expression-v0.test.mjs
bash tests/help-contract.sh
git diff --check
```

Also run a bounded AOS smoke when `./aos ready` passes:

```bash
./aos ready
packages/toolkit/components/html-workbench-expression/launch.sh \
  docs/design/fixtures/aos-html-workbench-expression-v0/expression.json
```

The smoke should verify:

- Surface Inspector sees `html-workbench-expression:goal` and
  `html-workbench-expression:suggested-verification`;
- both targets report `can_reveal=true`;
- reveal works for both targets;
- one semantic pin/comment can be created for `goal`;
- SI state reaches `pinCount=1`, `commentCount=1`;
- projection is visible when target is visible;
- clear/remove returns annotation state to empty.

If `CONTENT_WAIT_TIMEOUT` recurs, run one `./aos ready` recheck and report the
blocker. Do not run repeated repair loops.

## Non-Goals

- Do not implement the old Surface-Zoom annotation-mode plan.
- Do not add minimap action controls.
- Do not add global pointer capture.
- Do not browse arbitrary live websites.
- Do not mutate Employer Brand capture manifests, repair patches, diagnostics,
  data bundles, or report artifacts.
- Do not migrate Markdown docs to HTML.
- Do not make generated HTML canonical.
- Do not add arbitrary source-authored JavaScript execution.
