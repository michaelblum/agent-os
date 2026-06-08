# Toolkit Agent Terminal Session Rail View V0

## Recipient

Implementer

## Transfer Kind

Implementer round

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Extract the generic Agent Terminal session rail DOM rendering behavior from the
monolithic toolkit HTML page into a small toolkit-owned view module with focused
deterministic tests.

This is the next decomposition step after `session-rail-model.js` and
`session-inspector-view.js`: keep moving the toolkit Agent Terminal toward
reusable terminal view/session rail/inspector/bridge-client pieces without
changing live provider behavior.

## Branch / Base

- branch_from: local `main`
- required_start_ref: local `main` at
  `c9bd9d2ab9e6e197c9ea32766dd16fc41b155a2d`
- output_branch: `implementer/toolkit-agent-terminal-session-rail-view-v0`

The work card exists on local `main`, which is ahead of `origin/main` because
the accepted Agent Terminal foundation and decomposition slices have not been
externally published yet. Do not reset to `origin/main`.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/components.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-rail-model-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-inspector-view-v0.md`
- `packages/toolkit/components/agent-terminal/index.html`
- `packages/toolkit/components/agent-terminal/session-rail-model.js`
- `packages/toolkit/components/agent-terminal/session-inspector-view.js`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/renderer/agent-terminal-session-rail-model.test.mjs`
- `tests/renderer/agent-terminal-session-inspector-view.test.mjs`

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
  `renderSessions` inline, including empty state DOM, session button creation,
  selected styling, ARIA attributes, provider badge, workspace label, metadata,
  short id, and click callback wiring.
- `packages/toolkit/components/agent-terminal/session-rail-model.js` - owns
  pure row data for the rail; the new view tests should focus on DOM rendering
  and callback behavior, not repeat all model cases.
- `packages/toolkit/components/agent-terminal/session-inspector-view.js` -
  precedent for a small DOM view module that is browser/Node-testable without
  launching AOS.

## Required Behavior

1. Add a toolkit-owned browser/Node-testable view module under
   `packages/toolkit/components/agent-terminal/`, expected shape such as
   `session-rail-view.js`.

2. Move session rail DOM rendering out of inline HTML where practical:
   - empty session-list rendering with `No sessions`;
   - session button element creation;
   - selected session class and `aria-current` handling;
   - `role="listitem"` and row `aria-label` handling;
   - provider badge class/text rendering;
   - workspace name, metadata, and short id rendering;
   - click callback attachment that receives the row or record needed by
     `index.html`.

3. Keep page orchestration in `index.html`:
   - bridge-client calls;
   - provider filter and sort state;
   - selected-session state and replacement logic;
   - `selectSession`;
   - `runAgentCommand`;
   - terminal controller wiring;
   - inspector loading/telemetry behavior;
   - Sigil-surface gating.

4. Preserve existing visible behavior:
   - empty session list remains `No sessions`;
   - clicking a session still selects it, loads telemetry, and resumes through
     the existing command path;
   - provider badge class names and display text stay unchanged;
   - selected row styling and `aria-current` behavior stay unchanged;
   - session `aria-label`, workspace label, metadata, and short id text stay
     unchanged;
   - provider filter and sort controls keep their current semantics;
   - Sigil wrapper behavior and generic `surface=generic` behavior remain
     unchanged.

5. The extracted view module must be testable without launching AOS, opening a
   WebView, using xterm, or driving a real provider. Use the existing tiny fake
   `document`/element style from the inspector view test if that remains the
   smallest reliable option.

## Suggested Implementation Areas

- Add `packages/toolkit/components/agent-terminal/session-rail-view.js`.
- Import it from the inline module in
  `packages/toolkit/components/agent-terminal/index.html`.
- Add a focused Node test such as
  `tests/renderer/agent-terminal-session-rail-view.test.mjs`.
- Add or update a small static assertion in
  `tests/renderer/agent-terminal-chrome.test.mjs` only if it helps prove
  `index.html` consumes the module without making the test brittle.

## Hard Boundaries

- Do not move or change `apps/sigil/codex-terminal/server.mjs`.
- Do not change `bridge-client.js`, `session-rail-model.js`,
  `session-inspector-model.js`, `session-inspector-view.js`, or
  `terminal-controller.js` unless a tiny import adjustment is required.
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
node --test tests/renderer/agent-terminal-session-rail-model.test.mjs
node --test tests/renderer/agent-terminal-session-rail-view.test.mjs
node --test tests/renderer/agent-terminal-session-inspector-view.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

If you choose a different test filename for the session rail view, run that
exact test and report it.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- the module path and session rail view responsibilities extracted;
- how `index.html` now consumes the view module;
- confirmation that session click/resume behavior, selected-session behavior,
  inspector loading/telemetry behavior, Sigil wrapper behavior, and generic
  launch boundaries remain unchanged;
- verification commands and pass/fail results;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation for the next Agent Terminal decomposition
  slice, if one is obvious.
