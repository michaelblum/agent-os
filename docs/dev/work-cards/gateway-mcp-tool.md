# Work Card — Gateway `user_signal_surface` MCP Tool

## Goal

Add a `user_signal_surface` MCP tool to the Agent-OS gateway. This is a thin
adapter (~12 lines) that shells out to `./aos gate ask` and returns the
resolved values. Its purpose is to give MCP-connected AI agents (Claude.ai,
Cursor, or any external MCP host without shell access) a callable interface
into the human-in-the-loop signal surface.

## Design Reference

Read `docs/design/user-signal-surface.md` before implementing.

## Deliverables

### 1. MCP tool registration
- `packages/gateway/tools/user-signal-surface.js` — MCP tool definition:
  - Tool name: `user_signal_surface`
  - Input schema: mirrors `aos.gate.request.v1` fields (`prompt`, `fields[]`,
    `timeout_ms`, `source`) — see `shared/schemas/aos.gate.request.v1.json`
  - Handler: shells out to `./aos gate ask --request <tempfile>` with the
    request JSON, captures stdout, parses and returns resolved values
  - Exits with MCP tool error on non-zero exit code or timeout

### 2. Gateway registration
- Register `user_signal_surface` in the gateway tool index so it is advertised
  to MCP clients on connection.

### 3. Tests
- `tests/gateway/user-signal-surface.test.mjs` — unit tests with a mocked
  `./aos gate ask` subprocess. Cover: successful resolution, non-zero exit
  (rejection), timeout, and malformed stdout.

## Reference Implementations

- Gate CLI verb: `packages/cli/verbs/gate-ask.js`
- Gate service: `packages/daemon/gate/index.js`
- Schema: `shared/schemas/aos.gate.request.v1.json`
- Existing gateway tools (pattern reference): `packages/gateway/tools/`
- Test pattern: `tests/daemon/gate-service.test.mjs`

## Verification

```bash
node --test tests/gateway/user-signal-surface.test.mjs
node --test tests/toolkit/*.test.mjs   # must still be 817/817
node --test tests/daemon/*.test.mjs    # must still be 10/10
```

All must pass before committing.

## Git

1. Follow all preconditions in `.docks/gdi/AGENTS.md` (fetch, reset, branch)
2. Branch: `gdi/gateway-mcp-tool`
3. Stage only the files listed in Deliverables above — explicit paths, no wildcards
4. Commit, push, run `git show --stat HEAD`
5. Report: branch name + HEAD SHA + `git show --stat HEAD` output + test results
6. Do NOT merge to main — relay partner handles merge
