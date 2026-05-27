# GDI Radial Live IPC Cleanup Correction V0

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round.
- Single next goal: make the live Sigil radial real-input scenario either pass
  or fail with useful diagnostics and no stale AOS surfaces, with special focus
  on the current `INTERNAL` / `IPC failure` and orphaned DesktopWorld stage
  cleanup failure.
- Source artifact: Foreman acceptance pass after folding
  `gdi/aos-do-click-real-input-delivery-latency-v0`.
- Branch/output expectation: start from
  `origin/feat/command-surface-extraction`, create or update
  `gdi/radial-live-ipc-cleanup-correction-v0`, and push it.
- Stop conditions: complete, failed, human_needed, or blocker. Stop with
  `human_needed` instead of looping if repo-mode AOS permissions/TCC block live
  verification.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `gdi/radial-live-ipc-cleanup-correction-v0`
- routed from PR stack checkpoint: `d1bbfa61`
  (`docs(tests): document split status click timing`)

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, daemon, canvas,
runtime readiness, input state, or prior Foreman observations. Rediscover before
editing.

## Current Foreman Evidence

Foreman accepted and folded the click-latency helper, then tried the next live
proof:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

The scenario failed quickly:

```json
{
  "code" : "INTERNAL",
  "error" : "IPC failure"
}
```

After the failed run:

- `./aos ready --json` still reported ready.
- `./aos status --json` was degraded because stale canvases were present.
- `./aos show list --json` showed `surface-inspector` and its child
  `aos-desktop-world-stage`.
- `./aos clean --json` removed `surface-inspector` but failed to remove
  `aos-desktop-world-stage`:

```json
{
  "status": "failed",
  "actions_taken": [
    "removed canvas id=surface-inspector mode=repo"
  ],
  "notes": [
    "failed to remove canvas id=aos-desktop-world-stage mode=repo"
  ]
}
```

Foreman manually repaired the runtime with:

```bash
./aos show remove --id aos-desktop-world-stage
```

Final runtime after manual repair was clean:

- `./aos status --json`: `status=ok`
- `./aos clean --dry-run --json`: `status=clean`

## Goal

Repair the live radial proof path and cleanup behavior so this class of failure
does not leave the repo-mode runtime degraded.

Required outcome:

- the live radial scenario passes, or if a real product/runtime defect remains,
  it fails with enough phase context to identify the failing command and runtime
  state;
- failed live radial runs clean up `surface-inspector`, `aos-desktop-world-stage`,
  `avatar-main`, `sigil-hit-avatar-main`, and `sigil-radial-menu-avatar-main`
  according to their ownership rules;
- `./aos clean --json` can remove an orphaned `aos-desktop-world-stage` even
  when its parent `surface-inspector` is removed in the same cleanup pass;
- `./aos status --json` and `./aos clean --dry-run --json` are clean after the
  scenario or after cleanup.

## Read First

- `AGENTS.md`
- `tests/README.md`
- `docs/recipes/test-harness-ladder-and-prep.md`
- `docs/design/work-cards/gdi-sigil-diagnostic-surface-jank-guard-v0.md`
- `docs/design/work-cards/gdi-real-input-scenario-harness-consolidation-v0.md`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/lib/sigil/radial-menu.sh`
- `tests/lib/visual-harness.sh`
- `tests/lib/status-item.sh`
- `tests/sigil-real-input-status-avatar.sh`
- `scripts/aos-clean.mjs`
- `scripts/aos-show-client.mjs`
- `packages/toolkit/components/surface-inspector/index.html`
- `packages/toolkit/panel/chrome.js`

## Rediscover State

Run from repo root:

```bash
git status --short --branch
./aos ready --json
./aos status --json
./aos show list --json
./aos clean --dry-run --json
./aos dev recommend --json --paths tests/scenarios/sigil/radial-menu/real-input.sh,tests/lib/sigil/radial-menu.sh,tests/lib/visual-harness.sh,scripts/aos-clean.mjs,scripts/aos-show-client.mjs
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

## Investigation Requirements

1. Reproduce the live radial scenario once if `./aos ready` is true:

   ```bash
   AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
   ```

2. If it fails, capture:
   - failing phase or last command;
   - exact `./aos show` command payload if the error comes from show IPC;
   - `./aos status --json`;
   - `./aos show list --json`;
   - `./aos clean --dry-run --json`.

3. Inspect cleanup ordering and stale canvas classification in `scripts/aos-clean.mjs`.
   The parent/child case above must not be able to strand
   `aos-desktop-world-stage`.

4. Inspect scenario cleanup traps in `tests/scenarios/sigil/radial-menu/real-input.sh`
   and `tests/lib/sigil/radial-menu.sh`. A failed scenario should clean its
   owned live proof surfaces or report why cleanup was skipped.

5. If the IPC failure is in `aos show wait/eval/create`, fix the narrow source
   of the opaque `INTERNAL` failure or add bounded phase diagnostics so the next
   failure is actionable.

## Boundaries

- Do not broaden into radial menu redesign.
- Do not add unbounded pointer loops.
- Do not weaken `./aos ready` or input-tap safety checks.
- Do not make `aos clean` delete valid active Sigil-owned warm canvases.
- Do not hide product latency by skipping the radial real-input path.
- Do not use raw daemon HTTP or state-file surgery unless an `./aos` command is
  broken; if you must bypass AOS, report why.

## Verification

Minimum deterministic checks:

```bash
git diff --check
node --check scripts/aos-clean.mjs
node --check scripts/aos-show-client.mjs
bash -n tests/scenarios/sigil/radial-menu/real-input.sh tests/lib/sigil/radial-menu.sh tests/lib/visual-harness.sh
bash tests/aos-clean-canvas-regression.sh
```

Focused live check if `./aos ready --json` is true:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
./aos status --json
./aos clean --dry-run --json
```

If you change real-input helpers, also run the smallest adjacent status/avatar
smoke:

```bash
bash tests/sigil-real-input-status-avatar.sh
```

## Completion Report

Include:

- files changed;
- confirmed root cause of the `IPC failure`, or the exact phase if root cause
  remains external;
- whether `aos clean --json` now removes orphaned `aos-desktop-world-stage`;
- live radial scenario pass/fail and timing/phase evidence;
- final `./aos status --json`, `./aos ready --json`,
  `./aos show list --json`, and `./aos clean --dry-run --json` summaries;
- exact tests run and pass/fail results;
- whether any live proof was skipped and why.
