# Work Card: Operator AFK Warm Dock TUI Reuse Live Proof V0

**Status:** Blocked 2026-05-23

## Blocked Result

- Operator preflight reached the human-gated Implementer proof step.
- The requested Implementer prompt used a one-shot goal shape:
  `Warm TUI reuse live proof only. Reply with exactly: ...`.
- That prompt triggered a known Codex goal-mode repeated completion loop: Implementer repeatedly
  emitted `warm-implementer-tui-proof complete`, and the normal Implementer Stop hook spoke
  `Implementer finished.` after each repeated stop.
- The human interrupted the loop with Esc. Implementer should be cleaned up with
  clear the stale prompt state and then `/clear` before unrelated work.
- Foreman classification: blocked by invalid inbound message contract, not by
  warm TUI reuse implementation.
- Follow-up routed:
  `docs/design/work-cards/aos-dock-inbound-message-contract-v0.md`. The next
  Implementer slice must make dock/provider inbound message contracts AOS-owned and
  reject repeated-completion-prone one-shot goal prompts before they reach Implementer.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run
- Single next goal: collect a supervised live proof that the user's real
  long-lived dock-local Codex terminals can be reused with `/clear` as the
  provider conversation boundary, without cold Codex launch or bridge startup.
- Source artifacts:
  - `docs/design/work-cards/afk-warm-dock-tui-reuse-contract-v0.md`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `packages/host/src/codex-thread-adapter.ts`
- Required start ref:
  `implementer/afk-warm-dock-tui-reuse-contract-v0` at or after
  `0d826e0860bff02dbf7dcb2c1f7d550a7750433c`.
- Output expectation: no source/docs/config/GitHub mutations. Return a concise
  live proof report to Foreman.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
terminal state, Codex metadata state, previous session id, or prior live proof.
Read and rediscover before acting.

## Live Surface

The target runtime is the user's existing local terminals:

- Operator terminal: cwd `the operator native subagent`, existing Codex CLI process.
- Implementer terminal: cwd `the implementer native subagent`, existing Codex CLI process.

The human is supervising and can type into the real terminals. Do not launch a
new Codex process, do not run `codex --no-alt-screen`, do not start the Sigil
codex-terminal bridge, and do not drive Terminal.app automation in this proof.

## Setup And Preflight

Run from repo root:

```bash
git status --short --branch
git rev-parse HEAD 0d826e0860bff02dbf7dcb2c1f7d550a7750433c
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test packages/host/test/codex-thread-adapter.test.ts
git diff --check
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, stop and report `manual_intervention` with the exact
blocker. Do not run permission repair loops from Operator unless Foreman
explicitly routes that.

## Metadata Snapshot Rules

You may inspect Codex metadata files for `session_meta` records only. Do not
read or quote provider transcript bodies or user/assistant message content.

Before asking the human to touch Implementer, collect metadata-only baselines for:

- latest Codex session metadata with cwd ending `the operator native subagent`;
- latest Codex session metadata with cwd ending `the implementer native subagent`;
- process list evidence for existing Codex/TUI processes and absence of
  `codex --no-alt-screen`, `server.mjs`, and `pty-proxy.py` launched for this
  proof.

Suggested local inspection approach:

```bash
find "$HOME/.codex/sessions" -name 'rollout-*.jsonl' -type f -print0 |
  xargs -0 stat -f '%m %N' |
  sort -nr |
  head -40
```

Use a small Node/Python/Ruby one-liner only if helpful to parse the first
`session_meta` object from candidate JSONL files. Do not dump transcript lines.

## Human-Gated Live Steps

### Operator Terminal

This Operator session should have been started by the human in the existing
Operator terminal with:

```text
/clear
<Foreman clipboard payload>
```

Record whether that was the actual start path. Then verify metadata-only
evidence that a Codex session for cwd `the operator native subagent` exists after the
Operator dispatch time and is different from the most recent pre-dispatch
Operator session when one is visible.

### Implementer Terminal

Ask the human to perform this exact bounded action in the existing Implementer terminal:

```text
/clear
Warm TUI reuse live proof only. Reply with exactly: warm-implementer-tui-proof complete. Do not edit files, run commands, read transcripts, or mutate state.
```

The important transport evidence is:

- `/clear` was submitted before the Implementer dispatch;
- the Implementer dispatch started with  plus one space;
- no new Codex CLI process or bridge process was launched for the proof;
- metadata-only evidence shows a Codex session for cwd `the implementer native subagent` after the
  Implementer dispatch time;
- that post-reset Implementer session id differs from the latest visible pre-dispatch
  Implementer session id when one is visible.

Do not ask Implementer to implement, review, commit, run tests, or inspect source. This
is a live transport proof only.

## Required Evidence To Report

Return a concise report with:

- branch/head and whether the worktree stayed clean;
- preflight command results and pass/fail counts;
- whether Operator was started through existing terminal `/clear` plus plain
  Foreman payload;
- Operator metadata proof: previous visible session id, new session id, cwd,
  metadata file path, mtime, and whether the id changed;
- whether the Implementer human step used `/clear` then ;
- Implementer metadata proof: previous visible session id, new session id, cwd,
  metadata file path, mtime, and whether the id changed;
- process comparison summary showing no proof-owned `codex --no-alt-screen`,
  Sigil bridge `server.mjs`, or `pty-proxy.py` process remained or was started;
- whether any transcript body was read. Expected: no;
- whether any source/docs/config/provider/GitHub/runtime mutation occurred.
  Expected: no.

## Acceptance Criteria

- Operator and Implementer both show a metadata-backed post-`/clear` Codex session for
  the correct dock cwd.
- Implementer dispatch shape is  plus the proof payload.
- Operator dispatch shape is plain Foreman payload after `/clear`.
- At least Implementer has a visible prior session id and a different post-reset session
  id. If Operator's prior id cannot be reconstructed because this card arrived
  after `/clear`, state that limitation explicitly but still report the new
  Operator session metadata.
- No cold provider launch, bridge server, pty proxy, unsupervised trigger,
  transcript body read, provider store/catalog/telemetry mutation, gateway/dock
  runtime mutation, source/docs/config mutation, GitHub mutation, PR creation,
  or main merge occurs.

## Stop Conditions

- The human does not want to send `/clear` in either terminal.
- Codex metadata cannot be found or safely parsed without reading transcript
  bodies.
- The Implementer terminal is not an existing warm dock-local Codex process.
- A TCC/input readiness blocker prevents bounded verification.
- Any step would require launching a new provider process, starting the bridge,
  mutating provider configs, or reading provider transcript bodies.

Stop with `manual_intervention` or `blocked` and report the exact blocker.
