# Agent Terminal Bridge Server Provider Routes Extraction V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, provider, issue, or prior implementation state. Read and rediscover
before editing.

## Tracker

Accepted prerequisite:

- `docs/design/work-cards/agent-terminal-bridge-server-terminal-manager-extraction-v0.md`
- correction accepted through
  `docs/design/work-cards/agent-terminal-bridge-server-terminal-manager-extraction-correction-v0.md`

Current state: `bridge-server.mjs` now delegates terminal lifecycle/control to
`terminal-session-manager.mjs`. The remaining server factoring should proceed
one boundary at a time.

## Goal

Extract provider catalog and session-inspector helper behavior out of
`bridge-server.mjs` while preserving HTTP route ownership and endpoint behavior.

This is not a full route-framework extraction. The target is a small
toolkit-owned helper module for `/sessions` and `/session-inspector` data
selection so the bridge server keeps request routing but no longer owns provider
catalog query details or inspector record lookup details inline.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `b20f8533c0cb288a5c71a2c5c57356315ea6e4f6` or later with this work card
- output_branch:
  `gdi/agent-terminal-bridge-server-provider-routes-extraction-v0`

## Read First

- `AGENTS.md`
- `docs/design/work-cards/agent-terminal-bridge-server-terminal-manager-extraction-v0.md`
- `docs/design/work-cards/agent-terminal-bridge-server-terminal-manager-extraction-correction-v0.md`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs`
- `packages/toolkit/components/agent-terminal/session-inspector-server.mjs`
- `packages/host/src/session-catalog.ts`
- `packages/host/src/session-telemetry.ts`
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
  packages/toolkit/components/agent-terminal/session-inspector-server.mjs \
  tests/sigil-agent-terminal-server.test.mjs \
  tests/renderer/agent-terminal-chrome.test.mjs \
  tests/afk-terminal-substrate-no-provider.test.mjs
```

This slice is deterministic. Do not run `./aos ready`, live launchers, providers,
AOS canvases, or tmux-dependent live checks. Existing tests may start the bridge
with harmless process-driver fixtures.

## Existing Code To Inspect

- `bridge-server.mjs`
  - currently owns `/sessions` and `/session-inspector` route selection plus
    `sessionCatalogQueryForUrl`, `sessionCatalogForUrl`, provider filtering,
    catalog root env lookup, catalog record selection, and session inspector
    error handling.
- `session-inspector-server.mjs`
  - owns `buildSessionInspector(record)` and telemetry sanitization.
- `session-catalog.ts`
  - owns provider session discovery and catalog record shape.
- `tests/sigil-agent-terminal-server.test.mjs`
  - covers provider catalog rail sessions, all-cwd provider filtering,
    session-inspector telemetry, drift diagnostics, and missing inspector
    records.

## Required Behavior

1. Add a focused provider route/helper module.

   Suggested path:

   - `packages/toolkit/components/agent-terminal/provider-session-routes.mjs`

   The exact name is flexible after inspection, but the module should own the
   provider catalog and inspector data-selection helpers currently embedded in
   `bridge-server.mjs`.

   Suitable responsibilities include:

   - building the `/sessions` response shape from `URLSearchParams`;
   - filtering accepted providers (`codex`, `claude-code`) from repeated
     `provider` params;
   - applying default cwd versus `all_cwd=true`;
   - reading canonical catalog root env names:
     `AGENT_TERMINAL_CATALOG_HOME`, `AGENT_TERMINAL_CODEX_ROOT`, and
     `AGENT_TERMINAL_CLAUDE_ROOT`;
   - selecting a catalog record for `/session-inspector`;
   - building the inspector model with `buildSessionInspector(record)`;
   - returning enough information for `bridge-server.mjs` to preserve existing
     `400`, `404`, and `200` responses.

2. Keep `bridge-server.mjs` as HTTP route owner.

   `bridge-server.mjs` should continue to own:

   - HTTP server creation;
   - CORS, `json`, and `text` response helpers;
   - method/path checks for `/health`, `/sessions`, `/dock-terminal-session`,
     `/session-inspector`, `/snapshot`, `/ensure`, `/resize`, `/input`, and
     `/key`;
   - terminal manager delegation;
   - dock-terminal-session observation;
   - WebSocket upgrade routing;
   - `startServer` and `appendProcessStderr` export compatibility.

   Do not move dock-terminal-session observation or terminal route behavior in
   this slice.

3. Preserve endpoint behavior exactly.

   Existing behavior to preserve:

   - `/sessions` returns `{ sessions, scope, cwd_filter }`;
   - omitted `cwd` defaults to the bridge default cwd;
   - `all_cwd=true` omits the cwd filter and reports `scope: "all_cwd"` and
     `cwd_filter: null`;
   - repeated `provider` params only admit `codex` and `claude-code`;
   - `/session-inspector` returns text `400` when `provider` or `session_id` is
     missing;
   - `/session-inspector` returns text `404` as
     `session not found: <provider>:<session_id>` when no catalog record
     matches;
   - `/session-inspector` returns the same sanitized inspector JSON when a
     record matches;
   - canonical `AGENT_TERMINAL_*` env behavior remains the only active bridge
     env contract.

4. Add focused deterministic coverage if needed.

   Existing server tests should remain the primary behavior proof. Update static
   renderer/chrome assertions only enough to prove the new helper module exists
   and that bridge-server no longer owns the catalog/inspector helper details
   inline. Add unit tests for the helper only if they catch a boundary not
   already covered by `tests/sigil-agent-terminal-server.test.mjs`.

5. Keep the slice narrow.

   Do not extract:

   - route dispatch framework;
   - dock-terminal-session observation;
   - terminal manager behavior;
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
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
git diff --check
```

If you choose a different helper module path, substitute it in the `node
--check` command. If you change `packages/host/src/session-catalog.ts`,
`packages/host/src/session-telemetry.ts`, or session-inspector internals, run
the relevant host/package tests and report them.

Also run any focused command recommended by:

```bash
./aos dev recommend --json --files \
  packages/toolkit/components/agent-terminal/bridge-server.mjs \
  packages/toolkit/components/agent-terminal/provider-session-routes.mjs \
  packages/toolkit/components/agent-terminal/session-inspector-server.mjs \
  tests/sigil-agent-terminal-server.test.mjs \
  tests/renderer/agent-terminal-chrome.test.mjs \
  tests/afk-terminal-substrate-no-provider.test.mjs
```

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- new helper module path and exported surface;
- provider/catalog/inspector responsibilities that moved;
- bridge-server responsibilities intentionally left in place;
- endpoint compatibility behavior preserved;
- whether any live provider, AOS canvas, tmux session, provider transcript, or
  real provider store was touched;
- verification commands and pass/fail results;
- local-only state;
- recommended next factoring slice, if any.
