# Sigil Reticle Native AX Active-Scope Path Correction V0

## Tracker

- Display-first annotation epic: https://github.com/michaelblum/agent-os/issues/295
- Source scoped-descendant card:
  `docs/design/work-cards/sigil-reticle-scoped-descendant-disambiguation-correction-v0.md`
- Returned GDI branch under Foreman review:
  `gdi/sigil-reticle-scoped-targeting-explainability-correction-v0`
- Returned GDI commit:
  `cd95a0956c2ea2937fdf3578b9cb2296d23cfd8f`

Foreman accepted the returned direction for visually distinct descendants and
same-rectangle collapse, but found one blocking native AX scope gap. Do not
restart the broader browser targeting work or undo same-rectangle collapse.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
issue state, display topology, VS Code state, browser state, or prior review
context. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Branch / Base

- `branch_from: origin/gdi/sigil-reticle-scoped-targeting-explainability-correction-v0`
- `required_start_ref: origin/gdi/sigil-reticle-scoped-targeting-explainability-correction-v0`
- Expected output branch: keep working on
  `gdi/sigil-reticle-scoped-targeting-explainability-correction-v0`
- Stop and report instead of rebasing if the current branch is not the GDI
  branch above or if `packages/toolkit/workbench/annotation-candidates.js` lacks
  `rectsVisuallyEquivalent`.

## Foreman Review Finding

The latest returned implementation allows visually distinct descendants and
collapses same-rectangle layers, which matches Michael's clarification. But
native AX scoped filtering still treats any same-window candidate inside the
active scope rectangle as scoped, even when subject-path ancestry proves it is
not a descendant of the active anchor.

Foreman confirmation command:

```bash
node --input-type=module <<'EOF'
import { buildNativeWindowAnnotationCandidate, chooseAnnotationCandidateForScope, explainAnnotationCandidateChoice } from './packages/toolkit/workbench/annotation-candidates.js'
const root = buildNativeWindowAnnotationCandidate({ window_id: 51, app: 'Visual Studio Code', pid: 4242, bounds: { x: 0, y: 0, width: 1000, height: 800 } })
const baseProjection = { adapter_id: 'macos-ax', root_id: root.root_id, status: 'visible', current_render_status: 'visible', projectable: true, can_project_display_overlay: true, coordinate_space: 'desktop_world' }
const panel = { id: 'panel', adapter_id: 'macos-ax', root_id: root.root_id, root_kind: 'native_window', subject_id: 'panel', subject_path: ['native_window', root.root_id, 'ax_element', 'panel'], subject_kind: 'AXGroup', role: 'AXGroup', label: 'Explorer', projection: { ...baseProjection, subject_id: 'panel', subject_kind: 'AXGroup', visible_display_rect: { x: 100, y: 100, w: 500, h: 500 }, display_space_rect: { x: 100, y: 100, w: 500, h: 500 } } }
const child = { id: 'child', adapter_id: 'macos-ax', root_id: root.root_id, root_kind: 'native_window', subject_id: 'child', subject_path: ['native_window', root.root_id, 'ax_element', 'panel', 'child'], subject_kind: 'AXButton', role: 'AXButton', label: 'Child', capabilities: ['press'], projection: { ...baseProjection, subject_id: 'child', subject_kind: 'AXButton', visible_display_rect: { x: 120, y: 120, w: 80, h: 32 }, display_space_rect: { x: 120, y: 120, w: 80, h: 32 } } }
const overlappingNonDescendant = { id: 'other-child', adapter_id: 'macos-ax', root_id: root.root_id, root_kind: 'native_window', subject_id: 'other-child', subject_path: ['native_window', root.root_id, 'ax_element', 'other-panel', 'other-child'], subject_kind: 'AXButton', role: 'AXButton', label: 'Other', capabilities: ['press'], projection: { ...baseProjection, subject_id: 'other-child', subject_kind: 'AXButton', visible_display_rect: { x: 130, y: 130, w: 40, h: 20 }, display_space_rect: { x: 130, y: 130, w: 40, h: 20 } } }
const point = { x: 140, y: 140 }
console.log(JSON.stringify({ selected: chooseAnnotationCandidateForScope([panel, child, overlappingNonDescendant], panel, point)?.id, report: explainAnnotationCandidateChoice([panel, child, overlappingNonDescendant], panel, point) }, null, 2))
EOF
```

It currently selects `other-child`. That candidate is same-root and inside the
panel rect, but its subject path is under `other-panel`, not under `panel`.
The expected selected candidate is `child`, and `other-child` should be rejected
with a scoped-path reason such as `candidate_not_in_active_scope` or a clearer
existing reason.

## Goal

Make native AX scoped selection honor active-anchor subject-path ancestry when
that evidence is available, while preserving the accepted scoped-descendant and
visual-equivalence behavior:

- visually distinct descendants inside the active scope may win;
- same-rectangle layers collapse to one stable representative;
- active-scope-equivalent descendants produce
  `active_scope_no_distinct_descendant_under_pointer`;
- same-window but non-descendant native AX candidates must not win merely
  because their rect is inside the active anchor.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/work-cards/sigil-reticle-scoped-descendant-disambiguation-correction-v0.md`
- `packages/toolkit/workbench/annotation-candidates.js`
- `tests/toolkit/annotation-candidates.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
rg -n "candidateDirectnessForScope|rectsVisuallyEquivalent|candidate_visual_equivalent|scoped_native_window_child|scoped_descendant|native extended-display" packages/toolkit/workbench/annotation-candidates.js tests/toolkit/annotation-candidates.test.mjs
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or input
tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and include the script output. After the human
returns with `ready`, run `./aos ready --post-permission`.

## Existing Code To Inspect

- `packages/toolkit/workbench/annotation-candidates.js` - owns
  `candidateDirectnessForScope`, subject-path checks, visual-equivalence
  collapse, rejection reports, and final scoped ranking.
- `tests/toolkit/annotation-candidates.test.mjs` - add the active native AX
  anchor path-scope regression here.
- `tests/renderer/annotation-reticle.test.mjs` - only adjust if the toolkit
  helper cannot prove the contract.

## Required Behavior

When the active scope is a native AX anchor or native window and both active
scope and candidate have meaningful `subject_path` ancestry:

- reject the active scope itself as `candidate_is_active_scope`;
- require native AX candidates to stay under the active scope path when the
  active scope is narrower than the native window root;
- allow deeper descendants under that path when visually distinct;
- reject same-window candidates outside that path with
  `candidate_not_in_active_scope`, `candidate_outside_active_scope`, or a
  clearer existing scoped-path reason;
- keep other-root candidates rejected as `native_ax_root_mismatch`;
- keep same-rectangle collapse and no-distinct-descendant fallback intact.

When the active native scope is only the native window root, same-root native AX
children remain valid as before. Do not require direct children only.

If subject-path evidence is flat, missing, or unreliable, keep behavior
explainable with limitation evidence rather than silently promoting the active
full window or accepting a false child.

## Scope

Likely ownership is limited to:

- `packages/toolkit/workbench/annotation-candidates.js`
- `tests/toolkit/annotation-candidates.test.mjs`

Avoid daemon, Swift, browser command, Surface Inspector, snapshot schema, or
persistent storage changes.

## Hard Boundaries / Non-Goals

- Do not revert same-rectangle visual-equivalence collapse.
- Do not restore direct-child-only behavior.
- Do not restart the older broad browser-targeting card.
- Do not make Surface Inspector the primary annotation authoring UI.
- Do not add a persistent annotation database or redesign snapshot schemas.
- Do not add Sigil-named daemon policy.
- Do not use screenshot pixels as the source of truth.
- Do not add broad AX tree harvesting.
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
- the exact native AX active-scope path behavior changed;
- tests run with pass/fail results;
- `./aos ready` result;
- any live smoke result or why it was skipped;
- any remaining blocker or follow-up recommendation.
