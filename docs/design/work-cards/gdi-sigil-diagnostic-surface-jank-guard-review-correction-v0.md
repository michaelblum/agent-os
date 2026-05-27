# GDI Sigil Diagnostic Surface Jank Guard Review Correction V0

## Recipient

GDI correction round.

## Branch / Base

- branch_from: `origin/gdi/sigil-diagnostic-surface-jank-guard-v0`
- required_start_ref: `origin/gdi/sigil-diagnostic-surface-jank-guard-v0`
- expected output branch: `gdi/sigil-diagnostic-surface-jank-guard-v0`

## Source

Foreman review of `gdi/sigil-diagnostic-surface-jank-guard-v0` at
`5c934284791cd10de18dc5f8859fd31ee897d3b8`.

The implementation diff matches the intended diagnostic lifecycle direction:

- `render-performance` opts out of automatic stage prewarm;
- panel chrome preserves minimize option objects;
- `sigil-render-performance` and `sigil-interaction-trace` are cleanable
  diagnostic residue, not core warm Sigil surfaces;
- `aos clean` removes stale parent roots so diagnostic-parented stage children
  are cleaned with the parent.

However, Foreman could not reproduce one of the required acceptance checks, so
the branch is not accepted yet.

## Foreman Evidence

Passing checks during review:

```bash
bash tests/aos-clean-canvas-regression.sh
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/render-performance-model.test.mjs tests/toolkit/passive-component-semantics.test.mjs
bash tests/sigil-status-item-lifecycle.sh
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
git diff --check 93f370644828d1e8bf67e049060a3ab76c734230..HEAD
```

Failing check during review:

```bash
bash tests/sigil-warm-surface-lifecycle.sh
```

Observed failure modes across sequential reruns:

```json
{ "code": "INTERNAL", "error": "IPC failure" }
```

```json
{ "code": "NO_DAEMON", "error": "Cannot connect to daemon" }
```

With `bash -x`, the run reached:

```bash
./aos show create --id sigil-wiki-workbench --url 'aos://toolkit/components/wiki-subject-browser/index.html?wiki=aos/concepts/employer-brand-workflow-map.md' --at 80,80,900,620 --interactive --focus
./aos show wait --id sigil-wiki-workbench --manifest wiki-subject-browser-v0 --timeout 15s --json
```

and failed with:

```json
{
  "code" : "CANVAS_WAIT_TIMEOUT",
  "error" : "Canvas sigil-wiki-workbench did not become ready before timeout"
}
```

A manual probe also observed `./aos show create ...` returning `IPC failure`
while the canvas still materialized in `./aos show list --json`. A later
`./aos show wait --id sigil-wiki-workbench --manifest wiki-subject-browser-v0
--timeout 30s --json` succeeded after the page settled.

Final cleanup state after review:

- `./aos show list --json`: `canvases=[]`
- `./aos clean --dry-run --json`: `status=clean`

## Goal

Make the diagnostic jank guard branch pass its own required acceptance evidence
deterministically, or produce a precise correction explaining why the failing
test is invalid for this branch and replacing it with an equivalent bounded
check.

Do not continue to live real-input proof. This is still a deterministic
acceptance correction.

## Read First

- `docs/design/work-cards/gdi-sigil-diagnostic-surface-jank-guard-v0.md`
- `tests/sigil-warm-surface-lifecycle.sh`
- `scripts/aos-clean.mjs`
- `packages/toolkit/components/render-performance/index.html`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/components/wiki-subject-browser/index.html`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `packages/toolkit/panel/mount.js`
- `src/display/canvas.swift`
- `scripts/aos-show-client.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/sigil-diagnostic-surface-jank-guard-v0
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop. Run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Required Correction

1. Reproduce or disprove the `tests/sigil-warm-surface-lifecycle.sh` failure on
   this branch.
2. If the branch introduced or exposed an IPC/readiness race, fix it in the
   smallest relevant layer.
3. If the test itself is too timing-sensitive, repair the test without weakening
   the behavioral contract:
   - show create must not be treated as successful if the client reports IPC
     failure unless the test intentionally handles materialized-after-error
     recovery;
   - wiki workbench readiness must wait long enough for a cold content load but
     still fail on a genuinely broken manifest;
   - the test must leave no canvases, stale daemons, or diagnostic stage residue.
4. Do not hide `IPC failure`, `NO_DAEMON`, or `CANVAS_WAIT_TIMEOUT` behind a
   broad retry loop. If a retry is valid, record the specific transient state it
   handles and assert the final runtime state.
5. Keep the diagnostic lifecycle contract from the reviewed diff intact unless
   you find a real flaw in it.

## Verification

Run the full originally required suite again:

```bash
bash tests/aos-clean-canvas-regression.sh
bash tests/sigil-warm-surface-lifecycle.sh
node --test tests/toolkit/panel-chrome.test.mjs
bash tests/sigil-status-item-lifecycle.sh
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
node --test tests/toolkit/render-performance-model.test.mjs tests/toolkit/passive-component-semantics.test.mjs
git diff --check
```

Also include final runtime hygiene:

```bash
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
```

## Completion Report

Include:

- branch and head SHA;
- whether the correction changed product code, test code, or both;
- exact root cause of the Foreman reproduction failure;
- whether `tests/sigil-warm-surface-lifecycle.sh` now passes sequentially;
- tests run and pass/fail;
- final runtime hygiene summary;
- whether the branch is ready for Foreman to fold into
  `feat/command-surface-extraction`.
