# Post-Refactor Real-Input Dogfooding Finish V0

## Recipient

Implementer correction round.

## Branch / Base

- branch_from: `implementer/post-refactor-real-input-dogfooding-corrections-v0`
- required_start_ref: current dirty worktree on
  `implementer/post-refactor-real-input-dogfooding-corrections-v0`
- expected output branch: keep
  `implementer/post-refactor-real-input-dogfooding-corrections-v0`

The branch head is still `77cdbdb1f9cc6ee96f25874e3227969835cc4f64`.
Do not reset or discard the current uncommitted edits. Treat them as the draft
output from the prior correction round.

## Source Artifact

- Prior card:
  `docs/design/work-cards/implementer-post-refactor-real-input-dogfooding-corrections-v0.md`
- Adjacent correction card:
  `docs/design/work-cards/implementer-sigil-avatar-hit-target-click-drag-correction-v0.md`
- Foreman reproduction after the completion report:
  - `bash tests/sigil-avatar-interactions.sh` failed.
  - `bash tests/sigil-hit-target-drag-fast-travel.sh` failed.
  - `./aos status --json` reported repo mode `degraded`: input tap
    unavailable, listen/post access false, and active Sigil status-item target
    drift.

## Goal

Finish the deterministic harness correction started by the previous Implementer round.

The single goal is to make these two required checks pass without weakening the
new real-input consent gates:

```bash
bash tests/sigil-avatar-interactions.sh
bash tests/sigil-hit-target-drag-fast-travel.sh
```

## Current Dirty State To Preserve

The prior round already made useful draft changes:

- `tests/scenarios/sigil/radial-menu/real-input.sh` and
  `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh` now skip
  with exit 77 before readiness when `AOS_REAL_INPUT_OK` is absent.
- `tests/sigil-real-input-status-avatar.sh` now sources the real-input harness
  and skips before posting native input without `AOS_REAL_INPUT_OK=1`.
- `tests/lib/status-item.sh` now refuses low-latency native status-item clicks
  without `AOS_REAL_INPUT_OK=1`.
- `tests/sigil-hit-target-drag-fast-travel.sh` now expects
  `state=FAST_TRAVEL`, `fastTravelEffect="line"`, and cleared
  `radialPhase`.
- `tests/sigil-avatar-interactions.sh` has a partial stale-GOTO removal, but it
  is not correct yet.

Unrelated/pre-existing local state may remain:

- `.codex/config.toml`
- `docs/dev/reports/post-refactor-aos-dock-real-input-audit-v0.md`
- prior untracked work-card docs

Do not edit `.codex/config.toml` for this slice.

## Required Corrections

### Avatar Interaction Smoke

`bash tests/sigil-avatar-interactions.sh` currently fails after the partial
edit because the synthetic hit-target dispatch enters `FAST_TRAVEL` from the
avatar drag path while the test still expects:

```python
drag_state["state"] == "RADIAL"
drag_state["radialGestureMenu"]["phase"] == "radial"
```

Repair the test so it asserts the current renderer contract rather than the old
GOTO/radial-only assumption. Ground the expected state in the existing renderer
tests and code, especially:

- `tests/renderer/input-message.test.mjs`
- `tests/renderer/hit-target.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`
- `apps/sigil/renderer/live-modules/main.js`

Do not make product changes unless inspection proves the product contract is
wrong. If a product change is truly required, keep it tiny and explain why a
test-only correction cannot be honest.

### Hit-Target Drag Fast-Travel Smoke

`bash tests/sigil-hit-target-drag-fast-travel.sh` currently fails at the
context-menu effect selection:

```text
FAIL: context menu did not switch fast travel to wormhole:
{'ok': False, 'error': 'missing fast-travel menu button'}
```

The stale selector is:

```js
[data-sigil-fast-travel-effect="wormhole"]
```

The current context menu has drifted toward descriptor/card controls such as:

```text
sigil-menu-fast-travel-effect
[data-ctx-open="sigil-menu-wormhole-card"]
#sigil-menu-wormhole-card
```

Update the harness to use the current context-menu DOM/control contract. Do not
reintroduce stale aliases only to satisfy the old selector unless an external
contract proves that selector still belongs in the product.

## Boundaries

- Tests and harnesses only unless a product bug is proven.
- Do not remove the new `AOS_REAL_INPUT_OK` gates.
- Do not run live pointer scenarios while `./aos status --json` or
  `./aos ready --json` is degraded for repo-mode input tap.
- Do not reset the branch or clean unrelated local files.
- Do not commit or push unless all required deterministic verification is green
  and the checkpoint is cleanly scoped.

## Verification

Run at minimum:

```bash
git diff --check
bash -n tests/lib/*.sh tests/*.sh tests/scenarios/sigil/radial-menu/*.sh
python3 -m py_compile tests/lib/*.py
node --test tests/toolkit/real-input-surface-primitives.test.mjs
node --test tests/renderer/input-message.test.mjs tests/renderer/hit-target.test.mjs tests/renderer/sigil-input-regions.test.mjs
bash tests/sigil-avatar-interactions.sh
bash tests/sigil-hit-target-drag-fast-travel.sh
```

Also preserve or rerun the focused skip proofs from the prior card:

```bash
bash tests/scenarios/sigil/radial-menu/real-input.sh
bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
bash tests/sigil-real-input-status-avatar.sh
```

These should exit 77 without `AOS_REAL_INPUT_OK=1`.

Only run live real-input scenarios after repo-mode readiness is clean and the
human has explicitly permitted real pointer input. If readiness remains blocked,
report the blocker and do not substitute synthetic proof for live input.

## Completion Report

Include:

- branch and head SHA;
- exact files changed in this correction;
- root cause for each of the two remaining failures;
- whether any product code changed and why;
- exact pass/fail results for every verification command above;
- final `./aos status --json` or `./aos ready --json` summary;
- whether live real-input scenarios ran, skipped, or stopped with
  `manual_intervention`;
- any remaining local-only state.
