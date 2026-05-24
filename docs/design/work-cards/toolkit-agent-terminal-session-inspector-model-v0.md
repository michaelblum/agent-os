# Toolkit Agent Terminal Session Inspector Model V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Extract the generic Agent Terminal session inspector's pure model and formatting
behavior from the monolithic toolkit HTML page into a small toolkit-owned
module with focused deterministic tests.

This is the next decomposition step after `bridge-client.js` and
`session-rail-model.js`: keep moving the toolkit Agent Terminal toward reusable
view/session rail/inspector/bridge-client pieces without changing live provider
behavior.

## Branch / Base

- branch_from: local `main`
- required_start_ref: local `main` at
  `1397378d487c4315cacda146e86d7b627c8e5bb1`
- output_branch: `gdi/toolkit-agent-terminal-session-inspector-model-v0`

The work card exists on local `main`, which is ahead of `origin/main` because
the accepted Agent Terminal foundation and decomposition slices have not been
externally published yet. Do not reset to `origin/main`.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/components.md`
- `docs/design/work-cards/toolkit-agent-terminal-foundation-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-bridge-client-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-rail-model-v0.md`
- `packages/toolkit/components/agent-terminal/index.html`
- `packages/toolkit/components/agent-terminal/bridge-client.js`
- `packages/toolkit/components/agent-terminal/session-rail-model.js`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/renderer/agent-terminal-bridge-client.test.mjs`
- `tests/renderer/agent-terminal-session-rail-model.test.mjs`
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
  number/ratio/time formatting, metric/source display, session summary rows,
  context/token/lifecycle/diagnostic section decisions, and diagnostic
  de-duplication inline.
- `packages/toolkit/components/agent-terminal/session-rail-model.js` - precedent
  for extracting pure Agent Terminal presentation model behavior while keeping
  DOM creation inline.
- `apps/sigil/codex-terminal/session-inspector.mjs` - source shape for sanitized
  session inspector payloads.
- `tests/sigil-agent-terminal-server.test.mjs` - bridge and sanitized telemetry
  regression tests that must keep passing.

## Required Behavior

1. Add a toolkit-owned browser/Node-testable module under
   `packages/toolkit/components/agent-terminal/`, expected shape such as
   `session-inspector-model.js`.

2. Move pure inspector behavior out of inline HTML where practical:
   - numeric metric display;
   - ratio display;
   - metric source display;
   - source session selection from `payload.session` versus selected rail
     record;
   - context metric row modeling;
   - token counter row modeling;
   - lifecycle event row modeling, preserving the existing last-three behavior;
   - diagnostic collection and de-duplication across `payload.diagnostics` and
     `payload.telemetry.diagnostics`;
   - session summary row data, including provider label, cwd title, branch,
     source, and model display.

3. Keep DOM creation, section appending, event handlers, bridge-client usage,
   session rail rendering, xterm lifecycle, panel chrome, and Sigil-surface
   gating in `index.html`. This card is inspector model extraction, not a broad
   UI rewrite.

4. Preserve existing visible behavior:
   - the inspector still shows Session, Context, Token Counters, Lifecycle, and
     Diagnostics sections under the same conditions;
   - missing context still displays `Unknown`;
   - no diagnostics still displays `No diagnostics`;
   - diagnostics still de-duplicate by code, provider surface, and fallback;
   - telemetry emission remains `agent_terminal.session_telemetry` with the
     original payload.

5. The extracted module must be testable without launching AOS, opening a
   WebView, using xterm, or driving a real provider.

## Suggested Implementation Areas

- Add `packages/toolkit/components/agent-terminal/session-inspector-model.js`.
- Import it from the inline module in
  `packages/toolkit/components/agent-terminal/index.html`.
- Add a focused Node test such as
  `tests/renderer/agent-terminal-session-inspector-model.test.mjs`.
- Add or update a small static assertion in
  `tests/renderer/agent-terminal-chrome.test.mjs` only if it helps prove
  `index.html` consumes the module without making the test brittle.

## Hard Boundaries

- Do not move `apps/sigil/codex-terminal/server.mjs` or
  `apps/sigil/codex-terminal/session-inspector.mjs`.
- Do not change `bridge-client.js` or `session-rail-model.js` unless a tiny
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
node --test tests/renderer/agent-terminal-bridge-client.test.mjs
node --test tests/renderer/agent-terminal-session-rail-model.test.mjs
node --test tests/renderer/agent-terminal-session-inspector-model.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

If you choose a different test filename for the session inspector model, run
that exact test and report it.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- the module path and inspector responsibilities extracted;
- how `index.html` now consumes the module;
- confirmation that inspector visible behavior, telemetry emission, Sigil
  wrapper behavior, and generic launch boundaries remain unchanged;
- verification commands and pass/fail results;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation for the next Agent Terminal decomposition
  slice, if one is obvious.
