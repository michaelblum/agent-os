# Work Card: AFK Dev Session Trigger Dry-Run Command V0

**Status:** Accepted 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: add an experimental dry-run-only
  `./aos dev afk-session-trigger` command that validates a local transfer
  packet, creates deterministic scheduler and dispatch intent ids, resolves the
  dock launch root, and emits a no-schema trigger/dispatch dry-run receipt.
- Source artifacts:
  - `docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md`
  - `docs/design/work-cards/afk-session-trigger-command-readiness-v0.md`
  - `docs/design/work-cards/afk-dev-launch-attempt-command-v0.md`
  - `docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `gdi/afk-dev-session-trigger-dry-run-command-v0`. Keep the checkpoint local;
  do not push, open a PR, mutate GitHub, or publish externally.

## Tracker

- Workstream:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Command-readiness decision:
  `docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, Codex transcript, gateway state, built-binary
freshness, or prior implementation state. Read and rediscover before editing.

## Goal

Add this experimental developer command:

```bash
./aos dev afk-session-trigger \
  --packet <packet.json> \
  --provider codex \
  --dock gdi \
  --dry-run \
  --json
```

The command should validate packet/current-state facts, model scheduler intake,
model provider-neutral dispatch intent, and emit a deterministic dry-run
receipt. It must not implement final `aos session` command spelling and must
not launch Codex, Claude, Gemini, tmux, process-driver bridges, provider
terminals, gateway jobs, or route delivery.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/notes/afk-session-trigger-command-readiness-2026-05-22.md`
- `docs/design/work-cards/afk-dev-launch-attempt-command-v0.md`
- `scripts/afk-dry-run-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-dry-run-prototype.test.mjs`
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
./aos dev recommend --json --paths src/commands/dev.swift,src/shared/command-registry-data.swift,tests/dev-workflow-router.sh,tests/help-contract.sh,scripts/afk-dry-run-prototype.mjs,scripts/afk-launch-attempt-prototype.mjs
```

This slice changes Swift CLI wiring and likely tests, so expect a Swift build.
It should not need live AOS input control. If a required build/readiness check
reports repo-mode TCC/input-tap blockers, use the repo-standard recovery path:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Continue only if it reports ready.

## Required Behavior

The command should:

1. Accept:
   - `--packet <path>` required;
   - `--dry-run` required for this first source slice;
   - `--json` for machine-readable output;
   - `--provider <name>` optional when packet has provider hint;
   - `--dock <dock>` optional when packet has requested recipient;
   - `--repo <path>` optional;
   - `--timestamp <iso>` optional;
   - `--out <path>` optional;
   - `--result-route <ref>` optional only if packet omits a route;
   - `--idempotence-salt <value>` optional for deterministic tests.
2. Reject unknown flags, positional arguments, missing values, and missing
   `--packet` or missing `--dry-run` through existing JSON `exitError`
   patterns.
3. Parse the local packet JSON and normalize at least:
   - packet id or ref;
   - source artifact;
   - requested recipient/dock;
   - provider hint;
   - cwd/worktree;
   - required start ref;
   - result route;
   - branch/external publication policy when present.
4. Resolve the repo root, current worktree facts, required start ref, source
   artifact existence, selected provider, selected dock, dock profile, and dock
   launch root without changing branches or mutating state.
5. Emit one no-schema JSON receipt with this shape or a defensible local
   equivalent:

```json
{
  "record_type": "aos.afk_session_trigger_dry_run",
  "schema_status": "not_a_schema",
  "status": "dry_run_ready",
  "packet": {
    "packet_ref": "<path>",
    "packet_id": "<packet id or not_observed>",
    "source_artifact": "<path or not_observed>",
    "validation_status": "valid"
  },
  "scheduler": {
    "scheduler_run_id": "scheduler-<stable-id>",
    "idempotence_key": "<stable-key>",
    "lifecycle_state": "accepted",
    "selected_action": "dry-run",
    "lease": "not_enforced"
  },
  "dispatch": {
    "dispatch_attempt_id": "dispatch-<stable-id>",
    "selected_provider": "codex",
    "selected_dock": "gdi",
    "dock_profile_ref": ".docks/gdi/dock.json",
    "launch_root": ".docks/gdi",
    "action": "dry-run",
    "provider_launch_allowed": false
  },
  "terminal_substrate": {
    "status": "not_attempted",
    "reason": "dry-run-only"
  },
  "result_route": {
    "status": "not_attempted",
    "refs": []
  },
  "mismatches": []
}
```

6. Use status vocabulary from the readiness note:
   `dry_run_ready`, `rejected`, `duplicate`, `blocked`, and `failed`.
7. Include mismatch/error classes when applicable, especially:
   `missing_packet`, `invalid_packet_json`, `missing_source_artifact`,
   `unknown_dock`, `dock_profile_missing`, `provider_missing`,
   `provider_unsupported`, `repo_missing`,
   `required_start_ref_unresolved`, `worktree_mismatch`,
   `result_route_missing`, `launch_policy_violation`, and
   `receipt_write_failed`.
8. Preserve no-unattended-provider-launch behavior:
   - no flag may launch Codex, Claude, Gemini, tmux, process sessions,
     provider terminals, gateway jobs, or result routes;
   - do not add `--live`, `--launch-provider`, `--start`, or equivalent;
   - terminal substrate must remain `not_attempted` or dry-run equivalent.
9. Expose registry/help/audit metadata:
   - `./aos help dev --json` includes `dev-afk-session-trigger`;
   - `./aos help dev afk-session-trigger --json` exposes the option tokens;
   - `./aos dev audit --json` includes the new form and flag claim.
10. Preserve existing `afk-dry-run` and `afk-launch-attempt` behavior and help.

## Suggested Implementation Areas

Likely files:

- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`
- optional `scripts/afk-session-trigger-prototype.mjs`
- optional `tests/afk-session-trigger-prototype.test.mjs`

Prefer the repo's existing dev-command wrapper patterns. If a Node prototype
keeps receipt construction and deterministic tests simpler, add one and have
Swift delegate to it. If Swift can implement the receipt cleanly without
duplication, keep it in Swift.

## Hard Boundaries

- Do not create final `aos session`, `aos afk`, scheduler, runtime, gateway, or
  result-route command behavior.
- Do not add or modify schemas.
- Do not launch Codex, Claude, Gemini, tmux, process sessions, provider
  terminals, live bridges, gateway jobs, or route delivery.
- Do not read real `~/.codex` transcripts or provider-owned files.
- Do not mutate provider config, provider session files, provider catalogs,
  telemetry stores, gateway state, dock profiles, hooks, `.docks` role
  instructions, GitHub state, push, or PR state.
- Do not create committed generated receipt artifacts outside tests.
- Do not create a Researcher dock.

## Verification

Required:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

If a Node prototype is added, also run its focused test file, for example:

```bash
node --test tests/afk-session-trigger-prototype.test.mjs
```

Run a provider-free command-level smoke with a temp packet:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --provider codex \
  --dock gdi \
  --dry-run \
  --json
```

The smoke should prove:

- exit code 0 for a valid packet;
- `record_type=aos.afk_session_trigger_dry_run`;
- `status=dry_run_ready`;
- scheduler lifecycle is `accepted`;
- selected action is `dry-run`;
- selected provider/dock are `codex`/`gdi`;
- dock profile and launch root are resolved;
- terminal substrate is `not_attempted`;
- `provider_launch_allowed=false`;
- result route is `not_attempted`;
- no provider session id, provider transcript, gateway job, bridge process, or
  route delivery is created.

Also run:

```bash
./aos help dev --json
./aos help dev afk-session-trigger --json
./aos dev audit --json
git diff --check
./aos dev recommend --json --paths src/commands/dev.swift,src/shared/command-registry-data.swift,tests/dev-workflow-router.sh,tests/help-contract.sh
```

If `./aos dev recommend --json` recommends additional checks, run the smallest
relevant check or explain why it is not applicable.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- implementation shape, including Swift-only versus Swift wrapper plus Node
  prototype;
- command shape and why it remains experimental/dev-only;
- argument validation behavior;
- receipt shape and status/mismatch handling;
- help/registry/audit updates;
- provider-free smoke result and key receipt facts;
- tests/checks run and exact results;
- proof that no unattended provider launch, bridge process, provider transcript
  read, gateway mutation, result-route delivery, GitHub state, push, or PR
  occurred;
- remaining gap before any supervised or unattended live session trigger mode.

## Foreman Acceptance

Accepted on 2026-05-22 at GDI commit
`f7873d96a6430608f545ca4f9d14f59afb8f1b08`.

Review summary:

- Scope matched the card: the implementation adds experimental
  `./aos dev afk-session-trigger` only, delegates to
  `scripts/afk-session-trigger-prototype.mjs`, and keeps final
  `aos session` spelling deferred.
- Launch policy is preserved: the command requires `--dry-run`, exposes no
  `--live`, `--launch-provider`, `--start`, or equivalent launch flag, and the
  receipt reports `provider_launch_allowed=false`,
  `terminal_substrate.status=not_attempted`, and
  `result_route.status=not_attempted`.
- Changed files were limited to the expected dev command, registry, tests, and
  focused prototype/test paths.
- Provider-free wrapper smoke produced
  `record_type=aos.afk_session_trigger_dry_run`, `status=dry_run_ready`,
  scheduler lifecycle `accepted`, selected action `dry-run`, selected
  provider/dock `codex`/`gdi`, launch root `.docks/gdi`,
  `provider_launch_allowed=false`, terminal substrate `not_attempted`, result
  route `not_attempted`, and zero mismatches.

Foreman verification:

```bash
node --test tests/afk-session-trigger-prototype.test.mjs
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
node --test tests/afk-dry-run-prototype.test.mjs tests/afk-launch-attempt-prototype.test.mjs
./aos dev audit --json
node --test tests/schemas/dev-workflow-rules.test.mjs
node --test tests/schemas/dev-active-profile.test.mjs
node --test tests/schemas/dev-workflow-profiles.test.mjs
bash tests/dev-audit.sh
./aos dev afk-session-trigger --packet <temp-packet.json> --provider codex --dock gdi --dry-run --json --timestamp 2026-05-22T20:40:00.000Z --idempotence-salt foreman-smoke
./aos dev afk-session-trigger --packet
./aos dev afk-session-trigger --dry-run --json
./aos dev afk-session-trigger --packet /tmp/nope.json --provider codex --dock gdi --json
git diff --check c8b6c612c399099c1cbe5bbcebad09201e94d24b..HEAD
./aos dev recommend --json --paths src/commands/dev.swift,src/shared/command-registry-data.swift,tests/dev-workflow-router.sh,tests/help-contract.sh,scripts/afk-session-trigger-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs
```

All deterministic checks passed. `./aos ready` after the Swift build reported
`human_required` with `daemon_tcc_grant_stale_or_missing` for the repo-mode
`/Users/Michael/Code/agent-os/aos` runtime. This is an environment permission
blocker, not an acceptance failure for the dry-run command. Do not route
live-dependent follow-up until the repo-standard permission reset/setup path has
completed and `./aos ready --post-permission` reports ready.
