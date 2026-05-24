# Agent Terminal Bridge Server Terminal Manager Extraction V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, provider, issue, or prior implementation state. Read and rediscover
before editing.

## Tracker

Accepted Agent Terminal/toolkit factoring notes:

- `docs/design/notes/agent-terminal-toolkit-roadmap-2026-05-23.md`
- accepted wrapper health fix through
  `docs/design/work-cards/agent-terminal-sigil-wrapper-health-fixture-correction-v0.md`

Current assessment: the frontend modules are factored enough for now. The next
high-value cleanup is `packages/toolkit/components/agent-terminal/bridge-server.mjs`,
which still mixes HTTP routing, terminal lifecycle/control, WebSocket terminal
attachment, provider catalog endpoints, session inspector routing, and
dock-terminal-session observation.

## Goal

Extract the bridge server's terminal session lifecycle/control responsibilities
into a toolkit-owned module while preserving endpoint behavior.

This is the first server-side factoring slice. Keep HTTP route ownership in
`bridge-server.mjs`; move only the cohesive terminal manager behavior needed to
make process/tmux lifecycle, capture, resize, input, key delivery, terminal cwd,
terminal command, and shutdown easier to reason about.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `1948c9c36b07d10ee6a027e80019a4a2806f1211` or later with this work card
- output_branch:
  `gdi/agent-terminal-bridge-server-terminal-manager-extraction-v0`

## Read First

- `AGENTS.md`
- `docs/design/notes/agent-terminal-toolkit-roadmap-2026-05-23.md`
- `docs/design/work-cards/agent-terminal-sigil-wrapper-health-fixture-correction-v0.md`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `packages/toolkit/components/agent-terminal/pty-proxy.py`
- `apps/sigil/codex-terminal/server.mjs`
- `apps/sigil/codex-terminal/pty-proxy.py`
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
  tests/sigil-agent-terminal-server.test.mjs \
  tests/renderer/agent-terminal-chrome.test.mjs \
  tests/afk-terminal-substrate-no-provider.test.mjs
```

This slice is deterministic. Do not run `./aos ready`, live launchers, providers,
AOS canvases, or tmux-dependent live checks unless deterministic tests expose a
gap that cannot be reviewed otherwise. The existing server tests may start the
bridge with harmless process-driver fixtures; that is allowed.

## Existing Code To Inspect

- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
  - currently owns environment defaults, process/tmux lifecycle, PTY proxy
    control, capture, resize/input/key commands, WebSocket framing and terminal
    attachment, HTTP route handling, provider catalog queries, session inspector
    routing, dock-terminal-session observation, and shutdown.
- `tests/sigil-agent-terminal-server.test.mjs`
  - covers process-driver `/ensure`, `/snapshot`, `/input`, `/key`, `/resize`,
    catalog queries, inspector behavior, PTY child PID marker parsing, and
    historical shim delegation.
- `tests/afk-terminal-substrate-no-provider.test.mjs`
  - covers provider-free bridge substrate facts and no-catalog/no-telemetry
    behavior.
- `tests/renderer/agent-terminal-chrome.test.mjs`
  - contains static assertions about bridge exports, shims, env names, and
    launcher ownership.

## Required Behavior

1. Add a focused terminal manager module.

   Suggested path:

   - `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs`

   The exact API is up to implementation after inspection, but it should
   centralize the terminal lifecycle/control behavior currently embedded in
   `bridge-server.mjs`, such as:

   - active driver selection;
   - process/tmux availability and session existence;
   - process session creation and termination;
   - tmux session creation and owned-session shutdown;
   - snapshot/capture;
   - resize, input, and key handling;
   - terminal command and cwd lookup;
   - PTY child PID marker parsing through `appendProcessStderr` or an equivalent
     exported helper.

2. Keep `bridge-server.mjs` as the route owner.

   `bridge-server.mjs` should continue to own:

   - HTTP server creation and CORS response helpers;
   - `/health`, `/sessions`, `/dock-terminal-session`, `/session-inspector`,
     `/snapshot`, `/ensure`, `/resize`, `/input`, and `/key` routing;
   - WebSocket upgrade route selection;
   - provider catalog query shape;
   - session inspector lookup;
   - dock-terminal-session observation shape;
   - top-level `startServer` export.

   It may delegate WebSocket terminal attachment to the manager only if that is
   the smallest clean boundary. Do not move provider catalog, inspector, or dock
   observation code into the manager.

3. Preserve public and compatibility behavior.

   - `apps/sigil/codex-terminal/server.mjs` must keep working as a historical
     shim.
   - `appendProcessStderr` must remain importable through the existing bridge
     server export path unless tests are intentionally updated to import from
     the new module and the shim still preserves compatibility.
   - Endpoint JSON fields, status codes, error text used by existing tests, and
     canonical `AGENT_TERMINAL_*` env behavior should remain unchanged.
   - Process-driver and tmux-driver behavior should stay semantically the same.

4. Add focused deterministic coverage if needed.

   Prefer preserving existing behavior tests over adding broad snapshots. Add a
   small unit-style test for the new manager only if it catches a boundary that
   existing server tests would miss, such as PID marker parsing or manager API
   delegation.

5. Keep the slice narrow.

   Do not split route handlers, provider catalog adapters, session inspector
   server, launcher shell helpers, or frontend APIs in this round. Those can be
   later slices after this manager boundary is stable.

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
  route-handler extraction, launcher DRY work, or shim retirement.

## Verification

Run:

```bash
node --check packages/toolkit/components/agent-terminal/bridge-server.mjs
node --check packages/toolkit/components/agent-terminal/terminal-session-manager.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
git diff --check
```

If you choose a different new module path, substitute it in the `node --check`
command. Also run any focused command recommended by:

```bash
./aos dev recommend --json --files \
  packages/toolkit/components/agent-terminal/bridge-server.mjs \
  packages/toolkit/components/agent-terminal/terminal-session-manager.mjs \
  tests/sigil-agent-terminal-server.test.mjs \
  tests/renderer/agent-terminal-chrome.test.mjs \
  tests/afk-terminal-substrate-no-provider.test.mjs
```

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- new module path and exported surface;
- bridge-server responsibilities that moved;
- bridge-server responsibilities intentionally left in place;
- compatibility behavior preserved, especially historical Sigil/Codex shim and
  `appendProcessStderr`;
- whether any live provider, AOS canvas, tmux session, provider transcript, or
  real provider store was touched;
- verification commands and pass/fail results;
- local-only state;
- recommended next factoring slice, if any.
