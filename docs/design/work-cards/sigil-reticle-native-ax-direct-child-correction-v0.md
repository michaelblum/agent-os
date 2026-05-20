# Sigil Reticle Native AX Direct-Child Correction V0

## Tracker

- Display-first annotation epic: https://github.com/michaelblum/agent-os/issues/295
- Source correction card:
  `docs/design/work-cards/sigil-reticle-scoped-targeting-explainability-correction-v0.md`
- Returned GDI branch under Foreman review:
  `gdi/sigil-reticle-scoped-targeting-explainability-correction-v0`
- Returned GDI commit:
  `8e83e336c11668b14a4d6491ae3dff7d58089fb9`

Foreman deterministic review accepted the direction of the returned branch but
found one blocking acceptance gap in native AX scoped direct-child behavior. Do
not restart the broader browser targeting work.

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
  `explainAnnotationCandidateChoice`.

## Foreman Review Finding

The returned branch rejects the active full native window scope and explains
outside siblings, but native scoped filtering still treats every same-window AX
element as a direct child. That leaves a timing/selection hole: when a native
window scope is active and both an immediate panel candidate and a smaller
descendant/control candidate contain the pointer, the smaller descendant wins.

Foreman confirmation command:

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

It currently prints `button`. The correction should make this case select
`panel` and expose the deeper candidate as rejected with
`candidate_not_direct_child` or an equally precise existing direct-child reason.

## Goal

Make native AX scoped reticle selection honor the same direct-child contract as
semantic and browser DOM scoped selection when ancestry evidence is present,
without undoing the diagnostics, browser DOM evidence, stale-response handling,
or tests added by the returned branch.

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
rg -n "candidateDirectnessForScope|explainAnnotationCandidateChoice|candidate_not_direct_child|scoped_native_window_child|native extended-display" packages/toolkit/workbench/annotation-candidates.js tests/toolkit/annotation-candidates.test.mjs tests/renderer/annotation-reticle.test.mjs
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
  `candidateDirectnessForScope`, scoped filtering, rejection reports, and
  candidate ranking.
- `apps/sigil/renderer/live-modules/annotation-reticle.js` - records reticle
  decision reports on preview and release.
- `tests/toolkit/annotation-candidates.test.mjs` - add the direct-child native
  AX deterministic coverage here.
- `tests/renderer/annotation-reticle.test.mjs` - add or adjust reticle-level
  coverage only if the toolkit helper fix is not enough to prove release
  commits the immediate child scope.

## Required Behavior

### Native AX Direct-Child Selection

When the active scope is a native window or native AX anchor and subject-path
ancestry is available:

- reject the active scope itself as `candidate_is_active_scope`;
- prefer the immediate native AX child under the pointer over deeper descendants;
- reject deeper descendants with `candidate_not_direct_child` or a more precise
  existing direct-child reason;
- keep outside or other-root native AX candidates rejected as
  `native_ax_root_mismatch` or `candidate_outside_active_scope`;
- do not let the full app window win while it is the active scope.

If current native AX evidence is flat and cannot prove ancestry, keep the
behavior explainable. Either preserve the existing leaf-only selection with
explicit limitation evidence or fall back with a blocker reason; do not silently
promote the active full window as a successful child target.

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
- the exact native AX direct-child behavior changed;
- tests run with pass/fail results;
- `./aos ready` result;
- any live smoke result or why it was skipped;
- any remaining blocker or follow-up recommendation.
