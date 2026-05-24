# Agent Terminal Legacy Doc Cleanup Audit

**Date:** 2026-05-23
**Status:** docs-only cleanup audit after bridge env hard cutover

## Active Contract

The canonical toolkit Agent Terminal bridge env contract is
`AGENT_TERMINAL_*`. Current bridge docs should teach the toolkit-owned
component and bridge server as the active implementation:

- `packages/toolkit/components/agent-terminal/launch.sh`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `packages/toolkit/components/agent-terminal/session-inspector-server.mjs`
- `packages/toolkit/components/agent-terminal/pty-proxy.py`

Historical Sigil/Codex terminal paths may remain as compatibility file-path
entrypoints when they delegate to the canonical implementation:

- `apps/sigil/agent-terminal/launch.sh` is the canonical Sigil wrapper launch.
- `apps/sigil/codex-terminal/launch.sh` is a historical launcher shim.
- `apps/sigil/codex-terminal/server.mjs`,
  `apps/sigil/codex-terminal/session-inspector.mjs`, and
  `apps/sigil/codex-terminal/pty-proxy.py` are historical file-path shims around
  toolkit implementation files.

Those path shims do not imply a separate active env-alias contract.

## Obsolete Env Names

The hard cutover removed these obsolete active bridge env names from owned code
and tests:

- `SIGIL_AGENT_*`
- `SIGIL_CODEX_*`
- `CODEX_COMMAND`
- `SIGIL_AGENT_PTY_CHILD_PID`

The PTY child PID side channel is now `AGENT_TERMINAL_PTY_CHILD_PID`.

## Remaining Hit Classification

### Current Docs

Current-doc cleanup targets were updated to describe the active
`AGENT_TERMINAL_*` contract and historical path-shim shape:

- `docs/api/toolkit/components.md`
- `docs/dev/reports/toolkit-surface-audit.md`
- `docs/design/aos-surface-stack-v0-integration-ledger.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`

These docs should not teach `SIGIL_AGENT_*`, `SIGIL_CODEX_*`, `CODEX_COMMAND`,
or `SIGIL_AGENT_PTY_CHILD_PID` as active bridge env names.

### Superseded Work Cards

Several work cards intentionally preserve old requirements or rejected policy
history. They are historical task contracts, not current active-contract docs:

- `toolkit-agent-terminal-neutral-bridge-env-aliases-v0.md` records the
  superseded alias-preservation direction.
- `toolkit-agent-terminal-neutral-bridge-env-hard-cutover-correction-v0.md`
  records the cutover requirements and the obsolete names removed.
- older AFK bridge, PTY, launch-attempt, and operator proof cards quote the
  bridge shape that existed when those tasks were assigned.

Do not rewrite these cards wholesale unless a future card explicitly asks for
historical note normalization.

### Historical And Manual Receipts

Manual receipts under `docs/design/notes/manual-afk-receipts/` quote commands
that were actually run with old `SIGIL_AGENT_*` env names and
`apps/sigil/codex-terminal/server.mjs`. Those quotes are evidence and may stay
unchanged. If a receipt is later promoted into a current SOP, add a local note
or rewrite the command to use `AGENT_TERMINAL_*`.

### Future Roadmap Candidates

The audit surfaced broader candidates that are outside this cleanup slice:

- decide when the `apps/sigil/codex-terminal/*` file-path shims no longer
  reduce operator friction and can be retired;
- add a provider-launch acceptance surface that can observe provider session id
  before catalog match;
- keep AFK dispatch docs provider-neutral and avoid making Sigil or the gateway
  the primitive owner of provider session lifecycle.
