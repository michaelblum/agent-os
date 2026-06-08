# AFK Launch Attempt Canonical Env Correction V0

## Recipient

Implementer

## Transfer Kind

Correction round

## Tracker

Live Codex/Agent Terminal plumbing proof on 2026-05-24 found that the AFK
launch-attempt prototype still starts the historical Sigil bridge shim with
legacy `SIGIL_AGENT_*` environment names after the bridge substrate cutover to
canonical toolkit `AGENT_TERMINAL_*` names.

Relevant accepted context:

- `toolkit-agent-terminal-neutral-bridge-env-hard-cutover-correction-v0`
- `agent-terminal-bridge-server-terminal-manager-extraction-v0`
- `agent-terminal-bridge-server-provider-routes-extraction-v0`
- `agent-terminal-bridge-server-observation-helpers-extraction-v0`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, provider session, transcript/catalog state, or prior live proof state.
Read and rediscover before editing.

## Goal

Make `tests/afk-launch-attempt-prototype.test.mjs` pass again by correcting the
AFK launch-attempt prototype's bridge startup environment to the canonical
toolkit `AGENT_TERMINAL_*` contract.

Do not restore old bridge alias behavior. The fix belongs at the caller/prototype
boundary that still emits stale legacy env names.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `6376e7a0407c109c3b6a98f4f510d7c9d59ae9eb` or later with this work card
- output_branch: `implementer/afk-launch-attempt-canonical-env-correction-v0`

## Read First

- `AGENTS.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `apps/sigil/codex-terminal/server.mjs`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `packages/toolkit/components/agent-terminal/provider-session-routes.mjs`
- `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs`
- `tests/renderer/agent-terminal-chrome.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos dev recommend --json --files \
  scripts/afk-launch-attempt-prototype.mjs \
  tests/afk-launch-attempt-prototype.test.mjs \
  apps/sigil/codex-terminal/server.mjs \
  packages/toolkit/components/agent-terminal/bridge-server.mjs \
  tests/renderer/agent-terminal-chrome.test.mjs
```

This is a deterministic correction. Do not launch live providers.

## Observed Failure

From a Foreman shell on `main`:

```text
node --test tests/afk-launch-attempt-prototype.test.mjs
```

failed 21/48. The repeated failure shape was:

```text
bridge did not become healthy:
agent-terminal bridge listening on http://127.0.0.1:17761 (tmux)
```

The affected tests expected the prototype to start an isolated bridge on a free
test port with process driver fixtures. Instead, the compatibility shim ignored
the prototype's stale `SIGIL_AGENT_*` env and the toolkit bridge fell back to
default `AGENT_TERMINAL_*` values: port `17761`, driver `tmux`, default command.

The live Codex proof also surfaced a separate sandbox boundary:
`codex exec --sandbox workspace-write` cannot bind some local `127.0.0.1`
listeners and reported `listen EPERM`. That is useful evidence, but it is not
the correction target for this card. Keep this card focused on the caller env
contract regression that reproduces outside the Codex sandbox.

## Required Behavior

1. Update the AFK launch-attempt prototype to use canonical bridge env names
   when spawning `apps/sigil/codex-terminal/server.mjs`.

   Expected canonical names include:

   - `AGENT_TERMINAL_PORT`
   - `AGENT_TERMINAL_DRIVER`
   - `AGENT_TERMINAL_TMUX_SESSION`
   - `AGENT_TERMINAL_CWD`
   - `AGENT_TERMINAL_COMMAND`
   - `AGENT_TERMINAL_CATALOG_HOME`
   - `AGENT_TERMINAL_CODEX_ROOT`
   - `AGENT_TERMINAL_CLAUDE_ROOT`

2. Update any receipt/test expectation strings in the same prototype slice so
   recorded command env refs reflect the canonical names.

3. Preserve historical shim behavior.

   `apps/sigil/codex-terminal/server.mjs` should remain a thin compatibility
   module that delegates to the toolkit bridge. Do not make it parse old env
   aliases.

4. Preserve hard-cutover behavior.

   The bridge substrate should continue to reject broad legacy env aliases in
   the existing renderer/chrome test coverage.

## Hard Boundaries

- Do not add `SIGIL_AGENT_*`, `SIGIL_CODEX_*`, or `CODEX_COMMAND` alias support
  back into `bridge-server.mjs`, `terminal-session-manager.mjs`,
  `provider-session-routes.mjs`, `bridge-observation-routes.mjs`, or
  `pty-proxy.py`.
- Do not launch Codex, Claude, Gemini, AOS canvases, or live tmux/provider
  sessions for required evidence.
- Do not read provider transcript bodies or real provider session stores.
- Do not change launcher behavior outside the AFK prototype/test correction
  unless inspection proves a directly coupled expectation is stale.
- Do not broaden into AFK scheduler design, warm TUI reuse semantics, result
  routing, bridge route extraction, or shim retirement.

## Suggested Implementation Areas

- `scripts/afk-launch-attempt-prototype.mjs`
  - `observeTerminalSubstrate`
  - `observeProviderTerminalSubstrate`
  - any `command_env_refs` values in launch-intent records
- `tests/afk-launch-attempt-prototype.test.mjs`
  - update assertions only where they intentionally describe the bridge env
    contract.

## Verification

Run:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
git diff --check
```

If any test still fails with local socket or repo-mode readiness blockers, report
the exact command, failure text, and whether it reproduces outside
`codex exec --sandbox workspace-write`.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- exact env names changed from stale to canonical;
- whether any bridge/helper module gained legacy alias handling;
- verification commands and pass/fail results;
- local-only state;
- whether live providers, AOS canvases, tmux sessions, provider transcripts, or
  real provider stores were touched;
- remaining follow-up recommendation.
