# Work Card: Operator AFK Warm Dock TUI Reuse Live Proof V0

**Status:** Routed 2026-05-23

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
  `gdi/afk-warm-dock-tui-reuse-contract-v0` at or after
  `0d826e0860bff02dbf7dcb2c1f7d550a7750433c`.
- Output expectation: no source/docs/config/GitHub mutations. Return a concise
  live proof report to Foreman.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
terminal state, Codex metadata state, previous session id, or prior live proof.
Read and rediscover before acting.

## Live Surface

The target runtime is the user's existing local terminals:

- Operator terminal: cwd `.docks/operator`, existing Codex CLI process.
- GDI terminal: cwd `.docks/gdi`, existing Codex CLI process.

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
inactive input-tap blocker, stop and report `human_needed` with the exact
blocker. Do not run permission repair loops from Operator unless Foreman
explicitly routes that.

## Metadata Snapshot Rules

You may inspect Codex metadata files for `session_meta` records only. Do not
read or quote provider transcript bodies or user/assistant message content.

Before asking the human to touch GDI, collect metadata-only baselines for:

- latest Codex session metadata with cwd ending `.docks/operator`;
- latest Codex session metadata with cwd ending `.docks/gdi`;
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
evidence that a Codex session for cwd `.docks/operator` exists after the
Operator dispatch time and is different from the most recent pre-dispatch
Operator session when one is visible.

### GDI Terminal

Ask the human to perform this exact bounded action in the existing GDI terminal:

```text
/clear
/goal Warm TUI reuse live proof only. Reply with exactly: warm-gdi-tui-proof complete. Do not edit files, run commands, read transcripts, or mutate state.
```

The important transport evidence is:

- `/clear` was submitted before the GDI dispatch;
- the GDI dispatch started with `/goal ` plus one space;
- no new Codex CLI process or bridge process was launched for the proof;
- metadata-only evidence shows a Codex session for cwd `.docks/gdi` after the
  GDI dispatch time;
- that post-reset GDI session id differs from the latest visible pre-dispatch
  GDI session id when one is visible.

Do not ask GDI to implement, review, commit, run tests, or inspect source. This
is a live transport proof only.

## Required Evidence To Report

Return a concise report with:

- branch/head and whether the worktree stayed clean;
- preflight command results and pass/fail counts;
- whether Operator was started through existing terminal `/clear` plus plain
  Foreman payload;
- Operator metadata proof: previous visible session id, new session id, cwd,
  metadata file path, mtime, and whether the id changed;
- whether the GDI human step used `/clear` then `/goal `;
- GDI metadata proof: previous visible session id, new session id, cwd,
  metadata file path, mtime, and whether the id changed;
- process comparison summary showing no proof-owned `codex --no-alt-screen`,
  Sigil bridge `server.mjs`, or `pty-proxy.py` process remained or was started;
- whether any transcript body was read. Expected: no;
- whether any source/docs/config/provider/GitHub/runtime mutation occurred.
  Expected: no.

## Acceptance Criteria

- Operator and GDI both show a metadata-backed post-`/clear` Codex session for
  the correct dock cwd.
- GDI dispatch shape is `/goal ` plus the proof payload.
- Operator dispatch shape is plain Foreman payload after `/clear`.
- At least GDI has a visible prior session id and a different post-reset session
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
- The GDI terminal is not an existing warm dock-local Codex process.
- A TCC/input readiness blocker prevents bounded verification.
- Any step would require launching a new provider process, starting the bridge,
  mutating provider configs, or reading provider transcript bodies.

Stop with `human_needed` or `blocked` and report the exact blocker.
