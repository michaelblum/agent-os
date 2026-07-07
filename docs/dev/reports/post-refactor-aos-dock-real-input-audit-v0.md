# Post-Refactor AOS / Dock / Real-Input Audit V0

## Context

Foreman audit on `main` at `77cdbdb1` after the visual-object architecture and
command-surface extraction refactors. The audit started by reading the newest
GDI work card, `docs/design/work-cards/gdi-sigil-avatar-hit-target-click-drag-correction-v0.md`.

## Runtime State

`./aos status --json` is reachable, but repo-mode live input is degraded:

- `status=degraded`
- `mode=repo`
- daemon reachable
- `runtime.input_tap.status=unavailable`
- daemon input tap reports `listen_access=false` and `post_access=false`
- `./aos ready --json` reports `ready=false`, `phase=human_required`,
  `diagnosis=daemon_tcc_grant_stale_or_missing`
- blocked capabilities: `do`, `inspect`, `listen`, `see`

The ready path provides the correct repo-mode recovery sequence:

```bash
./aos permissions reset-runtime --mode repo
./aos permissions setup --once
./aos ready --post-permission
```

One confusing detail remains worth tracking: top-level CLI permission fields in
status/ready show granted booleans while the daemon input-tap view reports
missing listen/post access. The blocker is still correctly classified, but the
dual view can make humans and agents think the permission state is cleaner than
the daemon can actually use.

## Command Surface

The command-surface refactor is holding at the deterministic contract level:

- `./aos help` and `./aos help --json` render the external registry.
- `src/main.swift` contains only external dispatch plus private native
  primitives such as `__serve`, `__status`, `__ready`, `__permissions`,
  `__see`, `__say`, and `__do`.
- `docs/dev/command-surface.md` states that public command behavior belongs in
  manifests and scripts, not the Swift binary.

Passed checks:

```bash
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
bash tests/external-command-dispatch.sh
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/dev-workflow-router.sh
```

No command-surface regression was found in this audit.

## Deterministic Test Stack

Passed checks:

```bash
bash -n tests/lib/*.sh tests/*.sh tests/scenarios/sigil/radial-menu/*.sh
python3 -m py_compile tests/lib/*.py
node --test tests/toolkit/real-input-surface-primitives.test.mjs
node --test tests/renderer/input-message.test.mjs tests/renderer/hit-target.test.mjs tests/renderer/sigil-input-regions.test.mjs
bash tests/harness-composability-contracts.sh
bash tests/input-tap-readiness.sh
```

The renderer/model tests are aligned with the current avatar/radial input
contract, but two focused shell smokes are not:

- `bash tests/sigil-avatar-interactions.sh` fails because it still expects a
  short avatar left-click to enter `GOTO`; the current renderer contract opens
  the radial path and returns `state=RADIAL`.
- `bash tests/sigil-hit-target-drag-fast-travel.sh` reaches `FAST_TRAVEL`, but
  fails because it expects `radialGestureMenu.phase == "fastTravel"`; the
  current snapshot clears that phase while preserving `state=FAST_TRAVEL` and
  `fastTravelEffect="line"`.

These are concrete post-refactor test drift findings. They may be stale shell
assertions rather than product regressions, but they must be reconciled before
these smokes can be trusted again.

## Live Real-Input Stack

`bash tests/scenarios/sigil/radial-menu/real-input.sh` currently fails before it
reaches the real-input opt-in gate:

```text
INFO: phase=ready-after-live-roots command=ready_quiet
FAIL: phase=ready-after-live-roots status=1 command=ready_quiet
```

Because the script calls `./aos ready --json` before
`aos_real_input_surface_require_enabled`, a run without `AOS_REAL_INPUT_OK=1`
can still spend time in readiness repair/failure instead of immediately
returning the intended skip (`77`). The DesktopWorld-path sibling has the same
phase ordering.

`tests/sigil-real-input-status-avatar.sh` is also worth tightening: it uses the
low-latency native CGEvent helper for the final status-item click. That may be
valid for timing splits, but the harness should not post native events unless
it has an explicit real-input opt-in and a clean readiness posture.

## Retired Dock-Era Stack

This historical audit described dock-era discovery and deterministic hook checks
as healthy at the time. The retired command forms are intentionally omitted from
this active-tree report; git history is the archive for the exact invocation
list.

At the time, the audit treated AOS as the preferred control plane for readiness,
runtime status, canvases, Agent Terminal surfaces, communication, and input
routing. It also classified provider PTY/tmux helpers under `.docks/harness/` as
provider-control mechanics rather than as the first runtime control plane.

The practical degradation is workflow-level: because repo-mode live readiness is
blocked and the strongest real-input scenarios either fail early or are not in
default verification loops, Foreman/GDI can complete large deterministic slices
without ever dogfooding `./aos do`/real pointer paths.

## Next Correction Slice

Route one GDI round to repair the test/harness drift:

- update or replace stale Sigil shell smoke assertions with the current
  avatar/radial contract;
- make live real-input scenarios skip before readiness work when
  `AOS_REAL_INPUT_OK` is absent;
- add a safety gate around the low-latency native status-item click helper;
- preserve the command-surface refactor and avoid Swift rebuilds unless GDI
  proves a native primitive bug.
