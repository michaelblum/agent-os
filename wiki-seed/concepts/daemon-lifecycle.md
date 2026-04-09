---
type: concept
name: Daemon Lifecycle
description: How the aos daemon starts, runs, and stops across runtime modes
tags: [daemon, lifecycle, service]
---

# Daemon Lifecycle

## Startup

1. Parse config from `~/.config/aos/{mode}/config.json`
2. Create Unix socket at `~/.config/aos/{mode}/sock`
3. Start content server (HTTP) on an OS-assigned port
4. Start configuration file watcher for live reload
5. Begin accepting client connections

## Connection Handling

Each client gets an independent ndjson stream. Canvas operations, eval calls, and queries are routed through the daemon's central state.

## Shutdown

- `aos service stop` — sends SIGTERM via launchctl
- `aos reset` — stops service, removes socket, cleans state directory
- The daemon cleans up canvases and closes connections on exit

## Auto-Start

CLI commands that need the daemon (canvas operations, eval, listen) attempt to auto-start it via `DaemonSession.connect()`, which launches `aos serve` as a background process if no socket exists.

## Related
- [Daemon](../entities/daemon.md)
- [Runtime Modes](./runtime-modes.md)
