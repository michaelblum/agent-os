# Display-First Annotation Overlay Renderer V0

## Tracker

- Active issue: https://github.com/michaelblum/agent-os/issues/296
- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Sequence:
  `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- Builds on accepted session model commit:
  `94a46bd Preserve annotation anchor data on status refresh`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

The shared in-memory session model is already implemented in
`packages/toolkit/workbench/annotation-session.js`. Do not reimplement that
state machine. Extend or consume it.

## Goal

Add the first reusable display-first annotation overlay renderer that consumes
the shared annotation session model and produces stable frame/comment render
plans for display surfaces.

This slice should make display overlays consume session concepts instead of
Surface Inspector-only pin/list state, while keeping Surface Inspector as a
support tooling context for now. It should not implement the full Sigil reticle,
full drag routing, or Surface Inspector UI demotion.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`, if present
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- `docs/design/work-cards/display-first-annotation-session-model-v0.md`
- `packages/toolkit/workbench/annotation-session.js`
- `tests/toolkit/annotation-session.test.mjs`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/workbench/annotation-projection.js`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
./aos dev gh issue view 296 --json
./aos dev recommend --json
```

Use the repo wrapper syntax exactly as shown for GitHub issue discovery. Do not
append a raw `gh issue view --json <fields>` field list to
`./aos dev gh issue view`; the wrapper expects one issue number plus `--json`.

This is primarily a toolkit renderer/data-model slice. If `./aos ready` is
blocked by repo-mode macOS TCC/input-tap state, do not loop repair. Continue
with deterministic Node tests and report the live-readiness blocker.

If `./aos dev recommend --json` reports a broad changed-file set because the
branch is already ahead of origin, treat it as advisory branch context rather
than the verification scope for this card. Prefer the focused toolkit tests
listed below unless the current working tree contains relevant Swift, schema,
or command-contract changes.

## Existing Code To Inspect

- `packages/toolkit/workbench/annotation-session.js` - owns the neutral session
  shape, anchors, preview/committed stacks, status helpers, and opacity ladder.
- `packages/toolkit/components/surface-inspector/index.js` - currently owns
  `buildAnnotationOverlayEvalScript(...)`,
  `syncControlledAnnotationDisplayOverlays()`, overlay signatures, and
  Surface Inspector-driven overlay projection.
- `packages/toolkit/workbench/surface-inspector-annotations.js` - current
  Surface Inspector annotation state, pins, comments, active edge, and snapshot
  payload compatibility.
- `packages/toolkit/workbench/annotation-projection.js` - projection/status
  contract for display overlay eligibility.
- `tests/toolkit/surface-inspector.test.mjs` and
  `tests/toolkit/surface-inspector-annotations.test.mjs` - adjacent coverage for
  existing inspector behavior that must not regress.

## Required Behavior

### Renderer Plan

Create a reusable toolkit helper, suggested path:

```text
packages/toolkit/workbench/annotation-overlay-renderer.js
```

The exact path may differ if the codebase reveals a better home, but keep the
renderer adapter-neutral and reusable. It should accept an annotation session
and produce a render plan containing:

- target display/root/canvas grouping;
- committed frame ancestry;
- preview frame ancestry;
- hover candidate, if projectable;
- comment chips for anchors with non-empty `comment_text`;
- optional active comment input placement data near the current anchor;
- stale, absent, and blocked frame states with explicit reasons;
- stable signatures so unchanged hover/projection state does not trigger
  unnecessary overlay updates.

The renderer should use subject address and current projection evidence from
the session. A last-known rectangle is evidence only, not truth.

### Visual Semantics

- The current/deepest frame uses opacity `1`.
- The root/outer frame floor is `0.75`.
- Intermediate frames interpolate through `opacityForDepth(...)` or
  `opacityLadderForScope(...)`; do not reintroduce the old `1 -> 0.25` ladder.
- Preview and hover frames should be distinguishable from committed ancestry in
  the render plan. The exact visual style can stay modest in this slice.
- Commentless anchors render as frames, not as required comments.
- Comments render as optional chips attached to anchors.

### Surface Inspector Compatibility

Surface Inspector may remain the entry/debug surface in this card, but overlay
projection should begin flowing through the shared session model.

Add a small compatibility adapter only if needed, such as:

- converting current Surface Inspector pins/comments/scope state into an
  annotation session;
- using `surfaceInspectorPinToAnnotationAnchor(...)` for frame anchors;
- mapping existing comments into `comment_text` on session anchors or comment
  chip plan records.

Do not expand list-row or visible pin-icon authoring. The existing internal
`pin` names may remain where changing them would add churn.

Future Surface Inspector support should consume the shared session model
directly. Keep legacy `pin` state at the compatibility boundary only; do not
grow a second parallel annotation state machine while adding the renderer.

### Stale And Absent Subjects

Renderer-level behavior must prove the model's stale/absent guarantees are
visible to users:

- stale, absent, blocked, or non-projectable anchors must not render old
  rectangles as live frames;
- if the renderer chooses to display stale/blocked evidence, the plan must mark
  it explicitly as stale, absent, or blocked with a reason;
- hover candidates remain preview-only and must not become durable anchors or
  comment chips;
- projection evidence is copied from the current session state only and must
  not be treated as the source of truth.

### Performance

- Do not perform fresh AX, DOM, or CDP discovery on every mousemove.
- Do not create or destroy AOS canvases per hover.
- Prefer a persistent overlay element or stable overlay canvas target per
  display/root/canvas.
- Use signatures and requestAnimationFrame coalescing so overlays update only
  when the resolved candidate, preview stack, committed stack, comments, or
  projection state changes.

## Scope

Ownership is toolkit workbench/component:

- workbench helper owns session-to-overlay render planning;
- Surface Inspector may consume that helper as a compatibility surface;
- daemon/native primitives should not encode annotation UI policy in this
  slice;
- Sigil app behavior is out of scope except for keeping the renderer reusable
  enough for the future reticle slice.

## Hard Boundaries / Non-Goals

- No Sigil reticle implementation.
- No full drag/keyboard interaction router.
- No broad Surface Inspector UI demotion.
- No browser DOM/CDP adapter work.
- No broad AX harvesting.
- No snapshot artifact/schema changes unless a tiny compatibility field is
  unavoidable.
- No long-lived persistent annotation database.
- No Employer Brand workflow changes.
- No creation/destruction of canvases on each hover event.

## Suggested Implementation Areas

After reading the code, likely edits are:

- add `packages/toolkit/workbench/annotation-overlay-renderer.js`;
- add `tests/toolkit/annotation-overlay-renderer.test.mjs`;
- adjust `packages/toolkit/components/surface-inspector/index.js` to consume the
  render plan for existing controlled annotation overlays;
- add small compatibility helpers near `annotation-session.js` only if the
  conversion boundary belongs there.

Keep edits tightly scoped. If the current Surface Inspector overlay code can
consume the helper without broad DOM churn, prefer that route.

## Verification

Run focused deterministic checks:

```bash
node --test tests/toolkit/annotation-overlay-renderer.test.mjs
node --test tests/toolkit/annotation-session.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
git diff --check
```

If you choose not to add `tests/toolkit/annotation-overlay-renderer.test.mjs`,
explain which focused test covers the renderer plan and why.

The renderer test should include stale/absent/non-projectable anchors, proving
that old display rectangles are hidden or explicitly marked stale/blocked
rather than rendered as live truth. It should also cover hover-only preview
state so transient candidates do not appear as durable annotation rows or
comment chips.

If `./aos ready` passes, run one bounded live smoke:

1. Open Surface Inspector.
2. Enable Annotation Mode.
3. Select or create a visible frame anchor/comment through the existing path.
4. Verify the display overlay uses the session-derived frame/comment plan.
5. Verify repeated hover over the same candidate does not create/destroy
   overlay canvases or spam updates.
6. Clean up smoke canvases.

If live readiness is blocked, report the exact blocker and the deterministic
coverage completed.

## Completion Report

Report:

- changed files;
- final renderer/helper path and exported helpers;
- how the renderer consumes the shared session model;
- how committed, preview, hover, and comment overlays are represented;
- how stable signatures/hot-path gating work;
- how Surface Inspector compatibility is handled without making it the primary
  authoring UI;
- deterministic tests and results;
- live smoke result or readiness blocker;
- final `git status --short --branch`, with any unrelated or post-completion
  dirty files classified separately from this slice;
- recommended next card, likely Surface Inspector support demotion or Sigil
  reticle visual validation depending on what the renderer exposes.
