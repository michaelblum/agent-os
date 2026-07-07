# Toolkit Agent Terminal Terminal Controller V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Extract the generic Agent Terminal terminal-pane controller behavior from the
monolithic toolkit HTML page into a small toolkit-owned module with focused
deterministic tests.

This is the next decomposition step after `bridge-client.js`,
`session-rail-model.js`, and `session-inspector-model.js`: keep moving the
toolkit Agent Terminal toward reusable terminal view/session rail/inspector/
bridge-client pieces without changing live provider behavior.

## Branch / Base

- branch_from: local `main`
- required_start_ref: local `main` at
  `e44315a1568757b2b5634423abdd7d5c612538eb`
- output_branch: `gdi/toolkit-agent-terminal-terminal-controller-v0`

The work card exists on local `main`, which is ahead of `origin/main` because
the accepted Agent Terminal foundation and decomposition slices have not been
externally published yet. Do not reset to `origin/main`.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/components.md`
- `docs/design/notes/agent-terminal-toolkit-roadmap-2026-05-23.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-rail-model-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-inspector-model-v0.md`
- `packages/toolkit/components/agent-terminal/index.html`
- `packages/toolkit/components/agent-terminal/bridge-client.js`
- `packages/toolkit/components/agent-terminal/session-rail-model.js`
- `packages/toolkit/components/agent-terminal/session-inspector-model.js`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/renderer/agent-terminal-bridge-client.test.mjs`
- `tests/renderer/agent-terminal-session-rail-model.test.mjs`
- `tests/renderer/agent-terminal-session-inspector-model.test.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
```

This slice is deterministic. Do not run `./aos ready`; live proof is not
required.

## Existing Code To Inspect

- `packages/toolkit/components/agent-terminal/index.html` - currently owns
  terminal state, xterm options, resize/refit scheduling, WebSocket attach and
  detach event handling, terminal data forwarding, launch/start status handling,
  and terminal boot fallback inline.
- `packages/toolkit/components/agent-terminal/bridge-client.js` - owns
  bridge URL construction, terminal WebSocket opening, and resize control frame
  formatting.
- `tests/renderer/agent-terminal-bridge-client.test.mjs` - precedent for
  injected WebSocket/fetch tests without live AOS.

## Required Behavior

1. Add a toolkit-owned browser/Node-testable module under
   `packages/toolkit/components/agent-terminal/`, expected shape such as
   `terminal-controller.js`.

2. Move terminal-pane controller behavior out of inline HTML where practical:
   - default xterm option construction;
   - terminal attach/detach/error status label decisions;
   - resize/refit state, including last-fit comparison and resize frame send;
   - terminal WebSocket attach event wiring through the existing bridge client;
   - message payload handling for text and Blob-like event data;
   - terminal input forwarding only when the socket is open;
   - launch/start status and error write behavior for `runAgentCommand`, if it
     can be extracted without broadening the slice.

3. Keep DOM element lookup, panel chrome, session rail rendering, inspector
   rendering, Sigil-surface gating, and `window.headsup` integration in
   `index.html`. This card is terminal controller extraction, not a broad page
   rewrite.

4. Preserve existing visible and runtime behavior:
   - missing xterm assets still show the same user-facing fallback text;
   - first boot still writes `Connecting to agent terminal...`;
   - attach still clears the terminal, schedules refit, focuses the terminal,
     and marks `window.__sigilAgentTerminal.state.attached = true`;
   - close/error still updates attached state and status as before;
   - resize frames still use the bridge-client frame format;
   - terminal input still forwards unchanged bytes to the open socket;
   - `surface=sigil` and generic `surface=generic` boundaries remain unchanged.

5. The extracted module must be testable without launching AOS, opening a
   WebView, using real xterm, or driving a real provider. Use small fake
   terminal, fit addon, bridge client, and socket objects in tests.

## Suggested Implementation Areas

- Add `packages/toolkit/components/agent-terminal/terminal-controller.js`.
- Import it from the inline module in
  `packages/toolkit/components/agent-terminal/index.html`.
- Add a focused Node test such as
  `tests/renderer/agent-terminal-terminal-controller.test.mjs`.
- Add or update a small static assertion in
  `tests/renderer/agent-terminal-chrome.test.mjs` only if it helps prove
  `index.html` consumes the module without making the test brittle.

## Hard Boundaries

- Do not move `apps/sigil/codex-terminal/server.mjs` or change the bridge API.
- Do not change `bridge-client.js`, `session-rail-model.js`, or
  `session-inspector-model.js` unless a tiny import adjustment is required.
- Do not launch or drive live providers.
- Do not run or rely on visual Agent Terminal output as acceptance evidence.
- Do not read provider transcript bodies.
- Do not mutate provider configs, keymaps, stores, catalogs, telemetry,
  gateway/dock runtime, GitHub state, or `origin/main`.
- Do not remove or relax `--i-am-present`.
- Do not start async result routing.

## Verification

Run the focused deterministic checks:

```bash
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/renderer/agent-terminal-bridge-client.test.mjs
node --test tests/renderer/agent-terminal-session-rail-model.test.mjs
node --test tests/renderer/agent-terminal-session-inspector-model.test.mjs
node --test tests/renderer/agent-terminal-terminal-controller.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

If you choose a different test filename for the terminal controller, run that
exact test and report it.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- the module path and terminal controller responsibilities extracted;
- how `index.html` now consumes the module;
- confirmation that attach/detach, resize, input forwarding, Sigil wrapper
  behavior, and generic launch boundaries remain unchanged;
- verification commands and pass/fail results;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation for the next Agent Terminal decomposition
  slice, if one is obvious.
