# Operator AFK Dev Session Trigger Provider Acceptance Live Proof V0

**Status:** Routed 2026-05-23

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one bounded no-fixture supervised live
  `./aos dev afk-session-trigger` Codex/GDI proof and report whether the real
  trigger path now observes provider acceptance from live terminal snapshot
  output, while preserving verified cleanup.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-session-trigger-provider-acceptance-observation-v0.md`
  - `packets/to-operator-afk-dev-session-trigger-provider-acceptance-live-proof-v0.json`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
- Branch/Base:
  - `branch_from: foreman/afk-provider-acceptance-live-proof-v0`
  - `required_start_ref: foreman/afk-provider-acceptance-live-proof-v0`
  - Accepted source head:
    `1a1eba69db7e8a00976c6daddadee35b0f5502b5`
- Expected branch/output: stay local on the required start ref. Make no source,
  docs, config, provider config/session/catalog, telemetry, gateway, dock
  profile, hook, GitHub, push, PR, merge, or external publication changes.
  Return a Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be created by the
supervised launch and read only for bounded metadata diagnosis. Do not edit,
delete, move, clean, or paste full bodies from provider-owned Codex files.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
daemon, bridge process, provider session, transcript/catalog state, or Foreman
review details beyond this card. Read and rediscover before acting.

## Goal

Prove the accepted no-fixture source path, not a fixture or dry-run hook, can
observe provider acceptance from the live terminal snapshot:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --provider codex \
  --dock gdi \
  --supervised-live-launch \
  --i-am-present \
  --json \
  --timestamp <iso> \
  --out <temp-output.json>
```

Passing evidence for this Operator run is:

- `provider_acceptance.status=provider_session_observed`;
- `provider_acceptance.provider_session_id` is a concrete observed id;
- provider acceptance carries any snapshot-reported cwd, branch, head, version,
  and model fields;
- `terminal_substrate.snapshot_ref` is reviewable and
  `terminal_substrate.snapshot_summary.text_excerpt` is bounded;
- `cleanup.status=verified`;
- top-level receipt `status=completed` and
  `scheduler.lifecycle_state=completed`, unless a clearly documented live
  timing/provider blocker prevents provider acceptance observation;
- no `provider_acceptance_unobserved` mismatch remains in a pass.

If provider acceptance remains unobserved with verified cleanup, classify the
run as `provider_acceptance_unobserved_still_open`, not pass. If provider
acceptance is observed but cleanup is not verified, classify as
`cleanup_unverified`.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD foreman/afk-provider-acceptance-live-proof-v0 1a1eba69db7e8a00976c6daddadee35b0f5502b5
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
```

Stop if the worktree is dirty or if `HEAD` and
`foreman/afk-provider-acceptance-live-proof-v0` do not resolve to the same SHA.

If repo-mode TCC or input-tap readiness blocks, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

Only continue if readiness reports
`ready=true mode=repo daemon=reachable tap=active`.

## Baseline Process And Metadata Snapshot

Before the trigger run, capture bounded baseline state:

```bash
ps -axo pid=,pgid=,command= | rg 'server.mjs|pty-proxy.py|codex --no-alt-screen|Codex' || true
find /Users/Michael/.codex/sessions /Users/Michael/.codex/archived_sessions \
  -type f -newermt '<iso-now-minus-10-minutes-local>' -print | sort
```

Also record the newest five rollout files under the current
`/Users/Michael/.codex/sessions/YYYY/MM/DD` directory with mtimes and sizes.
Do not open or paste full transcript bodies.

## Packet And Trigger Run

Create temporary packet and output paths outside the repo. The packet should
use:

- `packet_id`: `operator-afk-dev-session-trigger-provider-acceptance-live-proof`
- `source_artifact`:
  `docs/design/work-cards/operator-afk-dev-session-trigger-provider-acceptance-live-proof-v0.md`
- `requested_recipient`: `gdi`
- `cwd` and `worktree`: `/Users/Michael/Code/agent-os`
- `required_start_ref`: `foreman/afk-provider-acceptance-live-proof-v0`
- `provider_hint`: `codex`
- `result_route`: one local stdout route
- `external_publication_policy`: `local-only`
- `goal`: `bounded live provider acceptance proof for guarded session trigger`

Run exactly one no-fixture trigger attempt:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --provider codex \
  --dock gdi \
  --supervised-live-launch \
  --i-am-present \
  --json \
  --timestamp <iso> \
  --idempotence-salt operator-provider-acceptance-live-proof-v0 \
  --out <temp-output.json>
```

Do not pass `--bridge-visibility-fixture`, `--cleanup-proof-fixture`,
`--provider-session-id`, `--codex-home`, or the internal
`--provider-launch-dry-run` script flag. Do not start async result routing.

Record:

- command exit code;
- top-level `status`;
- `packet.validation_status`;
- `scheduler.lifecycle_state`;
- `dispatch.provider_launch_allowed`;
- `dispatch.launch_root`;
- `terminal_substrate.status`, `driver`, `cwd`, and `command`;
- `terminal_substrate.snapshot_ref`;
- bounded `terminal_substrate.snapshot_summary` fields, especially
  `text_excerpt`;
- `provider_acceptance.status`;
- `provider_acceptance.provider_session_id`;
- `provider_acceptance.provider_reported_cwd`;
- `provider_acceptance.provider_reported_branch`;
- `provider_acceptance.provider_reported_head`;
- `provider_acceptance.provider_version`;
- `provider_acceptance.model`;
- `cleanup.status`, `cleanup.reason`, `cleanup.scope`, and cleanup proof item
  kinds;
- whether proof includes `owned_bridge_process_exit`,
  `owned_bridge_health_unreachable_after_teardown`,
  `owned_process_driver_child_exit`, and
  `owned_provider_command_child_exit`;
- mismatch classes;
- `codex_adapter.status`, `catalog.status`, and `telemetry.status`.

## Post-Run Cleanup Proof

After the command returns, capture the same bounded process snapshot:

```bash
ps -axo pid=,pgid=,command= | rg 'server.mjs|pty-proxy.py|codex --no-alt-screen|Codex' || true
find /Users/Michael/.codex/sessions /Users/Michael/.codex/archived_sessions \
  -type f -newermt '<pre-trigger local time>' -print | sort
```

For any likely nested Codex or bridge process, report PID, PPID, cwd, and
command using read-only commands such as `ps` and
`lsof -a -p <pid> -d cwd`. Do not kill unrelated pre-existing provider
sessions.

If a new or modified rollout file appears in the window, report only:

- file path;
- mtime;
- size;
- `session_meta.payload.id`;
- `session_meta.payload.timestamp`;
- `session_meta.payload.cwd`.

Do not paste full transcript content.

Compare baseline and post-run process snapshots. Report whether any new bridge
server, `pty-proxy.py`, owned process group, or nested
`codex --no-alt-screen` process remained. If a helper-owned bridge or PTY
process from this run remains and is clearly identifiable by session, PID, port,
or process group from the receipt, record it and classify
`cleanup_unverified`; do not kill unrelated provider sessions.

Remove the temporary packet/output directory after capturing evidence.

Run final readiness:

```bash
./aos ready
git status --short --branch
```

## Stop Conditions

Stop and report instead of broadening scope if:

- repo-mode TCC/Input Monitoring readiness blocks;
- the worktree is dirty before the run;
- `HEAD` and `foreman/afk-provider-acceptance-live-proof-v0` differ;
- the trigger would require fixture flags, dry-run hooks, final
  `aos session ...` spelling, or async result routing to continue;
- cleanup evidence would require killing or classifying unrelated provider
  sessions;
- provider transcript body inspection becomes necessary;
- the live provider asks for human input beyond the bounded launch acceptance
  proof.

## Completion Report

Report:

- branch, HEAD SHA, and accepted source SHA;
- preflight command results with exact pass/fail counts;
- trigger command exit code and receipt field summary listed above;
- whether provider acceptance was observed from live snapshot text;
- provider session id and provider-reported cwd/branch/head/version/model when
  present;
- cleanup proof fields and whether the receipt's cleanup status matches
  observed post-run processes;
- baseline versus post-run process comparison, including whether any new
  helper-owned bridge/PTY/provider command process remained;
- bounded provider metadata files created or modified, if any, without full
  transcript bodies;
- final `./aos ready` and `git status --short --branch` results;
- temp artifact cleanup status;
- confirmation that no source, docs, provider config/session/catalog, telemetry,
  gateway, dock profile/hook, GitHub state, push, PR, merge, external
  publication, provider transcript body read/mutation, or async result routing
  happened;
- classification: `pass`,
  `provider_acceptance_unobserved_still_open`, `cleanup_unverified`,
  `human_needed`, or `blocked`, plus the smallest next follow-up if one is
  obvious.
