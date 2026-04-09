---
type: entity
name: Daemon
description: Unified aos daemon — socket server, canvas manager, autonomic behaviors
tags: [infrastructure, daemon, service]
---

# Daemon

The aos daemon (`aos serve`) is the central process that manages canvases, routes IPC messages, runs the content server, and provides autonomic behaviors (voice, visual feedback).

## Communication

Unix socket at `~/.config/aos/{mode}/sock`. Messages are newline-delimited JSON (ndjson) using the daemon event envelope format.

## Responsibilities

- Canvas lifecycle (create, update, remove, eval)
- Content server (HTTP file serving for WKWebView)
- IPC routing between connected clients
- Autonomic voice announcements
- Configuration watching and live reload

## Service Management

The daemon can run as a launchd service:
```
aos service install --mode repo
aos service start
aos service status --json
```

## Related
- [IPC Protocol](../concepts/ipc-protocol.md)
- [Canvas System](./canvas-system.md)
- [Daemon Lifecycle](../concepts/daemon-lifecycle.md)
- [Runtime Modes](../concepts/runtime-modes.md)
