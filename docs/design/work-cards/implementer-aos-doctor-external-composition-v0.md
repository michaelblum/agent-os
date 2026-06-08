# Implementer AOS Doctor External Composition V0

## Transfer

- Recipient: Implementer
- Transfer kind: Implementer round
- Single next goal: move public `./aos doctor` behavior out of Swift into external script composition while preserving current diagnostic JSON shape and keeping native work limited to existing private broker primitives and existing external service status facts.
- Source artifact: #407 TCC broker lane, ADR `docs/adr/0015-aos-tcc-capability-broker-boundary.md`, inventory `docs/design/aos-tcc-capability-broker-inventory-v0.md`, accepted ready cutover commit `f418bb22`, and accepted status cutover commit `17e93fcb`.
- Branch/Base:
  - branch_from: local `implementer/aos-target-addressed-action-ergonomics-v0`
  - required_start_ref: local `implementer/aos-target-addressed-action-ergonomics-v0` at or after `17e93fcb`
- Branch/output expectations: use the existing single checkout at `/Users/Michael/Code/agent-os`; keep changes on `implementer/aos-target-addressed-action-ergonomics-v0`; do not create linked worktrees; do not push or open a PR.
- Stop conditions: stop with `manual_intervention` if live verification hits repo-mode TCC, Accessibility, Input Monitoring, or inactive input-tap blockers; stop and report a blocker if public `doctor` cannot be preserved without adding a new Swift primitive or moving public diagnostic policy back into Swift.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Make `./aos doctor` and `./aos doctor --json` route through external composition, with Swift retaining only private fact/action primitives and top-level doctor diagnostic JSON remaining equivalent for current runtime, permission, setup-marker, service, platform, ready-evaluation, and notes contracts.

## Foreman Decision

Foreman chose `doctor` as the next reversible #407 slice because `ready` and `status` are already externally composed and `doctorCommand` is mostly diagnostic assembly. Keep broad Swift cleanup for `__ready`, `__status`, and `__doctor` out of this card; removal requires a separate native cleanup/rebuild/TCC decision.

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/aos-tcc-capability-broker-inventory-v0.md`
- `docs/dev/command-surface.md`
- `docs/guides/test-harness-ladder-and-prep.md`
- `tests/README.md`
- `src/main.swift`
- `src/commands/operator.swift`
- `scripts/aos-ready.mjs`
- `scripts/aos-status.mjs`
- `scripts/aos-service.mjs`
- `manifests/commands/aos-external-commands.json`
- `manifests/commands/aos-commands.json`
- `tests/doctor-backcompat.sh`
- `tests/daemon-health-contract.sh`
- `tests/input-tap-readiness-legacy.sh`
- `tests/request-client-isolated-autostart.sh`
- `tests/doctor-gateway.sh`
- `tests/external-command-dispatch.sh`
- `tests/schemas/aos-external-command-manifest-v0.test.mjs`

## Rediscover State

```bash
git status --short --branch
git log --oneline -8
./aos ready
./aos doctor --json
./aos service status --mode repo --json
./aos dev recommend --json --paths scripts/aos-doctor.mjs scripts/aos-service.mjs manifests/commands/aos-external-commands.json tests/doctor-backcompat.sh tests/daemon-health-contract.sh tests/input-tap-readiness-legacy.sh tests/request-client-isolated-autostart.sh tests/external-command-dispatch.sh tests/schemas/aos-external-command-manifest-v0.test.mjs
```

If `./aos ready`, `./aos doctor --json`, or a bounded live check reports repo-mode TCC, Accessibility, Input Monitoring, or inactive input-tap blockers, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention` and return the blocker to Foreman. Do not run permission reset/setup, TCC reset, service restart loops, raw launchd recovery, raw socket probes, or tmux/PTY recovery.

## Existing Code To Inspect

- `src/commands/operator.swift` - current `doctorCommand`, `DoctorResponse`, `LaunchAgentState`, `currentRuntimeState`, `currentPermissionRequirements`, `evaluateReadyForTesting`, `runtimeHealthNotes`, `inputTapRecoveryGuidance`, and `inputMonitoringSubGuidance`.
- `scripts/aos-ready.mjs` - external ready-evaluation and permission/setup composition already accepted for public `ready`.
- `scripts/aos-status.mjs` - external identity, runtime, permission, notes, git, and daemon-socket composition pattern already accepted for public `status`.
- `scripts/aos-service.mjs` - external service status surface; extend its JSON only if needed to preserve doctor `aos_service` fields without adding Swift.
- `manifests/commands/aos-external-commands.json` - public top-level `doctor` route cutover target; preserve the separate `doctor gateway` route.
- `tests/fixtures/doctor-before.json` - backcompat path-shape fixture for top-level `doctor --json`.
- `tests/input-tap-readiness-legacy.sh` - legacy daemon semantics for doctor `ready_for_testing` and `ready_source`.

## Required Behavior

- Add external `scripts/aos-doctor.mjs` or a narrower equivalent script path that owns public `doctor` grammar and diagnostic JSON composition.
- Public `./aos doctor` and `./aos doctor --json` must both continue to emit JSON and exit successfully for degraded diagnostic state, matching current Swift behavior.
- Unknown flags and unexpected top-level doctor arguments must preserve the current error contract closely enough for users and tests: `UNKNOWN_FLAG` and usage `./aos doctor [--json]`.
- Preserve the current top-level doctor JSON shape:
  - `status`
  - `platform`
  - `identity`
  - `permissions`
  - `permissions_requirements`
  - `permissions_setup`
  - `runtime`
  - `aos_service`
  - `ready_for_testing`
  - `ready_source`
  - `notes`
- Compose from existing private primitives and accepted external surfaces:
  - `./aos __runtime status-facts --json`
  - `./aos __permissions facts --json`
  - `./aos __permissions setup-marker get --json`
  - `./aos __daemon health --json`
  - `scripts/aos-service.mjs status --mode <mode> --json`
  - `sw_vers -productVersion` or an equivalent stable external macOS version read for `platform.version`
- Preserve `identity` semantics from status composition: program `aos`, current mode, executable path, state dir, socket path, and repo-mode build timestamp/repo root/git commit fields.
- Preserve `permissions_requirements` with the same IDs, `required_for`, `setup_trigger`, and `granted` values as the current Swift response.
- Preserve ready evaluation semantics:
  - reachable daemon with inactive input tap fails closed with `ready_for_testing=false` and `ready_source=daemon`;
  - daemon-reported accessibility plus CLI screen recording plus setup marker determine daemon-sourced readiness when present;
  - legacy daemon missing listen/post/accessibility fields leaves those fields absent/unknown, not fabricated false;
  - CLI fallback remains only when daemon facts are not sufficient.
- Preserve notes behavior for daemon down, socket unreachable, runtime ownership mismatch/unmanaged, other-mode socket conflict, missing permissions, incomplete setup marker, service target/log drift, legacy shared runtime state, repo artifacts, and inactive input-tap recovery guidance.
- Preserve `aos_service` shape. If current `scripts/aos-service.mjs status --json` lacks fields needed by doctor, extend that external script in the same hot-swappable slice to include `loaded`, `label`, `target_matches_expected`, and `log_path_matches_expected`, while keeping existing service status consumers compatible.
- Cut public top-level `doctor` in `manifests/commands/aos-external-commands.json` away from `$AOS_PATH __doctor` to the external script with the same `AOS_PATH`, `AOS_INVOCATION_DISPLAY_NAME`, `AOS_RUNTIME_MODE`, and `AOS_STATE_ROOT` environment plumbing used by `ready` and `status`.
- Preserve `./aos doctor gateway ...` as the existing gateway route. Do not let the top-level doctor script swallow the `gateway` subcommand.
- Update manifest/schema/dispatch tests so top-level `doctor` no longer counts as an allowed direct `$AOS_PATH` bootstrap route. Do not add a new broad `__doctor` wrapper or alias.
- Leave broad Swift `__doctor` in place unless every in-repo caller is confirmed cut over and removal is explicitly safe without a native build/TCC cycle. If removal looks warranted, report it to Foreman as a later native cleanup slice instead of expanding this Implementer round.

## Scope

This is external command composition and tests. It should be hot-swappable after the accepted ready/status cutovers already present on this branch. It should not add new Swift/native behavior.

## Hard Boundaries

- Do not edit Swift for behavior in this slice. If a missing field truly requires a new broker primitive, stop and report the missing primitive to Foreman.
- Do not remove broad `__ready`, `__status`, or `__doctor` routes in this slice.
- Do not add aliases, adapters, compatibility wrappers, transitional broad routes, or old-vocabulary fallbacks.
- Do not move permission recovery policy, diagnostic notes, public grammar, help text, or workflow composition into Swift.
- Do not start daemon/service loops from `doctor`; doctor must remain diagnostic/observational.
- Do not push, open a PR, create a linked worktree, reset unrelated files, or clean unrelated untracked work.
- Do not run raw daemon HTTP, tmux, launchd, socket/state-file inspection, or direct PTY control unless an `./aos` command is broken and you state the bypass reason in the report.

## Suggested Implementation Areas

- `scripts/aos-doctor.mjs` - new external top-level doctor implementation.
- `scripts/aos-service.mjs` - optional additive service-status JSON fields needed to preserve doctor `aos_service` shape.
- Optional `scripts/lib/aos-runtime-compose.mjs` - only if sharing ready/status/doctor helpers materially reduces duplication without widening the slice. Keep extraction mechanical and covered by existing tests.
- `manifests/commands/aos-external-commands.json` - public top-level doctor route cutover.
- `tests/doctor-backcompat.sh` - preserve doctor JSON path shape.
- `tests/daemon-health-contract.sh`, `tests/input-tap-readiness-legacy.sh`, and `tests/request-client-isolated-autostart.sh` - preserve runtime/daemon/legacy semantics.
- `tests/doctor-gateway.sh` and `tests/external-command-dispatch.sh` - preserve gateway subcommand routing and update top-level doctor route assertions.
- `tests/schemas/aos-external-command-manifest-v0.test.mjs` - remove `doctor` from direct Swift bootstrap allowlists and add a top-level doctor external composition assertion.

## Verification

Run deterministic checks:

```bash
node --check scripts/aos-doctor.mjs
node --check scripts/aos-service.mjs
node --test tests/schemas/aos-external-command-manifest-v0.test.mjs
bash tests/external-command-dispatch.sh
bash tests/doctor-backcompat.sh
bash tests/doctor-gateway.sh
bash tests/daemon-health-contract.sh
bash tests/input-tap-readiness-legacy.sh
bash tests/request-client-isolated-autostart.sh
bash tests/runtime-readiness-broker-primitives.sh
bash tests/permissions-broker-primitives.sh
bash tests/help-contract.sh
git diff --check
```

Run workflow recommendation on changed paths:

```bash
./aos dev recommend --json --paths <changed paths>
```

If live AOS is safe and `./aos ready` is not blocked by permissions, run:

```bash
./aos doctor --json
./aos doctor
./aos ready --json
```

Live `./aos doctor --json` may be `degraded` for service drift, stale repo artifacts, legacy state, or other non-TCC notes. That is acceptable if the command returns valid diagnostic JSON and the report explains the note. If readiness is blocked by TCC/input tap, use the manual-intervention stop path above instead of looping.

## Completion Report

Report:

- files changed;
- whether public top-level `doctor` now routes externally and which manifest entries changed;
- whether `doctor gateway` still routes through the gateway external command;
- whether `scripts/aos-service.mjs status --json` was extended and why;
- which broad Swift `__doctor` route/callers remain, if any, and why;
- how platform, identity, permission requirements, setup marker, runtime, service, ready evaluation, legacy daemon, and notes behavior was preserved;
- exact verification commands and pass/fail results;
- live `./aos doctor` and `./aos ready` result, or exact manual-intervention blocker;
- unrelated dirty/untracked state left untouched;
- recommended next slice after Foreman acceptance, especially whether permissions workflow composition or broad Swift route cleanup should come next.
