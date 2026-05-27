# GDI DesktopWorld Radial Target Surface Correction V0

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI correction round after Foreman review failure.
- Single next goal: finish the DesktopWorld real-input correction by fixing the
  remaining failure where the radial target surface is created but never becomes
  daemon-observable/interactive during the DesktopWorld path scenario.
- Source artifact: `gdi/desktopworld-surface-inspector-readiness-flake-v0` at
  `514d115a` (`test(harness): bound surface inspector startup flake`).
- Branch/output expectation: start from
  `origin/gdi/desktopworld-surface-inspector-readiness-flake-v0`, update that
  same branch or create a clearly named correction branch, and push it.
- Stop conditions: complete, failed, human_needed, or blocker. Stop with
  `human_needed` instead of looping if repo-mode AOS permissions/TCC block live
  verification.

## Branch / Base

- branch_from: `origin/gdi/desktopworld-surface-inspector-readiness-flake-v0`
- required_start_ref: `origin/gdi/desktopworld-surface-inspector-readiness-flake-v0`
- expected output branch:
  `gdi/desktopworld-surface-inspector-readiness-flake-v0` or a direct
  correction child branch.
- routed from reviewed checkpoint: `514d115a`
  (`test(harness): bound surface inspector startup flake`)

## Foreman Review Result

Do not treat `514d115a` as accepted yet.

Foreman reran a single guarded DesktopWorld live pass:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

Observed behavior:

- the initial `surface-inspector` manifest wait timeout reproduced;
- the new bounded inspector retry recovered successfully;
- `surface-inspector` then became visible and interactive;
- the scenario later failed in `phase=verify-radial-real-input`.

Primary failure:

```text
timed out waiting for daemon-observable AOS radial menu target surface; last=None
```

Artifact from Foreman's failed review run:

```text
/var/folders/hm/d5_18wks38q0lrdhtjpkpw8h0000gq/T/aos-real-input-artifacts/sigil-radial-real-input-desktop-world-path-avatar-main-1779916815183-29274.json
```

Important artifact details:

- `initial.avatarVisible=true`
- `initial.hitTargetReady=true`
- `initial.hitTargetInteractive=true`
- `initial.hitTargetFrame=[13,220,80,80]`
- `initial.avatarPos={x:260,y:260,valid:true}`
- `surface-inspector` was active, visible, interactive, and had minimap rows;
- `sigil-radial-menu-avatar-main` existed, but was still offscreen and not
  interactive:
  - `at=[-10000,-10000,352,141]`
  - `interactive=false`
  - parent `avatar-main`
- final scenario cleanup did remove canvases; repo runtime returned to
  `status=ok`, `show list=[]`, and `clean --dry-run=clean`.

Interpretation: the first branch fixed or bounded one startup race, but the
DesktopWorld scenario still fails the actual radial-menu proof. The remaining
problem is no longer just `surface-inspector` readiness.

## Read First

- `AGENTS.md`
- `tests/README.md`
- `docs/recipes/test-harness-ladder-and-prep.md`
- `docs/design/work-cards/gdi-desktopworld-surface-inspector-readiness-flake-v0.md`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/lib/sigil/radial-menu.sh`
- `tests/lib/real-input-surface-harness.sh`
- `tests/lib/visual-harness.sh`
- `tests/lib/harness-contracts.sh`
- `tests/lib/real_input_surface_primitives.py`
- `apps/sigil/AGENTS.md`
- `apps/sigil/renderer/live-modules/main.js`

## Rediscover State

Run from repo root:

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/desktopworld-surface-inspector-readiness-flake-v0
./aos ready --json
./aos status --json
./aos show list --json
./aos clean --dry-run --json
./aos dev recommend --json --paths tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh,tests/scenarios/sigil/radial-menu/real-input.sh,tests/lib/sigil/radial-menu.sh,tests/lib/real-input-surface-harness.sh,tests/lib/visual-harness.sh,tests/lib/harness-contracts.sh,tests/lib/real_input_surface_primitives.py,apps/sigil/renderer/live-modules/main.js
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

## Required Work

### 1. Classify The Remaining Failure

Use the Foreman artifact first, then reproduce once if needed. Distinguish at
least these cases:

- real pointer events are not hitting the avatar/hit target after DesktopWorld
  travel;
- the renderer receives pointer state but does not transition into radial-menu
  open/target-surface visible state;
- the radial target surface is created but remains hidden/offscreen because the
  open phase is not reached or the frame is stale;
- DesktopWorld/native coordinate conversion is wrong for the final reopen point;
- the test sequence drags from a point that looks valid in debug state but is
  outside the daemon hit surface or actual native input route.

Do not classify it as fixed because `surface-inspector` launches reliably. The
acceptance proof is the radial target surface becoming daemon-observable and
the scenario opening `sigil-wiki-workbench`.

### 2. Fix The Narrow Cause

Prefer the least private reusable fix at the right layer:

- if the real-input path sequence is invalid, repair
  `tests/lib/sigil/radial-menu.sh` or the DesktopWorld scenario;
- if a shared coordinate primitive is wrong, repair
  `tests/lib/real_input_surface_primitives.py` with focused coverage;
- if Sigil renderer state/target-surface behavior is wrong under valid input,
  repair Sigil renderer code and run adjacent renderer tests;
- if diagnostics are insufficient, add bounded diagnostics, but do not replace
  the failing proof with logging.

The fix must preserve the base radial scenario and harness contract behavior.

### 3. Required Verification

Run focused checks for touched files:

```bash
git diff --check
bash -n tests/lib/*.sh tests/lib/sigil/*.sh tests/scenarios/sigil/radial-menu/*.sh
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile tests/lib/*.py
bash tests/harness-composability-contracts.sh
bash tests/aos-clean-canvas-regression.sh
```

Run live proof:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

If you touch `tests/lib/sigil/radial-menu.sh`,
`tests/lib/real_input_surface_primitives.py`, or Sigil renderer pointer/radial
code, also run:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

If you touch Sigil renderer JS, add focused deterministic renderer tests selected
by `./aos dev recommend`.

Final runtime hygiene:

```bash
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
git status --short --branch
```

## Boundaries

- Do not mark the DesktopWorld scenario optional/skipped to pass this round.
- Do not loosen `radial_surface_observable_probe()` so an offscreen or
  non-interactive radial target counts as success.
- Do not hide the failure by adding long sleeps without a readiness cause.
- Do not disable warm/suspend/resume behavior.
- Do not remove the harness contracts or real-input pointer guardrails.
- Do not use raw daemon HTTP, state-file surgery, or process kills unless an
  `./aos` command is broken; if bypassing AOS is necessary, report why.
- Do not run `./aos dev build` unless the router or changed files require it.

## Completion Report

Include:

- root cause classification for the remaining radial target-surface failure;
- files changed;
- exact deterministic checks and live checks run;
- whether the DesktopWorld scenario recovered from inspector startup retry;
- DesktopWorld scenario result, artifact path if produced, travel-step count,
  radial target ids, and opened destination surface;
- base radial scenario result if it was required by touched files;
- final `status`, `ready`, `show list`, and `clean --dry-run` summaries;
- any residual input-jank, duplicate-status-item, stale-canvas, or
  DesktopWorld coordinate risk.
