# Work Card: Sigil Radial Menu Main Integration Doc Conflicts V0

## Tracker

- Source branch to integrate:
  `origin/gdi/sigil-radial-menu-data-driven-3d-config-v0`
- Source branch current head:
  `5afe7bd268c8531a38ab970f4f526dd889a9ea95`
- Target base:
  `main` at or after `f60d5376a3702f0957dae3262b47b00c4e73abbb`
- Foreman preflight on 2026-05-16:
  `git merge-tree --write-tree main origin/gdi/sigil-radial-menu-data-driven-3d-config-v0`
  reports add/add conflicts only in:
  - `docs/design/work-cards/sigil-3d-thing-editor-subjects-v0.md`
  - `docs/design/work-cards/sigil-context-menu-data-driven-controls-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. This is an integration slice, not a rewrite of either workstream.

## Goal

Reconcile the doc conflicts that block merging the accepted radial-menu
data-driven 3D config branch into current `main`, then produce a reviewable
integration branch.

The radial branch contains accepted code/docs for the data-driven Sigil radial
menu stack. Current `main` contains the later accepted avatar object graph,
context-menu descriptor, and 3D thing editor subject work. The integration must
preserve both.

## Role Routing

- GDI owns this work card: create the integration branch, merge the radial-menu
  branch, resolve the expected doc conflicts, run deterministic verification,
  push the integration branch, and report results.
- Foreman owns review, acceptance, merge to `main`, branch deletion, and any
  follow-on routing after GDI reports completion.
- Operator is not the owner for this slice. Use Operator only if Foreman later
  routes supervised/live verification because deterministic checks pass and the
  next meaningful proof needs real input or human observation.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-v0.md`
- `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-review-corrections-v0.md`
- `docs/design/work-cards/sigil-3d-thing-editor-subjects-v0.md`
- `docs/design/work-cards/sigil-context-menu-data-driven-controls-v0.md`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `apps/sigil/renderer/radial-menu-defaults.js`
- `packages/toolkit/runtime/radial-menu-config.js`
- `apps/sigil/radial-item-editor/model.js`

## Rediscover State

Run:

```bash
git status --short --branch
git fetch origin main gdi/sigil-radial-menu-data-driven-3d-config-v0
git rev-parse main origin/main origin/gdi/sigil-radial-menu-data-driven-3d-config-v0
git log --oneline --left-right --cherry-pick main...origin/gdi/sigil-radial-menu-data-driven-3d-config-v0
git merge-tree --write-tree main origin/gdi/sigil-radial-menu-data-driven-3d-config-v0
./aos dev recommend --json
```

`git merge-tree --write-tree` is expected to exit non-zero before the fix and
print add/add conflicts for the two work-card files named in Tracker. If it
shows code conflicts too, stop and report them instead of guessing.

## Required Integration Flow

Create a new integration branch from current `main`, for example:

```bash
git switch main
git pull --ff-only origin main
git switch -c gdi/sigil-radial-main-integration-v0
git merge --no-ff origin/gdi/sigil-radial-menu-data-driven-3d-config-v0
```

Resolve the two expected doc conflicts and complete the merge. Do not push
directly to `main`.

## Conflict Resolution Policy

### `sigil-3d-thing-editor-subjects-v0.md`

Keep the current `main` version as the base. It includes accepted prerequisite
heads for the avatar adapter and context-menu descriptor work, plus the
Foreman note about live readiness being blocked by
`diagnosis=input_tap_not_active`.

The radial branch version is an older copy created before the follow-on
implementation and review corrections landed. Do not let it remove the accepted
tracker heads, readiness note, or subject-loader guidance already on `main`.

If the radial branch version contains a non-duplicative read-first or
verification detail, fold it in without weakening the accepted `main` context.

### `sigil-context-menu-data-driven-controls-v0.md`

Keep the current `main` version as the base. It includes the accepted
prerequisite adapter head and explicitly routes the context-menu descriptor work
from the avatar adapter branch.

The radial branch version is an older copy. Do not let it remove the tracker,
accepted heads, or descriptor/action routing guidance already on `main`.

### Radial Work Cards

Preserve the radial branch's radial-menu work cards:

- `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-v0.md`
- `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-review-corrections-v0.md`

Also preserve `docs/design/work-cards/sigil-3d-object-graph-platform-contract-v0.md`
from the radial branch if the merge adds it. Current `main` already has the
actual design note `docs/design/aos-3d-object-graph-platform-contract.md`; do
not replace or downgrade it.

## Behavioral Preservation

After the merge:

- radial menu defaults and Sigil default appearance/state must derive from the
  data-driven radial menu config;
- `radial-gesture-visuals.js` must keep generic orchestration while item modules
  own special glyph/effect behavior;
- avatar object graph adapter behavior from `main` must remain intact;
- descriptor-driven context menu routing from `main` must remain intact;
- 3D thing editor subject loading and canonical avatar rejection results from
  `main` must remain intact.

## Hard Boundaries / Non-Goals

- Do not reimplement the radial menu config work.
- Do not rewrite the context menu or 3D thing editor.
- Do not delete accepted work cards from either workstream.
- Do not push directly to `main`.
- Do not delete the source radial branch; Foreman will handle branch cleanup
  after review/merge.
- Do not run destructive git commands.

## Verification

Minimum deterministic checks:

```bash
git diff --check
node --check apps/sigil/renderer/radial-menu-defaults.js
node --check apps/sigil/renderer/live-modules/radial-gesture-menu.js
node --check apps/sigil/renderer/live-modules/radial-gesture-visuals.js
node --check apps/sigil/renderer/live-modules/main.js
node --check packages/toolkit/runtime/radial-menu-config.js
node --check apps/sigil/radial-item-editor/model.js
node --test tests/toolkit/runtime-radial-menu-config.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-gesture-visuals.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs
node --test tests/renderer/avatar-object-control.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
```

Also run the source audits from the radial-menu review if possible:

```bash
rg -n "createNestedNeuralTreeEffect|updateNestedNeuralTreeEffect|createFractalBrainTreeEffect|updateFractalBrainTreeEffect|updateRadialEffect" apps/sigil/renderer/live-modules/radial-gesture-visuals.js
```

That audit should produce no hits in `radial-gesture-visuals.js`.

For live evidence, run `./aos ready`. If it passes and deterministic checks are
clean, run:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

If `./aos ready` reports `diagnosis=input_tap_not_active`, do not start a
permission repair loop for this integration slice. Report the blocker exactly.

## Completion Report

Include:

- integration branch name and head SHA;
- source radial branch head merged;
- exact conflict files and how they were resolved;
- whether `main` tracker details were preserved in the two conflicting cards;
- tests/checks run with exact pass/fail results;
- live readiness or real-input smoke result;
- local-only state;
- whether the source radial branch can be deleted after Foreman merges the
  integration branch.
