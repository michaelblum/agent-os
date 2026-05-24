# Toolkit Agent Terminal Bridge Client V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Extract the generic Agent Terminal browser bridge-client behavior from the
monolithic toolkit HTML page into a small toolkit-owned module with focused
deterministic tests.

This keeps the accepted toolkit Agent Terminal foundation moving toward reusable
view/session rail/inspector/bridge-client pieces without moving the bridge
server substrate or starting live provider dogfooding.

## Branch / Base

- branch_from: local `main`
- required_start_ref: local `main` at
  `16f2b55d9c341f00435db794614acfd8f5b78cdd`
- output_branch: `gdi/toolkit-agent-terminal-bridge-client-v0`

The work card exists on local `main`, which is ahead of `origin/main` because
the accepted Agent Terminal foundation has not been externally published yet.
Do not reset to `origin/main`.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/components.md`
- `docs/design/work-cards/toolkit-agent-terminal-foundation-v0.md`
- `docs/design/dock-terminal-session-agent-terminal-contract-v0.md`
- `packages/toolkit/components/agent-terminal/index.html`
- `packages/toolkit/components/agent-terminal/launch.sh`
- `apps/sigil/codex-terminal/server.mjs`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
```

This slice is deterministic. Do not run `./aos ready` unless you deliberately
choose a bounded live check; live proof is not required.

## Existing Code To Inspect

- `packages/toolkit/components/agent-terminal/index.html` - currently owns
  DOM, xterm setup, session rail rendering, bridge HTTP fetches, `/ensure`, and
  terminal WebSocket attach in one inline module.
- `apps/sigil/codex-terminal/server.mjs` - current compatibility bridge API:
  `/health`, `/sessions`, `/dock-terminal-session`, `/session-inspector`,
  `/ensure`, `/input`, `/key`, `/snapshot`, and `/terminal` WebSocket.
- `tests/renderer/agent-terminal-chrome.test.mjs` - current static ownership
  and compatibility tests for the toolkit Agent Terminal page.
- `tests/sigil-agent-terminal-server.test.mjs` - bridge behavior regression
  tests that must keep passing.

## Required Behavior

1. Add a toolkit-owned browser module under
   `packages/toolkit/components/agent-terminal/`, expected shape such as
   `bridge-client.js`.

2. Move bridge-client responsibilities out of inline HTML where practical:
   - bridge URL construction from `port`;
   - loading session catalog data from `/sessions`;
   - loading inspector data from `/session-inspector`;
   - ensuring/restarting a terminal session via `/ensure`;
   - constructing or opening the `/terminal` WebSocket URL;
   - formatting the resize control frame sent over the WebSocket.

3. Keep DOM rendering, xterm lifecycle, panel chrome, Sigil-surface gating, and
   session rail visual behavior in `index.html` unless a smaller helper falls
   out naturally. This card is bridge-client extraction, not a broad UI rewrite.

4. Preserve the accepted ownership boundary:
   - generic toolkit Agent Terminal remains under
     `packages/toolkit/components/agent-terminal/`;
   - Sigil paths remain wrappers/consumers using `surface=sigil`;
   - generic launcher does not create, warm, or depend on `avatar-main`;
   - generic HTML loads xterm assets only from component-local toolkit paths;
   - bridge/server substrate may remain under `apps/sigil/codex-terminal/`.

5. The bridge client must be testable without launching AOS, opening a WebView,
   or driving a real provider. Prefer dependency injection for `fetch`,
   `WebSocket`, or URL origin pieces over global-only behavior.

6. Keep Agent Terminal observability non-authoritative. Do not make terminal
   pixels, transcript text, or visible output provider acceptance evidence.

## Suggested Implementation Areas

- Add `packages/toolkit/components/agent-terminal/bridge-client.js`.
- Import it from the inline module in
  `packages/toolkit/components/agent-terminal/index.html`.
- Add a focused Node test such as
  `tests/renderer/agent-terminal-bridge-client.test.mjs`, or extend the
  existing renderer test only if that stays readable.
- Update `docs/api/toolkit/components.md` only if the public component contract
  needs a short note about the local bridge-client module.

## Hard Boundaries

- Do not move `apps/sigil/codex-terminal/server.mjs` in this slice.
- Do not launch or drive live providers.
- Do not run or rely on visual Agent Terminal output as acceptance evidence.
- Do not read provider transcript bodies.
- Do not mutate provider configs, keymaps, stores, catalogs, telemetry,
  gateway/dock runtime, GitHub state, or `origin/main`.
- Do not remove or relax `--i-am-present`.
- Do not start async result routing.
- Keep provider scope Codex-only v0 unless preserving existing tests requires
  the current Claude catalog label behavior.

## Verification

Run the focused deterministic checks:

```bash
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/renderer/agent-terminal-bridge-client.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/schemas/aos-dock-terminal-session-v0.test.mjs
git diff --check
```

If you choose a different test filename for the bridge client, run that exact
test and report it.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- the module path and bridge responsibilities extracted;
- how `index.html` now consumes the module;
- confirmation that Sigil remains a wrapper/consumer and generic launch still
  avoids `avatar-main`;
- verification commands and pass/fail results;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation for the next Agent Terminal decomposition
  slice, if one is obvious.
