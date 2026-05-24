# Toolkit Agent Terminal Neutral Bridge Env Aliases V0

## Superseded

This work card is superseded by
`docs/design/work-cards/toolkit-agent-terminal-neutral-bridge-env-hard-cutover-correction-v0.md`.

The compatibility policy in this card was rejected after review. Agent OS is
pre-release, so owned repo callers, tests, and docs should be migrated to the
canonical names instead of preserving broad `SIGIL_AGENT_*` and
`SIGIL_CODEX_*` bridge environment aliases.

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Add neutral `AGENT_TERMINAL_*` bridge environment aliases now that the Agent
Terminal bridge substrate is toolkit-owned, while preserving all historical
`SIGIL_AGENT_*` and `SIGIL_CODEX_*` compatibility behavior.

The preceding slices moved the bridge server into toolkit and inverted the Sigil
launcher compatibility path. The remaining naming leak is that generic toolkit
launchers and the toolkit bridge server still primarily speak `SIGIL_AGENT_*`
environment names.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `85ae19292b8a3fe127861b9425122bb77d6165fe` or later with this work card
- output_branch: `gdi/toolkit-agent-terminal-neutral-bridge-env-aliases-v0`

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/toolkit-agent-terminal-bridge-server-substrate-v0.md`
- `docs/design/work-cards/sigil-agent-terminal-launcher-compatibility-inversion-v0.md`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `packages/toolkit/components/agent-terminal/pty-proxy.py`
- `packages/toolkit/components/agent-terminal/launch.sh`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/codex-terminal/launch.sh`
- `tests/renderer/agent-terminal-chrome.test.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`
- `tests/afk-terminal-substrate-no-provider.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
```

This slice is deterministic. Do not run `./aos ready`; live proof is not
required.

## Required Behavior

1. Add neutral bridge env aliases in the toolkit bridge server.

   `packages/toolkit/components/agent-terminal/bridge-server.mjs` should accept
   neutral aliases before legacy names:

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

   Preserve existing fallback order after the neutral name:
   `SIGIL_AGENT_*`, then `SIGIL_CODEX_*`, then the current literal default.
   Preserve the generic `PORT` fallback for the port.

2. Update toolkit-owned launchers to pass neutral env names to the toolkit
   bridge.

   Update both:

   - `packages/toolkit/components/agent-terminal/launch.sh`
   - `apps/sigil/agent-terminal/launch.sh`

   The generic toolkit launcher should not inject Sigil-named env variables when
   starting the toolkit bridge. The Sigil launcher may remain Sigil-specific for
   content roots, avatar setup, canvas IDs, and wrapper behavior, but its bridge
   server environment should use the neutral aliases.

3. Preserve historical launch and direct-server compatibility.

   Existing direct usages with `SIGIL_AGENT_*` and `SIGIL_CODEX_*` must still
   work. Do not remove legacy env support from `bridge-server.mjs`,
   `pty-proxy.py`, tests, or docs unless replaced by an explicit compatibility
   assertion.

4. Neutralize the PTY proxy side channel only if it stays compatible.

   The current PTY proxy emits `SIGIL_AGENT_PTY_CHILD_PID=<pid>` and the bridge
   parser consumes it. If you change this to a neutral
   `AGENT_TERMINAL_PTY_CHILD_PID=<pid>` marker, the bridge must still parse the
   legacy marker and tests must cover both. If that increases the slice size,
   keep the marker unchanged and call it out as a remaining follow-up.

5. Update focused tests.

   Tests should prove:

   - neutral env aliases configure bridge startup;
   - legacy `SIGIL_AGENT_*` direct-server env still works;
   - legacy `SIGIL_CODEX_*` direct-server env still works where already
     supported;
   - toolkit and Sigil launchers pass neutral bridge env names;
   - the generic toolkit launcher remains free of Sigil-specific launch
     behavior such as `avatar-main`, Sigil content roots, and Sigil canvases.

## Suggested Implementation Areas

- Add a small env lookup helper in `bridge-server.mjs` rather than repeating
  long `process.env.A || process.env.B || ...` chains if that makes the fallback
  order easier to test and read.
- Update `packages/toolkit/components/agent-terminal/pty-proxy.py` to accept
  `AGENT_TERMINAL_COLS` / `AGENT_TERMINAL_ROWS` before legacy
  `SIGIL_AGENT_TERMINAL_COLS` / `SIGIL_CODEX_TERMINAL_COLS` if you are already
  touching PTY sizing.
- Prefer focused assertions in existing test files over adding broad new
  integration coverage.
- Update public docs only where they describe the bridge env contract as current
  behavior. Do not rewrite historical work cards solely to rename legacy env
  examples.

## Hard Boundaries

- Do not remove `SIGIL_AGENT_*` or `SIGIL_CODEX_*` compatibility.
- Do not change HTTP endpoint behavior, response shapes, provider catalog
  behavior, session inspector behavior, PTY input/resize semantics, or frontend
  rendering.
- Do not change Sigil avatar/canvas behavior.
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
- exact neutral aliases added;
- compatibility evidence for `SIGIL_AGENT_*` and `SIGIL_CODEX_*`;
- whether the PTY child PID marker was neutralized or intentionally left as a
  follow-up;
- confirmation that toolkit generic launch, Sigil wrapper launch, historical
  compatibility paths, bridge startup, and CLI flags remain unchanged;
- verification commands and pass/fail results;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation, especially whether the next slice should
  retire legacy Codex naming in docs or leave it as historical compatibility.
