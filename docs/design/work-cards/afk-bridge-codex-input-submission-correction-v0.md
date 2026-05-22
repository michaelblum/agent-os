# AFK Bridge Codex Input Submission Correction V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: make bridge-driven prompt submission into a
  process-driver Codex TUI observable and reliable enough for the next Operator
  transcript-materialization proof, or return a deterministic classification
  that explains why Codex input cannot be submitted through the current bridge.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-diagnosis-v0.md`
  - `docs/design/work-cards/operator-afk-codex-workspace-root-live-correlation-v0.md`
  - `docs/design/work-cards/afk-codex-workspace-root-correlation-correction-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create or reuse a scoped local output branch from
  `docs/durable-agent-cognition-v0`. A suitable branch name is
  `gdi/afk-bridge-codex-input-submission-correction-v0`. Keep the checkpoint
  local; do not push, open a PR, mutate GitHub, or publish externally.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider sessions, Codex threads, bridge state, terminal dimensions, TUI state,
or prior implementation state. Read and rediscover before editing.

## Goal

Correct or instrument the Sigil codex-terminal bridge so a supervised
bridge-launched `codex --no-alt-screen` process can receive and submit exactly
one bounded prompt through the bridge API, with enough deterministic evidence to
distinguish these cases:

- generic process-driver `/input` delivery works;
- Codex TUI is not ready for text entry yet;
- text is typed but not submitted;
- text is submitted but not visible in captured snapshots;
- Codex accepts the prompt and a rollout transcript may materialize.

This is a bridge/input submission correction before another live Operator proof.
Do not launch real Codex, Claude, Gemini, Sigil, gateway, or other providers in
this GDI round.

## Triggering Evidence

Operator ran the transcript-materialization diagnostic on 2026-05-22:

- branch/ref gate passed at
  `cacc51733c9ff146e9d1381be47f4c45f665e021`;
- `./aos ready` passed with `ready=true mode=repo daemon=reachable tap=active`;
- process driver bridge on port `17866` launched `codex --no-alt-screen` from
  `/Users/Michael/Code/agent-os/.docks/gdi`;
- process evidence showed `pty-proxy.py`, `node .../bin/codex --no-alt-screen`,
  and the native Codex binary all running under `.docks/gdi`;
- `/input` returned HTTP 200 `{"ok":true}`;
- one `/key Enter` returned HTTP 200 `{"ok":true}`;
- snapshots before and after input still showed only startup/TUI tip output,
  not the prompt or a model response;
- no separate bridge-launched `.docks/gdi` Codex rollout transcript
  materialized.

Foreman then ran a provider-free bridge smoke using the same process driver and
a harmless stdin echo command. `/input` delivered `foreman-marker` into the PTY
and `/snapshot` showed `got:foreman-marker`. Treat that as evidence that the
generic process-driver stdin pipe can work; the unresolved gap is Codex TUI
readiness/submission behavior or the bridge's ability to observe it.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/operator-afk-bridge-codex-transcript-materialization-diagnosis-v0.md`
- `docs/design/work-cards/operator-afk-codex-workspace-root-live-correlation-v0.md`
- `docs/design/work-cards/afk-codex-workspace-root-correlation-correction-v0.md`
- `docs/design/work-cards/afk-terminal-substrate-no-provider-validation-v0.md`
- `docs/design/work-cards/afk-bridge-launch-visibility-fixture-v0.md`
- `apps/sigil/codex-terminal/server.mjs`
- `apps/sigil/codex-terminal/pty-proxy.py`
- `tests/sigil-agent-terminal-server.test.mjs`
- `tests/afk-terminal-substrate-no-provider.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`

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

If a later bounded live check is explicitly routed and repo-mode TCC or
input-tap readiness blocks, use:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns, run:
`./aos ready --post-permission`.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `cacc51733c9ff146e9d1381be47f4c45f665e021`
- expected output branch:
  `gdi/afk-bridge-codex-input-submission-correction-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `apps/sigil/codex-terminal/server.mjs` - owns `/ensure`, `/snapshot`,
  `/input`, `/key`, process-driver sessions, WebSocket terminal input, and
  process-driver buffer capture.
- `apps/sigil/codex-terminal/pty-proxy.py` - owns stdio-to-PTY forwarding and
  current PTY defaults for provider commands.
- `tests/sigil-agent-terminal-server.test.mjs` - existing process-driver server
  fixture coverage; currently covers catalog and `/ensure`, but not a focused
  `/input` or `/key` delivery contract.
- `tests/afk-terminal-substrate-no-provider.test.mjs` - provider-free bridge
  substrate test pattern.
- `scripts/afk-launch-attempt-prototype.mjs` and
  `tests/afk-launch-attempt-prototype.test.mjs` - inspect only if the
  correction needs record fields that describe input submission state.

## Required Behavior

Add the smallest source/test correction that makes bridge input submission
diagnosable and reliable for a process-driver terminal:

- Add deterministic coverage proving `/input` writes text plus Enter to a
  running process-driver PTY and that `/key Enter` sends Enter to the same PTY.
- Preserve existing `/input` behavior for tmux sessions and WebSocket terminal
  clients.
- If the existing process-driver implementation is correct for generic PTYs,
  keep the source change narrow and add explicit bridge diagnostics or response
  fields only where useful, such as whether a process session existed, whether
  the write was accepted by Node, and whether Enter was sent.
- If the likely Codex failure is readiness/timing, add or expose a bounded
  readiness signal from `/snapshot` or a helper that can wait for a stable input
  prompt before `/input` is sent. Do not hard-code Codex transcript content.
- If terminal dimensions, TTY mode, bracketed paste, carriage return vs
  newline, or another PTY detail is the likely cause, fix it at the generic
  bridge/PTY boundary and cover it with a provider-free fixture.
- Do not make cwd-only or transcript-only correlation looser as part of this
  correction. The Codex adapter work is already accepted; this card is about
  submitting and observing bridge input.

The next Operator run should be able to tell whether the prompt was not sent,
was sent but not submitted, was submitted but no rollout appeared, or succeeded
with a separate rollout transcript.

## Scope

This slice is limited to the Sigil codex-terminal bridge, its PTY proxy if
needed, and deterministic tests around process-driver input and key delivery.
Small AFK prototype status-field updates are allowed only if they are necessary
to preserve the new evidence shape.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, Sigil, gateway, or any provider.
- Do not read, write, delete, or depend on real provider transcripts under the
  user's home directory.
- Do not mutate provider config, gateway state, dock profiles, `.docks` role
  instructions, hooks, GitHub state, push, or PRs.
- Do not add public `./aos` commands, scheduler behavior, gateway routes,
  broker integration, result-route delivery, schemas, or committed generated
  receipts.
- Do not weaken the accepted Codex adapter cwd/time/provider-session safeguards.
- Do not require tmux or a live AOS display for deterministic tests.

## Verification

Required:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
git diff --check
./aos dev recommend --json
```

If you change `scripts/afk-launch-attempt-prototype.mjs`, also run:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
```

If you change TypeScript host code, run the focused host tests recommended by
`./aos dev recommend --json` and report exact pass/fail results.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- whether source behavior changed or this was test/docs/diagnostics only;
- the input/key delivery states now covered deterministically;
- exact verification commands and results;
- confirmation that no live provider, real provider transcript, provider
  config, gateway state, dock profile, hook, GitHub state, push, or PR changed;
- whether the next appropriate step is another Operator live
  transcript-materialization run;
- local-only state or blockers.
