# Implementer Show Wait Timeout Hang Correction V0

## Recipient

Implementer correction round.

## Branch / Base

- branch_from: `origin/implementer/sigil-diagnostic-surface-jank-guard-v0`
- required_start_ref: `origin/implementer/sigil-diagnostic-surface-jank-guard-v0`
- expected output branch: `implementer/sigil-diagnostic-surface-jank-guard-v0`

Do not fold this branch into `feat/command-surface-extraction` until this
correction passes Foreman review.

## Source

Foreman review of `origin/implementer/sigil-diagnostic-surface-jank-guard-v0` after:

- `aa1b4cf2 fix(status-item): gate tracked readiness generically`
- `571ccdb1 fix(docks): ignore no-op dev builds for tcc pause`

The status-item regression correction is directionally accepted from source and
initial shell evidence, but the branch still fails the warm surface lifecycle
acceptance loop because `aos show wait` can hang beyond its own timeout.

## Foreman Evidence

Source and governance checks passed:

```bash
node --test tests/status-item-readiness-contract.test.mjs
node --check scripts/aos-dev-build.mjs
bash tests/dock-hook-isolation.sh
bash tests/help-contract.sh
git diff --check
./aos dev build --json
```

The no-op build check reported:

```json
{
  "status": "success",
  "binary_rebuilt": false,
  "stdout": "Up to date: ./aos (dev, 6.8M)\n"
}
```

Foreman then ran the required sequential lifecycle acceptance command:

```bash
bash tests/status-item-tracked-lifecycle-timeout.sh &&
bash tests/sigil-status-item-lifecycle.sh &&
bash tests/sigil-warm-surface-lifecycle.sh &&
for i in 1 2 3; do bash tests/sigil-warm-surface-lifecycle.sh; done
```

Observed partial output showed the tracked lifecycle and Sigil status-item paths
emitting repeated `PASS` lines. The run then stopped producing output. Process
inspection showed it was stuck here:

```text
./aos show wait --id sigil-wiki-workbench --manifest wiki-subject-browser-v0 --timeout 30s --json
```

That process outlived its own `--timeout 30s`. Foreman killed the test process
instead of leaving it running.

Cleanup after the kill:

- `./aos show list --json`: `canvases=[]`
- `./aos status --json`: `status=ok`, input tap active
- `./aos clean --dry-run --json`: `status=clean`
- worktree clean

## Goal

Make `aos show wait` respect its timeout deterministically and make
`tests/sigil-warm-surface-lifecycle.sh` pass the required sequential acceptance
loop.

This is still deterministic verification. Do not move on to real-input
status-icon/radial-menu proof in this round.

## Read First

- `scripts/aos-show-client.mjs`
- `tests/sigil-warm-surface-lifecycle.sh`
- `src/display/canvas.swift`
- `src/daemon/unified.swift`
- `packages/toolkit/components/wiki-subject-browser/index.html`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `docs/design/work-cards/implementer-sigil-diagnostic-surface-jank-guard-review-correction-v0.md`
- `docs/design/work-cards/implementer-status-item-tracked-lifecycle-regression-correction-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/implementer/sigil-diagnostic-surface-jank-guard-v0
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
```

Build guidance:

- Do not rebuild by habit.
- `./aos dev build --json` now reports `binary_rebuilt`.
- A no-op build with `binary_rebuilt=false` must not trigger TCC reset/pause.
- If you change Swift, rebuild once before `./aos`-backed verification and then
  reuse that binary until Swift changes again.

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop. Run:

```bash
the manual TCC blocker report path
```

Stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Required Correction

1. Reproduce or disprove the `aos show wait --timeout 30s` hang from
   `tests/sigil-warm-surface-lifecycle.sh`.
2. Fix the smallest relevant layer so `show wait` cannot block longer than its
   caller-provided timeout, even when daemon IPC, socket reads, WebView eval, or
   canvas readiness is degraded.
3. Preserve the useful behavior from the prior correction:
   - `show wait` may tolerate transient socket gaps;
   - it must not leak listeners;
   - it must still fail with `CANVAS_WAIT_TIMEOUT` when a canvas genuinely never
     becomes ready.
4. Add focused regression coverage for the timeout/hang boundary if an existing
   test does not already catch it. Prefer a deterministic test that does not
   require live real input.
5. Keep the status-item generic readiness fix intact unless you find a direct
   flaw in it.

## Verification

Run the status-item and warm lifecycle checks sequentially:

```bash
bash tests/status-item-tracked-lifecycle-timeout.sh
bash tests/sigil-status-item-lifecycle.sh
bash tests/sigil-warm-surface-lifecycle.sh
for i in 1 2 3; do bash tests/sigil-warm-surface-lifecycle.sh; done
```

Run the supporting suite:

```bash
node --test tests/status-item-readiness-contract.test.mjs
bash tests/aos-clean-canvas-regression.sh
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/render-performance-model.test.mjs tests/toolkit/passive-component-semantics.test.mjs
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
git diff --check
```

Include final runtime hygiene:

```bash
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
```

## Completion Report

Include:

- branch and head SHA;
- exact root cause of the `show wait` timeout hang;
- whether product code, test code, or both changed;
- whether `tests/sigil-warm-surface-lifecycle.sh` passed the repeated
  sequential loop;
- tests run and pass/fail;
- final runtime hygiene summary;
- whether the branch is ready for Foreman to fold into
  `feat/command-surface-extraction`.
