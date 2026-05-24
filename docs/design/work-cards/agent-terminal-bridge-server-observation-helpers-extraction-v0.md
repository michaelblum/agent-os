# Agent Terminal Bridge Server Observation Helpers Extraction V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, provider, issue, or prior implementation state. Read and rediscover
before editing.

## Tracker

Accepted prerequisites:

- `docs/design/work-cards/agent-terminal-bridge-server-terminal-manager-extraction-v0.md`
- `docs/design/work-cards/agent-terminal-bridge-server-terminal-manager-extraction-correction-v0.md`
- `docs/design/work-cards/agent-terminal-bridge-server-provider-routes-extraction-v0.md`

Current state: `bridge-server.mjs` owns HTTP routing and delegates terminal
lifecycle/control plus provider catalog/session-inspector selection. The
remaining inline response-shape helpers are now small enough to combine safely
when the slice stays mechanical and deterministic.

## Goal

Extract the bridge server's health response and dock-terminal-session
observation payload helpers into one small toolkit-owned module, while
preserving HTTP route ownership and endpoint behavior.

This is an intentionally combined slice. It combines two adjacent read-only
response-shape helpers because they share the same file, tests, and no-live
verification surface. Do not use this card as permission to combine unrelated
runtime behavior.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `f5064031ddcabdcfa26cbdb8b1fc89c29e9e4f76` or later with this work card
- output_branch:
  `gdi/agent-terminal-bridge-server-observation-helpers-extraction-v0`

## Read First

- `AGENTS.md`
- `docs/design/work-cards/agent-terminal-bridge-server-provider-routes-extraction-v0.md`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs`
- `packages/toolkit/components/agent-terminal/provider-session-routes.mjs`
- `scripts/lib/dock-terminal-session-registry.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/afk-terminal-substrate-no-provider.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos dev recommend --json --files \
  packages/toolkit/components/agent-terminal/bridge-server.mjs \
  packages/toolkit/components/agent-terminal/terminal-session-manager.mjs \
  tests/sigil-agent-terminal-server.test.mjs \
  tests/renderer/agent-terminal-chrome.test.mjs \
  tests/afk-terminal-substrate-no-provider.test.mjs
```

This slice is deterministic. Do not run live launchers, providers, AOS canvases,
or tmux-dependent live checks. Existing tests may start the bridge with harmless
process-driver fixtures.

## Required Behavior

1. Add a focused observation helper module.

   Suggested path:

   - `packages/toolkit/components/agent-terminal/bridge-observation-routes.mjs`

   The exact name is flexible after inspection. The module should own:

   - the `/health` response shape;
   - the `/dock-terminal-session` response shape;
   - `createDockTerminalSessionReceipt` and `createAgentTerminalObservation`
     usage currently inline in `bridge-server.mjs`;
   - lookup of canonical dock observation env names such as
     `AGENT_TERMINAL_DOCK` and `AGENT_TERMINAL_DOCK_CWD`.

2. Keep `bridge-server.mjs` as HTTP route owner.

   `bridge-server.mjs` should continue to own:

   - HTTP server creation;
   - CORS, `json`, and `text` response helpers;
   - method/path checks for all endpoints;
   - terminal manager creation and delegation;
   - provider helper delegation;
   - WebSocket upgrade routing;
   - `startServer` and `appendProcessStderr` export compatibility.

3. Preserve endpoint behavior exactly.

   Existing behavior to preserve:

   - `/health` JSON fields and values;
   - `/dock-terminal-session` JSON shape;
   - default dock value `gdi`;
   - explicit `dock`, `session`, `cwd`, `provider`, `provider_session_id`,
     `lease_holder`, `lease_purpose`, and `lease_disposition` query behavior;
   - pty driver naming for process and tmux fixtures;
   - canonical `AGENT_TERMINAL_*` env behavior as the only active bridge env
     contract.

4. Keep the slice narrow.

   Do not extract:

   - route dispatch framework;
   - terminal manager behavior;
   - provider catalog/session-inspector behavior;
   - session inspector model internals;
   - host catalog implementation;
   - launcher shell helpers;
   - frontend APIs;
   - historical shim retirement.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not open AOS canvases, drive live UI, mutate live dock sessions, or depend
  on tmux state for required evidence beyond existing deterministic test guards.
- Do not read provider transcript bodies or real provider session stores.
- Do not mutate provider config, gateway state, dock profiles, hooks, GitHub
  issues, PRs, release state, or unrelated runtime artifacts.
- Do not remove historical `apps/sigil/codex-terminal/*` shims.
- Do not add compatibility env aliases for old `SIGIL_AGENT_*`,
  `SIGIL_CODEX_*`, or `CODEX_COMMAND` names.
- Do not broaden into AFK scheduler, gateway, result-route, catalog, telemetry,
  route-framework extraction, launcher DRY work, or shim retirement.

## Verification

Run:

```bash
node --check packages/toolkit/components/agent-terminal/bridge-server.mjs
node --check packages/toolkit/components/agent-terminal/terminal-session-manager.mjs
node --check packages/toolkit/components/agent-terminal/provider-session-routes.mjs
node --check packages/toolkit/components/agent-terminal/bridge-observation-routes.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
git diff --check
```

If you choose a different helper module path, substitute it in the `node
--check` command.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- new helper module path and exported surface;
- health/dock observation responsibilities that moved;
- bridge-server responsibilities intentionally left in place;
- endpoint compatibility behavior preserved;
- whether any live provider, AOS canvas, tmux session, provider transcript, or
  real provider store was touched;
- verification commands and pass/fail results;
- local-only state;
- recommended next factoring slice, if any.
