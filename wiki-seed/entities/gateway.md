---
type: entity
name: Gateway
description: MCP server for typed script execution and cross-harness coordination
tags: [infrastructure, mcp, tools]
---

# Gateway

The gateway is an MCP (Model Context Protocol) server that provides typed tool access to the agent-os runtime. It exposes coordination tools (session management, state, messaging) and execution tools (OS script running, script registry).

## Location

`packages/gateway/` in the agent-os repo. Runs as a Node.js process, typically started via MCP configuration in `.mcp.json`.

## Tools

### Coordination
- `register_session` — register a named session with metadata
- `set_state` / `get_state` — per-session key-value state
- `post_message` / `read_stream` — cross-session messaging
- `who_is_online` — list active sessions

### Execution
- `run_os_script` — execute TypeScript scripts with SDK access
- `save_script` / `list_scripts` — persistent script registry
- `discover_capabilities` — runtime capability detection

## Related
- [IPC Protocol](../concepts/ipc-protocol.md)
- [Daemon](./daemon.md)
