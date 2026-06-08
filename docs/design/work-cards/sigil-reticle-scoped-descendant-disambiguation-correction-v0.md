# Sigil Reticle Scoped Descendant Disambiguation Correction V0

## Tracker

- Display-first annotation epic: https://github.com/michaelblum/agent-os/issues/295
- Source correction card:
  `docs/design/work-cards/sigil-reticle-scoped-targeting-explainability-correction-v0.md`
- Returned Implementer branch under Foreman review:
  `implementer/sigil-reticle-scoped-targeting-explainability-correction-v0`
- Returned Implementer commit:
  `8e83e336c11668b14a4d6491ae3dff7d58089fb9`

Foreman deterministic review accepted the direction of the returned branch but
found one blocking acceptance gap in scoped descendant disambiguation. A
follow-up product clarification from Michael supersedes the earlier
direct-child-only correction: strict immediate-child selection may force users
to click through several anchors that have the same visible rectangle and appear
to be the same surface element. Do not restart the broader browser targeting
work.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
issue state, display topology, VS Code state, browser state, or prior review
context. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Branch / Base

- `branch_from: origin/implementer/sigil-reticle-scoped-targeting-explainability-correction-v0`
- `required_start_ref: origin/implementer/sigil-reticle-scoped-targeting-explainability-correction-v0`
- Expected output branch: keep working on
  `implementer/sigil-reticle-scoped-targeting-explainability-correction-v0`
- Stop and report instead of rebasing if the current branch is not the Implementer
  branch above or if `packages/toolkit/workbench/annotation-candidates.js` lacks
  `explainAnnotationCandidateChoice`.

## Foreman Review Finding And Product Clarification

The returned branch rejects the active full native window scope and explains
outside siblings, but native scoped filtering still treats every same-window AX
element as a direct child. That leaves a timing/selection hole: when a native
window scope is active and both an immediate panel candidate and a smaller
descendant/control candidate contain the pointer, the smaller descendant wins.

Foreman's first instinct was to route a strict native AX direct-child
correction. Michael pushed back: if several intermediate layers have the same
area on the surface, strict immediate-child anchoring makes the user click
through anchors that visually look identical.

So the correction is not "native AX must always choose the immediate child."
The correction is:

- stay inside the active scope;
- never fall back to the active parent/full window as if it were a child;
- allow deeper descendants when their visible rectangle is materially distinct;
- collapse or explain candidates whose visible rectangles are effectively the
  same as the active scope or an already-considered ancestor;
- avoid making the user anchor multiple layers that draw the same frame.

Foreman confirmation command for the current risky behavior:

```bash
node --input-type=module <<'EOF'
import { buildNativeWindowAnnotationCandidate, chooseAnnotationCandidateForScope } from './packages/toolkit/workbench/annotation-candidates.js'
const windowScope = buildNativeWindowAnnotationCandidate({ window_id: 51, app: 'Visual Studio Code', pid: 4242, bounds: { x: 1920, y: 0, width: 1440, height: 900 } })
const baseProjection = { adapter_id: 'macos-ax', root_id: windowScope.root_id, status: 'visible', current_render_status: 'visible', projectable: true, can_project_display_overlay: true, coordinate_space: 'desktop_world' }
const panel = { id: 'panel', adapter_id: 'macos-ax', root_id: windowScope.root_id, root_kind: 'native_window', subject_id: 'panel', subject_path: ['native_window', windowScope.root_id, 'ax_element', 'panel'], subject_kind: 'AXGroup', role: 'AXGroup', label: 'Explorer', projection: { ...baseProjection, subject_id: 'panel', subject_kind: 'AXGroup', visible_display_rect: { x: 1980, y: 80, w: 340, h: 760 }, display_space_rect: { x: 1980, y: 80, w: 340, h: 760 } } }
const grandchild = { id: 'button', adapter_id: 'macos-ax', root_id: windowScope.root_id, root_kind: 'native_window', subject_id: 'button', subject_path: ['native_window', windowScope.root_id, 'ax_element', 'panel', 'button'], subject_kind: 'AXButton', role: 'AXButton', label: 'New File', projection: { ...baseProjection, subject_id: 'button', subject_kind: 'AXButton', visible_display_rect: { x: 2000, y: 120, w: 80, h: 28 }, display_space_rect: { x: 2000, y: 120, w: 80, h: 28 } } }
console.log(chooseAnnotationCandidateForScope([windowScope, panel, grandchild], windowScope, { x: 2010, y: 130 })?.id)
EOF
```

It currently prints `button`. That can be acceptable only if `button` is
visually distinct from `panel`. If the two candidates have the same or
near-identical visible rectangle, the correction should choose one stable
representative for that apparent surface element and explain the others as
visually equivalent rather than making the user click through identical frames.

## Goal

Make scoped reticle selection choose a stable, explainable descendant within
the active anchor without over-constraining the user to immediate children. The
reticle should prefer the most specific visually meaningful target under the
pointer, while collapsing same-rectangle ancestor/descendant layers so repeated
anchors do not appear to target the same element.

Preserve the diagnostics, browser DOM evidence, stale-response handling, and
tests added by the returned branch.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/work-cards/sigil-reticle-scoped-targeting-explainability-correction-v0.md`
- `packages/toolkit/workbench/annotation-candidates.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `tests/toolkit/annotation-candidates.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
rg -n "candidateDirectnessForScope|explainAnnotationCandidateChoice|candidate_not_direct_child|scoped_native_window_child|native extended-display|visual" packages/toolkit/workbench/annotation-candidates.js tests/toolkit/annotation-candidates.test.mjs tests/renderer/annotation-reticle.test.mjs
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or input
tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention` and include the script output. After the human
returns with `finished`, run `./aos ready --post-permission`.

## Existing Code To Inspect

- `packages/toolkit/workbench/annotation-candidates.js` - owns scoped
  filtering, rejection reports, candidate ranking, and the returned branch's
  `explainAnnotationCandidateChoice` diagnostics.
- `apps/sigil/renderer/live-modules/annotation-reticle.js` - records reticle
  decision reports on preview and release.
- `tests/toolkit/annotation-candidates.test.mjs` - add scoped descendant and
  same-rectangle disambiguation coverage here.
- `tests/renderer/annotation-reticle.test.mjs` - add or adjust reticle-level
  coverage only if the toolkit helper fix is not enough to prove release
  commits the selected scoped descendant.

## Required Behavior

### Scoped Descendant Selection

When an active scope exists and ancestry evidence is available:

- reject the active scope itself as `candidate_is_active_scope`;
- keep outside, other-root, or out-of-rect candidates rejected as
  `native_ax_root_mismatch` or `candidate_outside_active_scope`;
- do not let the full app window win while it is the active scope.

Within the active scope, the selector may choose a deeper descendant when it is
visually meaningful. A descendant is visually meaningful when its visible rect
is materially smaller or otherwise distinguishable from the ancestor layer that
would be drawn as an anchor. The exact tolerance belongs in code/tests, but it
should handle normal 0-1 px coordinate noise without treating identical frames
as different targets.

### Same-Rectangle Layer Collapse

When multiple scoped candidates under the pointer have the same or
near-identical visible rectangle:

- do not require the user to anchor each visually identical layer in sequence;
- choose one stable representative for the apparent target using existing
  ranking signals such as adapter priority, actionability, label quality, role,
  and depth;
- expose skipped equivalents in `decision_report.rejected` or an adjacent
  diagnostics field with a reason such as `candidate_visual_equivalent` or a
  clearer existing reason;
- if the active scope is visually equivalent to the only candidates under the
  pointer, keep the current anchor or fallback stable and report a reason such
  as `active_scope_no_distinct_descendant_under_pointer`;
- if a deeper descendant is visually distinct, allow it to win even when it is
  not an immediate child.

### Native AX / VS Code Extended Display Case

For a maximized native app window on an extended display:

- parent native window scope is active;
- a panel candidate and a full-window candidate contain the pointer;
- a smaller control inside the panel may also contain the pointer;
- if the control's rect is materially distinct, it may win;
- if the control and panel share the same visible rect, the selector should not
  make the user click through both as separate visible anchors;
- outside/sibling native AX candidates remain rejected as
  `native_ax_root_mismatch` or `candidate_outside_active_scope`;
- release commits the selected scoped descendant under the parent anchor.

If current native AX evidence is flat and cannot prove ancestry or visual
distinctness, keep the behavior explainable. Either preserve the existing
selection with explicit limitation evidence or fall back with a blocker reason;
do not silently promote the active full window as a successful child target.

### Browser DOM / Semantic Parity

Do not make this correction native-only if the existing scoped filtering shape
would cause the same same-rectangle click-through problem for browser DOM or
semantic targets. Preserve the returned branch's Comet/Chromium targeting and
skipped-stack diagnostics, but let the shared policy express:

- scoped descendants can be selected;
- identical visible layers are collapsed or explained;
- direct-child-only behavior is not a product requirement unless a future
  explicit up/down-scope gesture is added.

### Preserve Returned Branch Behavior

Keep the returned branch's accepted pieces:

- `explainAnnotationCandidateChoice` diagnostics;
- Sigil `decision_report` preview/release state;
- browser DOM skipped/rejection evidence propagation;
- stale browser DOM response/scope event handling;
- existing passing tests.

## Scope

Likely ownership is limited to:

- `packages/toolkit/workbench/annotation-candidates.js`
- `tests/toolkit/annotation-candidates.test.mjs`
- optionally `tests/renderer/annotation-reticle.test.mjs`

Avoid daemon, Swift, browser command, Surface Inspector, snapshot schema, or
persistent storage changes.

## Hard Boundaries / Non-Goals

- Do not restart the older broad browser-targeting card.
- Do not make Surface Inspector the primary annotation authoring UI.
- Do not add a persistent annotation database or redesign snapshot schemas.
- Do not add Sigil-named daemon policy.
- Do not use screenshot pixels as the source of truth.
- Do not add broad AX tree harvesting.
- Do not turn browser targeting into crawling, export, CAPTCHA/consent bypass,
  or extension revival.
- Do not run full DOM/CDP discovery on every mousemove.

## Verification

Minimum deterministic evidence:

```bash
node --check packages/toolkit/workbench/annotation-candidates.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --test tests/toolkit/annotation-candidates.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/annotation-session.test.mjs tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/browser-dom-element-picker.test.mjs tests/toolkit/surface-inspector.test.mjs
git diff --check origin/main...HEAD
./aos ready
```

If the deterministic correction passes and `./aos ready` is green, report
whether live smoke was run. If live smoke is skipped, state why and leave it for
Foreman/Operator.

## Completion Report

Return a concise report with:

- files changed;
- the exact scoped descendant and same-rectangle behavior changed;
- tests run with pass/fail results;
- `./aos ready` result;
- any live smoke result or why it was skipped;
- any remaining blocker or follow-up recommendation.
