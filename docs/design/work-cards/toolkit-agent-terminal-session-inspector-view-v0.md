# Toolkit Agent Terminal Session Inspector View V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Extract the generic Agent Terminal session inspector DOM rendering behavior from
the monolithic toolkit HTML page into a small toolkit-owned view module with
focused deterministic tests.

This is the next decomposition step after `session-inspector-model.js`: keep
moving the toolkit Agent Terminal toward reusable terminal view/session rail/
inspector/bridge-client pieces without changing live provider behavior.

## Branch / Base

- branch_from: local `main`
- required_start_ref: local `main` at
  `ba450568421c118c5d87ce8772753c968596fa09`
- output_branch: `gdi/toolkit-agent-terminal-session-inspector-view-v0`

The work card exists on local `main`, which is ahead of `origin/main` because
the accepted Agent Terminal foundation and decomposition slices have not been
externally published yet. Do not reset to `origin/main`.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/components.md`
- `docs/design/work-cards/toolkit-agent-terminal-foundation-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-inspector-model-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-terminal-controller-v0.md`
- `packages/toolkit/components/agent-terminal/index.html`
- `packages/toolkit/components/agent-terminal/session-inspector-model.js`
- `packages/toolkit/components/agent-terminal/terminal-controller.js`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/renderer/agent-terminal-session-inspector-model.test.mjs`
- `tests/renderer/agent-terminal-terminal-controller.test.mjs`

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
  `appendText`, `appendRow`, `appendSection`, `appendMetricRow`,
  `renderInspectorEmpty`, `renderInspectorLoading`, and `renderInspector`
  inline.
- `packages/toolkit/components/agent-terminal/session-inspector-model.js` -
  owns pure section/row data for the inspector.
- `tests/renderer/agent-terminal-session-inspector-model.test.mjs` - verifies
  model behavior; the new view tests should focus on DOM rendering, not repeat
  all model cases.

## Required Behavior

1. Add a toolkit-owned browser/Node-testable view module under
   `packages/toolkit/components/agent-terminal/`, expected shape such as
   `session-inspector-view.js`.

2. Move inspector DOM rendering out of inline HTML where practical:
   - append text/row/section helpers used only by the inspector;
   - metric row rendering, including source rows and titles;
   - empty inspector rendering;
   - loading inspector rendering;
   - full inspector rendering from `createSessionInspectorModel(record, payload)`;
   - diagnostic DOM rendering and empty diagnostics text.

3. Keep page orchestration in `index.html`:
   - bridge-client calls;
   - selected-session state and request id checks;
   - session rail rendering;
   - terminal controller wiring;
   - Sigil-surface gating;
   - telemetry emission after a successful inspector render.

4. Preserve existing visible behavior:
   - section names remain `Session`, `Context`, `Token Counters`,
     `Lifecycle`, and `Diagnostics`;
   - loading state remains `Loading telemetry...`;
   - empty state remains `Select a session`, `No session selected`, or the
     caller-provided text;
   - missing context still displays `Unknown`;
   - no diagnostics still displays `No diagnostics`;
   - diagnostic severity class names and source text stay unchanged;
   - `agent_terminal.session_telemetry` emission remains in `index.html` with
     the original payload.

5. The extracted view module must be testable without launching AOS, opening a
   WebView, using xterm, or driving a real provider. Use a DOM test environment
   already available in repo tests if one exists; otherwise use a tiny fake
   `document`/element helper or keep tests focused on generated element
   structure using the standard DOM APIs available to Node in this repo.

## Suggested Implementation Areas

- Add `packages/toolkit/components/agent-terminal/session-inspector-view.js`.
- Import it from the inline module in
  `packages/toolkit/components/agent-terminal/index.html`.
- Add a focused Node test such as
  `tests/renderer/agent-terminal-session-inspector-view.test.mjs`.
- Add or update a small static assertion in
  `tests/renderer/agent-terminal-chrome.test.mjs` only if it helps prove
  `index.html` consumes the module without making the test brittle.

## Hard Boundaries

- Do not move or change `apps/sigil/codex-terminal/server.mjs`.
- Do not change `bridge-client.js`, `session-rail-model.js`,
  `session-inspector-model.js`, or `terminal-controller.js` unless a tiny
  import adjustment is required.
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
node --test tests/renderer/agent-terminal-session-inspector-model.test.mjs
node --test tests/renderer/agent-terminal-session-inspector-view.test.mjs
node --test tests/renderer/agent-terminal-terminal-controller.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

If you choose a different test filename for the inspector view, run that exact
test and report it.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- the module path and inspector view responsibilities extracted;
- how `index.html` now consumes the view module;
- confirmation that inspector visible behavior, telemetry emission, Sigil
  wrapper behavior, and generic launch boundaries remain unchanged;
- verification commands and pass/fail results;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation for the next Agent Terminal decomposition
  slice, if one is obvious.
