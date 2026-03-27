# heads-up

Display server for agent-os. Renders HTML/CSS/SVG to visual surfaces.

## Build

```bash
./build.sh
# or manually:
swiftc -parse-as-library -O -o heads-up main.swift
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

### Output

All output is JSON. Success to stdout, errors to stderr with exit code 1.

```json
{"status": "success", "file": "/tmp/overlay.png"}
{"status": "success", "base64": "iVBORw0KG..."}
{"error": "...", "code": "RENDER_FAILED"}
```

## Architecture

Single file: `main.swift`. No SPM, no Xcode project.

**Key frameworks:** WebKit (WKWebView for HTML rendering), AppKit (NSApplication lifecycle, NSBitmapImageRep for PNG encoding).

**Transparency:** Output PNGs have a working alpha channel. The WKWebView background is explicitly set to transparent. HTML content should use `background: transparent` on `<body>` to get clean compositing.

**Future:** Serve mode (persistent canvases on screen), browser backend (WebSocket bridge to Chrome extension). See the design spec for the full vision.
