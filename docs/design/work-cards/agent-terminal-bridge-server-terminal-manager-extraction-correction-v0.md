# Agent Terminal Bridge Server Terminal Manager Extraction Correction V0

## Recipient

GDI

## Transfer Kind

Correction round

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, provider, issue, or prior implementation state. Read and rediscover
before editing.

## Source Artifact

Foreman reviewed:

- branch: `gdi/agent-terminal-bridge-server-terminal-manager-extraction-v0`
- reviewed head: `332106d15c8cfafa8ca00a8e45006f116a84eee0`
- original work card:
  `docs/design/work-cards/agent-terminal-bridge-server-terminal-manager-extraction-v0.md`

The extraction boundary is mostly sound, but the `/snapshot` route regressed
exited process-driver session behavior.

## Goal

Preserve the pre-extraction `/snapshot` behavior for exited process-driver
sessions while keeping the new terminal manager boundary.

Before the extraction, process-driver session records stayed in memory after the
child exited. `/snapshot` returned `200` with the buffered output, `driver:
process`, and `command: exited`. After the extraction, `bridge-server.mjs` gates
`/snapshot` with `terminalManager.hasSession(session)`, and `hasSession` returns
false for exited process records. That turns an existing exited process snapshot
into a `404`.

## Branch / Base

- branch_from:
  `origin/foreman/agent-terminal-bridge-server-terminal-manager-extraction-correction-v0`
- required_start_ref:
  `origin/foreman/agent-terminal-bridge-server-terminal-manager-extraction-correction-v0`
- required_start_sha: `332106d15c8cfafa8ca00a8e45006f116a84eee0` plus this
  correction card
- output_branch:
  `gdi/agent-terminal-bridge-server-terminal-manager-extraction-correction-v0`

Do not reset to `origin/main`; this correction must apply on top of the reviewed
GDI extraction branch.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/agent-terminal-bridge-server-terminal-manager-extraction-v0.md`
- `docs/design/work-cards/agent-terminal-bridge-server-terminal-manager-extraction-correction-v0.md`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`
- `tests/afk-terminal-substrate-no-provider.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/foreman/agent-terminal-bridge-server-terminal-manager-extraction-correction-v0
```

This slice is deterministic. Do not run live launchers, providers, AOS canvases,
or tmux-dependent live checks beyond existing deterministic test guards.

## Finding To Fix

Pre-extraction route behavior in `bridge-server.mjs`:

```js
if (!processSessions.has(session) && !hasSession(session)) {
  text(res, 404, `tmux session not found: ${session}`);
  return;
}
json(res, 200, capture(session, url.searchParams.get('lines')));
```

Pre-extraction `capture()` returned a process snapshot whenever
`processSessions.get(session)` existed, including exited records.

Current extracted route:

```js
if (!terminalManager.hasSession(session)) {
  text(res, 404, `tmux session not found: ${session}`);
  return;
}
json(res, 200, terminalManager.capture(session, url.searchParams.get('lines')));
```

Current `terminalManager.hasSession(session)` only returns true for non-exited
process records or live tmux sessions. That blocks the manager's own
`capture()` support for exited process records.

## Required Behavior

1. Restore exited process snapshot behavior.

   `/snapshot` must return the stored process snapshot for an exited process
   session record, preserving:

   - HTTP status `200`;
   - `driver: "process"`;
   - `command: "exited"`;
   - buffered terminal text, including the original command output and process
     exit marker;
   - existing `process_child_pid`, `command_child_pid`, and `terminal` fields
     when present.

2. Preserve missing-session behavior.

   A truly missing session should still return the existing `404` text shape:

   - `tmux session not found: <session>`

   Do not turn missing snapshots into `500` errors by blindly calling
   `capture()` and relying on the route-level catch.

3. Keep the manager boundary.

   Prefer a small manager method such as `canCapture(session)`,
   `hasCapture(session)`, or similar that reflects the old
   `processSessions.has(session) || hasSession(session)` gate. Use the name that
   best fits the implementation.

   Do not reintroduce direct `processSessions` ownership into
   `bridge-server.mjs`.

4. Add deterministic regression coverage.

   Extend `tests/sigil-agent-terminal-server.test.mjs` or another focused test
   so a process-driver session that exits quickly can still be fetched through
   `/snapshot` after exit. The assertion should fail against the reviewed
   `332106d` behavior.

   A good shape is:

   - `/ensure` a process-driver session with a harmless command that prints a
     unique marker and exits;
   - wait until `/snapshot` includes the marker and/or exit marker;
   - assert the final `/snapshot` response is `200`;
   - assert `snapshot.driver === "process"`;
   - assert `snapshot.command === "exited"`;
   - assert text includes the unique marker.

5. Keep the original extraction scope.

   Do not extract route handlers, provider catalog adapters, session inspector
   code, launcher shell helpers, frontend APIs, or shim retirement in this
   correction.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not open AOS canvases, drive live UI, mutate live dock sessions, or depend
  on tmux state for required evidence beyond existing deterministic test guards.
- Do not read provider transcript bodies or real provider session stores.
- Do not mutate provider config, gateway state, dock profiles, hooks, GitHub
  issues, PRs, release state, or unrelated runtime artifacts.
- Do not remove historical `apps/sigil/codex-terminal/*` shims.
- Do not add compatibility env aliases for old `SIGIL_AGENT_*`,
  `SIGIL_CODEX_*`, or `CODEX_COMMAND` names.
- Do not broaden into AFK scheduler, gateway, result-route, catalog, telemetry,
  route-handler extraction, launcher DRY work, or shim retirement.

## Verification

Run:

```bash
node --check packages/toolkit/components/agent-terminal/bridge-server.mjs
node --check packages/toolkit/components/agent-terminal/terminal-session-manager.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
git diff --check
```

If you change more than the bridge server, terminal manager, and focused tests,
run the additional focused checks implied by those files and report them.

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- exact manager API or route guard correction;
- regression coverage added;
- compatibility behavior preserved, especially historical Sigil/Codex shim and
  `appendProcessStderr`;
- whether any live provider, AOS canvas, tmux session, provider transcript, or
  real provider store was touched;
- verification commands and pass/fail results;
- local-only state;
- remaining follow-up recommendation.
