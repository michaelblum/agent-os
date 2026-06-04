# GDI Work Card: AOS Runtime Service Input Tap Observability V0

## Recipient

GDI implementation round.

## Branch / Base

- `branch_from`: `gdi/aos-visible-surface-cross-process-audit-v0`
- `minimum_code_start_ref`: `739cb7bbdd239c4c9c31fbb8e718f919857286ba`
- `required_start_ref`: the Foreman routing checkpoint containing this work
  card, descendant of `739cb7bbdd239c4c9c31fbb8e718f919857286ba`.
- `expected_output_branch`: `gdi/aos-runtime-service-input-tap-observability-v0`

Do not restart from `origin/main`. This follows the accepted visible-surface
cross-process audit and its timeout correction.

## Source Artifact

Foreman accepted the cross-process visible surface audit correction at:

```text
739cb7bbdd239c4c9c31fbb8e718f919857286ba fix(show): bound external surface audit metadata
```

The accepted audit evidence:

- `./aos show audit --json` returns `status: success`;
- `external_aos_native_windows` remains present;
- repeated live audit calls returned in about 216-222 ms;
- `./aos show audit --json --point 90,100` returned in about 218 ms;
- `./aos clean --dry-run --json` returned clean;
- `./aos show list --json` returned an empty canvas list.

Human-visible evidence still needs a runtime governance slice:

- macOS Accessibility settings showed two `aos` rows, one disabled and one
  enabled;
- mouse input was noticeably laggy, which historically pointed to multiple
  input taps;
- AOS reported one active repo input tap and no stale daemons;
- AOS cannot currently observe duplicate macOS TCC database rows directly;
- during Foreman review, `./aos status --json` could report OK with a reachable
  repo daemon and active input tap while `./aos service status --mode repo
  --json` reported `running: false` / `Service is not running`.

That last mismatch is concrete and machine-checkable: live work should not need
humans to infer whether an active input tap is managed by launchd, an accepted
foreground/dev daemon, or a stale/unmanaged daemon that `clean` missed.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make AOS status/ready/service/clean observability agree about repo daemon
ownership and active input-tap provenance, so agents can detect unmanaged or
duplicate input-tap-capable runtimes without mistaking the state for stale TCC.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/commands/operator.swift`
- `scripts/aos-clean.mjs`
- `scripts/aos-service.mjs`
- `tests/ready-ownership-mismatch.sh`
- `tests/ready-stale-daemon-hygiene.sh`
- `tests/input-tap-readiness.sh`
- `tests/ready-fast-healthy-path.sh`
- `docs/design/work-cards/gdi-input-tap-stale-daemon-ready-hygiene-v0.md`
- `docs/design/work-cards/gdi-aos-ready-fast-healthy-path-v0.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 739cb7bbdd239c4c9c31fbb8e718f919857286ba HEAD; echo "accepted_audit_head_ancestor=$?"
./aos ready --json
./aos status --json
./aos service status --mode repo --json
./aos clean --dry-run --json
./aos show list --json
./aos dev recommend --json --paths src/commands/operator.swift,scripts/aos-clean.mjs,scripts/aos-service.mjs,tests/ready-ownership-mismatch.sh,tests/ready-stale-daemon-hygiene.sh,tests/input-tap-readiness.sh,tests/ready-fast-healthy-path.sh
rg -n "ownership_state|service_pid|serving_pid|lock_owner_pid|input_tap|stale_daemons|launchdProcessID|service status|ready_preflight|daemon_ownership_mismatch" src/commands/operator.swift scripts tests
```

If `./aos ready --json` or `./aos ready --post-permission` reports a repo-mode
TCC, Accessibility, Input Monitoring, or inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`,
continue in the same GDI session and run:

```bash
./aos ready --post-permission
```

Do not start permission setup, readiness repair, or ad-hoc retry loops from
GDI. Do not classify duplicate Accessibility UI rows alone as stale TCC when
`./aos ready` reports ready.

## Required Behavior

### Status And Service Ownership Agree

When repo-mode AOS has a reachable socket, lock owner, and active input tap but
`./aos service status --mode repo --json` reports the launchd service is not
running, AOS must expose that state explicitly. Choose the narrowest correct
contract after reading the code:

- either the daemon is accepted as an intentional foreground/dev daemon, and
  `status`, `ready`, and `service status` must all identify it as such with a
  non-misleading ownership label;
- or the daemon is unmanaged for normal repo-mode live work, and `status` /
  `ready` must report a runtime blocker or degraded state with a next action
  that points to the existing repair/cleanup/service path.

Do not let `./aos ready --json` say "managed daemon is already reachable" when
the launchd service is not loaded and the daemon is not otherwise identified as
an intentional foreground/dev daemon.

### Input-Tap Provenance Is Visible

`./aos status --json` and `./aos ready --json` should expose enough provenance
for the active input tap to answer:

- which PID owns the active tap;
- whether that PID is launchd-managed, accepted foreground/dev, or unmanaged;
- whether installed-mode socket state is reachable;
- whether stale daemon/process cleanup found additional input-tap-capable AOS
  processes;
- whether AOS can or cannot observe duplicate macOS TCC rows.

If duplicate TCC rows are not observable from AOS, report that explicitly as an
unavailable capability instead of implying TCC state is singular.

### Cleanup/Repair Guidance Is Concrete

When an unmanaged active repo daemon/input tap is detected, next actions should
be concrete and AOS-first, such as:

- `./aos ready --repair --json` if repair owns this path;
- `./aos service start --mode repo --json` if a managed service should replace
  the foreground daemon;
- `./aos clean --json` if stale daemon cleanup owns the path.

Do not add a destructive TCC reset path for this condition. TCC reset remains
only for actual permission/input-tap blockers.

### Existing Stale-Daemon Hygiene Remains

Do not regress the accepted stale-daemon rules:

- stale `aos serve` or `aos __serve` processes still make readiness non-ready
  or degraded;
- `./aos clean --json` still removes or reports stale daemon PIDs;
- the healthy launchd-managed path remains fast.

## Hard Boundaries / Non-Goals

- Do not implement toolkit placement, Sigil avatar avoidance, or live drag.
- Do not run service-wide TCC reset.
- Do not query or mutate the macOS TCC database directly unless there is an
  existing repo-owned safe helper for read-only diagnostics.
- Do not kill unrelated user processes.
- Do not disable a valid managed input tap.
- Do not make `./aos ready` destructive by default.
- Do not mutate unrelated untracked work cards or reports.

## Suggested Implementation Areas

- `src/commands/operator.swift` - `currentRuntimeState`,
  `currentOwnershipState`, `readyBlockers`, `readyDiagnosis`,
  `readyNextActions`, status notes, and input-tap runtime payloads.
- `scripts/aos-service.mjs` - service status shape if it should distinguish
  launchd service state from a reachable foreground/dev daemon.
- `scripts/aos-clean.mjs` - only if unmanaged active daemon cleanup should be
  classified alongside stale daemon cleanup.
- `tests/ready-ownership-mismatch.sh` and
  `tests/ready-stale-daemon-hygiene.sh` - closest existing harnesses.

## Verification

Run focused deterministic checks:

```bash
git diff --check
./aos dev recommend --json --paths src/commands/operator.swift,scripts/aos-clean.mjs,scripts/aos-service.mjs,tests/ready-ownership-mismatch.sh,tests/ready-stale-daemon-hygiene.sh,tests/input-tap-readiness.sh,tests/ready-fast-healthy-path.sh
./aos dev build
bash build.sh --no-restart
bash tests/ready-ownership-mismatch.sh
bash tests/ready-stale-daemon-hygiene.sh
bash tests/input-tap-readiness.sh
bash tests/ready-fast-healthy-path.sh
bash tests/external-command-dispatch.sh
bash tests/help-contract.sh
```

Add or update regression coverage proving:

1. launchd-managed healthy repo daemon remains ready and fast;
2. stale daemon processes remain readiness blockers;
3. reachable socket plus active input tap while launchd service is not running
   is either explicitly accepted as foreground/dev or reported as unmanaged /
   degraded;
4. duplicate TCC-row observability is explicit: either AOS reports a real
   read-only signal, or it reports that duplicate rows are not observable.

If live readiness is available, finish with:

```bash
./aos ready --json
./aos status --json
./aos service status --mode repo --json
./aos clean --dry-run --json
./aos show list --json
```

The final report must say whether the repo service is launchd-managed,
foreground/dev, or stopped; whether one active input tap is present; and whether
stale daemons or canvases remain.

## Completion Report

Include:

- branch name and head SHA;
- changed paths;
- root cause of `status/ready` and `service status` disagreement;
- final ownership contract chosen for reachable non-launchd repo daemons;
- exact input-tap provenance fields added or clarified;
- whether duplicate TCC rows are observable or explicitly unavailable;
- deterministic test commands and pass/fail results;
- live `ready/status/service status/clean/show list` result;
- whether mouse lag or duplicate Accessibility `aos` rows are still observed;
- local-only daemon/canvas/process state;
- whether the branch was pushed.
