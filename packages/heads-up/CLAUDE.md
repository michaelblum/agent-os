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

Manage persistent transparent canvases on screen. The daemon auto-starts on first `create` and auto-exits after 5s with no canvases.

```bash
# Create a canvas (auto-starts daemon)
heads-up create --id ball --at 100,100,200,200 --html "<div>...</div>"
heads-up create --id orb --anchor-window 4521 --offset 10,10,80,80 --html "..." --interactive
heads-up create --id app --at 0,0,800,600 --url http://localhost:3000

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

### Output

All output is JSON. Success to stdout, errors to stderr with exit code 1.

```json
{"status": "success", "file": "/tmp/overlay.png"}
{"status": "success", "base64": "iVBORw0KG..."}
{"status": "success", "canvases": [{"id": "ball", "at": [100,100,200,200], "interactive": false}]}
{"error": "...", "code": "RENDER_FAILED"}
```

## Architecture

Multi-file Swift: `main.swift` (entry point), `helpers.swift` (shared utilities), `render.swift` (bitmap rendering), `protocol.swift` (IPC types), `canvas.swift` (NSWindow + WKWebView), `daemon.swift` (Unix socket server), `client.swift` (CLI commands). No SPM, no Xcode project.

**Key frameworks:** WebKit (WKWebView for HTML rendering), AppKit (NSApplication lifecycle, NSWindow for overlays, NSBitmapImageRep for PNG encoding).

**Transparency:** Output PNGs and overlay windows have working alpha channels. The WKWebView background is explicitly set to transparent. HTML content should use `background: transparent` on `<body>` for clean compositing.

**Future:** Browser backend (WebSocket bridge to Chrome extension). See the design spec for the full vision.
