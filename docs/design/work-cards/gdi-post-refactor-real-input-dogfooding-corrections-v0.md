# Post-Refactor Real-Input Dogfooding Corrections V0

## Recipient

GDI implementation/correction round.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main`
- expected output branch: `gdi/post-refactor-real-input-dogfooding-corrections-v0`

## Tracker

- Source audit: `docs/dev/reports/post-refactor-aos-dock-real-input-audit-v0.md`
- Adjacent card read first by Foreman:
  `docs/design/work-cards/gdi-sigil-avatar-hit-target-click-drag-correction-v0.md`
- Current concern: after the visual-object architecture refactor and command
  surface extraction, live real-input tests and dock/AOS dogfooding have
  degraded.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make the post-refactor real-input verification path honest again.

The immediate outcome is not to redesign AOS input. The goal is to repair the
active test/harness drift so deterministic smokes match the current
avatar/radial contract, live real-input scenarios skip or block cleanly, and
native event helpers cannot accidentally bypass AOS readiness/dogfooding
guardrails.

## Read First

- `AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `tests/README.md`
- `docs/guides/test-harness-ladder-and-prep.md`
- `docs/dev/reports/post-refactor-aos-dock-real-input-audit-v0.md`
- `docs/dev/command-surface.md`
- `docs/design/work-cards/gdi-sigil-avatar-hit-target-click-drag-correction-v0.md`
- `tests/sigil-avatar-interactions.sh`
- `tests/sigil-hit-target-drag-fast-travel.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/sigil-real-input-status-avatar.sh`
- `tests/lib/real-input-surface-harness.sh`
- `tests/lib/real_input_surface_primitives.py`
- `tests/lib/status-item.sh`
- `tests/lib/sigil/radial-menu.sh`
- `tests/renderer/sigil-input-regions.test.mjs`

## Rediscover State

```bash
git status --short --branch
./aos status --json
./aos ready --json
./aos dev recommend --json
rg -n "AOS_REAL_INPUT_OK|ready-after-live-roots|ready_quiet|click-native-json|click_aos_status_item_real_low_latency_json|state.*GOTO|radialGestureMenu.*fastTravel|FAST_TRAVEL|dispatchDesktop" tests docs/dev/reports/post-refactor-aos-dock-real-input-audit-v0.md
```

If `./aos ready` reports the repo-mode TCC/input-tap blocker, keep working on
deterministic test/harness fixes. Do not loop on permission repair. When the
round reaches live real-input verification, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue live checks if that reports ready.

## Existing Code To Inspect

- `tests/sigil-avatar-interactions.sh` - deterministic isolated Sigil smoke
  that currently expects a short left-click to enter `GOTO`.
- `tests/sigil-hit-target-drag-fast-travel.sh` - deterministic isolated
  click/drag smoke that currently expects `radialGestureMenu.phase` to remain
  `fastTravel`.
- `tests/renderer/sigil-input-regions.test.mjs` - current renderer/model
  contract that passed during Foreman's audit.
- `tests/scenarios/sigil/radial-menu/real-input.sh` - live repo-daemon radial
  real-input scenario whose readiness phase currently runs before the
  `AOS_REAL_INPUT_OK` opt-in skip.
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh` - same
  issue for the DesktopWorld path scenario.
- `tests/lib/real-input-surface-harness.sh` - owns the real-input opt-in helper.
- `tests/sigil-real-input-status-avatar.sh`,
  `tests/lib/status-item.sh`, and `tests/lib/real_input_surface_primitives.py`
  - own the low-latency native status-item click path.

## Required Behavior

### Deterministic Sigil Smokes

- `tests/sigil-avatar-interactions.sh` must align with the current
  avatar/radial behavior.
- If current product behavior is "short avatar click opens radial", assert that
  behavior directly instead of expecting `GOTO`.
- If inspection proves `GOTO` is still the intended product behavior, fix the
  product path and keep the test expectation. Do not guess; ground the decision
  in current renderer tests and code.
- `tests/sigil-hit-target-drag-fast-travel.sh` must assert the current
  fast-travel state shape. If `state=FAST_TRAVEL` plus
  `fastTravelEffect="line"` is the current contract and
  `radialGestureMenu.phase` is intentionally cleared, update the assertion.

### Live Real-Input Scenario Gating

- The radial real-input scenarios must return a clean skip before readiness
  work when `AOS_REAL_INPUT_OK` is absent.
- The skip should keep the existing skip wording and exit code `77`.
- When `AOS_REAL_INPUT_OK=1`, the scenarios should still run `./aos ready` and
  preserve the TCC/input-tap blocker behavior.

### Native Low-Latency Click Safety

- Do not let `tests/sigil-real-input-status-avatar.sh` post native CGEvents
  without explicit real-input consent.
- Preserve the timing split intent from the low-latency helper if it remains,
  but gate it behind a clear opt-in and readiness posture.
- Do not weaken `./aos do click` safety gates.

### AOS Dogfooding

- Prefer `./aos` command surfaces for readiness, status, canvas, and action
  checks.
- Keep direct Quartz/CGEvent use only at the final real-input injection
  boundary and only when the test name, opt-in, and comments make that boundary
  explicit.
- Do not add raw daemon HTTP, launchd, tmux, or state-file probes to repair
  these tests unless the AOS surface is missing or broken and the reason is
  documented.

## Scope

Tests and harnesses only unless inspection proves a real product bug. If a
product bug is found, keep the product patch tiny and explain why it is
inseparable from making the tests honest.

## Hard Boundaries / Non-Goals

- Do not reopen the command-surface extraction architecture.
- Do not add public command compatibility to keep old tests passing.
- Do not rebuild `./aos` unless Swift/native files actually change and
  `./aos dev recommend --json` calls for it.
- Do not run live pointer scenarios in a degraded repo-mode TCC state.
- Do not remove the harness contract locks.
- Do not make GDI self-accept any broader product decision; report ambiguous
  behavior back to Foreman.

## Suggested Implementation Areas

Inspect before editing:

- `tests/sigil-avatar-interactions.sh`
- `tests/sigil-hit-target-drag-fast-travel.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/lib/real-input-surface-harness.sh`
- `tests/sigil-real-input-status-avatar.sh`
- `tests/lib/status-item.sh`
- `tests/lib/real_input_surface_primitives.py`

## Verification

Always run:

```bash
git diff --check
bash -n tests/lib/*.sh tests/*.sh tests/scenarios/sigil/radial-menu/*.sh
python3 -m py_compile tests/lib/*.py
node --test tests/toolkit/real-input-surface-primitives.test.mjs
node --test tests/renderer/input-message.test.mjs tests/renderer/hit-target.test.mjs tests/renderer/sigil-input-regions.test.mjs
bash tests/sigil-avatar-interactions.sh
bash tests/sigil-hit-target-drag-fast-travel.sh
```

Add focused verification that both radial real-input scenario entrypoints skip
before `./aos ready` when `AOS_REAL_INPUT_OK` is absent. Use the smallest
deterministic shape; do not run real pointer movement for this skip check.

If the native low-latency status-item click gate changes, add or update the
smallest deterministic test or dry-run proof showing that it refuses to post
without explicit consent.

Only when `./aos ready --json` is clean and the human has explicitly permitted
real input, run:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

If live readiness remains blocked, stop with the GDI TCC helper output instead
of substituting synthetic `show eval` proof.

## Completion Report

Include:

- branch and head SHA;
- files changed;
- root cause classification for each failing smoke;
- exact behavior changed;
- tests run with exact pass/fail results;
- whether live real-input scenarios ran, skipped, or stopped with
  `human_needed`;
- final `./aos status --json` or `./aos ready --json` summary;
- any local-only state, including unrelated dirty files or generated artifacts;
- remaining follow-up slice if one is exposed.
