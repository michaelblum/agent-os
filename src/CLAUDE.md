# aos — Agent Operating System

Unified binary for macOS perception, display, action, and voice.

## Build

```bash
bash build.sh
```

Requires macOS 14+ and Accessibility permission.

## Usage

### One-Shot Commands (no daemon needed)

```bash
aos see cursor                    # What's under the cursor
aos show render --html "..." --out /tmp/x.png  # Render HTML to PNG
aos do click 500,300              # Click at coordinates
aos do type "hello world"         # Type text with natural cadence
aos do key "cmd+s"                # Key combo
aos do press --pid 1234 --role AXButton --title Save  # Press AX element
aos set voice.enabled true        # Configure autonomic settings
```

### Daemon Mode

```bash
aos serve                         # Start unified daemon
aos see observe --depth 2         # Stream perception events
aos show create --id x --at 100,100,200,200 --html "<div>overlay</div>"
aos show list                     # List active canvases
aos show remove --id x            # Remove canvas
```

### Session Mode (stateful action loop)

```bash
aos do session [--profile natural]
# Then send ndjson on stdin:
{"action":"click","x":500,"y":300}
{"action":"type","text":"hello"}
{"action":"key","key":"cmd+s"}
{"action":"status"}
{"action":"end"}
```

### Config

Config file: `~/.config/aos/config.json`
Socket: `~/.config/aos/sock`
Profiles: `~/.config/aos/profiles/`

## Architecture

```
src/
  main.swift          # Entry point, subcommand routing
  shared/             # Helpers, envelope, config, types
  perceive/           # Perception module (cursor, AX, events, attention)
  display/            # Display module (canvas, render, auto-projection)
  act/                # Action module (click, type, press, session, profiles)
  daemon/             # UnifiedDaemon (socket server, routing)
  commands/           # serve, set
```

### Unified Daemon

`aos serve` starts a single daemon that hosts both perception and display.
One socket (`~/.config/aos/sock`), one CGEventTap, one process. Requests
routed by `action` field: perception actions -> PerceptionEngine, display
actions -> CanvasManager.

### Spec

See `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md`
