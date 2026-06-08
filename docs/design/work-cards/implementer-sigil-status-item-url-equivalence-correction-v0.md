# Implementer Sigil Status Item URL Equivalence Correction V0

## Transfer Classification

- Recipient: Implementer
- Transfer kind: correction round.
- Single next goal: fix the review blocker in
  `implementer/sigil-status-item-stale-root-recovery-v0` where valid URL-backed Sigil
  canvases are incorrectly reported as stale because canonical `aos://` URLs
  are compared as raw strings against resolved `http://127...` canvas URLs.
- Source artifact: Foreman review of
  `df9019e4f6f9ab1638d818683da6acd876f34cb6`
  (`fix(sigil): recover stale status item roots`).
- Branch/output expectation: continue from
  `origin/implementer/sigil-status-item-stale-root-recovery-v0`, add a focused
  correction commit, and push the same Implementer branch. Foreman will review and fold
  into PR #378 if accepted.
- Stop conditions: complete, failed, manual_intervention, or blocker only if the
  correction requires a product decision outside this card.

## Branch / Base

- branch_from: `origin/implementer/sigil-status-item-stale-root-recovery-v0`
- required_start_ref: `origin/implementer/sigil-status-item-stale-root-recovery-v0`
- expected output branch: `implementer/sigil-status-item-stale-root-recovery-v0`

This is a correction on top of the existing stale-root recovery branch. Do not
start from `origin/feat/command-surface-extraction` for this round.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, status-item, or prior review state. Read and rediscover before editing.

## Review Finding

Blocking finding:

`scripts/aos-clean.mjs` `activeSigilStatusItemDrift()` compares
`avatar.url` against `status_item.toggle_url` as raw strings.

Valid current behavior after status-item launch:

```text
status_item.toggle_url
=> aos://sigil_implementer_sigil_status_item_stale_root_recovery_v0/renderer/index.html?toolkit-root=toolkit_implementer_sigil_status_item_stale_root_recovery_v0

avatar-main.url
=> http://127.0.0.1:<port>/sigil_implementer_sigil_status_item_stale_root_recovery_v0/renderer/index.html?toolkit-root=toolkit_implementer_sigil_status_item_stale_root_recovery_v0
```

The roots match. The scheme differs because the daemon/content server resolves
`aos://` to localhost for WKWebView loading.

Current branch behavior incorrectly reports this healthy state as dirty:

```text
./aos clean --dry-run --json => status=dirty
./aos status --json => status=degraded
```

The regression missed this because `tests/aos-clean-canvas-regression.sh`
creates `avatar-main` with inline HTML, so the canvas has no URL identity to
compare. That fixture is not representative for this defect variable.

## Goal

Make status-item drift detection compare URL identity by content-root/path/query
equivalence, not by raw string equality between canonical `aos://` and resolved
localhost URLs.

After the correction:

- a current-root `avatar-main` loaded through the resolved localhost URL is
  clean when it is equivalent to the configured canonical `aos://`
  `status_item.toggle_url`;
- stale old branch roots still report dirty with the actionable
  `./aos experience activate sigil` guidance;
- the test fixture covers URL-backed canvas identity, not only inline HTML;
- `./aos status --json` does not degrade a valid active Sigil status-item stack.

## Read First

- `docs/design/work-cards/implementer-sigil-status-item-stale-root-recovery-v0.md`
- `docs/recipes/test-harness-ladder-and-prep.md`
- `tests/README.md`
- `scripts/aos-clean.mjs`
- `scripts/aos-experience.mjs`
- `tests/aos-clean-canvas-regression.sh`
- `tests/schemas/aos-experience-v0.test.mjs`
- Swift canvas URL metadata changes from the existing branch:

  ```bash
  git diff origin/feat/command-surface-extraction..HEAD -- src/display/protocol.swift src/display/canvas.swift src/display/desktop-world-surface.swift
  ```

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/implementer/sigil-status-item-stale-root-recovery-v0 origin/feat/command-surface-extraction
./aos dev recommend --json --paths scripts/aos-clean.mjs,scripts/aos-experience.mjs,tests/aos-clean-canvas-regression.sh,tests/schemas/aos-experience-v0.test.mjs
```

If live AOS readiness is needed and `./aos ready` reports a repo-mode
TCC/input-tap blocker, do not loop. Run:

```bash
the manual TCC blocker report path
```

Stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Required Behavior

### 1. Normalize Canonical And Resolved URL Equivalence

Treat these as equivalent when roots/path/query match:

```text
aos://<root>/renderer/index.html?toolkit-root=<toolkit-root>
http://127.0.0.1:<port>/<root>/renderer/index.html?toolkit-root=<toolkit-root>
```

You may implement this by:

- preserving canonical `aos://` source URL separately from the resolved URL; or
- normalizing both forms into a comparable root/path/query identity; or
- another small shared helper that preserves the same invariant.

Do not hide stale roots by ignoring canvas URL entirely. The branch still needs
to detect old branch roots.

### 2. Add Canonical-Path Representative Regression

Update or add a regression proving:

1. active experience is `sigil`;
2. `status_item.toggle_url` is the current canonical `aos://` Sigil URL;
3. `avatar-main` exists with a resolved localhost URL for the same root/path;
4. `./aos clean --dry-run --json` reports clean for the valid avatar stack;
5. stale `sigil_old_branch` / `toolkit_old_branch` still reports dirty.

The regression must use a URL-backed canvas or simulated canvas list with URL
metadata. Inline HTML alone is not enough for this defect.

### 3. Keep The Original Stale-Root Recovery Behavior

Do not lose the useful behavior from `df9019e4`:

- activation rewrites stale status-item target roots;
- activation removes/replaces stale `avatar-main` when the configured target
  changes;
- status/clean surfaces drift with clear next actions;
- canvas info exposes URL metadata where needed.

## Harness Selection

- `harness_selection`: isolated daemon or deterministic script test is enough
  if it exercises URL-backed canvas/source URL identity.
- `fixture_blind_spots`: inline HTML canvases erase URL identity and cannot be
  the sole proof for this correction.
- `new_test_artifact_candidates`: report any new URL equivalence helper,
  canonical-source URL metadata, or fixture helper so Foreman can decide whether
  to promote it beyond this slice.

## Hard Boundaries

- Do not broaden into another Sigil lifecycle rewrite.
- Do not remove branch-scoped roots as a concept.
- Do not silence all active Sigil canvas drift detection.
- Do not make `./aos status` perform long WebView evals.
- Do not rebuild repeatedly; rebuild only if Swift/native changes require it.
- Do not touch the harness governance/docs branch from
  `implementer/test-harness-ladder-prep-protocol-v0`.

## Verification

Run at least:

```bash
node --check scripts/aos-clean.mjs scripts/aos-experience.mjs
node --test tests/schemas/aos-experience-v0.test.mjs
bash tests/aos-clean-canvas-regression.sh
bash tests/sigil-status-item-lifecycle.sh
bash tests/sigil-warm-surface-lifecycle.sh
git diff --check
```

If Swift files are changed, run the repo-standard build once:

```bash
./aos dev build
```

If `./aos ready` passes and live proof is cheap, run:

```bash
./aos experience activate sigil --json
./aos status --json
./aos ready --json
./aos clean --dry-run --json
```

Real status-item click proof is optional. If attempted, use the bounded
PID-scoped helpers from `tests/lib/status-item.sh`, not global menu-bar scans.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- root cause and exact URL equivalence fix;
- `harness_selection`;
- `fixture_blind_spots`;
- `new_test_artifact_candidates`, if any;
- tests run and pass/fail status;
- final `./aos status`, `./aos ready`, and `./aos clean --dry-run` result or
  reason live checks were skipped;
- whether a real status-item click was attempted;
- local-only state, if any.
