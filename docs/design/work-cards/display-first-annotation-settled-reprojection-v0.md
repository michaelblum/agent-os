# Display-First Annotation Settled Reprojection V0

## Tracker

- Active issue: https://github.com/michaelblum/agent-os/issues/296
- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Related adapter issue: https://github.com/michaelblum/agent-os/issues/297
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Sequence:
  `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- Builds on accepted #296 slices:
  - shared session model and anchor preservation;
  - display overlay renderer;
  - Surface Inspector support demotion;
  - Sigil radial reticle validation and camera/input correction, currently on
    `codex/issue-296-display-first-annotation` at `542602a`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing. Work in `/Users/Michael/Code/agent-os`, not in
`.docks/`.

This slice is the first settled-reprojection foundation for display-first
Annotation Mode. It should preserve the accepted session, overlay, Surface
Inspector support, and Sigil reticle behavior.

## Goal

Make live annotation anchors react correctly to geometry/source churn:

- mark affected projections stale during scroll, resize, window move, display
  topology, DOM mutation, AX stale/absent state, canvas lifecycle, or semantic
  target refresh;
- keep anchor identity, comments, and scope paths bound to subject addresses;
- after the source settles, refresh projections from the latest available
  adapter evidence;
- hide or simplify stale overlays instead of drawing old rectangles as truth;
- keep mousemove hot paths cheap and free of fresh AX, DOM, or CDP discovery.

This is not the full #297 adapter matrix. If a source cannot be refreshed with
current evidence, keep the anchor and report an explicit blocker such as
`projection_refresh_source_missing`, `subject_absent`, or the existing adapter
reason.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- `docs/design/work-cards/display-first-annotation-session-model-v0.md`
- `docs/design/work-cards/display-first-annotation-overlay-renderer-v0.md`
- `docs/design/work-cards/display-first-annotation-surface-inspector-support-demotion-v0.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-visual-validation-v0.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-camera-input-correction-v0.md`
- `docs/api/toolkit/workbench.md`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
./aos ready
./aos dev gh issue view 296 --json
./aos dev recommend --json
rg -n "annotation|projection|reproject|stale|semantic_targets|display_geometry|canvas_lifecycle|window_entered|element_focused|scroll|resize|mutation" packages/toolkit apps/sigil tests docs
```

Use the repo wrapper syntax exactly as shown for GitHub issue discovery. Do not
append a raw `gh issue view --json <fields>` field list to
`./aos dev gh issue view`; the wrapper expects one issue number plus `--json`.

If `./aos ready` reports a repo-mode TCC/input-tap blocker, continue with
deterministic tests when possible and report the blocker. Do not loop through
ad-hoc permission repair.

## Existing Code To Inspect

- `packages/toolkit/workbench/annotation-session.js` - owns the shared in-memory
  session, anchors, projection normalization, status refresh, scope stacks, and
  opacity helper.
- `packages/toolkit/workbench/annotation-overlay-renderer.js` - turns a session
  into grouped overlay render plans and already suppresses stale/blocked rects.
- `packages/toolkit/workbench/surface-inspector-annotations.js` - owns Surface
  Inspector candidate, pin, scope, projection, reveal, and snapshot state.
- `packages/toolkit/components/surface-inspector/index.js` - subscribes to
  display, lifecycle, semantic target, input, native window, and AX events;
  syncs annotation overlays and action controls.
- `apps/sigil/renderer/live-modules/annotation-reticle.js` and
  `apps/sigil/renderer/live-modules/main.js` - read-only context unless Sigil
  reticle debug state needs a small generic update.
- `tests/toolkit/annotation-session.test.mjs` - deterministic session and
  projection status coverage.
- `tests/toolkit/annotation-overlay-renderer.test.mjs` - deterministic overlay
  plan and stale/blocked rendering coverage.
- `tests/toolkit/surface-inspector.test.mjs` and
  `tests/toolkit/surface-inspector-annotations.test.mjs` - Surface Inspector
  annotation support and integration coverage.
- `tests/renderer/annotation-reticle.test.mjs` - Sigil reticle regression
  coverage if touched.

## Required Behavior

### Stale During Motion

When a source event can invalidate projection geometry, mark the affected
session anchors, committed stack entries, preview stack entries, and hover
candidate as stale without losing subject address, comments, actor, timestamps,
or scope path.

Useful invalidation reasons include:

- `display_geometry_changed`
- `canvas_lifecycle_changed`
- `semantic_targets_refresh_pending`
- `native_window_moved_or_changed`
- `native_ax_stale_or_absent`
- `scroll_or_resize_settling`
- `dom_mutation_settling`

Stale anchors must not render their old `display_space_rect` as live overlay
geometry. Existing overlay plan behavior can be reused if the status/projection
normalization is kept honest.

### Settled Refresh

After a bounded debounce or existing event-settle point, refresh projections from
the latest already-available source evidence:

- AOS semantic target broadcasts for AOS-owned surfaces;
- canvas lifecycle/display geometry for canvas/window roots;
- latest native window or native AX events where those adapters already publish
  bounded evidence;
- existing Surface Inspector candidate/projection helpers.

Do not run fresh AX, DOM, CDP, or full descendant discovery on mousemove. If a
refresh source is not currently available, keep the anchor stale or blocked with
an explicit reason and report the missing adapter/source as a follow-up for
#297.

### Surface Inspector Support

Surface Inspector should show the settled/stale state as support evidence:

- stale or blocked count remains visible;
- blocker reasons are concrete;
- passive minimap and overlay renderers skip stale rectangles;
- hover candidates stay transient and do not become durable rows;
- saved annotation management keeps reveal/edit/remove controls for existing
  anchors.

The implementation may add a small adapter-neutral helper, for example a
projection refresh planner that accepts the current session plus injectable
projection evidence. Keep this helper in toolkit/workbench or Surface Inspector
support code; do not add Sigil-specific daemon policy.

### Sigil Compatibility

The Sigil reticle flow must keep the accepted behavior:

- `annotation-mode` enters with `entry_source: "sigil_radial"`;
- reticle reentry exits annotation reticle mode;
- reticle release records a bounded commit with deterministic placement;
- `annotation-camera` remains gated by live anchors;
- camera activation still records snapshot request evidence when live anchors
  exist.

Only touch Sigil if the accepted debug state needs to surface stale/settled
projection evidence or if tests reveal a regression from the toolkit change.

## Scope

Likely ownership is toolkit workbench/session helpers plus the Surface Inspector
component integration. Sigil is read-mostly regression territory. Daemon work is
out of scope unless GDI finds a missing generic lifecycle or event primitive and
reports it as a blocker instead of patching around it.

## Hard Boundaries / Non-Goals

- No full #297 adapter matrix.
- No arbitrary browser DOM/CDP implementation.
- No fresh AX, DOM, or CDP discovery on every mousemove.
- No per-hover canvas creation/destruction.
- No long-lived annotation database.
- No snapshot artifact redesign.
- No Surface Inspector list-first authoring resurrection.
- No Sigil-named daemon branches or native product policy.
- No Employer Brand capture, locator, report, or export work.

## Suggested Implementation Areas

- Add focused session helpers for stale invalidation and settled projection
  refresh, or a new `packages/toolkit/workbench/annotation-reprojection.js` if
  keeping it separate is clearer.
- Update Surface Inspector message handling so `display_geometry`,
  `canvas_lifecycle`, semantic-target refresh, native window, and AX events
  schedule invalidation/settled refresh instead of only rerendering.
- Reuse `requestSemanticTargetsForLiveCanvases()` for settle-time refreshes, not
  mousemove.
- Keep `syncControlledAnnotationDisplayOverlays()` signature gating intact so
  unchanged groups are not repeatedly updated.
- Extend debug state just enough for Foreman/Operator to see stale reason,
  refresh generation, pending settle reason, and last refresh result.

## Verification

Run focused deterministic checks:

```bash
node --check packages/toolkit/workbench/annotation-session.js
node --check packages/toolkit/workbench/annotation-overlay-renderer.js
node --check packages/toolkit/workbench/surface-inspector-annotations.js
node --check packages/toolkit/components/surface-inspector/index.js
node --test tests/toolkit/annotation-session.test.mjs tests/toolkit/annotation-overlay-renderer.test.mjs tests/toolkit/surface-inspector-annotations.test.mjs tests/toolkit/surface-inspector.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs
git diff --check
```

If `./aos ready` passes, run or prepare a bounded live smoke:

1. Launch Surface Inspector / Annotation Mode against an AOS-owned surface with
   semantic targets.
2. Create at least one frame anchor and optional comment.
3. Trigger a geometry/source churn event available in the local setup, such as
   canvas move/resize, display geometry refresh, semantic-target refresh, or a
   controlled scroll/resize fixture.
4. Verify the anchor first reports stale/settling evidence without drawing the
   old rectangle as live truth.
5. Verify settled refresh restores a live projection when evidence exists, or
   leaves a concrete blocker when it does not.
6. Verify mousemove does not spam overlay evals or semantic target requests.
7. Run final `./aos ready` and report `git status --short --branch`.

If live readiness is blocked, report the exact blocker and the deterministic
coverage that still passed.

## Completion Report

Report:

- changed files;
- how stale invalidation and settled refresh are represented;
- which source events schedule stale/refresh behavior;
- how comments/scope paths survive projection churn;
- deterministic tests run and exact results;
- live smoke run and results, or exact readiness blocker;
- any source/adapter gaps that should move to #297;
- final `./aos ready`;
- final `git status --short --branch`;
- whether Foreman should request Operator live verification before accepting.
