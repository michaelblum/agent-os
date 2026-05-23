# Dock Terminal Session CWD Correction v0

## Recipient

GDI

## Transfer Kind

Correction round

## Goal

Correct Agent Terminal dock terminal session cwd/root reporting so
`/dock-terminal-session` references the actual PTY substrate rather than
inferring a dock cwd that may differ from the running session.

The registry slice is useful, but this endpoint truthfulness issue blocks
acceptance.

## Branch / Base

- branch_from: `gdi/dock-terminal-session-registry-v0`
- required_start_ref:
  `gdi/dock-terminal-session-registry-v0` at
  `b5341c34f9dcb7f43fe91ae717e0f8257b1e3fef`
- expected_output_branch: `gdi/dock-terminal-session-cwd-correction-v0`

## Review Finding

In `apps/sigil/codex-terminal/server.mjs`, `dockTerminalSessionForUrl()` builds
the receipt with:

```js
cwd: url.searchParams.get('cwd') || process.env.SIGIL_AGENT_DOCK_CWD || undefined
```

When neither value is supplied, `createDockTerminalSessionReceipt()` defaults
to `repoRoot/.docks/<dock>`. That can differ from the actual PTY/default session
cwd, which is available through `terminalCwdForSession(session)` and ultimately
from `SIGIL_AGENT_CWD` or `sessionCommands`.

The current server test illustrates the risk: it starts the process-driver
terminal with a fixture `SIGIL_AGENT_CWD`, but the new endpoint asserts
`.docks/gdi` instead of the actual terminal cwd. A dock terminal session
observation should not claim a cwd that is not the active substrate.

## Required Behavior

- `/dock-terminal-session` should report the active session cwd from
  `terminalCwdForSession(session)` by default.
- An explicit `cwd` query param or intentionally named override may still be
  accepted when the caller is deliberately describing a dock cwd, but the test
  must make that distinction clear.
- The endpoint must not silently claim `.docks/<dock>` when the active PTY cwd is
  different.
- `apps/sigil/codex-terminal/launch.sh` should pass a stable repo root to
  `server.mjs` for both tmux and non-tmux startup paths, for example
  `SIGIL_AGENT_REPO_ROOT="$REPO_ROOT"`, unless an equivalent tested root
  derivation already exists.
- Preserve the registry helper defaults for deterministic fixture receipts when
  called directly with only `repoRoot` and `dock`.
- Preserve AFK warm reuse receipt behavior and provider acceptance semantics.

## Tests

Add or update focused tests proving:

- Agent Terminal `/dock-terminal-session` default cwd equals the active session
  cwd/default bridge cwd, not inferred `.docks/<dock>`.
- Explicit dock cwd override still works when supplied.
- Launcher text or behavior passes stable repo root to `server.mjs` in both
  tmux and non-tmux paths, if changed.
- Existing fixture-backed dock terminal session receipts for `foreman`, `gdi`,
  and `operator` still validate.
- AFK warm reuse receipts still include `owner: "aos.dock_terminal_session"` and
  stable `dock_terminal_session_id`.

Run:

```bash
./aos ready
node --test tests/schemas/aos-dock-terminal-session-v0.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-session-trigger-prototype.test.mjs
git diff --check
```

If `./aos ready` reports a repo-mode permission blocker, use the standard GDI
human-needed path and stop instead of routing around it:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
./aos ready --post-permission
```

## Boundaries

- Do not drive real dock terminals.
- Do not launch live providers.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not start async result routing.
- Do not create PRs, mutate GitHub issues, merge to main, or mutate main.
- Do not route Operator live proof in this slice.

## Completion Report

Report:

- branch and head SHA
- base SHA
- changed files
- exact cwd/root behavior chosen
- verification commands and results
- any remaining risk or follow-up
- statement confirming the boundaries above were respected
