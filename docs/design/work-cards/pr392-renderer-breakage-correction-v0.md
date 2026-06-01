# PR392 Renderer Breakage Correction

## Tracker

- Source inventory: `BROKE.md`
- Branch/base: `main`, tracking `origin/main`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Make the deterministic renderer breakage inventory from PR #392 pass or clearly reduce it to a smaller documented follow-up. Start with the crash-level renderer import failure, then address the remaining renderer assertions if they share the same cause.

## Read First

- `AGENTS.md`
- `BROKE.md`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `tests/renderer/interaction-overlay-lineage-layer.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-ux-tree-readiness.test.mjs`

## Rediscover State

```bash
git status --short --branch
node --test tests/renderer/interaction-overlay-lineage-layer.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/sigil-selection-mode-runtime.test.mjs
node --test tests/renderer/sigil-ux-tree-readiness.test.mjs
```

## Existing Failure Evidence

- `node --test tests/renderer/*.test.mjs` currently reports 449/455 pass, 6 fail.
- Crash-level failure: `ReferenceError: THREE is not defined` at `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`, where `highlightColor` is created at module scope.
- Radial gesture failures: three tests around hovering outside the handoff radius now observe `enteredFastTravel: true` where the expected contract keeps radial item/menu state active until release semantics decide commit.
- Selection Mode failure: `Selection Mode lineage bar pins to the active display visible bounds` violates the expected right-edge bound.
- UX tree failure: positive readiness audit reports `audit.ok === false`.

## Required Behavior

- Renderer modules imported by deterministic tests must not require browser-only or injected globals at module evaluation time.
- Existing radial gesture contracts should remain intentional: hovering outside the handoff radius does not prematurely switch the menu out of radial state when the test scenario expects item state retention.
- Selection Mode lineage geometry should clamp to active display visible bounds as tested.
- The Sigil UX tree positive readiness audit should pass only when command handlers, routed bindings, mechanics, and relations are actually covered.

## Scope

- Stay in Sigil renderer/test-owned code.
- Do not add broad compatibility shims or resurrect deprecated visual-object update paths.
- Do not change toolkit descriptor contracts unless a failing renderer assertion proves the shared contract is wrong.
- Leave the daemon timing failure alone unless it reproduces serially and is directly caused by the renderer correction.

## Verification

Run focused checks first:

```bash
node --test tests/renderer/interaction-overlay-lineage-layer.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/sigil-selection-mode-runtime.test.mjs
node --test tests/renderer/sigil-ux-tree-readiness.test.mjs
```

Then run the broad renderer suite:

```bash
node --test tests/renderer/*.test.mjs
```

If the broad suite remains red, report exact remaining failing tests and whether they are new, unchanged, or reduced from the `BROKE.md` inventory.

## Completion Report

Return:

- Files changed.
- Failure patterns fixed.
- Verification commands and pass/fail counts.
- Any remaining failures with exact test names and first assertion/error.

## Foreman Acceptance

Accepted on 2026-06-01 after reviewing `c61ea4c02472283193bb44eb4d3854aa47dba343`.

- Static review found the changes scoped to the four expected Sigil renderer modules.
- Focused renderer checks passed locally: 1/1, 18/18, 37/37, and 7/7.
- Full renderer sweep passed locally: `node --test tests/renderer/*.test.mjs` - 455/455.
- The daemon continuation timing failure from the initial inventory did not reproduce serially: `node --test tests/daemon/gate-continuations.test.mjs` - 14/14.
