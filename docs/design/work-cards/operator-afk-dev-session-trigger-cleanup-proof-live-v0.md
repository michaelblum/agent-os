# Operator AFK Dev Session Trigger Cleanup Proof Live V0

**Status:** Partial pass accepted 2026-05-22

## Result

- Classification: `partial_pass`.
- Foreman review: accepted as the intended live cleanup-proof evidence. Branch
  and ref gates passed with `HEAD` and `docs/durable-agent-cognition-v0` both at
  `98f043ee9aec224e6e1bed5cf05b5af0fe5e2650`; final worktree status was clean,
  and final `./aos ready` reported
  `ready=true mode=repo daemon=reachable tap=active`.
- Preflight passed: `./aos ready`, `node --test
  tests/afk-session-trigger-prototype.test.mjs` with 15/15 passing,
  `node --test tests/afk-launch-attempt-prototype.test.mjs` with 25/25
  passing, and `node --test tests/sigil-agent-terminal-server.test.mjs` with
  12/12 passing.
- Trigger receipt: wrapper observed exit `1`; top-level
  `status=provider_acceptance_unobserved`;
  `scheduler.lifecycle_state=rejected`;
  `terminal_substrate.status=observed`; `terminal_substrate.driver=process`;
  `terminal_substrate.cwd=/Users/Michael/Code/agent-os/the implementer native subagent`;
  `terminal_substrate.command=codex --no-alt-screen`;
  `provider_acceptance.status=provider_acceptance_unobserved`;
  `cleanup.status=verified`; `cleanup.reason=null`; mismatch classes:
  `provider_acceptance_unobserved`.
- Cleanup proof included all required kinds:
  `owned_bridge_process_exit`,
  `owned_bridge_health_unreachable_after_teardown`,
  `owned_process_driver_child_exit`, and
  `owned_provider_command_child_exit`.
- Process cleanup accepted: baseline and post-run snapshots matched for
  persistent pre-existing Codex app/helper processes; no new bridge server,
  `pty-proxy.py`, owned bridge process, owned process group, or nested
  `codex --no-alt-screen` remained. Receipt PIDs `75861` and `75863`, and
  bridge port `63663`, were no longer observable.
- Boundary confirmed: temporary packet/output directory removed; no source,
  docs, config, provider config/session/catalog, gateway, dock profile, hook,
  GitHub, push, PR, external publication, or provider transcript body
  read/mutation happened.
- Follow-up finding: the live receipt reported
  `packet.validation_status=invalid` even though the packet source artifact was
  present, the durable start ref resolved, the guarded launch path proceeded,
  and cleanup proof was verified. Foreman reproduced this deterministically
  without a live provider: a valid packet plus internal provider-launch dry-run
  and verified cleanup fixture still returned
  `packet.validation_status=invalid` solely because the runtime mismatch list
  contained `provider_acceptance_unobserved`.
- Next routed source correction:
  `docs/design/work-cards/afk-dev-session-trigger-packet-validation-status-correction-v0.md`.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one bounded no-fixture supervised live
  `./aos dev afk-session-trigger` Codex/Implementer proof and report whether the real
  command path now records verified source-owned cleanup proof without leaving
  helper-owned bridge, PTY, or provider command processes behind.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-session-trigger-live-cleanup-proof-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-live-cleanup-process-correction-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `apps/sigil/codex-terminal/server.mjs`
  - `apps/sigil/codex-terminal/pty-proxy.py`
- Required start ref: `docs/durable-agent-cognition-v0`
- Expected branch/output: stay local on the branch that contains this card.
  Make no source, docs, config, provider config, gateway, dock profile, hook,
  GitHub, push, PR, or external publication changes. Return a Foreman chat
  report only.

Provider-owned Codex transcript/catalog metadata may be created by the
supervised launch and read only for bounded metadata diagnosis. Do not edit,
delete, move, clean, or paste full bodies from provider-owned Codex files.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
daemon, bridge process, provider session, transcript/catalog state, or Foreman
review details beyond this card. Read and rediscover before acting.

## Goal

Prove the accepted source path, not a fixture or dry-run hook, can launch the
provider-shaped command and report cleanup proof from the helper-owned bridge
substrate:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --provider codex \
  --dock implementer \
  --supervised-live-launch \
  --i-am-present \
  --json \
  --timestamp <iso> \
  --out <temp-output.json>
```

The expected non-completed result is usually
`provider_acceptance_unobserved` with `cleanup.status=verified`. If live
provider acceptance is unexpectedly observed, `completed` is acceptable only
when cleanup remains `verified`. `cleanup_unverified` is a source-follow-up
signal, not an Operator cleanup task.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
```

Stop if the worktree is dirty or if `HEAD` and
`docs/durable-agent-cognition-v0` do not resolve to the same SHA.

If repo-mode TCC or input-tap readiness blocks, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if readiness reports
`ready=true mode=repo daemon=reachable tap=active`.

## Baseline Process Snapshot

Before the trigger run, capture a bounded process snapshot for later
comparison:

```bash
ps -axo pid=,pgid=,command= | rg 'server.mjs|pty-proxy.py|codex --no-alt-screen|Codex' || true
```

Do not kill pre-existing provider sessions or provider-owned processes.

## Trigger Run

Create temporary packet and output paths outside the repo. The packet should
use:

- `packet_id`: `operator-afk-dev-session-trigger-cleanup-proof-live`
- `source_artifact`:
  `docs/design/work-cards/operator-afk-dev-session-trigger-cleanup-proof-live-v0.md`
- `requested_recipient`: `implementer`
- `cwd` and `worktree`: `/Users/Michael/Code/agent-os`
- `required_start_ref`: `docs/durable-agent-cognition-v0`
- `provider_hint`: `codex`
- `result_route`: one local stdout route
- `external_publication_policy`: `local-only`
- `goal`: `bounded live cleanup proof for guarded session trigger`

Run exactly one no-fixture trigger attempt:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --provider codex \
  --dock implementer \
  --supervised-live-launch \
  --i-am-present \
  --json \
  --timestamp <iso> \
  --idempotence-salt operator-cleanup-proof-live-v0 \
  --out <temp-output.json>
```

Do not pass `--bridge-visibility-fixture`, `--cleanup-proof-fixture`,
`--provider-session-id`, `--codex-home`, or the internal
`--provider-launch-dry-run` script flag.

Record:

- command exit code;
- top-level `status`;
- `scheduler.lifecycle_state`;
- `dispatch.provider_launch_allowed`;
- `dispatch.launch_root`;
- `terminal_substrate.status`, `driver`, `cwd`, and `command`;
- `provider_acceptance.status`;
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
```

Compare against the baseline and report whether any new bridge server,
`pty-proxy.py`, owned process group, or nested `codex --no-alt-screen` process
remained. If a helper-owned bridge or PTY process from this run remains and is
clearly identifiable by session, PID, port, or process group from the receipt,
record it and stop with `cleanup_unverified`; do not kill unrelated provider
sessions. If only pre-existing Codex sessions remain, report them as baseline
processes and leave them alone.

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
- `HEAD` and `docs/durable-agent-cognition-v0` differ;
- the trigger would require fixture flags, dry-run hooks, prompt submission, or
  final `aos session ...` spelling to continue;
- cleanup evidence would require killing or classifying unrelated provider
  sessions;
- provider transcript body inspection becomes necessary.

## Completion Report

Report:

- branch, HEAD SHA, and `docs/durable-agent-cognition-v0` SHA;
- preflight command results with exact pass/fail counts;
- trigger command exit code and receipt field summary listed above;
- cleanup proof fields and whether the receipt's cleanup status matches
  observed post-run processes;
- baseline versus post-run process comparison, including whether any new
  helper-owned bridge/PTY/provider command process remained;
- final `./aos ready` and `git status --short --branch` results;
- temp artifact cleanup status;
- confirmation that no source, docs, provider config/session/catalog, gateway,
  dock profile/hook, GitHub state, push, PR, external publication, or provider
  transcript body read/mutation happened;
- classification: `pass`, `partial_pass`, `cleanup_unverified`,
  `manual_intervention`, or `blocked`, plus the smallest next follow-up if one is
  obvious.
