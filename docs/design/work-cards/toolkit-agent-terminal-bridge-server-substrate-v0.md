# Toolkit Agent Terminal Bridge Server Substrate V0

## Recipient

GDI

## Transfer Kind

GDI round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Move the generic Agent Terminal bridge server substrate out of
`apps/sigil/codex-terminal/` and into the toolkit Agent Terminal component,
while preserving the existing Sigil/Codex compatibility entrypoints.

This is the next ownership step after the Agent Terminal frontend extraction:
the rendered surface is toolkit-owned, but the local HTTP/WebSocket bridge,
session inspector adapter, and PTY proxy are still physically owned by the
historical Sigil/Codex terminal path.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main` at
  `87ac532bf2114f70086db4f1b0cda93932ac400b` or later with this work card
- output_branch: `gdi/toolkit-agent-terminal-bridge-server-substrate-v0`

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/components.md`
- `docs/design/work-cards/toolkit-agent-terminal-foundation-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-bridge-client-v0.md`
- `docs/design/work-cards/toolkit-agent-terminal-session-rail-view-v0.md`
- `packages/toolkit/components/agent-terminal/launch.sh`
- `packages/toolkit/components/agent-terminal/bridge-client.js`
- `packages/toolkit/components/agent-terminal/index.html`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/agent-terminal/index.html`
- `apps/sigil/codex-terminal/launch.sh`
- `apps/sigil/codex-terminal/server.mjs`
- `apps/sigil/codex-terminal/session-inspector.mjs`
- `apps/sigil/codex-terminal/pty-proxy.py`
- `tests/sigil-agent-terminal-server.test.mjs`
- `tests/renderer/agent-terminal-chrome.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
```

This slice is deterministic. Do not run `./aos ready`; live proof is not
required.

## Existing Code To Inspect

- `packages/toolkit/components/agent-terminal/launch.sh` - generic toolkit
  launcher currently sets `BRIDGE_DIR="$REPO_ROOT/apps/sigil/codex-terminal"`
  and starts `server.mjs` from that Sigil path.
- `apps/sigil/codex-terminal/server.mjs` - owns the current local bridge server:
  `/health`, `/sessions`, `/dock-terminal-session`, `/session-inspector`,
  `/snapshot`, `/ensure`, `/resize`, `/input`, `/key`, and `/terminal`
  WebSocket upgrade behavior.
- `apps/sigil/codex-terminal/session-inspector.mjs` - owns sanitized provider
  telemetry adapter behavior for the bridge's `/session-inspector` endpoint.
- `apps/sigil/codex-terminal/pty-proxy.py` - owns process-driver PTY
  forwarding and resize control frames.
- `tests/sigil-agent-terminal-server.test.mjs` - deterministic process-driver,
  catalog, inspector, launch/static, and PTY proxy coverage. Update this test
  so the toolkit path is primary while compatibility behavior remains covered.

## Required Behavior

1. Add toolkit-owned bridge substrate files under
   `packages/toolkit/components/agent-terminal/`.

   Expected shape:

   - `bridge-server.mjs` or similarly named server entrypoint;
   - `session-inspector-server.mjs`, `session-inspector-adapter.mjs`, or a
     similarly named extracted inspector adapter if keeping it separate remains
     clearer;
   - `pty-proxy.py`.

2. Make the toolkit launcher use the toolkit-owned bridge server path.

   `packages/toolkit/components/agent-terminal/launch.sh` should no longer use
   `apps/sigil/codex-terminal` as its bridge implementation directory.

3. Preserve existing bridge behavior.

   Do not intentionally change endpoint names, response shapes, default process
   driver behavior, tmux/process selection, WebSocket frame behavior, PTY resize
   behavior, provider catalog behavior, session inspector sanitization, cleanup
   behavior, or the existing compatibility environment variable names.

4. Preserve Sigil and historical Codex terminal compatibility.

   `apps/sigil/agent-terminal/launch.sh` should keep launching the Sigil Agent
   Terminal wrapper. `apps/sigil/codex-terminal/` should remain usable as a
   compatibility path, but it should delegate to or re-export the toolkit-owned
   bridge substrate rather than owning the implementation. Use thin shims or
   direct launcher references as appropriate.

5. Keep the bridge generic in ownership and naming where changing names is
   local and low-risk.

   New toolkit files should not introduce new Sigil-only behavior. Existing
   `SIGIL_AGENT_*` and `SIGIL_CODEX_*` environment names may remain for
   compatibility. You may add neutral aliases only if the change is small and
   deterministic, but do not require callers to migrate in this slice.

6. Update docs and tests to reflect the new ownership.

   `docs/api/toolkit/components.md` should no longer say that the generic
   toolkit Agent Terminal reuses the Sigil bridge/server substrate as the
   implementation. It may mention that historical Sigil/Codex entrypoints
   remain compatibility wrappers.

## Suggested Implementation Areas

- Move or copy-and-shim:
  - `apps/sigil/codex-terminal/server.mjs` ->
    `packages/toolkit/components/agent-terminal/bridge-server.mjs`
  - `apps/sigil/codex-terminal/session-inspector.mjs` ->
    `packages/toolkit/components/agent-terminal/session-inspector-server.mjs`
  - `apps/sigil/codex-terminal/pty-proxy.py` ->
    `packages/toolkit/components/agent-terminal/pty-proxy.py`
- Leave `apps/sigil/codex-terminal/server.mjs` as a thin executable shim that
  imports the toolkit server and preserves `appendProcessStderr` exports for
  compatibility if needed.
- Leave `apps/sigil/codex-terminal/session-inspector.mjs` as a thin re-export
  if any old imports remain.
- Leave `apps/sigil/codex-terminal/pty-proxy.py` as a small wrapper or update
  all deterministic references to the toolkit path while proving the old path
  still behaves.
- Update `tests/sigil-agent-terminal-server.test.mjs` to spawn/import the
  toolkit bridge server as the primary path and add targeted compatibility
  assertions for the old Sigil/Codex path.
- Update `tests/renderer/agent-terminal-chrome.test.mjs` only if it helps keep
  the toolkit boundary explicit without making static checks brittle.

## Hard Boundaries

- Do not change `packages/host/src/session-catalog.ts` or provider telemetry
  extraction behavior unless a relative import move requires only path fixes.
- Do not change provider catalog semantics, transcript parsing semantics,
  session inspector response shape, PTY framing, endpoint names, or HTTP status
  behavior.
- Do not remove `apps/sigil/codex-terminal/` compatibility entrypoints in this
  slice.
- Do not launch or drive live Codex, Claude, tmux, AOS canvases, or providers.
- Do not read provider transcript bodies outside deterministic test fixtures.
- Do not mutate provider configs, keymaps, stores, catalogs, telemetry,
  gateway/dock runtime, GitHub state, or unrelated Sigil renderer code.
- Do not remove or relax `--i-am-present`.
- Do not start async result routing.

## Verification

Run the focused deterministic checks:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --check packages/toolkit/components/agent-terminal/bridge-server.mjs
python3 -m py_compile packages/toolkit/components/agent-terminal/pty-proxy.py
git diff --check
```

If compatibility shims remain executable, also run focused syntax checks for
them, such as:

```bash
node --check apps/sigil/codex-terminal/server.mjs
python3 -m py_compile apps/sigil/codex-terminal/pty-proxy.py
```

If you choose different toolkit filenames, run the equivalent checks and report
the exact paths.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- which toolkit-owned bridge substrate files were created;
- which Sigil/Codex compatibility shims remain and how they delegate;
- how the toolkit launcher now starts the bridge;
- confirmation that endpoint behavior, PTY behavior, session inspector
  sanitization, Sigil wrapper behavior, and historical compatibility paths
  remain unchanged;
- verification commands and pass/fail results;
- local-only state, including dirty files, generated assets, daemon state, or
  skipped live checks;
- remaining follow-up recommendation, especially whether a later slice should
  rename environment variables, split tests, or retire legacy Codex naming.
