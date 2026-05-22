# Operator AFK Launch Attempt Live Codex Record Rerun V0

**Status:** Pass accepted 2026-05-22

## Result

- Classification: `pass`.
- Foreman review: accepted. The branch/ref gate passed with `HEAD` and
  `docs/durable-agent-cognition-v0` both at
  `08930f878efe9570d869b5f0e9c0f1483c005249`, the repo worktree remained
  clean, `./aos ready` passed, and Operator reported all required focused tests
  passing.
- Bridge evidence: process-driver bridge ran on port `17866` with
  `defaultCwd=/Users/Michael/Code/agent-os/.docks/gdi`, `driver=process`, and
  terminal geometry `80x24`; `/ensure` created process session
  `afk-launch-attempt-live-codex-record-rerun` for `codex --no-alt-screen`;
  `launch_observed_at=2026-05-22T19:18:09.000Z`.
- PTY/input evidence: `/resize` to `100x31` was accepted; `/input` accepted
  text and Enter but left the prompt in the input box; one allowed `/key Enter`
  was accepted and submitted the prompt.
- Snapshot evidence: the response marker was observed:
  `live-codex-launch-attempt-record-rerun`.
- Transcript evidence: a separate bridge-launched Codex rollout materialized at
  `/Users/Michael/.codex/sessions/2026/05/22/rollout-2026-05-22T15-18-10-019e511f-aa65-78e0-a12b-5527f9e5d559.jsonl`.
  Foreman corroborated the file metadata and `session_meta` fields:
  `id=019e511f-aa65-78e0-a12b-5527f9e5d559`,
  `timestamp=2026-05-22T19:18:10.311Z`, and
  `cwd=/Users/Michael/Code/agent-os/.docks/gdi`; a bounded grep found the
  submitted marker.
- Stabilized prototype evidence: the live evidence produced a launch-attempt
  record with `provider_launch_performed=true`,
  `lifecycle_state=provider_session_observed`, terminal geometry `100x31`,
  accepted resize/input/extra Enter, response marker observed,
  `provider_acceptance.status=provider_session_observed`,
  provider session id `019e511f-aa65-78e0-a12b-5527f9e5d559`,
  `codex_adapter.status=observed`,
  `correlation_status=matched_by_provider_session_id`, `confidence=exact`,
  `matched_thread_ref=codex-thread:019e511f-aa65-78e0-a12b-5527f9e5d559`,
  `matched_deeplink=codex://threads/019e511f-aa65-78e0-a12b-5527f9e5d559`,
  `matched_cwd_basis=intended_launch_cwd`, catalog and telemetry
  `not_observed`, result route `not_attempted`, and no mismatches.
- Cleanup proof: Foreman confirmed port `17866` had no listener and no matching
  `codex --no-alt-screen` or `pty-proxy.py` processes remained after Operator
  stopped the bridge. Operator reported temporary diagnostic files cleaned up.
- Local-only boundary confirmed: no source, docs, config, provider config,
  gateway state, dock profile, hook, GitHub state, push, or PR changes were
  made by Operator. Provider-owned Codex transcript/catalog files were created
  and read only as allowed evidence for this supervised diagnostic.
- Next routed slice:
  `docs/design/work-cards/afk-dev-launch-attempt-command-v0.md`.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: rerun one bridge-launched nested
  `codex --no-alt-screen` proof and then run the stabilized
  `afk-launch-attempt-prototype.mjs` against the live evidence to confirm the
  accepted fixture-backed record shape holds outside deterministic fixtures.
- Source artifacts:
  - `docs/design/work-cards/afk-launch-attempt-live-codex-record-v0.md`
  - `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-pty-rerun-v0.md`
  - `docs/design/work-cards/afk-bridge-codex-pty-observability-correction-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Expected branch/output: stay local on the current worktree/branch. Make no
  source, docs, config, provider config, gateway, dock profile, hook, GitHub,
  push, or PR changes. Return a Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be created by the
supervised launch and read for diagnosis. Do not edit, delete, move, or clean
up provider-owned Codex files.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos ready
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
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
SIGIL_AGENT_TMUX_SESSION=afk-launch-attempt-live-codex-record-rerun \
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
- `terminal`: the process-driver default geometry, expected `80x24` unless
  environment overrides are present

Use `/ensure` for:

- session: `afk-launch-attempt-live-codex-record-rerun`
- cwd: `/Users/Michael/Code/agent-os/.docks/gdi`
- command: `codex --no-alt-screen`
- force: `true`

Record `launch_observed_at` as an ISO timestamp when `/ensure` returns or when
the provider visibly starts. Capture an initial `/snapshot`, including its
`terminal` geometry.

Before sending the prompt, send one bounded process-driver resize through
`/resize`:

```json
{"session":"afk-launch-attempt-live-codex-record-rerun","cols":100,"rows":31}
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
Status check only. Reply with exactly: live-codex-launch-attempt-record-rerun cwd=<cwd> session=<session id if visible, otherwise not_observed>. Do not edit files.
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
  `live-codex-launch-attempt-record-rerun`

Do not paste full transcript content.

## Stabilized Prototype Probe

Only run this section if a new or modified rollout file appears that is not the
Operator session itself, or if bridge snapshot output independently exposes a
provider session id.

Create temporary packet and bridge-visibility fixture files outside the repo,
modeling the live evidence collected above:

- packet source artifact:
  `docs/design/work-cards/operator-afk-launch-attempt-live-codex-record-rerun-v0.md`
- packet required start ref: `docs/durable-agent-cognition-v0`
- bridge health, ensure, resize, input, optional key, typed/submitted
  observation, final snapshot text, response marker, and
  `supervised_live: true`
- provider session id from the new rollout `session_meta.payload.id` or a
  bridge-observed provider session id

Run:

```bash
node scripts/afk-launch-attempt-prototype.mjs \
  --packet <temp-packet.json> \
  --provider codex \
  --dock gdi \
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
- catalog/telemetry remain `not_observed` unless the prototype fixture
  explicitly supplies catalog/telemetry facts
- result route remains `not_attempted`
- no mismatch codes on the happy path

## Stop Conditions

- Stop as `human_needed` on TCC/input-tap readiness blockers after running the
  reset helper.
- Stop as `blocked` if the accepted ref is not checked out, the bridge cannot
  start after one port retry, Codex launch requires credentials/auth repair, or
  `/resize` fails before input submission.
- Stop as `partial_pass:input_write_not_accepted` if `/input` or `/key` returns
  a process-driver diagnostic showing the write was not accepted.
- Stop as `partial_pass:input_not_submitted` if the prompt appears typed but
  cannot be submitted through `/input` plus one `/key Enter` attempt.
- Stop as `partial_pass:no_transcript_materialized` if the prompt appears
  submitted or receives a response but no separate rollout transcript appears.
- Stop as `partial_pass:prototype_mismatch` if a separate rollout materializes
  but the stabilized prototype does not report a concrete provider-session
  match and a non-failed `provider_session_observed` launch-attempt record.
- Stop as `pass` if a separate rollout appears and the stabilized prototype
  emits the expected live record summary.

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
  and stabilized prototype record summary.
- Cleanup proof.
- Confirmation of no source/docs/provider-config/gateway/dock-profile/hook,
  GitHub, push, or PR changes, with provider-owned Codex transcript/catalog
  creation called out separately.
