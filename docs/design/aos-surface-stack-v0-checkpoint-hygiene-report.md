# AOS Surface Stack V0 Checkpoint Hygiene Report

**Date:** 2026-05-12
**Branch:** `codex/docks-session-roots`
**Status:** checkpoint verification passed after two harness hygiene fixes

This report classifies the dirty surface-stack worktree and records the
verification run used to prepare an integration checkpoint. It does not stage,
commit, push, or close the parent #223 epic.

## Related Tracker IDs

This report used #223, #304, #303, #122, #120, #123, #261, #305, #118, #119,
and #45 as related tracker IDs at the time of writing. Query GitHub for current
issue titles, states, and labels before acting on those IDs.

## Dirty Worktree Classification

The checkpoint worktree remains intentionally broad. After generated test
artifacts were removed, the working tree contains roughly 106 tracked changed
paths and 80 untracked paths.

### Accepted V0 Implementation

These paths are the core surface-stack implementation:

- `src/daemon/`, `src/display/`, `src/perceive/`, and
  `src/shared/command-registry-data.swift` for daemon input regions, lifecycle,
  canvas info, display/native routing, and command-surface updates.
- `shared/schemas/input-event-v2*`, `shared/schemas/daemon-event.md`, and
  related fixtures for routed input identity and scroll/cancel payload coverage.
- `packages/toolkit/runtime/`, `packages/toolkit/panel/`, and
  `packages/toolkit/components/desktop-world-stage/` for resource scope,
  input-event helpers, DesktopWorld hit-region helpers, stage affordances,
  panel/window policy, and passive stage visuals.
- `packages/toolkit/components/surface-inspector/` for inspector resource
  visibility, minimap mark sizing, tree rows, and launch/root handling.
- `apps/sigil/renderer/`, `apps/sigil/context-menu/`, and Sigil panel/editor
  paths for second-client consumption of accepted daemon/toolkit primitives.

### Accepted V0 Tests

These paths are part of the checkpoint test surface:

- `tests/toolkit/` for runtime, panel, inspector, resource, docs-contract, and
  decision-tree coverage.
- `tests/renderer/` for Sigil input identity, hit targets, radial menu target
  surfaces, input-region adapter behavior, and panel migration guardrails.
- `tests/lib/real-input-*`, `tests/lib/sigil/radial-menu.sh`, and
  `tests/scenarios/sigil/radial-menu/` for reusable real-input primitives and
  topology-neutral DesktopWorld radial path coverage.
- Shell smokes under `tests/` for canvas lifecycle, input ownership, inspector,
  content roots, and display/debug behavior.

### Accepted V0 Docs And Work Cards

These paths are documentation source-of-truth for the checkpoint:

- `AGENTS.md`, subtree `AGENTS.md` files, and compatibility `CLAUDE.md` files.
- `ARCHITECTURE.md`, `README.md`, `docs/api/`, `docs/adr/`, and
  `docs/design/aos-*`.
- `docs/guides/aos-surface-interaction-decision-tree.md`,
  `.docks/foreman/skills/session-transfer/references/implementer-work-card-authoring.md`,
  and related workflow references.
- Surface-stack work cards under `docs/design/work-cards/`.

### Checkpoint Hygiene Added During This Pass

- `.docks/foreman/AGENTS.md`: removed the known trailing blank-line-at-EOF
  blocker while preserving the existing Foreman contract edits.
- `tests/lib/isolated-daemon.sh`: isolated daemon tests now register
  branch-scoped aliases for canonical `toolkit`, `sigil`, and `repo` content
  roots. This prevents component launch scripts from restarting an isolated
  daemon just to make branch-scoped roots live.
- `tests/surface-inspector-snapshot.sh`: the smoke now enables the Inspector's
  minimap cursor control before posting a synthetic `mouse_moved` event,
  matching the current opt-in cursor-tracking behavior.
- `docs/design/work-cards/surface-stack-integration-checkpoint-hygiene-v0.md`
  and `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`:
  checkpoint and retrospective routing cards.
- This report.

### Inclusion Decisions After Checkpoint Review

Foreman reviewed the hold/review paths after the checkpoint commits were
prepared:

- `.vscode/settings.json` and `.vscode/tasks.json`: removed from the
  checkpoint branch as local editor convenience state.
- `.docks/foreman/skills/retirement-handoff/SKILL.md` and
  the implementer work-retrospective skill: kept in the PR as a
  separate agent-tooling commit because they support the Foreman/Implementer routing
  and retrospective workflow used by this checkpoint.
- Pre-existing modified work cards for spatial-subject-tree and surface-zoom
  annotation work were reviewed through their own workstream commits before
  inclusion.

## Verification

Readiness and hygiene:

- `./aos ready` passed before and after verification:
  `ready=true mode=repo daemon=reachable tap=active`.
- `./aos dev build` passed; repo binary was already up to date.
- `git diff --check` initially failed only on
  `.docks/foreman/AGENTS.md:78` blank-line-at-EOF. After the hygiene fix,
  `git diff --check` passed.
- Final sequential `./aos status --json` reported `status=ok`,
  daemon ownership consistent, input tap active, stale resources clean.
- Final `./aos show list --json` reported no active canvases.

Router-required checks:

- `bash tests/help-contract.sh` passed.
- `node --test tests/schemas/*.test.mjs` passed: 46 tests.
- `node --test tests/schemas/dev-workflow-rules.test.mjs` passed: 4 tests.
- `bash tests/dev-workflow-router.sh` passed.
- `bash tests/dev-audit.sh` passed.

Focused surface-stack checks:

- `node --test tests/toolkit/*.test.mjs` passed: 737 tests.
- `node --test tests/renderer/hit-target.test.mjs tests/renderer/input-message.test.mjs tests/renderer/radial-menu-target-surface.test.mjs tests/renderer/sigil-input-regions.test.mjs tests/renderer/sigil-panel-window-migration.test.mjs`
  passed: 31 tests.
- `bash tests/canvas-info-readiness.sh` passed.
- `bash tests/daemon-input-surface-ownership.sh` passed.
- `bash tests/canvas-lifecycle-metadata-smoke.sh` initially failed with
  `CONTENT_WAIT_TIMEOUT` for `toolkit_codex_docks_session_roots`; after the
  isolated daemon helper fix, it passed.
- `bash tests/lifecycle-complete.sh` passed.
- `bash tests/surface-inspector-snapshot.sh` initially failed because the test
  posted a cursor event without enabling the opt-in cursor control; after the
  smoke fix, it passed.
- `bash tests/spatial-telemetry-smoke.sh` passed.
- `bash tests/surface-inspector-primitive-marks.sh` passed.
- `bash tests/surface-inspector-move-abs.sh` skipped with its built-in
  `requires at least two displays` guard in the isolated test context.

Implementer previously reported live real-input passes for:

- `AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh`
- `AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`

Those live real-input scenarios were not rerun in this checkpoint hygiene pass.

## Proposed Commit Shape

Use scoped commits. Do not stage the whole tree blindly.

1. **Surface canon and governance docs.** Include root/subtree guidance,
   architecture/API/ADR updates, the decision tree, integration ledger, and
   closure work cards.
2. **Daemon input/lifecycle/display primitives.** Include Swift daemon/display
   changes, `input-surface-ownership.swift`, command registry changes, schemas,
   and daemon-focused shell/schema tests.
3. **Toolkit surface runtime and panel primitives.** Include toolkit runtime,
   resource scope, DesktopWorld hit-region, StageAffordance, panel/windowing,
   passive stage visuals, and toolkit tests.
4. **Surface Inspector resource and mark visibility.** Include inspector
   resource tree, minimap mark sizing, launch/root handling, and inspector tests.
5. **Sigil second-client adoption and real-input primitives.** Include Sigil
   renderer/context-menu/panel migrations, reusable real-input primitives,
   radial scenarios, and renderer/real-input tests.
6. **Checkpoint hygiene and retrospective routing.** Include the isolated daemon
   helper fix, snapshot smoke fix, checkpoint hygiene cards, retrospective
   follow-up queue, and this report.

Keep `.vscode/` out. Dock-local skill files stay as a separate agent-tooling
commit in this branch because they are part of the Foreman/Implementer workflow used to
produce and review the checkpoint.

## Next Work

The next Foreman action is to stage the chosen checkpoint groups and create
intentional commits, then update or open PR state. Future feature work should
wait until that checkpoint exists. After that, split
`docs/design/work-cards/surface-stack-retrospective-followups-v0.md` into exact
Implementer cards, starting with the Surface Inspector mark contract.
