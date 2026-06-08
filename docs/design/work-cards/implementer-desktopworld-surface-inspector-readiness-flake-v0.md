# Implementer DesktopWorld Surface Inspector Readiness Flake V0

## Transfer Classification

- Recipient: Implementer
- Transfer kind: Implementer correction round.
- Single next goal: diagnose and fix the optional Sigil radial DesktopWorld
  real-input scenario flake where `surface-inspector` can time out during live
  startup, without reopening the broader Sigil MVP acceptance round.
- Source artifact: PR #378 head after `1bc71821`
  (`docs(implementer): refresh Sigil MVP acceptance base`) and Implementer validation branch
  `implementer/pr378-sigil-mvp-runtime-acceptance-v0`.
- Branch/output expectation: start from
  `origin/feat/command-surface-extraction`, create or update
  `implementer/desktopworld-surface-inspector-readiness-flake-v0`, and push it.
- Stop conditions: complete, failed, manual_intervention, or blocker. Stop with
  `manual_intervention` instead of looping if repo-mode AOS permissions/TCC block live
  verification.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `implementer/desktopworld-surface-inspector-readiness-flake-v0`
- routed from PR stack checkpoint: `1bc71821`
  (`docs(implementer): refresh Sigil MVP acceptance base`)

## Fresh Context Contract

Implementer starts from a fresh context window. Rediscover branch, daemon, status item,
canvas, content root, input-tap, harness-lock, and runtime-clean state before
editing. Do not assume the optional DesktopWorld failure reproduces until you
have attempted it under current branch roots.

## Background

The required Sigil MVP runtime acceptance pass completed at current PR head:

- direct live status-item press opened `avatar-main`;
- base radial real-input scenario opened `sigil-wiki-workbench`;
- wiki graph had 32 nodes, 99 links, and node types `concept`, `entity`,
  `reference`, `workflow`;
- warm lifecycle retained wiki identity across close/resume;
- final runtime was clean.

The optional DesktopWorld path scenario failed early:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

Reported failure:

- `CANVAS_WAIT_TIMEOUT` for `surface-inspector`;
- runtime was clean afterward.

This follow-up is about making that scenario reliable or making its readiness
failure bounded, diagnosable, and non-damaging. It is not an MVP acceptance
rerun and not a Sigil redesign.

## Read First

- `AGENTS.md`
- `tests/README.md`
- `docs/recipes/test-harness-ladder-and-prep.md`
- `docs/design/work-cards/implementer-pr378-sigil-mvp-runtime-acceptance-v0.md`
- `docs/design/work-cards/implementer-test-harness-composability-contracts-v0.md`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/lib/harness-contracts.sh`
- `tests/lib/visual-harness.sh`
- `tests/lib/real-input-surface-harness.sh`
- `tests/lib/sigil/radial-menu.sh`
- `scripts/aos-show-client.mjs`
- `scripts/aos-clean.mjs`
- `packages/toolkit/components/surface-inspector/`

## Rediscover State

Run from repo root:

```bash
git status --short --branch
git rev-parse HEAD origin/feat/command-surface-extraction
./aos ready --json
./aos status --json
./aos show list --json
./aos clean --dry-run --json
./aos dev recommend --json --paths tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh,tests/scenarios/sigil/radial-menu/real-input.sh,tests/lib/harness-contracts.sh,tests/lib/visual-harness.sh,tests/lib/real-input-surface-harness.sh,tests/lib/sigil/radial-menu.sh,scripts/aos-show-client.mjs,scripts/aos-clean.mjs,packages/toolkit/components/surface-inspector
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop on
permission repair. Run:

```bash
the manual TCC blocker report path
```

Stop with `manual_intervention`. After the human returns with `finished`, run exactly:

```bash
./aos ready --post-permission
```

## Required Work

### 1. Reproduce Or Bound The Failure

Use the existing harness contract surface. Do not run this concurrently with
other live real-input tests:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

If it passes once, run it one more time after confirming runtime is clean. Do
not run an unbounded loop. Report both runs.

If it fails, capture the existing phase diagnostics and add only the smallest
missing diagnostic needed to distinguish:

- `surface-inspector` create/show failure;
- `aos show wait` IPC/readiness timeout;
- content-root drift;
- harness-lock conflict;
- cleanup removing `surface-inspector` while the DesktopWorld path needs it;
- real input / display topology timing.

### 2. Fix The Narrow Cause

Prefer reusable AOS/toolkit/test-harness fixes over Sigil-private behavior.
Likely valid fix areas:

- readiness and wait behavior in `tests/lib/visual-harness.sh` or
  `tests/lib/real-input-surface-harness.sh`;
- phase diagnostics or retry boundaries in the DesktopWorld scenario;
- `surface-inspector` startup readiness semantics;
- cleanup ordering for `surface-inspector` and `aos-desktop-world-stage`;
- `aos show wait` timeout handling only if the current command still permits a
  bounded scenario to fail without actionable evidence.

Keep the base radial scenario behavior intact.

### 3. Verification

Run focused checks for touched files and required live proof:

```bash
git diff --check
bash -n tests/lib/*.sh tests/lib/sigil/*.sh tests/scenarios/sigil/radial-menu/*.sh
node --check scripts/aos-show-client.mjs
bash tests/harness-composability-contracts.sh
bash tests/aos-clean-canvas-regression.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

If you touch toolkit JS or surface-inspector implementation, add the relevant
focused `node --test tests/toolkit/...` checks selected by `./aos dev recommend`.

If you touch `aos show wait`, add or update a bounded timeout regression and
run the existing show-wait tests.

Final runtime hygiene:

```bash
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
git status --short --branch
```

## Boundaries

- Do not rerun the whole PR acceptance matrix unless your change requires it.
- Do not disable the DesktopWorld scenario or mark it skipped to pass.
- Do not remove warm/suspend/resume behavior.
- Do not add sleeps as the primary fix unless they are part of a bounded
  readiness contract with diagnostics.
- Do not add Sigil-private test tricks when a reusable AOS/toolkit harness
  primitive is the right level.
- Do not use raw daemon HTTP, state-file surgery, or process kills unless an
  `./aos` command is broken; if bypassing AOS is necessary, report why.
- Do not run `./aos dev build` unless the router or changed files require it.

## Completion Report

Include:

- whether the DesktopWorld failure reproduced;
- root cause or best remaining classification;
- files changed;
- exact deterministic checks and live checks run;
- DesktopWorld scenario result, artifact path if produced, and opened surface
  id if successful;
- whether the base radial scenario still needs or received a smoke check;
- final `status`, `ready`, `show list`, and `clean --dry-run` summaries;
- any residual input-jank, duplicate-status-item, stale-canvas, or
  `surface-inspector` readiness risk.
