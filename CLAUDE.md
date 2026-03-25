# side-eye

Agent-first macOS screenshot CLI. Pure Swift, zero dependencies.

## Build

```bash
./build.sh
# or manually:
swiftc -parse-as-library -O -o side-eye main.swift
```

Requires macOS 14+ and Screen Recording permission for the calling terminal.

## Usage

```bash
# Display topology
./side-eye list

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
```

## Architecture

Single file: `main.swift`. No SPM, no Xcode project, no external deps.

**Key frameworks:** ScreenCaptureKit (capture), AppKit/CoreGraphics (display enumeration + overlay drawing), CoreText (grid labels), UniformTypeIdentifiers (format handling).

**Pipeline:**
```
Parse → Resolve zone → Delay → Resolve target → Interactive select
  → Capture → Cursor highlight → Crop → Draw overlays → Encode → Output + Clipboard
```

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
