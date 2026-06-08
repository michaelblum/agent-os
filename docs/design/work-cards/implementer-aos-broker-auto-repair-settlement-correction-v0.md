# Implementer Work Card: AOS Broker Auto-Repair Settlement Correction

## Tracker

- Governing issue: #407 `Governance: local relay and AOS GitHub control surface`
- Landed PR under review: #409 `refactor(aos): externalize TCC broker workflows`
- Merge commit: `9e536d2004ba751965f325d1de9c675dd5f56793`
- Outside review verdict: broker boundary is coherent, but the lane should not be treated as settled until ready auto-repair firing paths have deterministic coverage.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon, issue, or prior implementation state. Read and rediscover before editing.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at or after `9e536d2004ba751965f325d1de9c675dd5f56793`
- Expected local branch: create a local branch such as `implementer/aos-broker-auto-repair-settlement-v0` from `origin/main`.
- Do not push. Foreman owns publication, issue/PR updates, branch cleanup, and final acceptance.
- Preserve unrelated untracked work-card/report files. Do not create linked worktrees.

If `origin/main` has moved after `9e536d2004ba751965f325d1de9c675dd5f56793`, inspect the intervening diff. If it touches `scripts/aos-ready.mjs`, `scripts/lib/aos-readiness.mjs`, `scripts/lib/aos-facts.mjs`, `scripts/aos-status.mjs`, or readiness/status tests, stop and report the new base state to Foreman before editing.

## Goal

Close the post-merge #409 settlement gate by making `./aos ready` auto-repair decisions and recovery waits deterministic-testable, while also removing two small misleading command-surface artifacts from the same review.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `tests/README.md`
- `docs/guides/test-harness-ladder-and-prep.md`
- `scripts/aos-ready.mjs`
- `scripts/lib/aos-readiness.mjs`
- `scripts/lib/aos-facts.mjs`
- `scripts/aos-status.mjs`
- `tests/aos-readiness-composition.test.mjs`
- `tests/ready-fast-healthy-path.sh`
- `tests/ready-ownership-mismatch.sh`
- `tests/lib/mock-daemon.py`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse --show-toplevel
git branch --show-current
git fetch origin main
git rev-parse origin/main
```

Use `./aos` before lower-level daemon inspection. If live `./aos ready` or live smoke hits a repo-mode TCC/input-tap blocker, do not reset permissions or run setup loops. Use:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention` and return the blocker to Foreman.

## Required Behavior

### Auto-Repair Gate

`scripts/aos-ready.mjs` currently owns:

- `readyAutoRepairReason`
- `runReadyRuntimeRepair`
- `waitForReadyResponse`
- the `--repair` branch selection for stale daemons, repairable runtime blockers, and human permission handoff

Make the repair decision seam deterministic. At minimum, move the pure decision logic into `scripts/lib/aos-readiness.mjs` and cover it in `tests/aos-readiness-composition.test.mjs`.

Required cases:

- no auto repair when already ready;
- no auto repair for `stale_daemons`;
- no auto repair for `daemon_unmanaged`;
- auto repair reason for `daemon_ownership_mismatch`;
- auto repair reason for `input_tap_not_active`;
- `--post-permission` enables bounded restart/recheck for repairable runtime blockers;
- explicit `--repair` branch selection chooses clean for stale daemons, restart for repairable runtime blockers, and permission human handoff for permission blockers after runtime repair has not made the system ready.

Add a bounded mock-daemon flow that proves the command-layer restart/wait path fires without touching the real service. The test should cover:

- service restart action is recorded when a not-ready runtime blocker is repairable;
- wait/recheck observes a transition to ready and records `wait_for_recovery: ready`;
- timeout branch records `wait_for_recovery: timed_out`;
- the test does not call real `launchctl`, real TCC reset, Settings, or permission setup.

Prefer dependency injection or narrowly scoped `AOS_TEST_*` hooks over sleeps against the real daemon. Keep production behavior unchanged.

### Healthy Path Fact Rebuild

On the no-action healthy path, `./aos ready` should not rebuild the full broker fact set after it already has the current ready response. Collapse the redundant final `buildReadyResponse(...)` on the no-repair path unless repair or handoff actually changed the trace and requires a fresh read.

Keep public JSON shape stable.

### Status Dead Fallback

Remove the unreachable fallback in `scripts/aos-status.mjs`:

```js
facts.runtime ?? parsePrimitive(runAOS(['__runtime', 'status-facts', '--json']), ...)
```

`brokerFacts({ includeRuntime: true })` already owns that primitive call. The status script should not imply a second hidden runtime fact path.

### Status Degraded Residual Evidence

Capture bounded evidence for the known `./aos status --json` degraded residual. Do not make this a broad Sigil/status-item repair.

Required evidence:

- run `./aos status --json` only if `./aos ready --json` is green;
- record the exact status, notes, stale resource summary, and daemon/input-tap health in the completion report;
- attribute whether the degraded note comes from `scripts/aos-clean.mjs` dry-run stale resources, daemon snapshot notes, runtime/input-tap facts, or setup/permission facts.

Only attempt a pre-merge ref comparison if the checkout is tracked-clean and it can be done without deleting or disturbing unrelated untracked artifacts. Do not use linked worktrees. If the comparison is unsafe, report that and provide the current-main attribution instead.

## Hard Boundaries

- No Swift edits.
- No native rebuild.
- No `tccutil` reset, `permissions setup`, Settings automation, or manual permission prompts.
- No broad rewrite of `ready`, `status`, `doctor`, or `permissions`.
- Do not reintroduce `__ready`, `__status`, `__doctor`, broad public-policy `__permissions`, shims, compatibility aliases, or public workflow behavior in Swift.
- Do not repair the known Sigil status-item target drift in this card.
- Do not push, open/close PRs, or mutate GitHub state.

## Suggested Implementation Areas

- `scripts/lib/aos-readiness.mjs` - shared pure repair decision helpers.
- `scripts/aos-ready.mjs` - command entrypoint should orchestrate service calls and polling using shared pure decisions.
- `scripts/aos-status.mjs` - dead fallback cleanup.
- `tests/aos-readiness-composition.test.mjs` - pure decision coverage.
- `tests/ready-auto-repair-flow.sh` or a focused `node --test` file - mock command-layer restart/wait flow.

## Verification

Run deterministic checks:

```bash
node --test tests/aos-readiness-composition.test.mjs
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/ready-fast-healthy-path.sh
bash tests/ready-ownership-mismatch.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/help-contract.sh
git diff --check
```

Also run the new auto-repair flow test added by this card.

If `./aos ready --json` passes without a TCC/input-tap blocker, run:

```bash
./aos ready --json
./aos status --json
```

If live readiness is blocked by TCC/input tap, stop with `manual_intervention` using the manual TCC blocker report path and report the deterministic verification already completed.

## Completion Report

Return a concise report with:

- local branch and base SHA;
- changed paths for this slice only;
- how auto-repair decisions are now covered;
- what command-layer mock flow covers restart/recovery/timeout;
- whether the healthy ready path avoids the redundant fact rebuild;
- confirmation that the status dead fallback is removed;
- exact verification commands and pass/fail results;
- live `./aos ready --json` and `./aos status --json` result, or the manual-intervention blocker;
- status degraded residual attribution, if observed;
- any unrelated dirty/untracked state preserved.
