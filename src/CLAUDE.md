@../AGENTS.md

# aos — Agent Operating System

Unified binary for macOS perception, display, action, and voice.

## Build

```bash
bash build.sh
```

Only rebuild when you changed Swift in `src/` or `shared/swift/ipc/`, or when
the next verification step runs `./aos` directly. Do not rebuild before pure
Node-based tests or package-local workflows.

Examples that usually do **not** need `bash build.sh`:

```bash
node --test tests/studio/*.test.mjs
node --test tests/renderer/*.test.mjs
cd packages/gateway && npm test
cd packages/host && npm test
```

Examples that **do** need a current `./aos` binary when relevant Swift files
changed:

```bash
bash tests/wiki-seed.sh
bash tests/content/wiki-list.test.sh
./aos runtime status --json
./aos show create --id demo --url aos://sigil/studio/index.html
```

Requires macOS 14+ and Accessibility permission.

## Setup

Before interactive commands (`do`, `see cursor/observe/capture`, `inspect`) will work:

```bash
aos permissions setup --once     # One-time Accessibility + Screen Recording flow
aos doctor --json                # Verify runtime health
```

Interactive commands exit early with `PERMISSIONS_SETUP_REQUIRED` until onboarding completes for the current runtime mode.

See root `AGENTS.md` for the runtime model (repo vs installed modes, mode-scoped state).

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
aos say "Hello, I'm your agent"   # Speak text aloud (sugar for tell human)
aos say --list-voices             # List available voices
aos tell human "Hello"             # Speak (same as aos say)
aos tell handoff "task complete"    # Post to coordination channel
aos tell --register my-session     # Register session presence
aos tell --who                     # List online sessions
aos listen handoff                 # Read channel messages
aos listen handoff --follow        # Stream messages in real-time
aos listen --channels              # List known channels
aos set voice.enabled true        # Configure settings
aos inspect                       # Live AX element inspector overlay
aos log push "message"            # Push to log console
```

### Capture (aos see capture)

The capture pipeline runs in-process — no external binary dependency.

**Targets:** `main`, `external [N]`, `user_active`, `selfie`, `mouse`, `all`, `<zone-name>`

**Key options:**
- `--out <path>`, `--base64`, `--format <png|jpg|heic>`, `--quality <high|med|low>`
- `--window` (capture window only), `--crop <spec>`, `--grid <CxR>`
- `--xray` (AX traversal), `--label` (badge annotations via `aos show render`)
- `--show-cursor`, `--highlight-cursor`, `--radius <px>`
- `--delay <sec>`, `--clipboard`, `--draw-rect <coords> <color>`
- `--interactive`, `--wait-for-click`

### Topology (aos see list / aos see selection)

```bash
aos see list                      # Display/window topology (JSON)
aos see selection                 # Selected text from frontmost app
```

### Focus Channels (aos focus)

```bash
aos focus create --name work --apps "Xcode,Terminal"  # Create a focus channel
aos focus update --name work --apps "Xcode,Safari"    # Update channel filters
aos focus list                                         # List all channels
aos focus remove --name work                           # Remove a channel
```

### Graph Navigation (aos graph)

```bash
aos graph displays                # Display topology graph
aos graph windows                 # Window topology graph
aos graph deepen --node <id>      # Expand a graph node
aos graph collapse --node <id>    # Collapse a graph node
```

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
aos clean [--dry-run] [--json]    # Session-boundary cleanup (stale daemons, orphaned canvases)
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
| content.port | int | 0 | Content server port (0 = OS-assigned) |
| content.roots.{name} | string | — | Content root: URL prefix → directory path |
| status_item.enabled | bool | false | Show menu bar icon |
| status_item.toggle_id | string | "avatar" | Canvas ID to toggle on click |
| status_item.toggle_url | string | — | URL loaded in toggled canvas |
| status_item.toggle_track | string | — | Optional track target (e.g. "union") |
| status_item.icon | string | "hexagon" | Icon style |

### Content Server

The daemon runs a local HTTP file server for serving HTML surfaces to WKWebView canvases. This eliminates the need to bundle multi-file web apps (ES modules, CSS imports) into single HTML files.

```bash
aos set content.roots.sigil apps/sigil    # Register a content root
aos content status [--json]               # Show server address and roots
```

Canvases load via URL: `aos://sigil/studio/index.html` (rewritten to `http://127.0.0.1:PORT/...` by the daemon). The `aos://` prefix works in `--url` arguments and `toggle_url` config.

### Wiki (aos wiki)

A per-mode content store at `~/.config/aos/{mode}/wiki/`. Used by Sigil (agent docs under `sigil/agents/`) and as a general-purpose namespace for plugin assets. Also exposed via the daemon's content server at `/wiki/...`.

```bash
aos wiki list [--namespace <ns>]      # List entries (defaults to all namespaces)
aos wiki show <path>                  # Print an entry
aos wiki add <path> --file <src>      # Create or update an entry from a file
aos wiki rm <path>                    # Delete an entry
aos wiki link <from> <to>             # Cross-link entries
aos wiki search <query>               # Full-text search
aos wiki seed [--force] --namespace <ns> --file <name:path> [...]
                                      # Bulk-seed a namespace (idempotent unless --force)
aos wiki reindex                      # Rebuild the search index
aos wiki lint                         # Validate frontmatter + links
aos wiki invoke <path>                # Invoke a workflow-typed entry
aos wiki create-plugin <name>         # Scaffold a new plugin namespace
aos wiki migrate-namespaces           # One-shot schema migration
```

### Tools

High-level commands that combine modules:

- `aos inspect` — perception + display. Shows AX element details under cursor.
- `aos log` — display + stdin. Scrolling log console overlay.

## Architecture

```
src/
  main.swift          # Entry point, subcommand routing, preflight gating
  shared/             # Helpers, envelope, config (+watcher), types
  perceive/           # Perception: cursor, capture, AX, spatial, focus, graph, events, attention
  display/            # Display: canvas, render, auto-projection, status-item (menu bar)
  act/                # Action: click, type, press, session, profiles
  voice/              # Voice: TTS engine, say command
  content/            # Content server: HTTP file serving for WKWebView canvases
  daemon/             # UnifiedDaemon: socket, routing, autonomic
  commands/           # tell, listen, serve, set, inspect, log, service, runtime, operator, reset, wiki
shared/swift/ipc/
  runtime-paths.swift # AOSRuntimeMode, mode-scoped path resolution
  connection.swift    # Socket connection, DaemonSession, auto-start
  request-client.swift # NDJSON request/response helpers
```

State is scoped per runtime mode at `~/.config/aos/{repo|installed}/`.

### Spec

See `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md`
