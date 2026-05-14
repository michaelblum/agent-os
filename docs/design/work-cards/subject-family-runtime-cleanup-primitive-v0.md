# Subject-Family Runtime Cleanup Primitive V0

## Tracker

- Epic: #223 AOS Surface System
- Source queue:
  `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`
- Checkpoint PR: #307 Surface Stack V0 checkpoint
- Preceding follow-ups:
  `docs/design/work-cards/surface-inspector-mark-contract-v0.md`
  and `docs/design/work-cards/canonical-canvas-reload-workflow-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. The branch may have unrelated local state such as `.vscode/` or dock
skill edits; do not stage or mutate those unless the active diff proves they are
part of this slice.

## Goal

Make runtime cleanup for an owned subject family explicit and reliable, so a
root subject and its owned child surfaces can be removed without disturbing
developer/admin surfaces such as `surface-inspector`.

The concrete defect behind this slice is that avatar, radial, and hit-target
surfaces can reappear from saved runtime state after inspector/root relaunch,
creating duplicate-race risk. Start by auditing whether existing parent/cascade
removal and toolkit resource scopes already provide the right primitive. If they
do, document and test the canonical cleanup workflow and route consumers through
it. If not, add the smallest generic primitive needed.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/api/aos.md`
- `docs/api/toolkit/runtime.md`
- `docs/design/aos-surface-system.md`
- `src/shared/command-registry-data.swift`
- `src/display/canvas.swift`
- `src/daemon/unified.swift`
- `packages/toolkit/runtime/resource-scope.js`
- `packages/toolkit/runtime/desktop-world-hit-region.js`
- `tests/lib/real-input-surface-harness.sh`
- `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
./aos show list --json
rg -n "canvas\\.remove|show remove|removeCanvas|orphan_children|cascade|parent|owner|resource-scope|input_region.remove|removeInputRegionsOwned|surface-inspector|avatar-main|sigil-hit|sigil-radial" src packages apps tests docs/api docs/design
```

Before choosing build/test commands after edits, run `./aos dev recommend
--json` again.

## Existing Behavior To Inspect

Current known primitives:

- Canvas creation records `parent`, `cascade`, and optional owner metadata.
- Removing a parent canvas cascades to cascade-eligible children and orphans
  `cascade=false` children.
- `canvas.remove` / toolkit `removeCanvas()` accepts `orphan_children`.
- The daemon removes input regions owned by a canvas when that canvas is
  removed, and removes suspend-owned regions on suspend.
- `createResourceScope()` tracks child canvases, stage layers, input regions,
  subscriptions, and custom cleanup callbacks, with deterministic idempotent
  cleanup.
- Surface Inspector observes canvas lifecycle, input-region, and stage-layer
  ownership, but it is a developer/admin surface and must not be removed by a
  subject cleanup operation unless explicitly targeted.

Inspect whether these are sufficient for a canonical subject-family cleanup
recipe. If they are sufficient, avoid adding a new daemon command. If they are
not sufficient, identify the missing generic primitive before implementation.

## Required Behavior

### Generic Subject Selection

Cleanup must be expressible in generic AOS terms, not Sigil-specific names.
Acceptable selector concepts include root canvas id, parent/child lifecycle
tree, owner metadata, resource scope id, harness id, or another generic field
already present in canvas/resource metadata.

Do not add daemon branches for `sigil`, `avatar`, `radial`, or hit targets.
Sigil may use the generic primitive from app or test harness code, but product
policy stays out of the daemon.

### Cleanup Semantics

The canonical operation should:

- remove the selected root subject when requested;
- remove cascade-owned child canvases;
- remove owned input regions;
- remove or route cleanup for stage layers that belong to the subject family;
- leave unrelated canvases alone;
- preserve developer/admin surfaces such as `surface-inspector` by selection
  semantics, not by hard-coded product exceptions;
- be idempotent when run after the subject family is already gone;
- report what it removed, preserved, orphaned, or could not classify.

If stage-layer cleanup cannot be guaranteed from the chosen layer, document the
gap and add a focused test or harness assertion for the supported boundary.

### Consumer Route

Update the narrowest relevant consumer boundary after the primitive is clear.
Likely candidates are the real-input surface harness cleanup helper or toolkit
resource scope cleanup. Do not change Sigil product behavior unless the audit
proves the cleanup bug is in Sigil's use of the generic primitive.

### Documentation

Add the canonical cleanup contract to the right source of truth:

- `docs/api/aos.md` if the result is a CLI or daemon-facing command;
- `docs/api/toolkit/runtime.md` if the result is a toolkit resource-scope
  contract;
- `docs/design/aos-surface-system.md` if the result is a platform design
  invariant that spans daemon and toolkit.

## Possible Implementation Paths

Choose the smallest path after inspection:

- **Docs/test-only path:** if parent/cascade removal plus `createResourceScope`
  is already adequate, document the recipe and add focused tests proving that
  the subject tree is removed while unrelated/admin canvases survive.
- **Harness/helper path:** add a narrow shell or toolkit helper that applies
  existing primitives consistently for tests and real-input scenarios.
- **Small CLI/daemon path:** add a generic cleanup command or flag only if the
  current primitives cannot safely express subject-family cleanup. If adding a
  command, update parser/help registry, API docs, and IPC tests together.

## Scope

This is a daemon/toolkit runtime contract slice. It may touch Swift, toolkit
runtime helpers, shell harness helpers, API/design docs, and focused tests. It
should not add app-specific cleanup policy or broad state-management features.

## Hard Boundaries

- Do not hard-code Sigil subject names in daemon cleanup logic.
- Do not remove `surface-inspector` or other unrelated canvases in tests.
- Do not add broad saved-state reset, hot reload, or workspace cleanup features.
- Do not change content-root scoping policy.
- Do not expand this into compacting real-input output; that remains a separate
  queued follow-up.
- Do not stage unrelated `.docks/` or editor configuration changes.

## Suggested Implementation Areas

Likely files:

- `src/display/canvas.swift`
- `src/daemon/unified.swift`
- `src/shared/command-registry-data.swift`
- `packages/toolkit/runtime/resource-scope.js`
- `packages/toolkit/runtime/canvas.js`
- `tests/lib/real-input-surface-harness.sh`
- `tests/daemon-ipc-show.sh`
- new focused shell test such as `tests/show-subject-cleanup.sh`
- `docs/api/aos.md`
- `docs/api/toolkit/runtime.md`
- `docs/design/aos-surface-system.md`

These are suggestions, not permission to edit all of them. Inspect first and
keep the write set as small as the final path allows.

## Verification

Minimum for docs/test-only or helper-only:

```bash
git diff --check
./aos ready
./aos dev recommend --json
bash <new-or-changed-focused-test>
```

If command parser/help or Swift daemon behavior changes:

```bash
./aos dev build
./aos ready
bash tests/help-contract.sh
bash tests/daemon-ipc-show.sh
bash <new-focused-cleanup-test>
```

Focused cleanup test evidence should prove:

- a selected root subject can be cleaned up;
- owned child canvases are removed;
- owned input regions or the supported cleanup boundary are removed;
- an unrelated/admin canvas remains;
- running cleanup again is safe;
- the result reports removed/preserved/orphaned/error details when applicable.

Run broader commands only if `./aos dev recommend --json` points to them.

## Completion Report

Include:

- whether the final path is docs/test-only, helper-only, or new CLI/daemon
  behavior;
- files changed;
- exact cleanup workflow or primitive added;
- preservation semantics verified for unrelated/admin canvases;
- tests run and results;
- readiness result or blocker;
- next follow-up recommendation from
  `surface-stack-retrospective-followups-v0.md`.
