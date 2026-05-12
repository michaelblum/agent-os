# Surface Stack Retrospective Follow-Ups V0

## Tracker

- Epic: #223 AOS Surface System
- Source retrospective: GDI work retrospective for radial menu real-input and
  inspector mini-map, generated 2026-05-12
- Precondition: complete
  `docs/design/work-cards/surface-stack-integration-checkpoint-hygiene-v0.md`
  before starting these implementation slices.

## Fresh Context Contract

This is a follow-up queue, not one implementation assignment. GDI starts from a
fresh context window for each future slice. Foreman should split this card into
one exact work card per slice before handoff.

## Goal

Preserve the concrete tooling and primitive improvements exposed by the final
#305 verification work, without letting them expand the completed V0 closure
slice.

## Follow-Up Queue

### 1. Surface Inspector Mark Contract

Problem: fixed-size minimap markers and projected world-size hit areas looked
equivalent in code but had different visual semantics.

Smallest useful slice:

- document `minimapSizeMode`;
- define when producers should use minimap-fixed versus DesktopWorld-projected
  sizing;
- audit mark producers that represent spatial regions;
- add or update focused mark normalizer/renderer tests.

Likely files:

- `packages/toolkit/components/canvas-inspector/marks/normalize.js`
- `packages/toolkit/components/canvas-inspector/marks/render.js`
- `docs/api/toolkit/components.md`
- `tests/toolkit/canvas-inspector-marks-normalize.test.mjs`
- `tests/toolkit/canvas-inspector-marks-render.test.mjs`

### 2. Canonical Canvas Reload Workflow

Problem: verifying patched web assets required `show update`,
remove/recreate loops, and careful preservation of `surface-inspector`.

Smallest useful slice:

- document the current canonical reload path if it already exists; or
- add a narrow `show reload` / "reload canvas from current content root"
  workflow if the CLI lacks one;
- make preservation semantics explicit for developer/admin canvases such as
  `surface-inspector`.

Likely files:

- `src/shared/command-registry-data.swift`
- `src/display/canvas.swift`
- `src/daemon/unified.swift`
- `docs/api/aos.md`
- adjacent `tests/*show*` or command-contract tests.

### 3. Subject-Family Runtime Cleanup Primitive

Problem: avatar/radial/hit surfaces can reappear from saved runtime state after
inspector or root relaunch, creating duplicate-race risk.

Smallest useful slice:

- design a subject-family cleanup primitive before implementing broad cleanup;
- support removing a root subject and its owned child surfaces while preserving
  named developer/admin canvases such as `surface-inspector`;
- keep app product policy out of the daemon by expressing cleanup in generic
  owner/source/family terms.

Likely files:

- `src/daemon/unified.swift`
- `packages/toolkit/runtime/resource-scope.js`
- `tests/lib/real-input-surface-harness.sh`
- `docs/api/aos.md`
- `docs/design/aos-surface-system.md`

### 4. Compact Real-Input Scenario Output

Problem: passing real-input scenarios emit large JSON payloads into terminal
output, making failures and proof points hard to scan.

Smallest useful slice:

- print a compact pass/fail summary with key proof fields;
- write full JSON to an artifact path;
- keep failure diagnostics rich and easy to attach to Foreman review;
- update radial scenarios first, then generalize only if the helper boundary is
  obvious.

Likely files:

- `tests/lib/real-input-surface-harness.sh`
- `tests/lib/sigil/radial-menu.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/README.md`

### 5. Path-Scoped Handoff And Diff Summaries

Problem: broad dirty worktrees make narrow GDI slices hard to review.

Smallest useful slice:

- after checkpoint hygiene, add a lightweight convention for completion reports
  to include path-scoped touched files, verification commands, and known
  unrelated dirty state;
- prefer clean topic worktrees for future GDI slices when possible;
- avoid making this a mandatory bureaucratic form for tiny fixes.

Likely files:

- `docs/recipes/gdi-work-card-authoring.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `.docks/foreman/AGENTS.md` if Foreman-specific routing language needs to be
  sharpened.

## Priority Recommendation

1. Finish integration checkpoint hygiene first.
2. Route Surface Inspector mark contract as the first small GDI tooling slice.
3. Route compact real-input output as the second small GDI tooling slice.
4. Route canvas reload workflow only after deciding whether the CLI already has
   an adequate primitive.
5. Route subject-family cleanup after the checkpoint, because it crosses daemon,
   toolkit, runtime state, and app ownership boundaries.

## Hard Boundaries

- Do not reopen #305 for these follow-ups.
- Do not implement all five items as one GDI goal.
- Do not move app-specific cleanup policy into the daemon.
- Do not mutate the dirty worktree just to create a clean-looking report; first
  classify it under the checkpoint-hygiene card.

## Completion Report

For any future slice split from this queue, report:

- which retrospective item was addressed;
- files changed;
- behavior or docs changed;
- tests run;
- remaining follow-up items still queued.
