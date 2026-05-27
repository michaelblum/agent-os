# GDI Real-Input Status Item Owner Correction V0

## Recipient

GDI correction round.

## Branch / Base

- branch_from: `origin/gdi/real-input-scenario-harness-consolidation-v0`
- required_start_ref: `origin/gdi/real-input-scenario-harness-consolidation-v0`
- expected output branch: `gdi/real-input-scenario-harness-consolidation-v0`

Do not fold this branch into `feat/command-surface-extraction` until this
correction passes Foreman review.

## Source

Foreman review of `origin/gdi/real-input-scenario-harness-consolidation-v0`.

GDI's consolidation commit `a54bd2f7` is directionally good:

- shared `tests/lib/sigil_real_input_context.py` removes duplicated context
  menu real-input helpers;
- `tests/lib/status-item.sh` adds status item match/overlap helpers;
- docs steer agents toward named real-input scenarios instead of ad hoc
  `./aos do` sequences.

Foreman found one bug in the new status-item owner selection helper and pushed a
small review correction:

- `9111d1c0 fix(tests): require expected status item owner`

That correction makes `aos_unambiguous_status_item_pid <expected_pid>` fail when
the expected daemon's status item is not visible, rather than falling back to an
unrelated single visible AOS status item.

After that correction, Foreman reran the affected smoke:

```bash
bash tests/sigil-real-input-status-avatar.sh
```

The test produced no stdout for over 90 seconds. Process inspection while it was
running showed:

```text
bash tests/sigil-real-input-status-avatar.sh
/Users/Michael/Code/agent-os/aos serve --idle-timeout none
./aos serve --idle-timeout none
/Users/Michael/Code/agent-os/aos __serve --idle-timeout none
/Users/Michael/Code/agent-os/aos __serve --idle-timeout none
```

During the run, `./aos status --json` reported repo runtime degradation because
it saw the isolated daemon pair as stale daemons. Foreman stopped the test and
ran `./aos clean --json`; final cleanup returned clean.

This branch is therefore not accepted yet. The core issue is not simply that an
isolated test has a temporary daemon; it is that the real-input entrypoint can go
quiet for too long while duplicate status-item ownership is active, and the
owner-selection path was previously capable of choosing the wrong icon.

## Goal

Make the consolidated status-item real-input harness owner-strict, bounded, and
reviewable:

- keep the stricter expected-PID behavior from `9111d1c0`;
- make `tests/sigil-real-input-status-avatar.sh` either pass promptly or fail
  with a precise status-item ownership/progress error;
- preserve the broader real-input helper consolidation from `a54bd2f7`;
- do not change Sigil product behavior unless you prove a real product bug.

## Read First

- `docs/design/work-cards/gdi-real-input-scenario-harness-consolidation-v0.md`
- `tests/lib/status-item.sh`
- `tests/lib/visual-harness.sh`
- `tests/lib/isolated-daemon.sh`
- `tests/sigil-real-input-status-avatar.sh`
- `tests/sigil-context-menu-real-input.sh`
- `tests/lib/sigil_real_input_context.py`
- `tests/README.md`
- `apps/sigil/context-menu/README.md`
- `scripts/aos-content-scope.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/real-input-scenario-harness-consolidation-v0
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

1. Reproduce or disprove the Foreman hang with:

   ```bash
   bash tests/sigil-real-input-status-avatar.sh
   ```

2. Preserve the strict expected owner rule:

   - when an expected daemon PID is supplied, helpers must not fall back to an
     unrelated single visible status item;
   - if the expected status item is not visible yet, wait briefly and then fail
     with the matching status-item inventory.

3. Add bounded progress/failure around the status-avatar smoke:

   - it should not sit silent for more than the expected setup/click window;
   - if it is waiting for the isolated status item, say so in the failure;
   - if it is waiting for avatar visibility, context menu open, or a real click,
     report the last observed state;
   - final output should still be compact on success.

4. Resolve the duplicate status-item hygiene path:

   - either suppress/stop the normal repo status item before this isolated
     status-item test, or keep the isolated daemon path and assert the duplicate
     icon overlap/targeting contract in a way that cannot choose the wrong
     owner;
   - final cleanup must leave `./aos status --json` ok and
     `./aos clean --dry-run --json` clean.

5. Do not broaden product behavior. This should stay in test harness code unless
   rediscovery proves a real stale daemon/input-tap bug.

## Verification

Run deterministic checks:

```bash
git diff --check
bash -n tests/lib/status-item.sh \
  tests/lib/visual-harness.sh \
  tests/sigil-real-input-status-avatar.sh \
  tests/sigil-context-menu-real-input.sh
python3 -m py_compile tests/lib/sigil_real_input_context.py tests/lib/real_input_surface_primitives.py
node --test tests/toolkit/real-input-surface-primitives.test.mjs
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
```

Run live checks only if `./aos ready --json` is clean and real pointer movement
is safe:

```bash
bash tests/sigil-real-input-status-avatar.sh
bash tests/sigil-context-menu-real-input.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
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
- exact root cause of the Foreman status-avatar hang or why it no longer
  reproduces;
- what changed in status-item owner selection or isolated daemon hygiene;
- whether duplicate menu bar status icons are suppressed, bounded, or only
  reported;
- tests run and pass/fail;
- live real-input scenarios run or skipped, with reason;
- final runtime hygiene summary;
- whether the branch is ready for Foreman to fold into
  `feat/command-surface-extraction`.
