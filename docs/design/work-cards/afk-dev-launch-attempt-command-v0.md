# Work Card: AFK Dev Launch Attempt Command V0

**Status:** Accepted 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: expose the accepted AFK launch-attempt prototype through an
  experimental `./aos dev afk-launch-attempt` command without making it a final
  AFK runtime/session API or enabling unattended provider launch.
- Source artifacts:
  - `docs/design/work-cards/afk-launch-attempt-live-codex-record-v0.md`
  - `docs/design/work-cards/operator-afk-launch-attempt-live-codex-record-rerun-v0.md`
  - `scripts/afk-launch-attempt-prototype.mjs`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `gdi/afk-dev-launch-attempt-command-v0`. Keep the checkpoint local; do not
  push, open a PR, mutate GitHub, or publish externally.

## Tracker

- Workstream:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Prior dev-command pattern:
  `docs/design/work-cards/afk-dev-dry-run-command-v0.md`
- Accepted launch-attempt prototype:
  `scripts/afk-launch-attempt-prototype.mjs`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, Codex transcript, catalog, telemetry,
Operator report, built-binary freshness, or prior implementation state. Read
and rediscover before editing.

## Goal

Add an experimental developer command:

```bash
./aos dev afk-launch-attempt --packet <packet.json> --provider codex --dock gdi --json
```

The command should delegate to `scripts/afk-launch-attempt-prototype.mjs` and
preserve the prototype's current safety boundary:

- default execution starts only the provider-free harmless-command bridge
  substrate;
- fixture-backed execution can model supervised live evidence;
- explicit `--codex-home` is read-only diagnostic input for correlation;
- no wrapper flag enables unattended Codex, Claude, Gemini, gateway, or final
  AFK session launch.

Keep the command under `dev` so it remains a repo-development diagnostic, not
final `aos session` command spelling.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/afk-dev-dry-run-command-v0.md`
- `docs/design/work-cards/afk-launch-attempt-live-codex-record-v0.md`
- `docs/design/work-cards/operator-afk-launch-attempt-live-codex-record-rerun-v0.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos dev recommend --json
./aos dev classify --json --paths src/commands/dev.swift,src/shared/command-registry-data.swift,scripts/afk-launch-attempt-prototype.mjs,tests/afk-launch-attempt-prototype.test.mjs,tests/dev-workflow-router.sh
```

This slice changes Swift CLI wiring and tests, so expect a Swift build. If a
live readiness check reports repo-mode TCC/input-tap blockers after rebuilding,
use the repo-standard recovery path:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `08930f878efe9570d869b5f0e9c0f1483c005249`
- expected output branch:
  `gdi/afk-dev-launch-attempt-command-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `src/commands/dev.swift` - `devCommand` subcommand router, existing
  `devAfkDryRunCommand`, option parser patterns, and dev audit expected forms.
- `src/shared/command-registry-data.swift` - help/registry form definitions for
  `dev` commands.
- `tests/dev-workflow-router.sh` - current dev command/help assertions.
- `tests/help-contract.sh` - broader registry/help contract expectations.
- `scripts/afk-launch-attempt-prototype.mjs` - accepted launch-attempt
  prototype options and safety checks.
- `tests/afk-launch-attempt-prototype.test.mjs` - current deterministic
  fixture coverage.

## Required Behavior

The command should:

1. Accept the prototype's core safe options:
   - `--packet <path>` required;
   - `--provider <name>` optional when packet has provider hint;
   - `--dock <dock>` optional when packet has requested recipient;
   - `--repo <path>` optional;
   - `--timestamp <iso>` optional;
   - `--out <path>` optional;
   - `--json` for JSON output.
2. Accept the prototype's fixture/diagnostic options when useful:
   - `--duplicate-in-process`;
   - `--catalog-fixture <path>`;
   - `--bridge-visibility-fixture <path>`;
   - `--provider-session-id <id>`;
   - `--launch-observed-at <iso>`;
   - `--codex-home-fixture <path>`;
   - `--codex-home <path>`.
3. Preserve no-unattended-provider-launch behavior:
   - the wrapper must not expose any flag that starts Codex, Claude, Gemini, or
     another provider directly;
   - help text must call this an experimental dev diagnostic, not stable
     runtime session control;
   - direct provider correlation through `--codex-home` is read-only and only
     happens when explicitly requested by the caller.
4. Delegate to the Node script or share its behavior with minimal duplication.
   Prefer invoking the accepted script from Swift unless inspection shows a
   smaller safer reuse path.
5. Propagate stdout/stderr and exit status from the launch-attempt script.
6. Return machine-readable wrapper-level errors through existing `exitError`
   patterns for mistakes such as missing `--packet`, missing flag values,
   unknown flags, or positional arguments.
7. Expose registry/help metadata:
   - `./aos help dev --json` includes `dev-afk-launch-attempt`;
   - `./aos help dev afk-launch-attempt --json` exposes the option tokens;
   - `./aos dev audit --json` includes the new form and flag claim.
8. Preserve existing `afk-dry-run` behavior and help.

## Scope

Likely files:

- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- optionally `tests/help-contract.sh` if the broader help contract is the local
  convention for new command forms
- `scripts/afk-launch-attempt-prototype.mjs` only if a tiny usage/help
  adjustment is required for clean wrapper delegation
- `tests/afk-launch-attempt-prototype.test.mjs` only if script behavior changes

Do not edit provider bridge behavior or Codex adapter behavior unless a wrapper
smoke exposes a direct bug.

## Hard Boundaries

- Do not create a final `aos session`, `aos afk`, scheduler, dispatch, or
  runtime command surface.
- Do not add or modify schemas.
- Do not launch Codex, Claude, Gemini, tmux, process sessions, or provider
  terminals from tests or wrapper smoke beyond the prototype's existing
  harmless no-provider bridge command.
- Do not mutate provider config, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, or notification routes.
- Do not add package dependencies.
- Do not create committed generated receipt artifacts outside tests.
- Do not change `.docks` role instructions, dock profiles, transfer scripts,
  hook behavior, or provider config files.
- Do not move or rename recipes, playbooks, workflows, work cards, docks,
  gateway files, API docs, apps, packages, shared schema files, or
  `docs/dev/workflow-rules.json`.
- Do not make gateway the owner of sessions.
- Do not create a Researcher dock.
- Do not push, open a PR, mutate GitHub issues, or publish externally.

## Verification

Required:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
bash tests/dev-workflow-router.sh
./aos dev build --no-restart
```

After the build, run one provider-free command-level smoke with a temp packet:

```bash
./aos dev afk-launch-attempt --packet <temp-packet.json> --provider codex --dock gdi --json
```

The smoke should prove:

- exit code 0 for a valid packet;
- record type is `aos.afk_launch_attempt`;
- `lifecycle_state` is `provider_acceptance_unobserved`;
- selected provider/dock are `codex`/`gdi`;
- terminal substrate driver is `process`;
- `provider_acceptance.provider_session_id` remains
  `not_applicable: no-provider-launch`;
- `launch_intent.provider_launch_performed=false`;
- no real provider session id or provider transcript is created.

Run one fixture-backed wrapper smoke using temporary packet, bridge fixture, and
Codex-home fixture:

```bash
./aos dev afk-launch-attempt \
  --packet <temp-packet.json> \
  --provider codex \
  --dock gdi \
  --json \
  --timestamp <iso> \
  --launch-observed-at <iso> \
  --bridge-visibility-fixture <temp-bridge-visibility.json> \
  --codex-home-fixture <temp-codex-home>
```

The fixture smoke should prove the same happy-path summary accepted in
`docs/design/work-cards/afk-launch-attempt-live-codex-record-v0.md` without
reading real `~/.codex`.

Also run:

```bash
./aos help dev --json
./aos help dev afk-launch-attempt --json
./aos dev audit --json
git diff --check
./aos dev recommend --json
```

If `./aos dev recommend --json` recommends additional checks, run the smallest
relevant check or explain why it is not applicable. If live readiness is the
next meaningful proof after building, run `./aos ready` unless the repo-mode
TCC/input-tap state is blocked; if blocked, use the helper and stop with
`human_needed`.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- command shape and why it remains experimental/dev-only;
- whether the wrapper delegates to the script or shares logic another way;
- argument validation behavior;
- help/registry/audit updates;
- provider-free smoke result and key record facts;
- fixture-backed smoke result and key record facts;
- tests/checks run and exact results;
- proof that no unattended provider launch occurred;
- confirmation that no provider config, provider transcript, gateway state,
  generated committed receipt artifact, GitHub state, push, or PR changed;
- remaining gap before final AFK session trigger/dispatch command design.

## Foreman Acceptance

Accepted on 2026-05-22 at GDI commit
`340a1c15725eff53bc2fd8158fca7c96cf1b3f76`.

Review summary:

- Scope matched the card: the command is limited to experimental
  `./aos dev afk-launch-attempt`, delegates to
  `scripts/afk-launch-attempt-prototype.mjs`, and does not expose
  `--allow-provider-launch` or a final `aos session` command surface.
- Changed files were limited to `src/commands/dev.swift`,
  `src/shared/command-registry-data.swift`, and
  `tests/dev-workflow-router.sh`.
- Help, registry, and audit expose `dev-afk-launch-attempt` with the expected
  safe fixture/diagnostic flags and preserve `afk-dry-run`.
- Provider-free wrapper smoke returned `record_type=aos.afk_launch_attempt`,
  `lifecycle_state=provider_acceptance_unobserved`,
  `provider_session_id=not_applicable: no-provider-launch`, process-driver
  terminal substrate, selected provider/dock `codex`/`gdi`, and
  `provider_launch_performed=false`.
- Fixture-backed wrapper smoke used only temporary packet, bridge, and
  Codex-home fixtures and returned `lifecycle_state=provider_session_observed`,
  `provider_launch_performed=true`, geometry `100x31`, extra Enter observed,
  response marker observed, exact Codex adapter match by provider session id,
  and no mismatches.

Foreman verification:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
./aos help dev --json
./aos help dev afk-launch-attempt --json
./aos dev audit --json
./aos dev recommend --json --paths src/commands/dev.swift,src/shared/command-registry-data.swift,tests/dev-workflow-router.sh
node --test tests/schemas/dev-workflow-rules.test.mjs
node --test tests/schemas/dev-active-profile.test.mjs
node --test tests/schemas/dev-workflow-profiles.test.mjs
bash tests/dev-audit.sh
git diff --check
```

All deterministic checks passed. Foreman also checked wrapper errors for
missing `--packet`, missing `--packet` value, and unknown
`--allow-provider-launch`; each returned the expected JSON error shape.

`./aos ready` reported `human_required` with
`daemon_tcc_grant_stale_or_missing` for the repo-mode `/Users/Michael/Code/agent-os/aos`
runtime. This is an environment permission blocker, not an acceptance failure
for the wrapper. Do not route live-dependent follow-up until the human runs the
repo-standard permission reset/setup path and `./aos ready --post-permission`
reports ready.
