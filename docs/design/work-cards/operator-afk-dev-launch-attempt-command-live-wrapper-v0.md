# Operator AFK Dev Launch Attempt Command Live Wrapper V0

**Status:** Pass accepted 2026-05-22

## Result

- Classification: `pass`.
- Foreman review: accepted. Branch/ref gates passed with `HEAD` and
  `docs/durable-agent-cognition-v0` both at
  `5195fc0d7e4f53db2bf038a6cbf4923127618aea`, the repo worktree stayed clean,
  `./aos ready` reported `ready=true mode=repo daemon=reachable tap=active`,
  and the bridge cleanup checks found port `17866` unreachable with no matching
  nested `codex --no-alt-screen`, `pty-proxy.py`, or bridge server process
  remaining.
- Bridge evidence: process-driver bridge ran on port `17866` with
  `defaultCwd=/Users/Michael/Code/agent-os/the implementer native subagent`, `driver=process`, and
  terminal geometry `80x24`; `/ensure` created process session
  `afk-dev-launch-attempt-command-live-wrapper`; `launch_observed_at` was
  `2026-05-22T20:08:55Z`.
- Process evidence: nested process tree was observed as bridge server,
  `pty-proxy.py`, `node codex --no-alt-screen`, and vendor
  `codex --no-alt-screen`, all rooted at
  `/Users/Michael/Code/agent-os/the implementer native subagent`.
- PTY/input evidence: `/resize` to `100x31` was accepted; `/input` accepted
  text and Enter; one extra Enter was needed and accepted; the response marker
  `live-codex-dev-launch-attempt-command-wrapper` was observed in the
  post-key snapshot.
- Transcript evidence: a separate bridge-launched Codex rollout materialized at
  `/Users/Michael/.codex/sessions/2026/05/22/rollout-2026-05-22T16-08-57-019e514e-2824-7331-9efc-76e0fbede5a2.jsonl`.
  Foreman bounded verification confirmed size `66301`, mtime
  `2026-05-22T20:09:46.737Z`, session id
  `019e514e-2824-7331-9efc-76e0fbede5a2`, timestamp
  `2026-05-22T20:08:57.161Z`, cwd
  `/Users/Michael/Code/agent-os/the implementer native subagent`, and marker presence. Full
  transcript content was not pasted or mutated.
- Wrapper evidence: `./aos dev afk-launch-attempt` consumed the live bridge
  fixture plus read-only `/Users/Michael/.codex` correlation and emitted
  `provider_launch_performed=true`,
  `lifecycle_state=provider_session_observed`, terminal geometry `100x31`,
  accepted resize/input/extra Enter, response marker observed,
  `provider_acceptance.status=provider_session_observed`, provider session id
  `019e514e-2824-7331-9efc-76e0fbede5a2`,
  `codex_adapter.status=observed`,
  `correlation_status=matched_by_provider_session_id`, `confidence=exact`,
  `matched_thread_ref=codex-thread:019e514e-2824-7331-9efc-76e0fbede5a2`,
  `matched_deeplink=codex://threads/019e514e-2824-7331-9efc-76e0fbede5a2`,
  `matched_cwd_basis=intended_launch_cwd`, catalog and telemetry
  `not_observed`, result route `not_attempted`, and no mismatch codes.
- Cleanup proof: bridge process stopped, `http://127.0.0.1:17866/health` was
  unreachable, temporary packet/fixture/output files were removed, and
  provider-owned Codex rollout metadata was left untouched.
- Local-only boundary confirmed: no source, docs, config, provider config,
  gateway, dock profile, hook, GitHub, push, or PR changes were made by
  Operator. Provider-owned Codex transcript/catalog files were created and read
  only as allowed diagnostic evidence.
- Next routed slice:
  `docs/design/work-cards/afk-session-trigger-command-readiness-v0.md`.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one supervised bridge-launched nested Codex proof and
  feed the live evidence through experimental
  `./aos dev afk-launch-attempt`, proving the new dev wrapper preserves the
  accepted live launch-attempt record behavior.
- Source artifacts:
  - `docs/design/work-cards/afk-dev-launch-attempt-command-v0.md`
  - `docs/design/work-cards/operator-afk-launch-attempt-live-codex-record-rerun-v0.md`
  - `scripts/afk-launch-attempt-prototype.mjs`
- Required start ref: `docs/durable-agent-cognition-v0`
- Expected branch/output: stay local on
  `implementer/afk-dev-launch-attempt-command-v0` or the branch that contains this
  card. Make no source, docs, config, provider config, gateway, dock profile,
  hook, GitHub, push, or PR changes. Return a Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be created by the
supervised launch and read for diagnosis. Do not edit, delete, move, or clean
up provider-owned Codex files.

## Goal

Prove the accepted wrapper, not only the underlying Node prototype, can ingest
live supervised bridge evidence and emit the same happy-path
`provider_session_observed` summary:

```bash
./aos dev afk-launch-attempt \
  --packet <temp-packet.json> \
  --provider codex \
  --dock implementer \
  --json \
  --timestamp <post-response-iso> \
  --launch-observed-at <launch-observed-at> \
  --bridge-visibility-fixture <temp-bridge-visibility.json> \
  --codex-home /Users/Michael/.codex
```

The wrapper must not launch Codex directly. Codex launch in this run is the
supervised bridge action below, and the wrapper only consumes the resulting
diagnostic evidence.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
node --test tests/afk-launch-attempt-prototype.test.mjs
bash tests/dev-workflow-router.sh
```

Stop if the worktree is dirty or if `HEAD` and
`docs/durable-agent-cognition-v0` do not resolve to the same SHA.

If repo-mode TCC or input-tap readiness blocks, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns, run:

```bash
./aos ready --post-permission
```

Continue only if readiness reports `ready=true`.

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
SIGIL_AGENT_TMUX_SESSION=afk-dev-launch-attempt-command-live-wrapper \
SIGIL_AGENT_CWD=/Users/Michael/Code/agent-os/the implementer native subagent \
SIGIL_AGENT_COMMAND='codex --no-alt-screen' \
SIGIL_AGENT_TERMINAL_DRIVER=process \
node apps/sigil/codex-terminal/server.mjs
```

If the port is busy, use the next free port and report it. Do not retry more
than once for non-port failures.

Verify `/health` reports:

- `defaultCwd`: `/Users/Michael/Code/agent-os/the implementer native subagent`
- `driver`: `process`
- `terminal`: process-driver default geometry, expected `80x24` unless
  environment overrides are present

Use `/ensure` for:

- session: `afk-dev-launch-attempt-command-live-wrapper`
- cwd: `/Users/Michael/Code/agent-os/the implementer native subagent`
- command: `codex --no-alt-screen`
- force: `true`

Record `launch_observed_at` as an ISO timestamp when `/ensure` returns or when
the provider visibly starts. Capture an initial `/snapshot`, including its
terminal geometry.

Before sending the prompt, send one bounded process-driver resize through
`/resize`:

```json
{"session":"afk-dev-launch-attempt-command-live-wrapper","cols":100,"rows":31}
```

Capture the `/resize` response body and one post-resize `/snapshot`. Do not
retry resize unless the HTTP call fails due to a transient connection issue.

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
Status check only. Reply with exactly: live-codex-dev-launch-attempt-command-wrapper cwd=<cwd> session=<session id if visible, otherwise not_observed>. Do not edit files.
```

Capture the `/input` HTTP response status/body. It should include:

- `driver: process`
- `session_exists: true`
- `text_bytes`
- `text_accepted`
- `enter_sent`
- `enter_bytes`
- `enter_accepted`

Then capture:

- a snapshot immediately after send;
- a snapshot after a short wait;
- whether the prompt appears submitted, remains in an input box, receives a
  model response, or remains unobserved despite accepted bridge diagnostics.

If the prompt appears typed but not submitted, send one `/key` `Enter` and
capture the `/key` response plus one more snapshot. The process-driver path
should report `key: Enter`, `key_bytes`, and `key_accepted`. Do not send
additional prompts.

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
  `live-codex-dev-launch-attempt-command-wrapper`

Do not paste full transcript content.

## Wrapper Probe

Only run this section if a new or modified rollout file appears that is not the
Operator session itself, or if bridge snapshot output independently exposes a
provider session id.

Create temporary packet and bridge-visibility fixture files outside the repo,
modeling the live evidence collected above:

- packet source artifact:
  `docs/design/work-cards/operator-afk-dev-launch-attempt-command-live-wrapper-v0.md`
- packet required start ref: `docs/durable-agent-cognition-v0`
- bridge health, ensure, resize, input, optional key, typed/submitted
  observation, final snapshot text, response marker, and
  `supervised_live: true`
- provider session id from the new rollout `session_meta.payload.id` or a
  bridge-observed provider session id

Run the wrapper, not the Node script directly:

```bash
./aos dev afk-launch-attempt \
  --packet <temp-packet.json> \
  --provider codex \
  --dock implementer \
  --json \
  --timestamp <post-response-iso> \
  --launch-observed-at <launch_observed_at> \
  --bridge-visibility-fixture <temp-bridge-visibility.json> \
  --codex-home /Users/Michael/.codex \
  > <temp-output.json>
```

Report the resulting record summary:

- `launch_intent.provider_launch_performed`
- `lifecycle_state`
- `terminal_substrate.geometry`
- `terminal_substrate.resize`
- `terminal_substrate.input_submission`
- `provider_acceptance.status`
- `provider_acceptance.provider_session_id`
- `codex_adapter.status`
- `codex_adapter.correlation_status`
- `codex_adapter.confidence`
- `codex_adapter.matched_thread_id`
- `codex_adapter.matched_thread_ref`
- `codex_adapter.matched_deeplink`
- `codex_adapter.matched_cwd_basis`
- `catalog.status`
- `telemetry.status`
- `result_route.status`
- mismatch codes, if any

Expected happy path:

- `provider_launch_performed=true`
- `lifecycle_state=provider_session_observed`
- terminal geometry `100x31`
- resize accepted
- input accepted
- one optional extra Enter accepted only if needed
- response marker observed
- concrete provider session id
- Codex adapter `observed`, `matched_by_provider_session_id`, `exact`
- `matched_cwd_basis=intended_launch_cwd` or `workspace_root`
- catalog/telemetry remain `not_observed` unless the wrapper input supplies
  catalog/telemetry fixture facts
- result route remains `not_attempted`
- no mismatch codes on the happy path

## Stop Conditions

- Stop as `manual_intervention` on TCC/input-tap readiness blockers after running the
  reset helper.
- Stop as `blocked` if the accepted ref is not checked out, the bridge cannot
  start after one port retry, Codex launch requires credentials/auth repair, or
  `/resize` fails before input submission.
- Stop as `partial_pass:input_write_not_accepted` if `/input` or `/key`
  returns a process-driver diagnostic showing the write was not accepted.
- Stop as `partial_pass:input_not_submitted` if the prompt appears typed but
  cannot be submitted through `/input` plus one `/key Enter` attempt.
- Stop as `partial_pass:no_transcript_materialized` if the prompt appears
  submitted or receives a response but no separate rollout transcript appears.
- Stop as `partial_pass:wrapper_mismatch` if a separate rollout materializes
  but `./aos dev afk-launch-attempt` does not report a concrete
  provider-session match and a non-failed `provider_session_observed` record.
- Stop as `pass` if a separate rollout appears and the wrapper emits the
  expected live record summary.

## Cleanup

Before reporting:

- stop the bridge process;
- verify the chosen port is no longer reachable;
- remove temporary packet, bridge visibility, snapshot, or output files created
  for this diagnostic;
- leave provider-owned Codex transcript/catalog files untouched;
- run `git status --short --branch`.

## Evidence To Return

- Classification: `pass`, `partial_pass:<reason>`, `blocked`, or
  `manual_intervention`.
- Branch, HEAD, durable alias SHA, and after-state
  `git status --short --branch`.
- Exact commands run and pass/fail results.
- Bridge port, health summary including terminal geometry, ensure result,
  `/resize` result, `launch_observed_at`, and driver.
- `/input` and optional `/key` response bodies with process-driver diagnostics.
- Initial, post-resize, and post-input snapshot summaries: enough to know
  whether the prompt was accepted, typed, submitted, responded to, or
  unobserved.
- Process evidence: likely nested Codex PID/PPID/cwd/command, or why it could
  not be identified.
- Baseline and post-prompt metadata inventory summaries.
- Whether a separate bridge-launched rollout transcript materialized.
- If a rollout materialized: session id, cwd, timestamp, marker grep result,
  and wrapper-produced record summary.
- Cleanup proof.
- Confirmation of no source/docs/provider-config/gateway/dock-profile/hook,
  GitHub, push, or PR changes, with provider-owned Codex transcript/catalog
  creation called out separately.
