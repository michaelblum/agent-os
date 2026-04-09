---
type: concept
name: IPC Protocol
description: Newline-delimited JSON messaging over Unix socket between daemon and clients
tags: [protocol, ipc, messaging]
---

# IPC Protocol

All communication between the aos daemon and its clients (CLI commands, Sigil, gateway) uses newline-delimited JSON (ndjson) over a Unix socket.

## Envelope Format

```json
{"v":1,"service":"display","event":"canvas_created","ts":1712345678,"data":{...},"ref":"optional-correlation-id"}
```

| Field | Description |
|-------|-------------|
| v | Protocol version (always 1) |
| service | Originating subsystem |
| event | Event type (snake_case) |
| ts | Unix timestamp |
| data | Event payload |
| ref | Optional correlation ID for request/response |

## Request/Response

CLI commands use a request/response pattern: send a command, receive a response with the same `ref`. The `DaemonSession` class handles this via `sendAndReceive()`.

## Streaming

Long-lived connections (Sigil, observe) receive continuous events. The daemon broadcasts relevant events to all connected clients.

## Related
- [Daemon](../entities/daemon.md)
- [Gateway](../entities/gateway.md)
