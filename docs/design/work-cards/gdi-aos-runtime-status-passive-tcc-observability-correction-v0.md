# GDI Work Card: AOS Runtime Status Passive TCC Observability Correction V0

## Recipient

GDI correction round.

## Branch / Base

- `branch_from`: `gdi/aos-runtime-service-input-tap-observability-v0`
- `minimum_code_start_ref`: `887afe9360679f764ac9c755783762bdfd5ff727`
- `required_start_ref`: the Foreman correction-routing checkpoint containing
  this work card, descendant of `887afe9360679f764ac9c755783762bdfd5ff727`.
- `expected_output_branch`: `gdi/aos-runtime-service-input-tap-observability-v0`

Do not restart from `origin/main`. This is a bounded correction for the pushed
runtime service/input-tap observability implementation.

## Source Artifact

Foreman reviewed:

```text
887afe9360679f764ac9c755783762bdfd5ff727 fix(runtime): expose input tap ownership provenance
```

The implementation correctly added structured input-tap provenance:

- owner PID/kind;
- launchd-managed boolean;
- installed-mode socket reachability;
- stale input-tap-capable daemon count;
- duplicate TCC-row observability as unavailable.

It also correctly made unmanaged reachable repo daemons a readiness blocker.

Acceptance blocker: after repairing Sigil branch-scoped content-root drift with
`./aos experience activate sigil --json`, live runtime checks showed:

- `./aos ready --json`: `ready=true`, `status=ok`;
- `./aos service status --mode repo --json`: `status=ok`, service running;
- `./aos clean --dry-run --json`: `status=clean`;
- `./aos show list --json`: empty canvas list;
- `./aos status --json`: `status=degraded` only because `notes[]` contains:

```text
Duplicate macOS TCC Privacy rows are not observable from AOS; AOS reports this capability as unavailable and does not query the TCC database.
```

That is not a runtime degradation. It is a passive observability limitation that
should remain visible in structured data, but it should not make an otherwise
healthy launchd-managed runtime report degraded.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Keep duplicate-TCC-row observability explicit without making healthy
`./aos status --json` degraded solely because that capability is unavailable.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/commands/operator.swift`
- `tests/ready-fast-healthy-path.sh`
- `tests/ready-ownership-mismatch.sh`
- `tests/input-tap-readiness.sh`
- `docs/design/work-cards/gdi-aos-runtime-service-input-tap-observability-v0.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 887afe9360679f764ac9c755783762bdfd5ff727 HEAD; echo "runtime_observability_head_ancestor=$?"
./aos ready --json
./aos status --json
./aos service status --mode repo --json
./aos clean --dry-run --json
./aos show list --json
./aos dev recommend --json --paths src/commands/operator.swift,tests/ready-fast-healthy-path.sh,tests/ready-ownership-mismatch.sh,tests/input-tap-readiness.sh
rg -n "runtimeHealthNotes|duplicate_tcc_rows|StatusResponse|status: notes.isEmpty|input_tap" src/commands/operator.swift tests
```

If live readiness hits a real repo-mode TCC, Accessibility, Input Monitoring,
or inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`,
continue in the same GDI session and run:

```bash
./aos ready --post-permission
```

Do not classify duplicate Accessibility UI rows alone as stale TCC when
`./aos ready` reports ready.

## Required Behavior

### Healthy Status Remains OK

When runtime state is otherwise healthy:

- launchd-managed repo daemon;
- reachable socket;
- active input tap;
- no stale daemons;
- no stale canvases;
- service status OK;
- no Sigil status-item target drift;

then `./aos status --json` must report `status: "ok"`.

Duplicate TCC-row observability being unavailable must not by itself add a
status note that makes status degraded.

### Structured Observability Remains

Keep the structured fields added by the prior slice:

- `runtime.input_tap.duplicate_tcc_rows_observable: false`;
- `runtime.input_tap.duplicate_tcc_rows_observability` with an explicit
  unavailable reason;
- owner PID/kind;
- launchd-managed boolean;
- installed-mode socket reachability;
- stale input-tap-capable daemon count.

If a human-facing note remains, it must be separated from degradation semantics
or only appear under a diagnostic field that does not control status health.
Prefer keeping the signal in `runtime.input_tap` unless the code already has a
non-health diagnostic section.

### Real Runtime Problems Still Degrade

Do not weaken existing health behavior:

- unmanaged daemon still blocks readiness/degrades status;
- ownership mismatch still blocks readiness/degrades status;
- stale daemons still block readiness/degrade status;
- inactive input tap still reports actionable recovery guidance;
- Sigil status-item drift still appears as stale-resource dirtiness until
  reactivated.

## Hard Boundaries / Non-Goals

- Do not remove the duplicate TCC-row unavailable signal from structured
  runtime data.
- Do not query or mutate the macOS TCC database.
- Do not run TCC reset unless `./aos ready` reports a real permission/input
  blocker.
- Do not implement toolkit placement, Sigil avatar avoidance, or live drag.
- Do not mutate unrelated untracked work cards or reports.

## Verification

Run focused deterministic checks:

```bash
git diff --check
./aos dev recommend --json --paths src/commands/operator.swift,tests/ready-fast-healthy-path.sh,tests/ready-ownership-mismatch.sh,tests/input-tap-readiness.sh
./aos dev build
bash build.sh --no-restart
bash tests/ready-fast-healthy-path.sh
bash tests/ready-ownership-mismatch.sh
bash tests/ready-stale-daemon-hygiene.sh
bash tests/input-tap-readiness.sh
bash tests/external-command-dispatch.sh
bash tests/help-contract.sh
```

Add or update regression coverage proving a healthy status response remains OK
while `runtime.input_tap.duplicate_tcc_rows_observable` is false.

Run live checks when readiness is available:

```bash
./aos experience activate sigil --json
./aos ready --json
./aos status --json
./aos service status --mode repo --json
./aos clean --dry-run --json
./aos show list --json
```

The live `status` output should be OK after Sigil activation, unless a real
actionable runtime or stale-resource blocker appears.

## Completion Report

Include:

- branch name and head SHA;
- changed paths;
- exact reason status was degraded before correction;
- where duplicate TCC-row unavailable evidence now lives;
- deterministic test commands and pass/fail results;
- live `ready/status/service/clean/show list` results;
- whether duplicate Accessibility rows or mouse lag remain human-observable;
- local-only daemon/canvas/process state;
- whether the branch was pushed.
