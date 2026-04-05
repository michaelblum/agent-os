# aos — Agent Operating System

Unified binary for macOS perception, display, action, and voice.

## Build

```bash
bash build.sh
# or manually:
find src -name '*.swift' | xargs swiftc -parse-as-library -O -o aos
```

Requires macOS 14+ and Accessibility permission.

## Usage

### One-Shot Commands (no daemon needed)

```bash
aos see cursor          # What's under the cursor
aos set voice.enabled true  # Configure autonomic settings
```

### Daemon Mode

```bash
aos serve               # Start unified daemon
aos see observe --depth 2   # Stream perception events
```

### Config

Config file: `~/.config/aos/config.json`
Socket: `~/.config/aos/sock`

## Architecture

```
src/
  main.swift          # Entry point, subcommand routing
  shared/             # Helpers, envelope, config, types
  perceive/           # Perception module (cursor, daemon, AX, events)
  commands/           # serve, set
```

### Perception Daemon

The daemon monitors cursor position via CGEventTap and queries the
AX tree on cursor settle. Events are published in the standard
daemon-event envelope format to subscribers over Unix socket.

Depth levels:
- 0: Cursor position + display
- 1: Window + app identification
- 2: AX element at cursor (role, title, label, bounds)

### Spec

See `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md`
