# Operator AFK Dev Session Trigger Supervised Bridge Live V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one bounded supervised live
  `./aos dev afk-session-trigger` no-fixture Codex/GDI proof and report whether
  the accepted source path starts the provider-shaped bridge command, returns a
  non-completed receipt when provider acceptance or cleanup is unproven, and can
  be cleaned up without mutating repo-owned or provider-owned state.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-session-trigger-supervised-bridge-launch-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-supervised-bridge-provider-command-correction-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
- Required start ref: `docs/durable-agent-cognition-v0`
- Expected branch/output: stay local on
  `gdi/afk-dev-session-trigger-supervised-bridge-launch-v0` or the branch that
  contains this card. Make no source, docs, config, provider config, gateway,
  dock profile, hook, GitHub, push, or PR changes. Return a Foreman chat report
  only.

Provider-owned Codex transcript/catalog metadata may be created by the
supervised launch and read for bounded diagnosis. Do not edit, delete, move, or
clean up provider-owned Codex files. Do not paste full transcript content.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
daemon, bridge process, provider session, transcript/catalog state, or Foreman
review details beyond this card. Read and rediscover before acting.

## Goal

Prove the accepted source path, not the deterministic dry-run hook, can enter
the real supervised provider branch:

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

This run is expected to be non-completed unless live provider acceptance and
cleanup proof become observable in the bounded window. A valid proof for this
Operator slice is not "completed"; it is evidence that the guarded command
selects and attempts `codex --no-alt-screen` from `.docks/gdi`, reports a
structured non-completed state such as `provider_acceptance_unobserved` or
`cleanup_unverified`, and leaves the runtime clean after Operator cleanup.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
bash tests/dev-workflow-router.sh
```

Stop if the worktree is dirty or if `HEAD` and
`docs/durable-agent-cognition-v0` do not resolve to the same SHA.

If repo-mode TCC or input-tap readiness blocks, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns, run:

```bash
./aos ready --post-permission
```

Continue only if readiness reports `ready=true`.

## Baseline Runtime Inventory

Before the trigger run, record bounded baseline state:

```bash
pgrep -fl 'codex --no-alt-screen|codex$|pty-proxy.py|codex-terminal/server.mjs' || true
find /Users/Michael/.codex/sessions /Users/Michael/.codex/archived_sessions \
  -type f -newermt '<iso-now-minus-10-minutes-local>' -print | sort
```

Also record the newest five rollout files under the current
`/Users/Michael/.codex/sessions/YYYY/MM/DD` directory with mtimes and sizes.
Do not open or paste full transcripts.

## Packet And Trigger Run

Create temporary packet and output paths outside the repo. The packet should use:

- `packet_id`: `operator-afk-dev-session-trigger-supervised-bridge-live`
- `source_artifact`:
  `docs/design/work-cards/operator-afk-dev-session-trigger-supervised-bridge-live-v0.md`
- `requested_recipient`: `gdi`
- `cwd` and `worktree`: `/Users/Michael/Code/agent-os`
- `required_start_ref`: `docs/durable-agent-cognition-v0`
- `provider_hint`: `codex`
- `result_route`: one local stdout route
- `external_publication_policy`: `local-only`
- `goal`: a short bounded live command-shape proof

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
  --idempotence-salt operator-supervised-bridge-live-v0 \
  --out <temp-output.json>
```

Do not pass `--bridge-visibility-fixture`, `--cleanup-proof-fixture`,
`--provider-session-id`, `--codex-home`, or the internal
`--provider-launch-dry-run` script flag.

Record:

- command exit code;
- top-level receipt `status`;
- `scheduler.lifecycle_state`;
- `dispatch.provider_launch_allowed`;
- `dispatch.launch_root`;
- `terminal_substrate.status`;
- `terminal_substrate.driver`;
- `terminal_substrate.cwd`;
- `terminal_substrate.command`;
- `terminal_substrate.bridge_health`;
- `provider_acceptance.status`;
- `cleanup.status`;
- `codex_adapter.status`;
- `catalog.status`;
- `telemetry.status`;
- mismatch classes.

Expected source-path evidence:

- `dispatch.provider_launch_allowed=true`;
- `terminal_substrate.command="codex --no-alt-screen"`;
- launch cwd is `/Users/Michael/Code/agent-os/.docks/gdi`;
- provider acceptance is non-completed unless a concrete provider session is
  observed;
- missing cleanup proof does not report `completed`.

## Post-Run Evidence

Immediately after the trigger command returns, collect bounded process and
metadata evidence:

```bash
pgrep -fl 'codex --no-alt-screen|codex$|pty-proxy.py|codex-terminal/server.mjs' || true
find /Users/Michael/.codex/sessions /Users/Michael/.codex/archived_sessions \
  -type f -newermt '<pre-trigger local time>' -print | sort
```

For any likely nested Codex or bridge process, report PID, PPID, cwd, and
command using read-only commands such as `ps` and `lsof -a -p <pid> -d cwd`.
If a new or modified rollout file appears in the window, report only:

- file path;
- mtime;
- size;
- `session_meta.payload.id`;
- `session_meta.payload.timestamp`;
- `session_meta.payload.cwd`.

Do not paste full transcript content.

## Cleanup

Before reporting:

- stop any bridge server, `pty-proxy.py`, or nested `codex --no-alt-screen`
  process that was started by this run and is still alive;
- do not kill unrelated pre-existing provider sessions from the baseline;
- verify no matching new bridge/provider processes remain;
- remove temporary packet/output files created for this diagnostic;
- leave provider-owned Codex transcript/catalog files untouched;
- run `git status --short --branch`;
- run `./aos ready`.

## Stop Conditions

- Stop as `human_needed` on TCC/input-tap readiness blockers after running the
  reset helper.
- Stop as `blocked` if the accepted ref is not checked out, the trigger command
  cannot start after one attempt, or Codex launch requires credential/auth
  repair.
- Stop as `partial_pass:no_provider_command` if the receipt does not show
  `terminal_substrate.command="codex --no-alt-screen"` after
  `provider_launch_allowed=true`.
- Stop as `partial_pass:provider_not_retained` if the receipt shows the provider
  command but no live process or rollout evidence can be observed before
  cleanup.
- Stop as `partial_pass:cleanup_unverified_expected` if the command starts the
  provider-shaped path, reports a non-completed cleanup or provider-acceptance
  state, and Operator cleanup succeeds.
- Stop as `pass` if the command starts the provider-shaped path, observes a
  concrete provider session or rollout metadata, still avoids false
  `completed` without cleanup proof, and Operator cleanup succeeds.

## Evidence To Return

- Classification: `pass`, `partial_pass:<reason>`, `blocked`, or
  `human_needed`.
- Branch, HEAD, durable alias SHA, and after-state
  `git status --short --branch`.
- Exact commands run and pass/fail results.
- Trigger receipt summary fields listed above.
- Baseline and post-run process/metadata summaries.
- Whether a separate bridge-launched rollout transcript materialized.
- Cleanup proof and final `./aos ready` result.
- Confirmation of no source/docs/provider-config/gateway/dock-profile/hook,
  GitHub, push, or PR changes, with provider-owned Codex transcript/catalog
  creation called out separately if it occurred.
