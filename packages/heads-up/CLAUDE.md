# heads-up

Display server for agent-os. Renders HTML/CSS/SVG to visual surfaces.

## Build

```bash
./build.sh
# or manually:
swiftc -parse-as-library -O -o heads-up *.swift
```

Requires macOS 14+.

## Usage

### Render Mode (stateless)

Rasterize HTML/CSS/SVG to a transparent PNG bitmap. Used by side-eye --label.

```bash
# Inline HTML to file
heads-up render --width 1920 --height 1080 --html "<svg>...</svg>" --out /tmp/overlay.png

# File to base64
heads-up render --width 500 --height 400 --file overlay.html --base64

# Stdin
cat content.html | heads-up render --width 1920 --height 1080 --base64
```

### Serve Mode (daemon)

Manage persistent transparent canvases on screen. The daemon auto-starts on first `create` and auto-exits after 5s with no canvases and no subscriber connections.

```bash
# Create a canvas (auto-starts daemon)
heads-up create --id ball --at 100,100,200,200 --html "<div>...</div>"
heads-up create --id orb --anchor-window 4521 --offset 10,10,80,80 --html "..." --interactive
heads-up create --id app --at 0,0,800,600 --url http://localhost:3000
heads-up create --id cursor --at 100,100,40,40 --html "..." --scope connection

# Update content, position, or interactivity
heads-up update --id ball --html "<div>new content</div>"
heads-up update --id ball --at 200,200,300,300

# List, remove, remove all
heads-up list
heads-up remove --id ball
heads-up remove-all
```

#### Coordinates

- `--at x,y,w,h` — Global CG space (top-left = 0,0, Y down)
- `--anchor-window <wid> --offset x,y,w,h` — LCS relative to window, auto-tracks at 30fps

#### Content Sources

- `--html "..."` — Inline HTML
- `--file path.html` — Local file
- `--url http://...` — URL loaded in WKWebView
- stdin — Piped HTML content

#### IPC

Unix socket at `~/.config/heads-up/sock`. Newline-delimited JSON protocol. The `serve` command starts the daemon directly (normally auto-started by `create`).

#### Canvas Lifecycle

- `--ttl <duration>` on create/update — auto-remove after timeout (e.g. `5s`, `10m`, `1h`)
- Reset TTL with `heads-up update --id foo --ttl 10s`
- Clear TTL with `heads-up update --id foo --ttl 0`
- `--scope connection` on create — canvas dies when the creating socket connection closes. Use with `listen` for orchestrator-owned overlays.
- `--scope global` (default) — canvas lives until explicitly removed or TTL expires.

#### Daemon Configuration

- `heads-up serve --idle-timeout 10m` — daemon exits after this duration with no canvases and no subscribers (default: 5s)
- `heads-up serve --idle-timeout none` — daemon never auto-exits
- Revised idle condition: daemon stays alive if there are canvases OR subscriber connections

#### JavaScript Eval

Run JavaScript inside a canvas's WKWebView:

```bash
heads-up eval --id mycanvas --js "document.title"
heads-up eval --id mycanvas --js "setState({mode: 'active'})"
```

Returns `{"status": "success", "result": "..."}` with the JS return value.

#### Message Handler Relay (canvas JS → orchestrator)

Canvas JavaScript can send events to connected listeners via WKWebView's native messaging:

```javascript
// In canvas HTML/JS:
window.webkit.messageHandlers.headsup.postMessage({event: "click", x: 150, y: 200});
```

Events are relayed to all subscriber connections as:
```json
{"type": "event", "id": "canvas-id", "payload": {"event": "click", "x": 150, "y": 200}}
```

#### Persistent Connection (listen)

The `listen` command opens a long-lived connection for orchestrator patterns:

```bash
# Subscribe to events, forward stdin commands to daemon
heads-up listen

# Orchestrator pattern: create connection-scoped canvases + receive events
{ echo '{"action":"create","id":"ball","at":[100,100,200,200],"html":"...","scope":"connection"}'; sleep 60; } | heads-up listen
# Ball appears. Events print to stdout. Ctrl-C kills listener → ball removed.
```

Protocol: send `{"action": "subscribe"}` on any connection to receive pushed events.

#### Health Check

```bash
heads-up ping
# {"status": "success", "uptime": 45.2}
```

### Output

All output is JSON. Success to stdout, errors to stderr with exit code 1.

```json
{"status": "success", "file": "/tmp/overlay.png"}
{"status": "success", "base64": "iVBORw0KG..."}
{"status": "success", "canvases": [{"id": "ball", "at": [100,100,200,200], "interactive": false}]}
{"error": "...", "code": "RENDER_FAILED"}
```

## Architecture

Multi-file Swift: `main.swift` (entry point), `helpers.swift` (shared utilities), `render.swift` (bitmap rendering), `protocol.swift` (IPC types), `canvas.swift` (NSWindow + WKWebView + CanvasMessageHandler), `daemon.swift` (Unix socket server + subscriber management), `client.swift` (CLI commands + listen). No SPM, no Xcode project.

**Key frameworks:** WebKit (WKWebView for HTML rendering, WKScriptMessageHandler for canvas→host events), AppKit (NSApplication lifecycle, NSWindow for overlays, NSBitmapImageRep for PNG encoding).

**Transparency:** Output PNGs and overlay windows have working alpha channels. The WKWebView background is explicitly set to transparent. HTML content should use `background: transparent` on `<body>` for clean compositing.

**Host↔Content Bridge:** Full-duplex communication between orchestrator and canvas content. Host→content via `eval` action (evaluateJavaScript). Content→host via `window.webkit.messageHandlers.headsup.postMessage()` → daemon relays as `{"type":"event"}` to subscriber connections.

**Connection Tracking:** Every socket connection gets a UUID. Connection-scoped canvases (`scope: "connection"`) are automatically removed when their connection closes. Subscriber connections keep the daemon alive even with zero canvases.

**Future:** Browser backend (WebSocket bridge to Chrome extension). See the design spec for the full vision.
