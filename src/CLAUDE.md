# aos — Agent Operating System

Unified binary for macOS perception, display, action, and voice.

## Build

```bash
bash build.sh
```

Requires macOS 14+ and Accessibility permission.

## Setup

Before interactive commands (`do`, `see cursor/observe/capture`, `inspect`) will work:

```bash
aos permissions setup --once     # One-time Accessibility + Screen Recording flow
aos doctor --json                # Verify runtime health
```

See root `CLAUDE.md` for the runtime model (repo vs installed modes, mode-scoped state).

## Usage

### One-Shot Commands (no daemon needed)

```bash
aos see cursor                    # What's under the cursor
aos see capture main --out /tmp/screen.png   # Screenshot main display
aos see main --base64 --format jpg           # Base64 shorthand
aos see capture user_active --window --xray  # Window + AX overlay
aos see mouse --radius 200                   # Area around cursor
aos show render --html "..." --out /tmp/x.png
aos do click 500,300              # Click at coordinates
aos do type "hello world"         # Type with natural cadence
aos say "Hello, I'm your agent"   # Speak text aloud
aos say --list-voices             # List available voices
aos set voice.enabled true        # Configure settings
aos inspect                       # Live AX element inspector overlay
aos log push "message"            # Push to log console
```

### Capture (aos see capture)

Delegates to `side-eye` for the full screenshot pipeline. Requires `side-eye` binary
(build: `cd packages/side-eye && bash build.sh`). Resolved adjacent to `aos`, in
`packages/side-eye/`, or via PATH.

**Targets:** `main`, `external [N]`, `user_active`, `selfie`, `mouse`, `all`, `<zone-name>`

**Key options:**
- `--out <path>`, `--base64`, `--format <png|jpg|heic>`, `--quality <high|med|low>`
- `--window` (capture window only), `--crop <spec>`, `--grid <CxR>`
- `--xray` (AX traversal), `--label` (badge annotations, requires heads-up)
- `--show-cursor`, `--highlight-cursor`, `--radius <px>`
- `--delay <sec>`, `--clipboard`, `--draw-rect <coords> <color>`
- `--interactive`, `--wait-for-click`

See `packages/side-eye/CLAUDE.md` for full capture documentation.

### Daemon Mode

```bash
aos serve                         # Start unified daemon
aos see observe --depth 2         # Stream perception events
aos show create --id x --at 100,100,200,200 --html "<div>overlay</div>"
aos do session                    # Interactive action session
echo "lines" | aos log            # Stream stdin to log overlay
```

### Runtime and Service Management

```bash
aos runtime status [--json]       # Runtime identity, signing, mode
aos runtime path                  # Print current executable path
aos service install [--mode repo|installed]   # Install launch agent
aos service start|stop|restart    # Service lifecycle
aos service status [--json]       # Launch agent state
aos doctor [--json]               # Full health check (permissions, daemon, services)
aos reset --mode current|repo|installed|all  # Deterministic state cleanup
aos permissions check [--json]    # Read-only permission check
aos permissions setup --once      # Interactive onboarding flow
```

### Autonomic Configuration

Config file: `~/.config/aos/{mode}/config.json` where mode is `repo` or `installed` (daemon watches for changes)

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
| status_item.enabled | bool | false | Show menu bar icon |
| status_item.toggle_id | string | "avatar" | Canvas ID to toggle on click |
| status_item.toggle_url | string | — | URL to load when creating canvas |
| status_item.toggle_at | array | [200,200,300,300] | [x,y,w,h] position for canvas |
| content.port | int | 0 | Content server port (0 = OS-assigned) |
| content.roots.{name} | string | — | Content root: URL prefix → directory path |

### Content Server

The daemon runs a local HTTP file server for serving HTML surfaces to WKWebView canvases. This eliminates the need to bundle multi-file web apps (ES modules, CSS imports) into single HTML files.

```bash
aos set content.roots.sigil apps/sigil    # Register a content root
aos content status [--json]               # Show server address and roots
```

Canvases load via URL: `aos://sigil/studio/index.html` (rewritten to `http://127.0.0.1:PORT/...` by the daemon). The `aos://` prefix works in `--url` arguments and `toggle_url` config.

### Tools

High-level commands that combine modules:

- `aos inspect` — perception + display. Shows AX element details under cursor.
- `aos log` — display + stdin. Scrolling log console overlay.

## Architecture

```
src/
  main.swift          # Entry point, subcommand routing, preflight gating
  shared/             # Helpers, envelope, config (+watcher), types
  perceive/           # Perception: cursor, capture (→ side-eye), AX, events, attention
  display/            # Display: canvas, render, auto-projection, status-item (menu bar)
  act/                # Action: click, type, press, session, profiles
  voice/              # Voice: TTS engine, say command
  content/            # Content server: HTTP file serving for WKWebView canvases
  daemon/             # UnifiedDaemon: socket, routing, autonomic
  commands/           # serve, set, inspect, log, service, runtime, operator, reset
shared/swift/ipc/
  runtime-paths.swift # AOSRuntimeMode, mode-scoped path resolution
  connection.swift    # Socket connection, DaemonSession, auto-start
  request-client.swift # NDJSON request/response helpers
```

State is scoped per runtime mode at `~/.config/aos/{repo|installed}/`.

### Spec

See `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md`
