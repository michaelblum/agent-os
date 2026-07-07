# Toolkit Agent Terminal Session Rail Model V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Extract the generic Agent Terminal session rail's pure model and formatting
behavior from the monolithic toolkit HTML page into a small toolkit-owned
module with focused deterministic tests.

This is the next decomposition step after `bridge-client.js`: keep moving the
toolkit Agent Terminal toward reusable view/session rail/inspector/bridge-client
pieces without changing live provider behavior.

## Branch / Base

- branch_from: local `main`
- required_start_ref: local `main` at
  `e993c8e1c5dd43bb6f8cafddb8ef8b7ec106bde1`
- output_branch: `gdi/toolkit-agent-terminal-session-rail-model-v0`

The work card exists on local `main`, which is ahead of `origin/main` because
the accepted Agent Terminal foundation and bridge-client extraction have not
been externally published yet. Do not reset to `origin/main`.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/components.md`
- `docs/design/notes/agent-terminal-toolkit-roadmap-2026-05-23.md`
- `packages/toolkit/components/agent-terminal/index.html`
- `packages/toolkit/components/agent-terminal/bridge-client.js`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/renderer/agent-terminal-bridge-client.test.mjs`

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
  provider labels, cwd basename extraction, short session ids, timestamp
  selection, rail sorting, selected-session matching, and session button row
  data inline.
- `packages/toolkit/components/agent-terminal/bridge-client.js` - precedent for
  a small toolkit-owned Agent Terminal module with injected/testable behavior.
- `tests/renderer/agent-terminal-chrome.test.mjs` - static boundary tests that
  should keep proving the rail uses toolkit fixed sidebar behavior.

## Required Behavior

1. Add a toolkit-owned browser/Node-testable module under
   `packages/toolkit/components/agent-terminal/`, expected shape such as
   `session-rail-model.js`.

2. Move pure session rail behavior out of inline HTML where practical:
   - provider display labels, preserving the existing Codex and Claude labels;
   - cwd/workspace basename extraction;
   - short session id display;
   - sort timestamp selection for `last-message` and `created`;
   - stable session ordering;
   - selected-session matching;
   - row/view-model data needed by the DOM renderer, such as provider label,
     workspace label, metadata text, short id, aria label, and selected state.

3. Keep DOM creation, event handlers, `runAgentCommand`, xterm lifecycle,
   bridge-client usage, panel chrome, Sigil-surface gating, and visual rail
   layout in `index.html` unless a tiny helper falls out naturally. This card
   is session rail model extraction, not a broad UI rewrite.

4. Preserve existing visible behavior:
   - provider filter and sort controls keep their current semantics;
   - clicking a session still selects it, loads telemetry, and resumes through
     the existing command path;
   - empty-state behavior remains unchanged;
   - Sigil wrapper behavior and generic `surface=generic` behavior remain
     unchanged.

5. The extracted module must be testable without launching AOS, opening a
   WebView, using xterm, or driving a real provider.

## Suggested Implementation Areas

- Add `packages/toolkit/components/agent-terminal/session-rail-model.js`.
- Import it from the inline module in
  `packages/toolkit/components/agent-terminal/index.html`.
- Add a focused Node test such as
  `tests/renderer/agent-terminal-session-rail-model.test.mjs`.
- Add or update a small static assertion in
  `tests/renderer/agent-terminal-chrome.test.mjs` only if it helps prove
  `index.html` consumes the module without making the test brittle.

## Hard Boundaries

- Do not move `apps/sigil/codex-terminal/server.mjs`.
- Do not change `packages/toolkit/components/agent-terminal/bridge-client.js`
  unless a tiny import/typing adjustment is required.
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
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

If you choose a different test filename for the session rail model, run that
exact test and report it.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- the module path and rail responsibilities extracted;
- how `index.html` now consumes the module;
- confirmation that session click/resume behavior, Sigil wrapper behavior, and
  generic launch boundaries remain unchanged;
- verification commands and pass/fail results;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation for the next Agent Terminal decomposition
  slice, if one is obvious.
