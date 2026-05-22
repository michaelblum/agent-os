# AFK Bridge Codex PTY Observability Correction V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: make the process-driver bridge prove, with deterministic
  tests, whether accepted `/input` bytes are forwarded through `pty-proxy.py`
  into a raw/full-screen PTY process and whether that process can render or
  acknowledge submitted input. Fix the smallest bridge/PTY gap found.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-rerun-v0.md`
  - `docs/design/work-cards/afk-bridge-codex-input-submission-correction-v0.md`
  - `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-diagnosis-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create or reuse a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `gdi/afk-bridge-codex-pty-observability-correction-v0`. Keep the checkpoint
  local; do not push, open a PR, mutate GitHub, or publish externally.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider sessions, Codex threads, bridge state, terminal dimensions, raw-mode
behavior, or prior implementation state. Read and rediscover before editing.

## Goal

Close the remaining process-driver evidence gap for bridge-launched Codex: the
server accepted `/input` writes, but Codex snapshots never showed typed text,
submission, response, or a separate rollout transcript. Add deterministic
raw/full-screen PTY coverage and the smallest bridge instrumentation or fix
needed so the next Operator run can distinguish:

- server accepted bytes but `pty-proxy.py` did not forward them;
- `pty-proxy.py` forwarded bytes but the child TUI did not read/render them;
- terminal size/raw-mode/control-sequence behavior prevents observable input;
- the TUI received and submitted input, but no transcript materialized.

Do not launch real Codex, Claude, Gemini, Sigil, gateway, or other providers in
this GDI round.

## Triggering Evidence

Accepted correction `63301abec6e6affb7ed793085f55dd4a6c2eff84` changed the
process-driver bridge to:

- report `/input` diagnostics for session existence, text byte count, Node
  stdin write acceptance, Enter sent, Enter byte count, and Enter write
  acceptance;
- report `/key` diagnostics for key byte count and write acceptance;
- send PTY carriage return for process-driver Enter;
- cover simple line-oriented PTY submission deterministically.

Operator then reran the live transcript-materialization proof:

- bridge launched `codex --no-alt-screen` from `.docks/gdi`;
- process tree showed `pty-proxy.py`, `node .../bin/codex --no-alt-screen`,
  and native Codex all under `.docks/gdi`;
- `/input` returned:

```json
{"ok":true,"driver":"process","session_exists":true,"text_bytes":168,"text_accepted":true,"enter_sent":true,"enter_bytes":1,"enter_accepted":true}
```

- snapshots after the accepted input write never showed typed text, submission,
  response, or marker;
- no separate `.docks/gdi` Codex rollout materialized.

This narrows the unresolved gap below the Node HTTP handler but above successful
provider transcript creation. Do not change the accepted Codex adapter
correlation rules in this slice.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-rerun-v0.md`
- `docs/design/work-cards/afk-bridge-codex-input-submission-correction-v0.md`
- `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-diagnosis-v0.md`
- `apps/sigil/codex-terminal/server.mjs`
- `apps/sigil/codex-terminal/pty-proxy.py`
- `apps/sigil/codex-terminal/index.html`
- `tests/sigil-agent-terminal-server.test.mjs`
- `tests/afk-terminal-substrate-no-provider.test.mjs`

If local Codex source exists under
`.aos-test-tmp/codex-source-check/codex/`, inspect only the relevant TUI input
handling files read-only. Do not depend on that checkout for tests.

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD docs/durable-agent-cognition-v0
./aos dev recommend --json
```

This is deterministic implementation work. Do not run live provider checks. If
live AOS readiness somehow becomes necessary, stop and explain why before
running it.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `9f7925b75bcdd2cc953c3518c339970cb2633e9a`
- expected output branch:
  `gdi/afk-bridge-codex-pty-observability-correction-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `apps/sigil/codex-terminal/server.mjs` - process-driver session lifecycle,
  input/key writes, WebSocket attach path, resize control handling, and
  `/snapshot` buffer capture.
- `apps/sigil/codex-terminal/pty-proxy.py` - stdio-to-PTY forwarding. It
  currently opens a PTY, starts the command attached to the slave fd, forwards
  stdin bytes to the master fd, and forwards master output to stdout.
- `apps/sigil/codex-terminal/index.html` - WebSocket terminal path sends resize
  control frames; compare this path with process-driver sessions that are
  controlled only through HTTP endpoints.
- `tests/sigil-agent-terminal-server.test.mjs` - existing process-driver server
  coverage and the new line-oriented `/input` and `/key` assertions.
- `tests/afk-terminal-substrate-no-provider.test.mjs` - provider-free bridge
  substrate pattern.

## Required Behavior

Add the smallest deterministic source/test correction that proves the bridge
behavior relevant to raw/full-screen TUIs:

- Cover a provider-free raw-mode or full-screen-ish PTY fixture, not only a
  line-oriented echo process. The fixture should disable normal terminal echo
  or otherwise mimic a TUI that only renders when it receives input events.
- Prove whether `/input` plus Enter reaches the child process through
  `pty-proxy.py`, and whether `/key Enter` does the same when text was sent
  with `enter:false`.
- If `pty-proxy.py` needs terminal size initialization, resize support, raw
  mode handling, or better forwarding/flush behavior, implement it generically
  and cover it with the provider-free fixture.
- If the server needs a process-driver `/resize`, `/terminal-state`,
  `/input-diagnostics`, or other bounded diagnostic endpoint/field to avoid
  another ambiguous Operator result, add the narrowest useful shape and cover
  it.
- Preserve tmux behavior and WebSocket terminal behavior. If process-driver
  resize handling diverges from the existing WebSocket control-frame path,
  document why in code or tests.
- Preserve the accepted simple line-oriented `/input` and `/key` tests.
- Do not hard-code Codex transcript content or weaken Codex adapter
  cwd/time/provider-session safeguards.

The next Operator run should be able to classify an accepted write more
precisely than `input_accepted_not_observed`, ideally by knowing whether bytes
crossed the proxy boundary, whether the child TUI acknowledged them, and what
terminal geometry/control path was active.

## Scope

This slice is limited to the Sigil codex-terminal process driver,
`pty-proxy.py`, and deterministic tests around raw/full-screen PTY input and
observation. Small bridge response-field additions are allowed when they make
the next live evidence unambiguous.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, Sigil, gateway, or any provider.
- Do not read, write, delete, or depend on real provider transcripts under the
  user's home directory.
- Do not mutate provider config, gateway state, dock profiles, `.docks` role
  instructions, hooks, GitHub state, push, or PRs.
- Do not add public `./aos` commands, scheduler behavior, gateway routes,
  broker integration, result-route delivery, schemas, or committed generated
  receipts.
- Do not weaken accepted Codex adapter correlation rules.
- Do not require tmux or a live AOS display for deterministic tests.

## Verification

Required:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
git diff --check
./aos dev recommend --json --files apps/sigil/codex-terminal/server.mjs apps/sigil/codex-terminal/pty-proxy.py tests/sigil-agent-terminal-server.test.mjs
```

If you change only a subset of those files, still run the focused bridge tests.
If `./aos dev recommend --json` names additional focused checks for changed
files, run them or explain why they are branch-level inherited checks.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- whether source behavior changed or this was test/diagnostics only;
- what raw/full-screen PTY behavior is now covered deterministically;
- exact verification commands and results;
- confirmation that no live provider, real provider transcript, provider
  config, gateway state, dock profile, hook, GitHub state, push, or PR changed;
- whether the next appropriate step is another Operator live
  transcript-materialization run;
- local-only state or blockers.
