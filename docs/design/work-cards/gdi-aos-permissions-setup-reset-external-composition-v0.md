# GDI AOS Permissions Setup/Reset External Composition V0

## Transfer

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: move public `./aos permissions setup` and `./aos permissions reset-runtime` out of Swift into external composition while preserving the existing public contracts on top of accepted private permission primitives.
- Source artifact: #407 TCC broker lane, ADR `docs/adr/0015-aos-tcc-capability-broker-boundary.md`, accepted read-only permissions cutover `2930e7d2`, and native primitive checkpoint `4de3f5e0`.
- Branch/Base:
  - branch_from: local `gdi/aos-target-addressed-action-ergonomics-v0`
  - required_start_ref: local `gdi/aos-target-addressed-action-ergonomics-v0` at or after `4de3f5e0`
- Branch/output expectations: use the existing single checkout at `/Users/Michael/Code/agent-os`; keep changes on `gdi/aos-target-addressed-action-ergonomics-v0`; create one scoped local commit if the slice completes; do not create linked worktrees, push, or open a PR.
- Stop conditions: stop with `human_needed` if live verification hits repo-mode TCC, Accessibility, Input Monitoring, or inactive input-tap blockers; stop and report a blocker if preserving setup/reset behavior requires new Swift/native work or real TCC/service mutation during verification.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon, issue, prior implementation, or TCC state. Read and rediscover before editing.

## Goal

Make the remaining public permission workflows hot-swappable external command composition: `./aos permissions setup` and `./aos permissions reset-runtime`.

## Foreman Decision

Foreman added and accepted the missing native primitives in `4de3f5e0`:

- `__permissions prompt <accessibility|screen-recording|listen-event|post-event> --json`
- `__permissions reset-target [--mode repo|installed] --json`
- `__permissions tcc-reset [--mode repo|installed] --json`

Those primitives expose the privileged prompt/reset facts and actions. Public setup sequence, marker policy, service choreography, dry-run planning, break-glass acknowledgment policy, text rendering, and command grammar now belong outside Swift.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/aos-tcc-capability-broker-inventory-v0.md`
- `docs/dev/command-surface.md`
- `docs/guides/test-harness-ladder-and-prep.md`
- `tests/README.md`
- `src/commands/operator.swift`
- `scripts/aos-permissions.mjs`
- `scripts/aos-service.mjs`
- `manifests/commands/aos-external-commands.json`
- `manifests/commands/aos-commands.json`
- `tests/permissions-broker-primitives.sh`
- `tests/input-tap-readiness.sh`
- `tests/input-tap-readiness-legacy.sh`
- `tests/permissions-marker-worktree.sh`
- `tests/external-command-dispatch.sh`
- `tests/external-parser-flags.sh`
- `tests/schemas/aos-external-command-manifest-v0.test.mjs`

## Rediscover State

```bash
git status --short --branch
git log --oneline -10
./aos ready --json
./aos permissions check --json
./aos permissions setup --once --json
./aos permissions reset-runtime --mode repo --dry-run --json
./aos __permissions prompt accessibility --json
./aos __permissions reset-target --mode repo --json
./aos dev recommend --json --paths scripts/aos-permissions.mjs manifests/commands/aos-external-commands.json tests/external-command-dispatch.sh tests/external-parser-flags.sh tests/input-tap-readiness.sh tests/input-tap-readiness-legacy.sh tests/permissions-marker-worktree.sh tests/permissions-broker-primitives.sh tests/schemas/aos-external-command-manifest-v0.test.mjs
```

If `./aos ready --json` or a bounded live check reports repo-mode TCC, Accessibility, Input Monitoring, or inactive input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and return the blocker to Foreman. Do not run real permission setup, real permission reset, TCC reset, service restart loops, raw launchd recovery, raw socket probes, or tmux/PTY recovery to force the live checks through.

## Existing Code To Inspect

- `src/commands/operator.swift` - current public `permissionsSetupCommand`, `runPermissionsSetup`, `permissionsResetRuntimeCommand`, `runPermissionsResetRuntime`, retained private primitives, response shapes, notes, and text rendering.
- `scripts/aos-permissions.mjs` - accepted external `permissions check` and `permissions preflight` composition; extend this script rather than adding a competing permissions wrapper unless inspection proves a narrower split is better.
- `scripts/aos-service.mjs` - existing external `service stop`, `service status`, and `service restart` surfaces for reset/setup choreography.
- `manifests/commands/aos-external-commands.json` - add explicit `permissions setup` and `permissions reset-runtime` routes before the broad native `permissions` fallback.
- `tests/input-tap-readiness.sh` - reset-runtime dry-run, emergency ack guard, and emergency dry-run assertions.
- `tests/permissions-broker-primitives.sh` - private prompt/reset primitive contract.
- `tests/schemas/aos-external-command-manifest-v0.test.mjs` - route and private-wrapper contract checks.

## Required Behavior

### Routing

- Add explicit external manifest routes:
  - `permissions setup` -> `/usr/bin/env node scripts/aos-permissions.mjs setup`
  - `permissions reset-runtime` -> `/usr/bin/env node scripts/aos-permissions.mjs reset-runtime`
- Keep public `permissions check` and `permissions preflight` externally composed.
- Keep bare `./aos permissions` and unknown permission subcommands on the retained native `__permissions` fallback for now.
- Keep retained private parity paths available: `./aos __permissions setup ...` and `./aos __permissions reset-runtime ...` until a later native cleanup tranche removes broad `__permissions`.

### Setup

- Preserve public parser behavior for:
  - `./aos permissions setup`
  - `./aos permissions setup --once`
  - `./aos permissions setup --json`
  - `./aos permissions setup --once --json`
  - unknown flags as `UNKNOWN_FLAG` with usage `aos permissions setup [--json] [--once]`.
- Preserve the JSON response shape:
  - `status`
  - `completed`
  - `permissions`
  - `requirements`
  - `setup`
  - `missing_permissions`
  - `marker_path`
  - `restarted_services`
  - `notes`
- Compose from:
  - `__permissions facts --json`
  - `__permissions setup-marker get --json`
  - `__permissions setup-marker write --json`
  - `__permissions prompt <permission> --json`
  - `__daemon health --json`
  - `service restart --mode <mode> --json` or a narrower existing service surface if inspection shows one is better.
- Preserve the existing deterministic branches:
  - `--once` plus completed marker plus no missing permissions skips prompts and returns completed.
  - `--once` plus completed marker plus missing daemon/CLI permissions returns degraded recovery notes.
  - all permissions already granted with no marker writes the marker and restarts managed services.
  - granted CLI permissions with stale/missing daemon-owned permissions returns degraded recovery notes instead of writing a false-success marker.
- For missing permissions, call the private prompt primitive one permission at a time in the current order: accessibility, screen recording, listen event, post event.
- Do not recreate AppKit modal dialogs in Swift. Any public setup instructions or text belong in the Node script.
- Preserve non-JSON text summary closely: `completed=... accessibility=... screen_recording=... listen_access=... post_access=...`, `ready_for_testing=...`, optional `restarted=...`, then notes.

### Reset Runtime

- Preserve public parser behavior for:
  - `--mode repo|installed`
  - default mode from current runtime
  - `--dry-run`
  - `--json`
  - `--allow-service-reset`
  - `--emergency-ack-other-apps`
  - unknown flags and missing values with the current error codes/messages as closely as practical.
- Preserve the emergency guard:
  - `--allow-service-reset` without `--emergency-ack-other-apps` must fail with `EMERGENCY_ACK_REQUIRED`.
  - `--emergency-ack-other-apps` without `--allow-service-reset` must fail with `INVALID_ARG`.
  - Dry-run with both flags must plan service-wide resets without mutating TCC.
- Preserve the JSON response shape:
  - `status`
  - `mode`
  - `dry_run`
  - `target_path`
  - `tcc_identifier`
  - `service_stop`
  - `tcc_reset`
  - `service_resets`
  - `next_actions`
  - `fallback`
  - `notes`
- Compose normal reset from:
  - `__permissions reset-target --mode <mode> --json`
  - `service stop --mode <mode> --json`
  - `__permissions tcc-reset --mode <mode> --json`
- Preserve the safety sequence for real reset-runtime: stop the managed daemon first, verify the stop result reports `running=false`, then run or classify targeted reset.
- Preserve repo-mode bare-binary behavior: target reset is unavailable, real reset-runtime stops the daemon first, then reports degraded/unavailable with manual fallback and no `tccutil reset All ...` attempt.
- Preserve service-wide reset as break-glass only. If implementing it externally, run `/usr/bin/tccutil reset Accessibility`, `/usr/bin/tccutil reset ListenEvent`, and `/usr/bin/tccutil reset PostEvent` only when both emergency flags are present and the command is not `--dry-run`. Do not exercise that real mutation in automated verification.
- Preserve non-JSON text summary closely: status/mode/dry-run, target, tcc identifier, service stop status, tcc reset status, optional service reset statuses, notes, next actions, and fallback.

## Scope

This is external command composition, manifest routing, and tests. It should be hot-swappable. It must not edit Swift, rebuild `./aos`, reset TCC, or change native private primitive shapes.

## Hard Boundaries

- Do not edit Swift or add native behavior in this GDI slice.
- Do not remove broad `__ready`, `__status`, `__doctor`, or `__permissions` routes.
- Do not add aliases, shims, broad compatibility wrappers, transitional routes, or old-vocabulary fallbacks.
- Do not change public `check`/`preflight` behavior while extending `scripts/aos-permissions.mjs`.
- Do not run real permission setup, real target reset, real service-wide TCC reset, or service restart/stop loops during verification unless the card explicitly names the bounded live check. Dry-run checks are expected; real mutating checks are not.
- Do not push, open a PR, create a linked worktree, reset unrelated files, or clean unrelated untracked work.
- Do not use raw daemon HTTP, tmux, launchd, socket/state-file inspection, or direct PTY control unless an `./aos` command is broken and you state the bypass reason in the report.

## Suggested Implementation Areas

- `scripts/aos-permissions.mjs` - add `setup` and `reset-runtime` subcommands plus shared permission/setup/reset helpers.
- `manifests/commands/aos-external-commands.json` - add explicit public setup/reset routes.
- `tests/external-command-dispatch.sh` - assert public setup/reset route externally and broad fallback remains for bare/unknown permission subcommands.
- `tests/external-parser-flags.sh` - cover malformed external setup/reset flags.
- `tests/input-tap-readiness.sh` - preserve reset-runtime dry-run and emergency guard behavior.
- `tests/permissions-broker-primitives.sh` - keep private primitive coverage green.
- `tests/schemas/aos-external-command-manifest-v0.test.mjs` - tighten route assertions and wrapper-source expectations.

## Verification

Run deterministic checks:

```bash
node --check scripts/aos-permissions.mjs
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/input-tap-readiness.sh
bash tests/input-tap-readiness-legacy.sh
bash tests/permissions-marker-worktree.sh
bash tests/permissions-broker-primitives.sh
bash tests/daemon-health-contract.sh
bash tests/help-contract.sh
git diff --check
```

Run workflow recommendation on changed paths:

```bash
./aos dev recommend --json --paths <changed paths>
```

For deterministic public/private parity, use separate isolated state roots and `AOS_TEST_ASSUME_PERMISSIONS_GRANTED=1` where needed. Compare public setup/reset-runtime outputs against retained private `__permissions` outputs on stable fields for:

```bash
./aos permissions setup --once --json
./aos __permissions setup --once --json
./aos permissions reset-runtime --mode repo --dry-run --json
./aos __permissions reset-runtime --mode repo --dry-run --json
./aos permissions reset-runtime --mode repo --allow-service-reset --emergency-ack-other-apps --dry-run --json
```

Also assert the missing emergency acknowledgment guard remains an error:

```bash
./aos permissions reset-runtime --mode repo --allow-service-reset --dry-run --json
```

If live AOS is safe and `./aos ready --json` is not blocked by permissions or input tap state, run bounded non-mutating live smoke:

```bash
./aos permissions setup --once --json
./aos permissions reset-runtime --mode repo --dry-run --json
./aos ready --json
```

Do not run real `permissions setup` without `--once`, real non-dry-run `reset-runtime`, real `tcc-reset`, or real service-wide reset as part of automated verification.

## Completion Report

Report:

- files changed;
- whether public `permissions setup` and `permissions reset-runtime` now route externally and which manifest entries changed;
- confirmation that `check`/`preflight` remain external and bare/unknown permission subcommands still use the native fallback;
- how setup output shape, prompt sequencing, marker write policy, daemon-missing recovery, service restart reporting, reset dry-run planning, daemon-stop guard, targeted reset unavailable handling, emergency ack guard, and service-wide dry-run planning were preserved;
- exact verification commands and pass/fail results;
- live non-mutating smoke result or exact `human_needed` blocker;
- unrelated dirty/untracked state left untouched;
- recommended next slice after Foreman acceptance, especially broad native cleanup for retained `__ready`, `__status`, `__doctor`, and `__permissions`.
