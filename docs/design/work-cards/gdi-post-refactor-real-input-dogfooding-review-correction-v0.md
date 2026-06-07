# Post-Refactor Real-Input Dogfooding Review Correction V0

## Recipient

GDI correction round.

## Branch / Base

- branch_from: `gdi/post-refactor-real-input-dogfooding-corrections-v0`
- required_start_ref: `784cedc7`
- expected output branch:
  `gdi/post-refactor-real-input-dogfooding-corrections-v0`

Do not reset or discard unrelated local files. The branch currently has the
test-only commit `784cedc7` on top of `origin/main`.

## Source Artifact

- Review report:
  `docs/dev/reports/sigil-renderer-post-refactor-quality-review-and-forensics-v0.md`
- Prior work card:
  `docs/design/work-cards/gdi-post-refactor-real-input-dogfooding-corrections-v0.md`
- Commit under review: `784cedc7`

Foreman disposition: do not accept `784cedc7` as-is. Fix the two branch-review
findings below before this branch is merge-ready.

## Goal

Make the post-refactor real-input dogfooding correction branch honest by fixing
the two test-seam regressions identified in branch review:

- BR-1: the two new `wait_until` wrappers must actually wait without
  re-dispatching side effects.
- BR-2: daemon-echo suppression must remain covered now that the old
  `label_toggle` block is gone.

This is a test/harness correction. Do not expand into the broader forensic
findings FA-1 through FA-7 in this slice.

## Finding BR-1: `wait_until` Wrappers Never Retry

File:

- `tests/sigil-hit-target-drag-fast-travel.sh`

Problem areas:

- `menu_effect` around line 308
- `ext_menu_control` around line 530

The file's `wait_until` helper only retries while the predicate returns `None`
or a dict with `{"__pending": true}`. Both new wrappers currently call
`show_eval_json(...)` and always return a dict. Missing controls return
`{ ok:false, error:"..." }`, which exits the wait loop immediately. The timeout
and labels are therefore decorative.

Do not fix this by simply returning pending around the existing whole predicate:
the current predicate body performs clicks, drags, and key events. Retrying that
body would repeatedly dispatch side effects and can toggle state back and forth.

Required correction:

1. Dispatch the opening click or tab-selection side effect once.
2. Wait only for a read-only readiness probe that returns `None` or
   `{"__pending": true}` until the compact controls are mounted/settled.
3. After readiness, perform the intended click/drag sequence once.
4. Assert the resulting state after the side effects.

Preserve the compact selector migration from `784cedc7`; do not restore stale
selectors such as `[data-sigil-fast-travel-effect="wormhole"]` unless inspection
proves they remain a product contract.

## Finding BR-2: Daemon-Echo Suppression Coverage Was Deleted

Files:

- `tests/sigil-avatar-interactions.sh`
- optionally a focused renderer/toolkit test if that is the cleaner seam
- production reference:
  `apps/sigil/renderer/live-modules/main.js:3958`

`tests/sigil-avatar-interactions.sh` removed the old `label_toggle` block, which
also asserted that daemon echo events are ignored:

```text
stage === "hit-canvas:ignored"
reason === "daemon-echo"
```

That production logic is still live in `main.js`. No replacement coverage exists
after `784cedc7`.

Required correction:

- Restore focused coverage for `daemon-echo` suppression at the most durable
  seam.
- Prefer a small renderer/toolkit unit test if the suppression decision can be
  exercised without fragile context-menu DOM choreography.
- If the only practical seam is the existing smoke, add a minimal probe that
  triggers one recent daemon pointer event plus the matching hit-canvas echo and
  asserts `hit-canvas:ignored` / `daemon-echo`.
- Do not resurrect stale GOTO/radial assertions or the whole removed
  `label_toggle` block just to recover this one assertion.

## Boundaries

- Tests and harnesses only unless inspection proves a product bug.
- Do not weaken or remove the `AOS_REAL_INPUT_OK` gates.
- Do not run live real-input scenarios while repo-mode `./aos ready` is blocked
  by input tap/TCC state.
- Do not address FA-1 through FA-7 here. Those need separate routing after the
  branch is clean.
- Do not edit `.codex/config.toml`.

## Verification

Run:

```bash
git diff --check
bash -n tests/lib/*.sh tests/*.sh tests/scenarios/sigil/radial-menu/*.sh
python3 -m py_compile tests/lib/*.py
node --test tests/toolkit/real-input-surface-primitives.test.mjs
node --test tests/renderer/input-message.test.mjs tests/renderer/hit-target.test.mjs tests/renderer/sigil-input-regions.test.mjs
bash tests/sigil-avatar-interactions.sh
bash tests/sigil-hit-target-drag-fast-travel.sh
```

Also prove the no-consent skip gates still exit 77:

```bash
bash tests/scenarios/sigil/radial-menu/real-input.sh
bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
bash tests/sigil-real-input-status-avatar.sh
```

If repo-mode live readiness remains degraded, report the exact
`./aos status --json` or `./aos ready --json` summary and do not run live
real-input smokes.

## Completion Report

Include:

- branch and head SHA;
- files changed;
- how BR-1 was fixed without retrying side effects;
- where daemon-echo suppression is now covered;
- exact verification results;
- final AOS readiness/status summary;
- any local-only state that remains.
