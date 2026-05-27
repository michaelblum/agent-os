# GDI Status Item Tracked Lifecycle Regression Correction V0

## Recipient

GDI correction round.

## Branch / Base

- branch_from: `origin/gdi/sigil-diagnostic-surface-jank-guard-v0`
- required_start_ref: `origin/gdi/sigil-diagnostic-surface-jank-guard-v0`
- expected output branch: `gdi/sigil-diagnostic-surface-jank-guard-v0`

Do not fold this branch into `feat/command-surface-extraction` until this
correction passes Foreman review.

## Source

Foreman review of `origin/gdi/sigil-diagnostic-surface-jank-guard-v0` at
`b6d553d2db9c719c67989f63e462e1ae1b190f18`.

The latest correction stabilized `tests/sigil-warm-surface-lifecycle.sh` in
Foreman review, including three sequential passes. However, the same commit
touched generic status-item behavior in `src/display/status-item.swift`, and a
generic tracked lifecycle regression now reproduces sequentially.

## Foreman Evidence

Passing checks during review:

```bash
for i in 1 2 3; do bash tests/sigil-warm-surface-lifecycle.sh; done
bash tests/aos-clean-canvas-regression.sh
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/render-performance-model.test.mjs tests/toolkit/passive-component-semantics.test.mjs
bash tests/sigil-status-item-lifecycle.sh
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
git diff --check d38bb89e..HEAD
```

Failing check, rerun sequentially after the status-item suite:

```bash
bash tests/status-item-tracked-lifecycle-timeout.sh
```

Observed failure:

```text
FAIL: smoke visible=False expected True; state={'ackExit': False, 'ackEnter': True, 'visible': False, 'events': [{'type': 'ready', 'ts': 1779848248261}], 'readyAt': 1779848248261}
```

This is not accepted as a concurrency artifact. The test was rerun by itself and
still failed.

Foreman also observed a design smell in the same file: generic status item code
now evaluates Sigil-specific JavaScript:

```swift
window.__sigilDebug?.snapshot?.().avatarVisible === true
```

Existing code already had a Sigil-specific readiness probe nearby:

```swift
Boolean(window.__sigilDebug && window.liveJs?.avatarPos?.valid && window.__sigilBootError == null)
```

This correction may keep the working Sigil behavior, but it must not make the
generic status-item path depend on Sigil-only renderer globals.

Final runtime state before routing:

- `./aos status --json`: `status=ok`, input tap active, stale resources clean
- `./aos show list --json`: `canvases=[]`

## Goal

Repair the generic tracked status-item lifecycle path while preserving the warm
Sigil diagnostic lifecycle stabilization from `b6d553d2`.

This is a deterministic correction. Do not move on to real-input status-icon or
radial-menu proof in this round.

## Read First

- `docs/design/work-cards/gdi-sigil-diagnostic-surface-jank-guard-v0.md`
- `docs/design/work-cards/gdi-sigil-diagnostic-surface-jank-guard-review-correction-v0.md`
- `src/display/status-item.swift`
- `tests/status-item-tracked-lifecycle-timeout.sh`
- `packages/toolkit/runtime/_smoke/lifecycle-timeout.html`
- `tests/sigil-status-item-lifecycle.sh`
- `tests/sigil-warm-surface-lifecycle.sh`
- `scripts/aos-show-client.mjs`
- `src/display/canvas.swift`

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

1. Reproduce `bash tests/status-item-tracked-lifecycle-timeout.sh` on this
   branch before changing behavior.
2. Identify why the first status-item press can leave the smoke canvas at only
   `ready` with no received `status_item.toggle` event.
3. Fix the generic tracked lifecycle path without weakening the test's contract:
   - first press on a missing tracked canvas must create the canvas and send a
     visible toggle intent;
   - follow-up presses must still toggle through the tracked intent path;
   - lifecycle timeout behavior must still avoid hanging when enter/exit ACKs do
     not arrive;
   - the test must leave no canvases or stale daemons.
4. Remove or contain Sigil-specific status-item probes from the generic path.
   Prefer a product-neutral surface readiness/visibility signal, manifest
   capability, or state-source handshake if one already exists. If a small new
   generic hook is necessary, document it through tests.
5. Preserve the accepted parts of `b6d553d2` unless you find a direct flaw:
   - `aos show wait` should remain tolerant of transient socket gaps without
     leaking listeners;
   - `tests/sigil-warm-surface-lifecycle.sh` must continue to pass
     sequentially.

## Verification

Run these checks sequentially, not in parallel, because the status-item/menu-bar
surface is singleton-ish:

```bash
bash tests/status-item-tracked-lifecycle-timeout.sh
bash tests/sigil-status-item-lifecycle.sh
bash tests/sigil-warm-surface-lifecycle.sh
for i in 1 2 3; do bash tests/sigil-warm-surface-lifecycle.sh; done
```

Then run the remaining acceptance suite:

```bash
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
- exact root cause of the tracked lifecycle regression;
- whether the fix changed product code, test code, or both;
- how Sigil-specific status-item probes were removed, contained, or justified;
- tests run and pass/fail;
- final runtime hygiene summary;
- whether the branch is ready for Foreman to fold into
  `feat/command-surface-extraction`.
