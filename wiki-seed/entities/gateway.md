---
type: entity
name: Gateway
description: External adapter package for MCP access and provider integrations
tags: [infrastructure, mcp, tools]
---

# Gateway

The gateway is an external adapter package for agent-os. It exposes bounded MCP script execution for external harnesses and hosts the integration broker used by provider adapters such as Slack.

The daemon owns agent/session communication. Gateway state is for provider jobs, workflow launches, and broker-local UI state; it is not the authoritative coordination bus for autonomous coding sessions.

## Location

`packages/gateway/` in the agent-os repo. The MCP adapter can be started from a harness configuration. The integration broker is started separately when provider integrations are needed.

## Tools

### Execution
- `run_os_script` — execute TypeScript scripts with SDK access
- `save_script` / `list_scripts` — persistent script registry
- `discover_capabilities` — runtime capability detection

### Integration Broker
- Slack Socket Mode adapter as the first provider
- provider-neutral workflow catalog
- persistent workflow/job history
- local HTTP snapshot API for toolkit and operator surfaces

## Related
- [IPC Protocol](../concepts/ipc-protocol.md)
- [Daemon](./daemon.md)
