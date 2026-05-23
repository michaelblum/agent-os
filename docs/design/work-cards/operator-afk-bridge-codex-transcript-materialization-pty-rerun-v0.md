# Operator AFK Bridge Codex Transcript Materialization PTY Rerun V0

**Status:** Pass accepted 2026-05-22

## Result

- Classification: `pass`.
- Foreman review: accepted. The branch/ref gate passed with `HEAD` and
  `docs/durable-agent-cognition-v0` both at
  `4814cdcfdd065ed107a20df656164ae89ae10440`, the repo worktree remained
  clean, `./aos ready` passed, and Operator reported all required focused tests
  passing.
- Bridge evidence: process-driver bridge ran on port `17866` with
  `defaultCwd=/Users/Michael/Code/agent-os/.docks/gdi`, `driver=process`, and
  terminal geometry `80x24`; `/ensure` created session
  `afk-codex-transcript-materialization-pty-rerun` for
  `codex --no-alt-screen`; `launch_observed_at=2026-05-22T18:51:34Z`.
- PTY evidence: `/resize` to `100x31` returned `resize_accepted=true`, and the
  post-resize snapshot reported terminal geometry `100x31`.
- Input evidence: `/input` returned accepted process-driver diagnostics:
  `session_exists=true`, `text_bytes=172`, `text_accepted=true`,
  `enter_sent=true`, `enter_bytes=1`, and `enter_accepted=true`. The immediate
  and short-wait snapshots showed the prompt typed but not submitted; one
  allowed `/key Enter` returned `key_accepted=true`.
- Snapshot evidence: the final snapshot showed submission and the bounded model
  response marker:
  `live-codex-transcript-materialization-pty-rerun`.
- Transcript evidence: a separate bridge-launched Codex rollout materialized at
  `/Users/Michael/.codex/sessions/2026/05/22/rollout-2026-05-22T14-51-35-019e5107-5456-7f22-b08b-b977df1b35f4.jsonl`.
  Foreman corroborated the file metadata and `session_meta` fields:
  `id=019e5107-5456-7f22-b08b-b977df1b35f4`,
  `timestamp=2026-05-22T18:51:35.420Z`, and
  `cwd=/Users/Michael/Code/agent-os/.docks/gdi`; a bounded grep found the
  submitted marker.
- Prototype evidence: the corrected launch-attempt prototype, run with
  `--codex-home /Users/Michael/.codex`, `--launch-observed-at
  2026-05-22T18:51:34Z`, and provider session id
  `019e5107-5456-7f22-b08b-b977df1b35f4`, reported
  `codex_adapter.status=observed`,
  `correlation_status=matched_by_provider_session_id`, `confidence=exact`,
  `matched_thread_ref=codex-thread:019e5107-5456-7f22-b08b-b977df1b35f4`,
  `matched_deeplink=codex://threads/019e5107-5456-7f22-b08b-b977df1b35f4`,
  and `matched_cwd_basis=intended_launch_cwd`.
- Cleanup proof: Foreman confirmed port `17866` had no listener and no matching
  `codex --no-alt-screen` or `pty-proxy.py` processes remained after Operator
  stopped the bridge. Operator reported temporary prototype packet/output
  cleanup complete.
- Local-only boundary confirmed: no source, docs, config, provider config,
  gateway state, dock profile, hook, GitHub state, push, or PR changes were
  made by Operator. Provider-owned Codex transcript/catalog files were created
  and read only as allowed evidence for this supervised diagnostic.
- Next routed slice:
  `docs/design/work-cards/afk-launch-attempt-live-codex-record-v0.md`.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: rerun the bridge-launched nested
  `codex --no-alt-screen` transcript-materialization proof after the accepted
  PTY geometry/control/input correction, and determine whether the corrected
  process-driver PTY now lets a bounded prompt submit, respond, and create a
  separate Codex rollout transcript.
- Source artifacts:
  - `docs/design/work-cards/afk-bridge-codex-pty-observability-correction-v0.md`
  - `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-rerun-v0.md`
  - `docs/design/work-cards/afk-bridge-codex-input-submission-correction-v0.md`
  - `docs/design/work-cards/afk-codex-workspace-root-correlation-correction-v0.md`
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
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
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
SIGIL_AGENT_TMUX_SESSION=afk-codex-transcript-materialization-pty-rerun \
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

- session: `afk-codex-transcript-materialization-pty-rerun`
- cwd: `/Users/Michael/Code/agent-os/.docks/gdi`
- command: `codex --no-alt-screen`
- force: `true`

Record `launch_observed_at` as an ISO timestamp when `/ensure` returns or when
the provider visibly starts. Capture an initial `/snapshot`, including its
`terminal` geometry.

Before sending the prompt, send one bounded process-driver resize through
`/resize`:

```json
{"session":"afk-codex-transcript-materialization-pty-rerun","cols":100,"rows":31}
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
Status check only. Reply with exactly: live-codex-transcript-materialization-pty-rerun cwd=<cwd> session=<session id if visible, otherwise not_observed>. Do not edit files.
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
  `live-codex-transcript-materialization-pty-rerun`

Do not paste full transcript content.

## Prototype Probe

Only run the prototype if a new or modified rollout file appears that is not
the Operator session itself, or if bridge snapshot output independently exposes
a provider session id. If so, run the corrected prototype probe with explicit
`--codex-home /Users/Michael/.codex` and report the resulting `codex_adapter`
summary.

If no separate rollout materializes, skip the prototype and classify as the
most specific partial result from the stop conditions below.

## Stop Conditions

- Stop as `human_needed` on TCC/input-tap readiness blockers after running the
  reset helper.
- Stop as `blocked` if the accepted ref is not checked out, the bridge cannot
  start after one port retry, Codex launch requires credentials/auth repair, or
  `/resize` fails before input submission.
- Stop as `partial_pass:input_write_not_accepted` if `/input` or `/key` returns
  a process-driver diagnostic showing the write was not accepted.
- Stop as `partial_pass:input_accepted_not_observed` if `/resize` and `/input`
  report accepted process-driver writes but snapshots never show typed text,
  submission, or response.
- Stop as `partial_pass:input_not_submitted` if the prompt appears typed but
  cannot be submitted through `/input` plus one `/key Enter` attempt.
- Stop as `partial_pass:no_transcript_materialized` if the prompt appears
  submitted or receives a response but no separate rollout transcript appears.
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
  and prototype `codex_adapter` summary.
- Cleanup proof.
- Confirmation of no source/docs/provider-config/gateway/dock-profile/hook,
  GitHub, push, or PR changes, with provider-owned Codex transcript/catalog
  creation called out separately.
