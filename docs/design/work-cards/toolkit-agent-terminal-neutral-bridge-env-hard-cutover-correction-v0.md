# Toolkit Agent Terminal Neutral Bridge Env Hard Cutover Correction V0

## Recipient

GDI

## Transfer Kind

Correction round

## Source Artifact

- Superseded card:
  `docs/design/work-cards/toolkit-agent-terminal-neutral-bridge-env-aliases-v0.md`
- Rejected implementation branch:
  `origin/gdi/toolkit-agent-terminal-neutral-bridge-env-aliases-v0`
- Rejected commit:
  `b17881f7a2d64f1eb625d769ced66721f3300f01`

Do not integrate `b17881f7` unchanged. Inspect it for useful mechanical edits,
but the final direction must follow this correction card.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make `AGENT_TERMINAL_*` the canonical toolkit Agent Terminal bridge environment
contract and remove broad legacy bridge env fallbacks.

This supersedes the prior alias-preservation policy. Agent OS is still
pre-release, has no external consumer base, and the owned repo callers, tests,
and docs should be migrated immediately instead of keeping compatibility alias
layers that future agents can confuse for active contract.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `3a15150d2f5dfe2ed78d6eb58b7116eff06c1601` or later with this correction
  card
- output_branch:
  `gdi/toolkit-agent-terminal-neutral-bridge-env-hard-cutover-correction-v0`

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/toolkit-agent-terminal-neutral-bridge-env-aliases-v0.md`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `packages/toolkit/components/agent-terminal/pty-proxy.py`
- `packages/toolkit/components/agent-terminal/launch.sh`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/codex-terminal/launch.sh`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`
- `tests/afk-terminal-substrate-no-provider.test.mjs`

Then inspect the rejected implementation for awareness:

```bash
git fetch origin gdi/toolkit-agent-terminal-neutral-bridge-env-aliases-v0
git diff --stat origin/main..origin/gdi/toolkit-agent-terminal-neutral-bridge-env-aliases-v0
git diff origin/main..origin/gdi/toolkit-agent-terminal-neutral-bridge-env-aliases-v0 -- \
  packages/toolkit/components/agent-terminal/bridge-server.mjs \
  packages/toolkit/components/agent-terminal/pty-proxy.py \
  packages/toolkit/components/agent-terminal/launch.sh \
  apps/sigil/agent-terminal/launch.sh \
  tests/renderer/agent-terminal-chrome.test.mjs \
  tests/sigil-agent-terminal-server.test.mjs \
  tests/afk-terminal-substrate-no-provider.test.mjs
```

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
```

This slice is deterministic. Do not run `./aos ready`; live proof is not
required.

## Required Behavior

1. Canonicalize bridge server env names.

   `packages/toolkit/components/agent-terminal/bridge-server.mjs` should read
   these canonical names:

   - `AGENT_TERMINAL_PORT`
   - `AGENT_TERMINAL_TMUX_SESSION`
   - `AGENT_TERMINAL_CWD`
   - `AGENT_TERMINAL_COMMAND`
   - `AGENT_TERMINAL_REPO_ROOT`
   - `AGENT_TERMINAL_DRIVER`
   - `AGENT_TERMINAL_COLS`
   - `AGENT_TERMINAL_ROWS`
   - `AGENT_TERMINAL_DOCK`
   - `AGENT_TERMINAL_DOCK_CWD`
   - `AGENT_TERMINAL_CATALOG_HOME`
   - `AGENT_TERMINAL_CODEX_ROOT`
   - `AGENT_TERMINAL_CLAUDE_ROOT`

   Remove broad `SIGIL_AGENT_*` and `SIGIL_CODEX_*` bridge env fallbacks from
   the toolkit bridge server. Preserve the generic `PORT` fallback for port only
   if it remains useful and tested as a generic process convention.

2. Migrate owned launchers to the canonical bridge env.

   Update both:

   - `packages/toolkit/components/agent-terminal/launch.sh`
   - `apps/sigil/agent-terminal/launch.sh`

   Both launchers should pass `AGENT_TERMINAL_*` env names when starting
   `bridge-server.mjs`, in tmux and no-tmux paths.

   Do not add translation code in `apps/sigil/codex-terminal/launch.sh`; that
   historical file-path shim may continue to delegate to
   `../agent-terminal/launch.sh`, but it should not preserve old bridge env
   names.

3. Remove obsolete owned env aliases.

   Remove direct support for:

   - `SIGIL_AGENT_TERMINAL_PORT`
   - `SIGIL_CODEX_TERMINAL_PORT`
   - `SIGIL_AGENT_TMUX_SESSION`
   - `SIGIL_CODEX_TMUX_SESSION`
   - `SIGIL_AGENT_CWD`
   - `SIGIL_CODEX_CWD`
   - `SIGIL_AGENT_COMMAND`
   - `SIGIL_CODEX_COMMAND`
   - `SIGIL_AGENT_REPO_ROOT`
   - `SIGIL_CODEX_REPO_ROOT`
   - `SIGIL_AGENT_TERMINAL_DRIVER`
   - `SIGIL_CODEX_TERMINAL_DRIVER`
   - `SIGIL_AGENT_TERMINAL_COLS`
   - `SIGIL_CODEX_TERMINAL_COLS`
   - `SIGIL_AGENT_TERMINAL_ROWS`
   - `SIGIL_CODEX_TERMINAL_ROWS`
   - `SIGIL_AGENT_DOCK`
   - `SIGIL_AGENT_DOCK_CWD`
   - `SIGIL_AGENT_CATALOG_HOME`
   - `SIGIL_AGENT_CODEX_ROOT`
   - `SIGIL_AGENT_CLAUDE_ROOT`

   Also remove `CODEX_COMMAND` launcher fallback unless you find a concrete
   non-updatable consumer. If you keep any legacy env name, document the exact
   non-updatable consumer, a removal gate, and a focused test. Do not keep
   aliases for owned tests, docs, launchers, or historical convenience.

4. Neutralize the PTY side channel.

   Change the PTY child PID marker from `SIGIL_AGENT_PTY_CHILD_PID=<pid>` to
   `AGENT_TERMINAL_PTY_CHILD_PID=<pid>` and update the bridge parser/tests.
   Do not preserve the legacy marker unless you identify a concrete
   non-updatable consumer and explicit removal gate.

5. Keep file-path compatibility, not env alias compatibility.

   Historical path shims may remain:

   - `apps/sigil/codex-terminal/launch.sh`
   - `apps/sigil/codex-terminal/server.mjs`
   - `apps/sigil/codex-terminal/session-inspector.mjs`
   - `apps/sigil/codex-terminal/pty-proxy.py`

   These are file/path entrypoint compatibility shims. They should point at the
   canonical toolkit/Sigil implementation without preserving obsolete bridge env
   variables.

6. Update owned tests and current docs.

   Tests should prove:

   - canonical `AGENT_TERMINAL_*` env configures bridge startup;
   - toolkit and Sigil launchers pass canonical bridge env names;
   - bridge server, PTY proxy, and launcher code no longer contain broad
     `SIGIL_AGENT_*`, `SIGIL_CODEX_*`, or `CODEX_COMMAND` bridge/env alias
     fallbacks;
   - the historical Codex terminal file-path shims still delegate to canonical
     implementation files;
   - the generic toolkit launcher remains free of Sigil-specific launch behavior
     such as `avatar-main`, Sigil content roots, and Sigil canvases.

   Update current docs and design notes that present bridge env names as current
   behavior. Historical manual receipts that quote commands actually run in the
   past may either remain unchanged as evidence or receive a short note that the
   quoted env names are historical and superseded. Do not leave current docs
   teaching old env names as the active contract.

## Suggested Implementation Areas

- You may reuse the rejected branch's launcher edits that pass
  `AGENT_TERMINAL_*`, but remove its fallback lists and legacy-alias tests.
- Add a small `envValue(name, fallback)` helper only if it improves readability;
  do not use it to preserve broad legacy alias chains.
- Consider changing the bridge server direct-run default session from the
  Sigil-flavored `sigil-agent-terminal-agent-os` to a neutral default such as
  `aos-agent-terminal-agent-os`. Sigil launch behavior should remain unchanged
  because the Sigil launcher passes its explicit session.

## Hard Boundaries

- Do not change HTTP endpoint behavior, response shapes, provider catalog
  behavior, session inspector behavior, PTY input/resize semantics, or frontend
  rendering.
- Do not change Sigil avatar/canvas behavior.
- Do not remove historical Codex terminal file-path compatibility entrypoints.
- Do not launch or drive live Codex, Claude, tmux, AOS canvases, or providers.
- Do not read provider transcript bodies.
- Do not mutate provider configs, keymaps, stores, catalogs, telemetry,
  gateway/dock runtime, GitHub state, or unrelated Sigil renderer code.
- Do not remove or relax `--i-am-present`.
- Do not start async result routing.

## Verification

Run the focused deterministic checks:

```bash
bash -n packages/toolkit/components/agent-terminal/launch.sh
bash -n apps/sigil/agent-terminal/launch.sh
bash -n apps/sigil/codex-terminal/launch.sh
node --check packages/toolkit/components/agent-terminal/bridge-server.mjs
python3 -m py_compile packages/toolkit/components/agent-terminal/pty-proxy.py
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
git diff --check
```

If you add or update another focused test, run it and report the exact command.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- rejected-branch awareness: what was reused, discarded, or rewritten from
  `b17881f7`;
- exact canonical env names now supported;
- exact obsolete env names removed;
- whether any legacy env name remains, with non-updatable consumer and removal
  gate if so;
- PTY child PID marker status;
- confirmation that toolkit generic launch, Sigil wrapper launch, historical
  file-path shims, bridge startup, and CLI flags remain unchanged;
- verification commands and pass/fail results;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation, especially whether the next slice should
  retire more legacy Codex naming in docs or leave it as historical wording.
