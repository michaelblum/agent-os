---
type: concept
name: Runtime Modes
description: Repo vs installed mode — separate state directories prevent cross-contamination
tags: [infrastructure, runtime, configuration]
---

# Runtime Modes

AOS has two explicit runtime modes that determine where state is stored and which binaries are used.

## Modes

| Mode | Binary | State Dir | When |
|------|--------|-----------|------|
| repo | `./aos` | `~/.config/aos/repo/` | Building/testing from source |
| installed | `~/Applications/AOS.app/.../aos` | `~/.config/aos/installed/` | Packaged runtime |

## Detection

Automatic: if the executable path contains `.app/Contents/MacOS/`, it's installed mode. Otherwise, repo mode. Can be overridden via `AOS_RUNTIME_MODE` environment variable.

## Isolation

Each mode gets its own socket, config, logs, and launchd labels. This prevents development builds from interfering with the installed runtime.

## Related
- [Daemon](../entities/daemon.md)
- [Daemon Lifecycle](./daemon-lifecycle.md)
