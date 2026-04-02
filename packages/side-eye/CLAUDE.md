# side-eye

Agent-first macOS perception CLI. Pure Swift, zero dependencies.

## Build

```bash
./build.sh
# or manually:
swiftc -parse-as-library -O -o side-eye *.swift
```

Requires macOS 14+ and Screen Recording permission for the calling terminal.

## Usage

```bash
# Display topology (includes cursor position)
./side-eye list

# What's under the cursor? (window + AX element)
./side-eye cursor

# Selected text across visible apps (checks non-focused apps first)
./side-eye selection

# Screenshot main display
./side-eye main --out /tmp/main.png

# Base64 output (no file written)
./side-eye selfie --base64 --format jpg --quality low

# Window capture
./side-eye user_active --window --out /tmp/window.png

# Crop + grid overlay for spatial reasoning
./side-eye main --crop top-half --grid 4x3 --out /tmp/grid.png

# Draw bounding boxes with RGBA colors
./side-eye main --draw-rect 100,100,400,200 '#FF000080' --thickness 4 --out /tmp/rects.png

# Named zones (persistent memory)
./side-eye zone save "menu" 0,0,500,50
./side-eye menu --out /tmp/menu.png

# Interactive drag selection
./side-eye main --interactive --out /tmp/selected.png

# Cursor awareness
./side-eye main --show-cursor --highlight-cursor --out /tmp/cursor.png

# Delay + clipboard
./side-eye main --delay 2 --clipboard --out /tmp/delayed.png

# Annotated screenshots (requires heads-up)
./side-eye main --label --out /tmp/labeled.png
./side-eye user_active --window --label --base64
```

### Daemon Mode

Persistent daemon for live spatial tracking and focus channels.

```bash
# Start daemon (auto-started by focus commands)
side-eye serve [--idle-timeout 30s]

# Create a focus channel for a window
side-eye focus create --id slack-msgs --window 5678 [--pid 1234] [--subtree-role AXScrollArea] [--subtree-title Messages] [--depth 3]

# List active channels
side-eye focus list

# Update channel focus
side-eye focus update --id slack-msgs --subtree-role AXToolbar --depth 2

# Remove a channel
side-eye focus remove --id slack-msgs

# Daemon snapshot (display/window/channel counts)
side-eye daemon-snapshot
```

Channel files are written to `~/.config/agent-os/channels/<id>.json` with triple coordinates (pixel, window, global) on every element. hand-off reads these via `{"action":"bind","channel":"<id>"}`.

### Graph Navigation (Progressive Perception)

Discovery and depth control for the perception graph.

```bash
# Enumerate connected displays
side-eye graph displays

# Enumerate on-screen windows (layer 0)
side-eye graph windows [--display <display_id>]

# Deepen AX traversal on an existing channel
side-eye graph deepen --id slack-msgs [--depth 5]
side-eye graph deepen --id slack-msgs --subtree-role AXScrollArea [--depth 5]

# Collapse channel to shallower depth (default: 1)
side-eye graph collapse --id slack-msgs [--depth 2]
```

Deepen/collapse return `elements_count` showing how many elements the channel has after the operation.

Daemon socket: `~/.config/side-eye/sock`. Auto-exits after 30s idle (no channels, no subscribers).

## Architecture

Multi-file Swift (no SPM, no Xcode project, no external deps). Key files:
- `main.swift` — entry point, all commands, capture pipeline
- `enumerate-windows.swift` — `enumerateWindows()` shared window/app/display builder
- `daemon.swift` — Unix socket server, idle timeout, signal handling
- `spatial.swift` — SpatialModel: channel registry, polling loop, channel file writer
- `client.swift` — CLI commands that talk to daemon (focus create/update/list/remove, snapshot)
- `protocol.swift` — Shared types: DaemonRequest, DaemonResponse, DaemonEvent, ChannelSubtree

**Key frameworks:** ScreenCaptureKit (capture), AppKit/CoreGraphics (display enumeration + overlay drawing), CoreText (grid labels), UniformTypeIdentifiers (format handling).

**Pipeline:**
```
Parse → Resolve zone → Delay → Resolve target → Interactive select
  → Capture → Cursor highlight → Crop → Draw overlays → Encode → Output + Clipboard
```

**--label pipeline:** `--label` implies `--xray`. After capturing elements, side-eye generates SVG badge HTML, shells out to `heads-up render` to rasterize it as a transparent PNG, and composites the result onto the screenshot. The `annotations` array in JSON output follows `shared/schemas/annotation.schema.json`. Requires `heads-up` binary in the same directory or in PATH.

**Local Coordinate System (LCS):** All user-facing coordinates are relative to the target, never global macOS screen space. `(0,0)` = top-left of whatever you're capturing. Overlays (`--draw-rect`, `--grid`) operate in post-crop pixel space.

## Targets

| Target | Resolves to |
|---|---|
| `main`, `center`, `middle` | Primary display (origin 0,0) |
| `external` | First non-main, non-mirrored display |
| `external 1` | Leftmost external (lowest X) |
| `external 2` | Next external by X coordinate |
| `user_active` | Display containing frontmost app window |
| `selfie` | Display hosting the calling process (walks PID tree) |
| `all` | Every connected display |
| `<zone-name>` | Saved zone (display + crop from `~/.config/side-eye/zones.json`) |

## JSON Output

All output is JSON. Success to stdout, errors to stderr with exit code 1.

```json
{"status": "success", "files": ["./screenshot.png"]}
{"status": "success", "base64": ["iVBORw0KG..."]}
{"status": "success", "files": ["..."], "cursor": {"x": 100, "y": 200}}
{"status": "success", "files": ["..."], "bounds": {"x": 0, "y": 0, "width": 500, "height": 300}}
{"error": "...", "code": "PERMISSION_DENIED"}
```

## Colors

All color arguments accept `#RRGGBB` or `#RRGGBBAA` hex codes. Alpha controls transparency (e.g., `#FF000080` = red at 50% opacity).
