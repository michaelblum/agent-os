# Sigil Agent Terminal Launcher Compatibility Inversion V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make `apps/sigil/agent-terminal/launch.sh` own the canonical Sigil Agent
Terminal wrapper launch, and turn `apps/sigil/codex-terminal/launch.sh` into a
thin historical compatibility launcher.

After the bridge server substrate moved into toolkit, the next remaining naming
inversion is that the canonical Sigil Agent Terminal launcher still delegates
through the historical `codex-terminal` path.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `ed0a79e8a64b82cebdebe64bd1be058f5f83f37d` or later with this work card
- output_branch: `gdi/sigil-agent-terminal-launcher-compatibility-inversion-v0`

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/components.md`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `packages/toolkit/components/agent-terminal/launch.sh`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/agent-terminal/index.html`
- `apps/sigil/codex-terminal/launch.sh`
- `apps/sigil/codex-terminal/index.html`
- `apps/sigil/codex-terminal/server.mjs`
- `tests/renderer/agent-terminal-chrome.test.mjs`
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

- `apps/sigil/agent-terminal/launch.sh` - currently a compatibility launcher
  that immediately execs `../codex-terminal/launch.sh`.
- `apps/sigil/codex-terminal/launch.sh` - currently owns the real Sigil wrapper
  launch: content roots, bridge startup, `avatar-main` ensure, Sigil canvas
  replacement, frame calculation, and the `aos://sigil/agent-terminal/index.html`
  URL.
- `packages/toolkit/components/agent-terminal/launch.sh` - generic toolkit
  launcher now starts the toolkit-owned bridge server; use as ownership context,
  but do not collapse Sigil wrapper launch behavior into it in this slice.
- `tests/renderer/agent-terminal-chrome.test.mjs` - static tests for Sigil
  compatibility entrypoints and toolkit boundaries.

## Required Behavior

1. Move the canonical Sigil wrapper launch implementation to
   `apps/sigil/agent-terminal/launch.sh`.

   The canonical Sigil launcher should keep the current Sigil behavior:

   - configure toolkit and Sigil content roots;
   - start the toolkit-owned Agent Terminal bridge through the existing server
     shim or the toolkit bridge path, whichever is smallest and clearest;
   - ensure the selected bridge session;
   - ensure `avatar-main` exists when launching Sigil mode;
   - remove/recreate the Sigil Agent Terminal canvas;
   - open `apps/sigil/agent-terminal/index.html` with `toolkit-root`,
     `port`, `session`, and `cwd` query parameters;
   - preserve existing CLI flags: `--new`, `--new-codex`, `--new-claude`,
     `--pick`, `--last`, `--restart`, `-h`, and `--help`;
   - preserve defaults unless a default is clearly only an old implementation
     detail.

2. Make `apps/sigil/codex-terminal/launch.sh` a thin compatibility shim.

   It should delegate to `../agent-terminal/launch.sh` while preserving old
   invocation behavior and environment-variable compatibility. Avoid duplicating
   the full launcher body in both paths.

3. Preserve historical compatibility paths.

   Do not remove `apps/sigil/codex-terminal/index.html`, `server.mjs`,
   `session-inspector.mjs`, or `pty-proxy.py`. The old launcher path must still
   work as a wrapper.

4. Preserve toolkit and Sigil ownership boundaries.

   The generic toolkit launcher remains generic and should not start
   `avatar-main`. Sigil-specific avatar and `surface=sigil` wrapper behavior
   remains under `apps/sigil/agent-terminal/`.

5. Update docs/tests where they encode the old inversion.

   Static tests should prove:

   - the canonical Sigil Agent Terminal launcher no longer immediately delegates
     through `../codex-terminal/launch.sh`;
   - the historical Codex terminal launcher delegates to the canonical Sigil
     Agent Terminal launcher;
   - Sigil compatibility HTML entrypoints still resolve to the toolkit Agent
     Terminal surface.

## Suggested Implementation Areas

- Move the current body of `apps/sigil/codex-terminal/launch.sh` to
  `apps/sigil/agent-terminal/launch.sh`, with path adjustments:
  - `SCRIPT_DIR` becomes `apps/sigil/agent-terminal`;
  - `REPO_ROOT` remains `../../..`;
  - bridge server path should continue to resolve correctly after the recent
    toolkit bridge substrate move;
  - `agent-terminal/index.html` URL may become local to `SCRIPT_DIR` instead of
    reaching across from `codex-terminal`.
- Replace `apps/sigil/codex-terminal/launch.sh` with a short `exec` wrapper.
- Update `tests/renderer/agent-terminal-chrome.test.mjs` or a focused shell
  static test to encode the new direction.
- Update `docs/api/toolkit/components.md` only if the public docs currently
  imply the old launcher direction.

## Hard Boundaries

- Do not change toolkit Agent Terminal frontend behavior.
- Do not change bridge endpoint behavior, session inspector behavior, PTY
  behavior, provider catalog behavior, or server response shapes.
- Do not remove historical Codex terminal compatibility entrypoints.
- Do not launch or drive live Codex, Claude, tmux, AOS canvases, or providers.
- Do not read provider transcript bodies.
- Do not mutate provider configs, keymaps, stores, catalogs, telemetry,
  gateway/dock runtime, GitHub state, or unrelated Sigil renderer code.
- Do not remove or relax `--i-am-present`.
- Do not start async result routing.

## Verification

Run the focused deterministic checks:

```bash
bash -n apps/sigil/agent-terminal/launch.sh
bash -n apps/sigil/codex-terminal/launch.sh
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

If you add or update a focused launcher/static test, run it and report the exact
command.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- how the canonical Sigil Agent Terminal launcher now owns wrapper launch;
- how the historical Codex terminal launcher delegates;
- confirmation that toolkit generic launch, Sigil wrapper launch, historical
  compatibility paths, bridge startup, and CLI flags remain unchanged;
- verification commands and pass/fail results;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation, especially whether the next slice should
  add neutral bridge environment aliases or retire legacy Codex naming in docs.
