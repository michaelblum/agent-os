# GDI Test Harness Composability Contracts V0

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI correction / harness foundation round.
- Single next goal: make high-risk test harness side effects explicit and add a
  first reusable guard so incompatible repo-daemon, status-item, and real-input
  harnesses fail fast instead of invalidating each other mid-run.
- Source artifact: Foreman side review after GDI observed that
  `tests/sigil-real-input-status-avatar.sh` stopped the repo service while the
  live radial scenario was running in parallel.
- Branch/output expectation: start from
  `origin/feat/command-surface-extraction`, create or update
  `gdi/test-harness-composability-contracts-v0`, and push it.
- Stop conditions: complete, failed, human_needed, or blocker. Stop with
  `human_needed` instead of looping if repo-mode AOS permissions/TCC block live
  verification.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `gdi/test-harness-composability-contracts-v0`
- routed from PR stack checkpoint: `e6cf5940`
  (`docs(gdi): route Sigil MVP runtime acceptance`)

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, daemon, canvas,
test state, status item state, or Foreman observations. Rediscover before
editing.

## Problem

Some harnesses mutate global live AOS resources, but that contract is implicit.
The clearest example:

- `tests/sigil-real-input-status-avatar.sh` intentionally stops the repo-mode
  AOS service/status item so an isolated status-item smoke can own the menu-bar
  item;
- `tests/scenarios/sigil/radial-menu/real-input.sh` requires the live repo
  daemon and status item to remain stable;
- when these run in parallel, the isolated smoke can invalidate the live radial
  daemon mid-run.

That is not a radial product defect. It is hidden harness side-effect debt.

Related smell: `tests/lib/visual-harness.sh` contains both generic visual/canvas
primitives and Sigil-specific compositions/failure strings, while the current
test ladder wants reusable primitives first and app-specific compositions
clearly marked or split.

## Goal

Add a small, enforceable harness composability contract layer for the risky
runtime/input/status surfaces. This is the first slice, not a whole-suite
taxonomy rewrite.

Required outcomes:

- tests that mutate live repo service/status-item state declare that side effect
  or use a helper that does;
- tests that require the live repo daemon/status item/real input acquire an
  incompatible-harness guard before starting;
- known unsafe parallel composition fails fast with a clear harness-contract
  error instead of stopping the daemon mid-run;
- sequential intended runs still pass;
- test catalog docs explain the first compatibility classes;
- Sigil-specific visual composition in `tests/lib/visual-harness.sh` is at
  least clearly marked, and if low-risk, moved to a Sigil-specific helper under
  `tests/lib/sigil/`.

## Read First

- `AGENTS.md`
- `tests/README.md`
- `docs/recipes/test-harness-ladder-and-prep.md`
- `docs/dev/reports/test-harness-ladder-prep-protocol-v0.md`
- `docs/dev/reports/test-suite-contract-audit-v0.md`
- `tests/lib/visual-harness.sh`
- `tests/lib/status-item.sh`
- `tests/lib/real-input-surface-harness.sh`
- `tests/lib/isolated-daemon.sh`
- `tests/sigil-real-input-status-avatar.sh`
- `tests/sigil-context-menu-real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/lib/sigil/radial-menu.sh`
- `tests/studio/*.test.mjs`

## Rediscover State

Run from repo root:

```bash
git status --short --branch
./aos ready --json
./aos status --json
./aos clean --dry-run --json
./aos dev recommend --json --paths tests/README.md,docs/recipes/test-harness-ladder-and-prep.md,tests/lib/visual-harness.sh,tests/lib/status-item.sh,tests/lib/real-input-surface-harness.sh,tests/sigil-real-input-status-avatar.sh,tests/scenarios/sigil/radial-menu/real-input.sh
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop on
permission repair. Run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Stop with `human_needed`. After the human returns with `finished`, run exactly:

```bash
./aos ready --post-permission
```

## Contract Vocabulary

Introduce a lightweight vocabulary. Exact storage is up to implementation, but
do not overbuild a framework. A shell helper plus docs/catalog entries is enough
if it prevents the known unsafe composition.

Useful fields:

- `uses_repo_daemon`
- `requires_repo_service_stable`
- `mutates_repo_service`
- `uses_status_item`
- `mutates_status_item`
- `uses_real_input`
- `uses_isolated_daemon`
- `mutates_live_canvases`
- `parallel_safe=false`
- `exclusive_group=<name>`

Suggested exclusive groups:

- `repo-daemon-live`
- `repo-service-mutator`
- `status-item-owner`
- `real-input-pointer`

## Required Work

### 1. Guard Unsafe Live/Isolated Composition

Add a reusable guard primitive under `tests/lib/` that can be used by shell
harnesses to acquire/release a named test-harness lease. Keep it robust:

- no stale permanent lock after normal exit;
- useful owner metadata: pid, script, cwd, started_at, contract/exclusive group;
- fail-fast message naming the conflicting harness;
- no broad process killing as part of the guard;
- cleanup through `trap`.

Apply the guard first to:

- `tests/sigil-real-input-status-avatar.sh` because it stops/restores repo
  service and owns an isolated status item;
- `tests/scenarios/sigil/radial-menu/real-input.sh` because it requires the
  live repo daemon/status item and real pointer path;
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh` if it
  shares the same live repo/real-input assumptions.

The guard must make the known unsafe composition fail before repo service is
stopped, not after the live test has already started failing.

### 2. Normalize Repo Service Stop/Restore

If a test intentionally stops repo service, centralize that pattern in a helper
instead of inline ad hoc shell:

- record whether repo service was running;
- stop with `./aos service stop --mode repo --json`;
- restore only if it was running;
- report restore failure clearly;
- do not leave hidden service state changes.

Do not remove the isolated status-item smoke; make its side effect explicit.

### 3. Clarify Visual Harness Boundaries

Do one of these, whichever is lower risk:

- add clear section headers/comments in `tests/lib/visual-harness.sh` separating
  generic visual/canvas primitives from Sigil-specific compositions; or
- split Sigil-specific compositions to a Sigil helper under `tests/lib/sigil/`
  and keep a narrow compatibility source path if needed for existing callers.

Do not do a large helper migration if it would obscure the guard work.

### 4. Clarify `tests/studio`

Do not delete Studio helper tests in this slice. Make the catalog wording hard
to misread:

- Studio is defunct as a current product/launch surface;
- `tests/studio/*.test.mjs` are retained only as pure-helper coverage for
  `apps/sigil/_sequestered/studio/...`;
- they are not current Sigil MVP/product activation tests.

If a low-risk rename to `tests/sequestered/studio` is obvious, you may do it
only if adjacent docs and test commands stay simple. Otherwise document the
status and leave the rename as a follow-up.

### 5. Add A Negative Composition Proof

Add a deterministic or bounded shell test that proves incompatible harness
contracts fail fast. Prefer a fake/small helper-level test over actually
running two full live real-input scenarios in parallel.

The test should demonstrate the class:

- one process holds a `repo-daemon-live` or `real-input-pointer` lease;
- another process attempts `repo-service-mutator` or conflicting status-item
  ownership;
- the second process fails with a clear harness-contract diagnostic.

## Boundaries

- Do not rewrite the whole test suite.
- Do not add YAML/JSON manifest ceremony for every test unless the small helper
  approach cannot enforce the known conflict.
- Do not make every test serial by default.
- Do not weaken `./aos ready`, input-tap safety checks, or isolated daemon
  cleanup.
- Do not delete sequestered Studio source/tests in this slice.
- Do not run unbounded live real-input loops.
- Do not use raw daemon HTTP, state-file surgery, or process kills unless an
  `./aos` command is broken; if bypassing AOS is necessary, report why.

## Verification

Minimum:

```bash
git diff --check
bash -n tests/lib/*.sh tests/lib/sigil/*.sh tests/*.sh tests/scenarios/sigil/radial-menu/*.sh
python3 -m py_compile tests/lib/*.py
node --test tests/studio/*.test.mjs
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
```

Run the new guard/contract test.

Run the affected scenarios sequentially:

```bash
bash tests/sigil-real-input-status-avatar.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

If the DesktopWorld path was changed or guarded, run:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

Final hygiene:

```bash
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
git status --short --branch
```

## Completion Report

Include:

- files changed;
- harness contract vocabulary and where it is enforced;
- unsafe composition proof result;
- whether repo service stop/restore is centralized;
- what changed, if anything, in `tests/lib/visual-harness.sh` organization;
- explicit statement about `tests/studio` status;
- exact tests run and pass/fail results;
- final runtime hygiene summaries;
- `new_test_artifact_candidates`: helper(s) or contract docs Foreman should
  consider promoting in later harness ecosystem work.
