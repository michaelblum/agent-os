# Surface Inspector AOS Semantic Target Reveal V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Active adapter issue: https://github.com/michaelblum/agent-os/issues/297
- Builds on accepted root/candidate slice:
  `docs/design/work-cards/surface-inspector-annotation-root-candidate-adapter-v0.md`
- Broader adapter plan:
  `docs/design/work-cards/surface-inspector-annotation-reveal-and-projection-adapters-v0.md`
- AOS-owned HTML expression context:
  `docs/design/work-cards/aos-html-workbench-expression-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make `Reveal Target` work end-to-end for AOS-owned semantic targets, using the
HTML Workbench Expression surface as the controlled first-party proof.

The previous slice made Annotation Mode root-first and candidate-driven. It
proved that hovering inside a selected AOS-owned HTML workbench root can resolve
a scoped semantic candidate. This slice should prove the next behavior: a
semantic target that is clipped or offscreen inside an AOS-owned surface remains
reachable in the Surface Inspector tree and can be revealed through the owning
canvas without browser DOM/CDP.

## Product Shape

Expected operator flow:

1. Open Surface Inspector and an AOS-owned HTML workbench expression.
2. Enable Annotation Mode.
3. Select/pin the HTML workbench root.
4. Pin or select an AOS semantic target that is currently visible or
   offscreen-scrollable.
5. If the target is offscreen-scrollable, the annotation row exposes `Reveal`.
6. Invoking `Reveal` asks the owning canvas to scroll/focus the target.
7. Surface Inspector refreshes projection state, marks the reveal result as
   `revealed` or `already_visible`, and draws a display overlay only after a
   current visible rect is available.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/surface-inspector-annotation-root-candidate-adapter-v0.md`
- `docs/design/work-cards/surface-inspector-annotation-reveal-and-projection-adapters-v0.md`
- `docs/design/work-cards/aos-html-workbench-expression-v0.md`
- `docs/api/aos.md`
- `docs/api/toolkit.md`
- `shared/schemas/annotation-projection-v0.schema.json`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
gh issue view 297 --json number,title,state,url,body,labels,comments
./aos ready
./aos dev recommend --json
```

This is expected to be mostly toolkit JS and tests. If Swift/native files are
touched unexpectedly, stop and use the router recommendation before building.

## Existing Code To Inspect

- `packages/toolkit/components/surface-inspector/index.js` - owns Surface
  Inspector row actions, `Reveal` dispatch, semantic target requests,
  `buildRevealPayloadForSurfaceInspectorPin`, and target-node normalization.
- `packages/toolkit/components/html-workbench-expression/index.js` - owns the
  first-party HTML expression semantic target publisher and existing
  `window.aosSurfaceInspector.revealTarget` hook.
- `packages/toolkit/workbench/annotation-projection.js` - normalizes projection
  adapter results and reachability states.
- `packages/toolkit/workbench/surface-inspector-annotations.js` - stores reveal
  result state, pin projection state, and tree-row fields.
- `tests/toolkit/html-workbench-expression.test.mjs` - existing semantic target
  publication tests.
- `tests/toolkit/surface-inspector.test.mjs` - Surface Inspector reveal payload,
  row, and scoped hit-region tests.
- `tests/toolkit/annotation-projection.test.mjs` and
  `tests/toolkit/surface-inspector-annotations.test.mjs` - projection/reveal
  state tests.
- `scripts/browser-dom-element-picker-surface-smoke.mjs` - useful pattern for a
  smoke script, but do not turn this slice into browser DOM work.

## Required Behavior

### 1. First-Party Semantic Target Reveal

For AOS-owned canvas semantic targets with enough selector/ref metadata:

- visible targets project as `visible`, `can_project_display_overlay=true`;
- clipped or below-viewport targets report `offscreen_scrollable` when the
  owner can reveal them;
- `Reveal` calls the owning canvas reveal hook with a payload containing the
  target identity, owner canvas, source metadata, selector/ref candidates, and
  prior projection state;
- the owning surface uses its own DOM only because it is AOS-owned, not because
  Surface Inspector is piercing arbitrary pages;
- reveal result is one of `already_visible`, `revealed`, `blocked`,
  `target_absent`, `unsupported`, or `adapter_error`.

### 2. Projection Refresh After Reveal

After a successful reveal:

- Surface Inspector updates the pin projection from the reveal result;
- Surface Inspector refreshes or requests current semantic targets for the owner
  canvas;
- display overlays draw only when the refreshed/reveal projection has a visible
  display-space rect;
- stale old rects are not painted.

### 3. Tree Row Reachability

Annotation rows for non-visible semantic targets should remain usable:

- row state shows `offscreen_scrollable`, `clipped`, `stale`, `absent`, or
  `unsupported` as applicable;
- rows expose `Reveal` only when `can_reveal=true`;
- blocked/unsupported rows show a concrete blocker reason;
- selecting a row refreshes projection state but does not implicitly reveal.

### 4. HTML Workbench Expression Proof

Use the HTML Workbench Expression surface as the primary controlled proof:

- include a visible target and an offscreen-scrollable target in deterministic
  test fixtures or fake DOM tests;
- prove the target publisher reports current rects, reveal eligibility, and
  refreshed bounds after scroll;
- prove `window.aosSurfaceInspector.revealTarget` can reveal the offscreen
  target and returns a normalized projection result;
- prove Surface Inspector can unwrap a pinned AOS semantic target and dispatch a
  reveal payload to the owner canvas.

### 5. Browser Boundary

Keep the existing browser boundary intact:

- do not open live websites;
- do not add CDP;
- do not add Playwright locator promotion;
- do not treat browser DOM selector candidates as the model for AOS semantic
  targets;
- `browser_dom_cdp_deferred` must remain the blocker for arbitrary browser page
  inspection.

## Scope

Primary ownership boundary:

- toolkit component/runtime work for Surface Inspector and HTML Workbench
  Expression;
- toolkit workbench helpers and tests for projection/reveal state;
- docs/API updates only if behavior becomes a public toolkit contract.

Do not move reveal policy into the daemon. The daemon should provide native
capability and canvas lifecycle; AOS-owned surface reveal behavior belongs with
the owning toolkit surface.

## Hard Boundaries / Non-Goals

- No arbitrary browser DOM/CDP inspection.
- No live websites.
- No Chrome extension/sidebar work.
- No native AX reveal beyond preserving current unsupported/bounded behavior.
- No 3D object registry projection implementation in this slice.
- No snapshot settings or persistence work from #298.
- No agent-authored rich leaves from #299.
- No Employer Brand capture, locator, report, or export work.
- No screenshot-pixel oracle.

## Suggested Implementation Areas

GDI should inspect first and then choose the smallest correct patch.

Likely implementation:

1. Add deterministic tests around HTML Workbench semantic targets that are
   initially offscreen-scrollable and become visible after reveal.
2. Harden `buildRevealPayloadForSurfaceInspectorPin` so AOS semantic targets
   carry enough identity/source metadata for owner-canvas reveal.
3. Harden `HtmlWorkbenchExpression.revealTarget` and publisher refresh behavior
   if gaps appear during tests.
4. Ensure `revealAnnotationTarget` requests fresh semantic targets after reveal
   when the owner canvas supports it.
5. Add or update a small live smoke script only if deterministic tests cannot
   prove the owner-canvas message path.

## Verification

Run deterministic tests:

```bash
node --test tests/toolkit/html-workbench-expression.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/browser-dom-element-picker.test.mjs tests/toolkit/surface-inspector-ax.test.mjs
git diff --check
```

If a smoke script is added, run it directly, for example:

```bash
node scripts/<new-html-workbench-semantic-reveal-smoke>.mjs --stdout
```

If `./aos ready` passes, run one bounded live smoke:

1. Launch Surface Inspector.
2. Open an HTML Workbench Expression with at least one offscreen semantic
   target.
3. Enable Annotation Mode and select/pin the HTML workbench root.
4. Select/pin the offscreen semantic target from the SI tree or controlled
   fixture path.
5. Invoke `Reveal`.
6. Confirm result is `revealed` or `already_visible`, the target becomes visible,
   the pin projection refreshes, and the overlay only appears after a current
   visible rect exists.
7. Clean up smoke canvases.

If readiness is blocked, report the blocker and rely on deterministic tests.

## Completion Report

Report back with:

- changed files;
- exact reveal/projection behavior implemented;
- how AOS-owned HTML reveal is distinguished from browser DOM/CDP;
- tests and smoke commands run with exact results;
- `./aos ready` result or blocker;
- any known follow-up needed before broader #297 adapter work.
