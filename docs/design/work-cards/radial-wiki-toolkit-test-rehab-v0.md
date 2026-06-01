# Radial Wiki Toolkit Test Rehab V0

## Tracker

- User report: "radial Menu does not work. We need all of the tests for the radial menu and the wiki browser/workshop and all of the toolkit stuff rehabed if they're not present/working."
- PR stack: #378 `feat/command-surface-extraction`.
- Current head at card creation: `1bea8186 fix(sigil): make experience activation load live roots`.
- Prior adjacent cards:
  - `docs/design/work-cards/real-input-surface-test-primitives-and-seam-radial-v0.md`
  - `docs/design/work-cards/toolkit-subject-browser-zag-disclosure-revamp-v0.md`
  - `docs/design/work-cards/toolkit-3d-radial-menu-workbench-v0.md`
  - `docs/design/work-cards/subject-family-runtime-cleanup-primitive-v0.md`

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- output_branch: `gdi/radial-wiki-toolkit-test-rehab-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, permission, issue, PR, or prior implementation state. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

This is a product-test rehab slice for Sigil's radial menu and the toolkit wiki
surfaces it should be able to open. It is not a request to add more green model
unit tests while the live product remains broken.

## Goal

Make the radial menu, wiki browser/workshop, and the relevant toolkit support
tests form a coherent, runnable contract for the current Sigil-as-AOS-experience
MVP.

The expected end state is:

- current focused deterministic radial/wiki/toolkit tests pass;
- missing or stale tests are repaired rather than silently ignored;
- the live radial menu path is covered from user-facing activation through a real
  or realistic input path;
- the radial menu can open the current MVP wiki/browser/workshop surface, or the
  affordance is made explicitly disabled with tests proving it cannot appear as a
  working action;
- test helpers use shared AOS/toolkit primitives instead of duplicating display,
  canvas, pointer, semantic-target, or cleanup logic;
- the verification commands are documented so Foreman and humans can rerun them
  without rediscovering the maze.

## Current Baseline Evidence

Foreman ran this focused deterministic group on `feat/command-surface-extraction`
at card creation and it passed 81/81:

```bash
node --test \
  tests/renderer/radial-menu-activation.test.mjs \
  tests/renderer/radial-gesture-menu.test.mjs \
  tests/renderer/radial-menu-target-surface.test.mjs \
  tests/toolkit/runtime-radial-gesture.test.mjs \
  tests/toolkit/runtime-radial-menu-config.test.mjs \
  tests/toolkit/runtime-menu-activation.test.mjs \
  tests/toolkit/wiki-subject-browser.test.mjs \
  tests/toolkit/wiki-kb.test.mjs \
  tests/toolkit/wiki-kb-semantics.test.mjs \
  tests/toolkit/wiki-kb-layout-modes.test.mjs
```

This green baseline is not acceptance. It means the reported defect is probably
live integration, real input, target-surface geometry, stale launch wiring,
radial item action wiring, or missing end-to-end proof.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `tests/README.md`
- `docs/api/aos.md`
- `docs/api/toolkit/runtime.md`
- `docs/design/work-cards/real-input-surface-test-primitives-and-seam-radial-v0.md`
- `docs/design/work-cards/toolkit-subject-browser-zag-disclosure-revamp-v0.md`
- `experiences/sigil/aos-experience.json`
- `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD origin/feat/command-surface-extraction
./aos experience status --json
./aos show list --json
./aos status --json
./aos ready
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not retry in a
loop. Run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Keep deterministic work moving while live checks are blocked only when that work
can be completed without pretending live proof passed.

## Existing Code To Inspect

Radial product and live path:

- `apps/sigil/renderer/live-modules/main.js` - status item, visibility, radial,
  fast-travel, and action dispatch integration.
- `apps/sigil/renderer/live-modules/radial-gesture-runtime.js` - live pointer to
  radial gesture contract.
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js` - menu model used by
  the live renderer.
- `apps/sigil/renderer/live-modules/radial-menu-activation.js` - maps committed
  radial items to action requests.
- `apps/sigil/renderer/live-modules/menu-activation-runtime.js` - runtime action
  execution for committed menu items.
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js` - child target
  surface and semantic targets for real-input interaction.
- `apps/sigil/renderer/radial-menu/items/wiki-brain.js` - current wiki/brain
  item action.
- `apps/sigil/renderer/radial-menu/items/agent-terminal.js` - known launch item;
  useful comparison for action wiring.
- `apps/sigil/renderer/radial-menu/sigil-radial-menu.json` - active menu config.

Toolkit radial/menu primitives:

- `packages/toolkit/runtime/radial-gesture.js`
- `packages/toolkit/runtime/radial-menu-config.js`
- `packages/toolkit/runtime/menu-activation.js`
- `packages/toolkit/runtime/radial-item-transition.js`
- `packages/toolkit/runtime/desktop-world-hit-region.js`
- `packages/toolkit/runtime/input-events.js`
- `packages/toolkit/runtime/input-region.js`
- `packages/toolkit/runtime/spatial.js`

Wiki browser/workshop surfaces:

- `packages/toolkit/components/wiki-kb/index.js`
- `packages/toolkit/components/wiki-kb/views/graph.js`
- `packages/toolkit/components/wiki-kb/views/radial-graph.js`
- `packages/toolkit/components/wiki-kb/semantics.js`
- `packages/toolkit/components/wiki-kb/launch.sh`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `packages/toolkit/components/wiki-subject-browser/model.js`
- `packages/toolkit/components/wiki-subject-browser/semantics.js`
- `packages/toolkit/components/wiki-subject-browser/launch.sh`
- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/html-file-workbench/index.js`
- `packages/toolkit/workbench/wiki-subject.js`
- `packages/toolkit/workbench/wiki-subject-opening.js`

Test harness and live proof:

- `tests/lib/visual-harness.sh`
- `tests/lib/status-item.sh`
- `tests/lib/sigil/radial-menu.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/sigil-real-input-status-avatar.sh`
- `tests/sigil-status-item-lifecycle.sh`
- `tests/wiki-kb-smoke.sh`
- `tests/sigil-workbench-kb.sh`

Focused deterministic tests to inspect/rehab:

- `tests/renderer/radial-menu-activation.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/radial-gesture-visuals.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/renderer/radial-activation-transition.test.mjs`
- `tests/toolkit/runtime-radial-gesture.test.mjs`
- `tests/toolkit/runtime-radial-menu-config.test.mjs`
- `tests/toolkit/runtime-radial-item-transition.test.mjs`
- `tests/toolkit/runtime-menu-activation.test.mjs`
- `tests/toolkit/wiki-kb.test.mjs`
- `tests/toolkit/wiki-kb-semantics.test.mjs`
- `tests/toolkit/wiki-kb-layout-modes.test.mjs`
- `tests/toolkit/wiki-subject-browser.test.mjs`
- `tests/toolkit/wiki-subject-opening.test.mjs`
- `tests/toolkit/wiki-subject.test.mjs`
- `tests/toolkit/workbench-subject.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`

## Required Behavior

### Radial Menu Product Contract

- `aos experience activate sigil` must leave the status item configured with live
  content roots and no pre-created avatar canvas.
- A single normal status-item click should show a booted avatar after permissions
  are ready.
- The user-facing radial menu gesture must open a target surface whose hit
  targets are externally observable and native-clickable/mouse-draggable.
- Releasing on a radial item must produce one deterministic committed action; it
  must not silently cancel, fast-travel by accident, or lose the selected item.
- The committed action must reach the runtime activation path. If the action is
  `Graph Wiki Brain`, it must open the accepted MVP wiki surface. If the product
  contract is not ready to open that surface, the affordance must be visibly and
  semantically disabled instead of pretending to work.

### Wiki Browser / Workshop Contract

Treat "wiki browser/workshop" as the current toolkit wiki surface set unless the
code reveals a better canonical name:

- Wiki KB graph/radial graph remains deterministic and semantic-targeted.
- Wiki Subject Browser still starts graph-first, opens Markdown/wiki pages,
  exposes Catalog/Index/Details/Trail semantics, and clears back to graph root.
- Launch scripts must ensure live content roots through shared helpers, not stale
  hard-coded root names.
- Browser/workshop surfaces must be launchable through `aos://toolkit...` roots
  after Sigil activation, not only in isolated tests.
- Tests should prove the radial action reaches the same toolkit surface contract
  the direct launcher uses.

### Toolkit Test Rehab Contract

Do not interpret "all toolkit stuff" as running every historical employer-brand
or unrelated toolkit test in this slice. Interpret it as all toolkit runtime,
controls, workbench, and component tests that are directly in the radial menu /
wiki browser / Sigil-surface dependency path.

Required rehab tasks:

- Inventory the relevant tests and classify each as model, renderer, launcher,
  isolated-daemon, live real-input, or manual/HITL.
- Re-enable or repair tests that are skipped, stale, impossible to run, or
  testing old launch paths.
- Add missing tests where a current product contract has no coverage.
- Remove or rewrite tests that only preserve retired avatar-configuration or
  workbench behavior,
  unless they are explicitly legacy and sequestered.
- Update `tests/README.md` with the command groups and prerequisite gates needed
  to rerun this surface family.

## Hard Boundaries

- Do not revive the retired avatar configuration surface or make the legacy
  workbench the current product path.
- Do not use direct DOM/eval activation as the acceptance proof for live user
  behavior. Eval is allowed for observation after native or realistic input.
- Do not add another one-off radial test harness if existing primitives can be
  repaired.
- Do not duplicate DesktopWorld/native coordinate conversion in scenario-local
  scripts.
- Do not paper over a live product failure by asserting only pure model tests.
- Do not run full broad toolkit/employer-brand suites repeatedly. Keep memory
  pressure low: run focused groups, avoid parallel live daemons, and do not do
  repeated rebuild/restart loops unless needed for changed Swift.
- Do not build `./aos` unless Swift/native files changed or live proof requires
  a native change.
- Do not mutate GitHub PR state unless the work card explicitly reaches a clean
  checkpoint and the branch is pushed as the output branch.

## Suggested Implementation Areas

After reading the code, choose the narrowest correct layer. Likely areas:

- radial menu item action wiring for `wiki-brain` / `graph-wiki-brain`;
- `menu-activation-runtime` dispatch to toolkit launchers;
- target-surface semantic target publication or hit geometry;
- `tests/lib/sigil/radial-menu.sh` and real-input scenario helpers;
- wiki launcher root setup and launch smoke tests;
- test README grouping and command discoverability.

## Verification

Run deterministic verification first:

```bash
node --test \
  tests/renderer/radial-menu-activation.test.mjs \
  tests/renderer/radial-gesture-menu.test.mjs \
  tests/renderer/radial-gesture-visuals.test.mjs \
  tests/renderer/radial-menu-target-surface.test.mjs \
  tests/renderer/radial-activation-transition.test.mjs \
  tests/toolkit/runtime-radial-gesture.test.mjs \
  tests/toolkit/runtime-radial-menu-config.test.mjs \
  tests/toolkit/runtime-radial-item-transition.test.mjs \
  tests/toolkit/runtime-menu-activation.test.mjs \
  tests/toolkit/runtime-input-events.test.mjs \
  tests/toolkit/runtime-input-region.test.mjs \
  tests/toolkit/runtime-interaction-region.test.mjs \
  tests/toolkit/runtime-desktop-world-hit-region.test.mjs
```

Run wiki/toolkit deterministic verification:

```bash
node --test \
  tests/toolkit/wiki-kb.test.mjs \
  tests/toolkit/wiki-kb-semantics.test.mjs \
  tests/toolkit/wiki-kb-layout-modes.test.mjs \
  tests/toolkit/wiki-subject-browser.test.mjs \
  tests/toolkit/wiki-subject-opening.test.mjs \
  tests/toolkit/wiki-subject.test.mjs \
  tests/toolkit/workbench-subject.test.mjs \
  tests/toolkit/radial-menu-subject.test.mjs \
  tests/schemas/aos-workbench-subject.test.mjs
```

Run launcher/shell verification where applicable:

```bash
bash tests/wiki-kb-smoke.sh
bash tests/sigil-workbench-kb.sh
bash tests/sigil-status-item-lifecycle.sh
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
git diff --check
```

Live proof after `./aos ready` passes:

```bash
./aos experience activate sigil --json
./aos show list --json
```

Then perform one bounded live path:

1. Use the status item to show the avatar.
2. Open the radial menu through the real user path or the existing real-input
   radial scenario helper.
3. Confirm the radial target surface is active, visible/intersecting an active
   display, and emits semantic targets.
4. Select the Wiki/Graph Brain radial item.
5. Confirm the current MVP wiki/browser/workshop surface opens and reaches a
   ready observable state.
6. Run `./aos clean --dry-run --json` and confirm Sigil-owned active/warm
   canvases are not misclassified as stale while the experience is active.
7. Clean up only scenario-owned surfaces.

If live input is unavailable, report the exact `./aos ready` diagnosis and the
`.docks/gdi/scripts/human-needed-tcc-reset` result instead of claiming live
proof.

Optional real-input scenarios when readiness and machine pressure allow:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

## Required Output

- Commit and push the output branch if changes are made.
- Keep the worktree clean at completion.
- Do not leave live canvases, orphaned clients, stale daemons, or extra input-tap
  owners running.
- If no code changes are needed but the product is still broken, produce a
  concise report proving which live contract fails and route the narrow follow-up
  target.

## Completion Report

Report:

- branch/head SHA and whether pushed;
- files changed;
- test inventory classification added or updated;
- radial menu root cause and behavior changed;
- wiki/browser/workshop behavior changed;
- deterministic tests run with exact pass/fail results;
- live proof result or exact readiness blocker;
- `./aos show list --json`, `./aos clean --dry-run --json`, and `./aos status --json` final summaries;
- any tests intentionally skipped, with precise skip reason;
- remaining follow-up recommendation if the live product still needs another
  slice.
