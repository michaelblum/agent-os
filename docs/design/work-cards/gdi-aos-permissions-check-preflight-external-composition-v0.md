# GDI AOS Permissions Check/Preflight External Composition V0

## Transfer

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: move public `./aos permissions check` and `./aos permissions preflight` out of Swift into external script composition while preserving the current JSON contract and leaving mutating permission workflows native.
- Source artifact: #407 TCC broker lane, ADR `docs/adr/0015-aos-tcc-capability-broker-boundary.md`, inventory `docs/design/aos-tcc-capability-broker-inventory-v0.md`, and accepted doctor cutover commit `bd0bce3a`.
- Branch/Base:
  - branch_from: local `gdi/aos-target-addressed-action-ergonomics-v0`
  - required_start_ref: local `gdi/aos-target-addressed-action-ergonomics-v0` at or after `bd0bce3a`
- Branch/output expectations: use the existing single checkout at `/Users/Michael/Code/agent-os`; keep changes on `gdi/aos-target-addressed-action-ergonomics-v0`; do not create linked worktrees; do not push or open a PR.
- Stop conditions: stop with `human_needed` if live verification hits repo-mode TCC, Accessibility, Input Monitoring, or inactive input-tap blockers; stop and report a blocker if preserving `check`/`preflight` requires a new Swift primitive, native rebuild, TCC reset, permission prompt, or public policy moving back into Swift.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Make the read-only public permission inspection forms, `./aos permissions check` and `./aos permissions preflight`, hot-swappable external command composition while keeping the same machine-readable output shape and readiness semantics.

## Foreman Decision

Foreman chose a bounded permissions tranche instead of full public `permissions` cutover. `check` and `preflight` are read-only and can be composed from existing primitives: `__permissions facts`, `__permissions setup-marker get`, and `__daemon health`. `setup` still owns native prompt UI and service restart behavior; `reset-runtime` still owns targeted TCC reset and stopped-daemon choreography. Those mutating workflows stay native until a separate primitive tranche exposes `__permissions prompt`, reset-target, and tcc-reset actions with explicit native-boundary justification.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/aos-tcc-capability-broker-inventory-v0.md`
- `docs/dev/command-surface.md`
- `docs/guides/test-harness-ladder-and-prep.md`
- `tests/README.md`
- `src/main.swift`
- `src/commands/operator.swift`
- `src/shared/input-tap-health.swift`
- `scripts/aos-ready.mjs`
- `scripts/aos-status.mjs`
- `scripts/aos-doctor.mjs`
- `manifests/commands/aos-external-commands.json`
- `manifests/commands/aos-commands.json`
- `tests/permissions-broker-primitives.sh`
- `tests/permissions-marker-worktree.sh`
- `tests/input-tap-readiness.sh`
- `tests/input-tap-readiness-legacy.sh`
- `tests/external-command-dispatch.sh`
- `tests/external-parser-flags.sh`
- `tests/schemas/aos-external-command-manifest-v0.test.mjs`

## Rediscover State

```bash
git status --short --branch
git log --oneline -10
./aos ready --json
./aos permissions check --json
./aos permissions preflight --json
./aos __permissions facts --json
./aos __permissions setup-marker get --json
./aos __daemon health --json
./aos dev recommend --json --paths scripts/aos-permissions.mjs manifests/commands/aos-external-commands.json tests/external-command-dispatch.sh tests/external-parser-flags.sh tests/input-tap-readiness.sh tests/input-tap-readiness-legacy.sh tests/permissions-marker-worktree.sh tests/schemas/aos-external-command-manifest-v0.test.mjs
```

If `./aos ready --json` or a bounded live check reports repo-mode TCC, Accessibility, Input Monitoring, or inactive input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and return the blocker to Foreman. Do not run permission setup, permission reset, TCC reset, service restart loops, raw launchd recovery, raw socket probes, or tmux/PTY recovery.

## Existing Code To Inspect

- `src/commands/operator.swift` - current `permissionsCommand`, `permissionsCheckCommand`, `PermissionsResponse`, `currentPermissionRequirements`, `currentPermissionsSetupState`, `missingPermissionIDsFor`, `evaluateReadyForTesting`, `inputTapRecoveryGuidance`, and `inputMonitoringSubGuidance`.
- `src/shared/input-tap-health.swift` - legacy daemon parsing contract: absent listen/post/accessibility fields mean unknown, not false.
- `scripts/aos-ready.mjs`, `scripts/aos-status.mjs`, and `scripts/aos-doctor.mjs` - accepted external composition patterns for permission facts, setup marker projection, daemon view, readiness evaluation, and TCC recovery notes.
- `manifests/commands/aos-external-commands.json` - add specific `permissions check` and `permissions preflight` routes ahead of the broad native fallback. The dispatcher chooses the longest matching path.
- `tests/input-tap-readiness.sh` and `tests/input-tap-readiness-legacy.sh` - degraded and legacy daemon semantics for public `permissions check`.
- `tests/schemas/aos-external-command-manifest-v0.test.mjs` - update route guards so `check` and `preflight` are external, while the broad `permissions` fallback and mutating subcommands remain native for now.

## Required Behavior

- Add `scripts/aos-permissions.mjs` or an equivalent narrowly named external script for the public read-only forms.
- Public `./aos permissions check`, `./aos permissions check --json`, `./aos permissions preflight`, and `./aos permissions preflight --json` must all emit JSON. Preserve the current behavior where `--json` is optional and there is no text-mode output.
- Preserve unknown flag behavior closely enough for current users and tests:
  - `UNKNOWN_FLAG`
  - `Usage: ./aos permissions check [--json]`
  - `Usage: ./aos permissions preflight [--json]`
- Preserve the current JSON response shape:
  - `status`
  - `permissions`
  - `daemon_view`
  - `cli_view`
  - `requirements`
  - `setup`
  - `missing_permissions`
  - `ready_for_testing`
  - `ready_source`
  - optional `disagreement`
  - `notes`
- Compose only from existing private primitives:
  - `./aos __permissions facts --json`
  - `./aos __permissions setup-marker get --json`
  - `./aos __daemon health --json`
- Recreate setup projection externally by adding `recommended_command: "aos permissions setup --once"` only when `setup_completed` is false. The private setup-marker primitive intentionally omits this public workflow policy.
- Preserve permission requirements with the same IDs, `granted`, `required_for`, and `setup_trigger` values as current Swift output.
- Preserve daemon view semantics:
  - unreachable or unparseable daemon health yields `daemon_view.reachable=false`, no fabricated daemon accessibility, and no fabricated input tap;
  - structured daemon health maps `input_tap.status`, `attempts`, `listen_access`, `post_access`, and optional accessibility into `daemon_view`;
  - legacy daemon health omits unknown listen/post/accessibility fields instead of converting them to false.
- Preserve readiness semantics:
  - reachable daemon with inactive input tap fails closed with `ready_for_testing=false` and `ready_source=daemon`;
  - daemon-reported accessibility plus CLI screen recording plus setup marker determine daemon-sourced readiness when daemon accessibility is present;
  - CLI fallback remains only when daemon facts are not sufficient.
- Preserve `missing_permissions` semantics: prefer daemon accessibility/listen/post when those comparable fields are present, fall back to CLI values when daemon fields are absent, and always use CLI screen recording.
- Preserve `disagreement` semantics: only report fields where both daemon and CLI have comparable Boolean opinions and disagree.
- Preserve notes for missing CLI permissions, incomplete or mismatched setup marker, setup command recommendation, daemon unreachable CLI fallback, inactive input tap, and Input Monitoring sub-guidance.
- Cut only the `permissions check` and `permissions preflight` public routes in `manifests/commands/aos-external-commands.json` to the external script with `AOS_PATH`, `AOS_INVOCATION_DISPLAY_NAME`, `AOS_RUNTIME_MODE`, and `AOS_STATE_ROOT` environment plumbing.
- Leave `./aos permissions setup`, `./aos permissions reset-runtime`, unknown permission subcommands, and bare `./aos permissions` on the existing native `__permissions` fallback in this slice.
- Preserve retained private parity path: `./aos __permissions check --json` and `./aos __permissions preflight --json` may remain available until the later native cleanup tranche removes broad `__permissions`.

## Scope

This is external command composition, manifest routing, and tests. It should be hot-swappable. It should not require a Swift build or TCC identity change.

## Hard Boundaries

- Do not externalize `permissions setup` or `permissions reset-runtime` in this slice.
- Do not add new Swift/native behavior, prompt APIs, reset APIs, aliases, broad compatibility wrappers, or transitional old-vocabulary routes.
- Do not call macOS TCC APIs, AppKit prompt APIs, `tccutil`, service restart, service stop, or permission setup from the new Node script.
- Do not move permission prompt policy, reset policy, setup workflow, help text, or mutating recovery behavior into Swift.
- Do not remove broad `__permissions`, `__ready`, `__status`, or `__doctor` routes in this slice.
- Do not push, open a PR, create a linked worktree, reset unrelated files, or clean unrelated untracked work.
- Do not use raw daemon HTTP, tmux, launchd, socket/state-file inspection, or direct PTY control unless an `./aos` command is broken and you state the bypass reason in the report.

## Suggested Implementation Areas

- `scripts/aos-permissions.mjs` - new external `check`/`preflight` implementation.
- `manifests/commands/aos-external-commands.json` - add specific `["permissions", "check"]` and `["permissions", "preflight"]` routes; keep the existing `["permissions"]` native fallback for remaining subcommands.
- `tests/external-command-dispatch.sh` - assert public `permissions check` and `preflight` route through the external script while `setup`/`reset-runtime` remain native.
- `tests/external-parser-flags.sh` - cover external flag parsing for unknown flags on `check`/`preflight` if the existing parser test is the right home.
- `tests/input-tap-readiness.sh` and `tests/input-tap-readiness-legacy.sh` - keep degraded and legacy daemon behavior green after public route cutover.
- `tests/permissions-marker-worktree.sh` - keep setup marker and cross-worktree behavior green.
- `tests/schemas/aos-external-command-manifest-v0.test.mjs` - tighten route guards for the read-only subcommands and add `scripts/aos-permissions.mjs` to expected private primitive wrapper source checks.

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

If live AOS is safe and `./aos ready --json` is not blocked by permissions or input tap state, run:

```bash
./aos permissions check
./aos permissions check --json
./aos permissions preflight
./aos permissions preflight --json
./aos __permissions check --json
./aos __permissions preflight --json
./aos permissions reset-runtime --mode repo --dry-run --json
```

Compare public `check`/`preflight` against retained private `__permissions check`/`preflight` on stable fields for the current live state: `status`, `permissions`, `daemon_view`, `cli_view`, `missing_permissions`, `ready_for_testing`, `ready_source`, and `disagreement`. Do not run real permission setup, real permission reset, TCC reset, service stop/restart, or prompt flows.

## Completion Report

Report:

- files changed;
- whether public `permissions check` and `permissions preflight` now route externally and which manifest entries changed;
- confirmation that `permissions setup`, `permissions reset-runtime`, bare `permissions`, and unknown permission subcommands still use the native fallback;
- how the output shape, setup projection, requirements, daemon view, legacy unknown fields, readiness, missing permission, disagreement, and notes semantics were preserved;
- exact verification commands and pass/fail results;
- live parity check result for public `check`/`preflight` versus retained private `__permissions` paths, or the exact human-needed blocker;
- unrelated dirty/untracked state left untouched;
- recommended next slice after Foreman acceptance, especially the missing native primitive tranche for `permissions setup`/`reset-runtime` or later broad Swift route cleanup.
