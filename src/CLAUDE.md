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
aos show render --html "..." --out /tmp/x.png
aos do click 500,300              # Click at coordinates
aos do type "hello world"         # Type with natural cadence
aos say "Hello, I'm your agent"   # Speak text aloud
aos say --list-voices             # List available voices
aos set voice.enabled true        # Configure settings
```

### Daemon Mode

```bash
aos serve                         # Start unified daemon
aos see observe --depth 2         # Stream perception events
aos show create --id x --at 100,100,200,200 --html "<div>overlay</div>"
aos do session                    # Interactive action session
```

### Autonomic Configuration

Config file: `~/.config/aos/config.json` (daemon watches for changes)

```bash
aos set voice.enabled true        # Daemon starts speaking automatically
aos set voice.voice "com.apple.voice.compact.en-US.Samantha"
aos set voice.rate 200            # Words per minute
aos set voice.enabled false       # Mute
```

When voice is enabled, the daemon announces canvas lifecycle events
and other significant actions without the agent needing to call `aos say`.

### Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| voice.enabled | bool | false | Auto-speak daemon events |
| voice.announce_actions | bool | true | Announce canvas/action events |
| voice.voice | string | system default | Voice identifier |
| voice.rate | float | ~180 | Speech rate (WPM) |
| perception.default_depth | int | 1 | Default perception depth (0-3) |
| perception.settle_threshold_ms | int | 200 | Cursor settle threshold |
| feedback.visual | bool | true | Visual feedback overlays |
| feedback.sound | bool | false | Sound feedback |

## Architecture

```
src/
  main.swift          # Entry point, subcommand routing
  shared/             # Helpers, envelope, config (+watcher), types
  perceive/           # Perception: cursor, AX, events, attention
  display/            # Display: canvas, render, auto-projection
  act/                # Action: click, type, press, session, profiles
  voice/              # Voice: TTS engine, say command
  daemon/             # UnifiedDaemon: socket, routing, autonomic
  commands/           # serve, set
```

### Spec

See `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md`
