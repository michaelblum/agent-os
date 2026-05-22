# Operator AFK Bridge Codex Transcript Materialization Diagnosis V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: determine whether a bridge-launched nested `codex
  --no-alt-screen` process creates a separate Codex rollout transcript after an
  explicit submitted prompt, and capture enough process/snapshot metadata to
  explain a missing transcript.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-codex-workspace-root-live-correlation-v0.md`
  - `docs/design/work-cards/afk-codex-workspace-root-correlation-correction-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Expected branch/output: stay local on the current worktree/branch. Make no
  source, docs, config, provider config, gateway, dock profile, hook, GitHub,
  push, or PR changes. Return a Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be created by the
supervised launch and read for diagnosis. Do not edit, delete, move, or clean up
provider-owned Codex files.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test --experimental-strip-types packages/host/test/codex-thread-adapter.test.ts
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

## Baseline Metadata Inventory

Before starting the bridge, record a read-only baseline:

```bash
find /Users/Michael/.codex/sessions /Users/Michael/.codex/archived_sessions \
  -type f -newermt '<iso-now-minus-10-minutes-local>' -print | sort
```

Also record the newest five rollout files under
`/Users/Michael/.codex/sessions/2026/05/22` with their mtimes. Do not open or
paste full transcripts; only report file path, mtime, size, and `session_meta`
fields if needed.

## Live Bridge Run

Start one bridge process with a free local port, preferring `17866`:

```bash
SIGIL_AGENT_TERMINAL_PORT=17866 \
SIGIL_AGENT_TMUX_SESSION=afk-codex-transcript-materialization \
SIGIL_AGENT_CWD=/Users/Michael/Code/agent-os/.docks/gdi \
SIGIL_AGENT_COMMAND='codex --no-alt-screen' \
SIGIL_AGENT_TERMINAL_DRIVER=process \
node apps/sigil/codex-terminal/server.mjs
```

If the port is busy, use the next free port and report it. Do not retry more
than once for non-port failures.

Verify `/health` reports:

- `defaultCwd`: `/Users/Michael/Code/agent-os/.docks/gdi`
- `driver`: `process`

Use `/ensure` for:

- session: `afk-codex-transcript-materialization`
- cwd: `/Users/Michael/Code/agent-os/.docks/gdi`
- command: `codex --no-alt-screen`
- force: `true`

Record `launch_observed_at` as an ISO timestamp when `/ensure` returns or when
the provider visibly starts. Capture an initial `/snapshot`.

## Process Evidence

After `/ensure`, collect bounded process evidence:

```bash
pgrep -fl 'codex --no-alt-screen|codex$|pty-proxy.py'
```

For any likely nested Codex process, report PID, parent PID, cwd, and command
using read-only commands such as `ps` and `lsof -a -p <pid> -d cwd`. Do not
kill provider processes except the bridge process during cleanup.

## Submitted Prompt Probe

Wait until the snapshot shows the Codex TUI is ready for input or clearly asks
for a prompt. Then send exactly one bounded status prompt through `/input`:

```text
Status check only. Reply with exactly: live-codex-transcript-materialization cwd=<cwd> session=<session id if visible, otherwise not_observed>. Do not edit files.
```

After sending, capture:

- the `/input` HTTP response status/body;
- a snapshot immediately after send;
- a snapshot after a short wait;
- whether the prompt appears submitted, remains in an input box, or receives a
  model response.

If the prompt appears typed but not submitted, send one `/key` `Enter` and
capture one more snapshot. Do not send additional prompts.

## Post-Prompt Metadata Inventory

After the prompt attempt and short wait, record a second read-only metadata
inventory:

```bash
find /Users/Michael/.codex/sessions /Users/Michael/.codex/archived_sessions \
  -type f -newermt '<launch_observed_at converted to local time or a conservative pre-launch local time>' -print | sort
```

For each new or modified rollout file in the window, report:

- file path
- mtime
- size
- `session_meta.payload.id`
- `session_meta.payload.timestamp`
- `session_meta.payload.cwd`
- whether a small grep finds the submitted marker
  `live-codex-transcript-materialization`

Do not paste full transcript content.

## Prototype Probe

Only run the prototype if a new or modified rollout file appears that is not
the Operator session itself, or if bridge snapshot output independently exposes
a provider session id. If so, run the same corrected prototype probe as the
previous Operator card with explicit `--codex-home /Users/Michael/.codex` and
report the resulting `codex_adapter` summary.

If no separate rollout materializes, skip the prototype and classify as
`partial_pass:no_transcript_materialized`.

## Stop Conditions

- Stop as `human_needed` on TCC/input-tap readiness blockers after running the
  reset helper.
- Stop as `blocked` if the accepted ref is not checked out, the bridge cannot
  start after one port retry, or Codex launch requires credentials/auth repair.
- Stop as `partial_pass:no_transcript_materialized` if Codex visibly launches
  but no separate rollout transcript appears after the bounded submitted prompt.
- Stop as `partial_pass:input_not_submitted` if the prompt cannot be submitted
  through `/input` plus one `/key Enter` attempt.
- Stop as `pass` if a separate rollout appears and the corrected prototype
  matches it with `codex_adapter.matched_cwd_basis=workspace_root` or reports a
  concrete provider-session match with Codex refs.

## Cleanup

Before reporting:

- stop the bridge process;
- verify the chosen port is no longer reachable;
- remove temporary packet, bridge visibility, snapshot, or output files created
  for this diagnostic;
- leave provider-owned Codex transcript/catalog files untouched;
- run `git status --short --branch`.

## Evidence To Return

- Branch, HEAD, durable alias SHA, and after-state
  `git status --short --branch`.
- Exact commands run and pass/fail results.
- Bridge port, health summary, ensure result, `launch_observed_at`, and driver.
- Initial and post-input snapshot summaries: enough to know whether the prompt
  was accepted, submitted, or responded to.
- Process evidence: likely nested Codex PID/PPID/cwd/command, or why it could
  not be identified.
- Baseline and post-prompt metadata inventory summaries.
- Whether a separate bridge-launched rollout transcript materialized.
- If a rollout materialized: session id, cwd, timestamp, marker grep result,
  and prototype `codex_adapter` summary.
- Cleanup proof.
- Confirmation of no source/docs/provider-config/gateway/dock-profile/hook,
  GitHub, push, or PR changes, with provider-owned Codex transcript/catalog
  creation called out separately.
