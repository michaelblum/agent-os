# hand-off

Multi-backend macOS actuator CLI. Pure Swift, zero dependencies.

## Build

```bash
./build.sh
# or manually:
swiftc -parse-as-library -O -o hand-off main.swift
```

Requires macOS 14+ and Accessibility permission for the calling terminal.

## Usage

```bash
# Semantic actions (AX backend — no coordinates needed)
./hand-off press --pid 1234 --role AXButton --title "Save"
./hand-off set-value --pid 1234 --role AXTextField --value "hello"
./hand-off focus --pid 1234 --role AXTextField --title "Search"

# Physical actions (CGEvent backend — global CG coordinates)
./hand-off click 450,320
./hand-off click 450,320 --right
./hand-off click 450,320 --double
./hand-off drag 100,200 300,400
./hand-off scroll 450,320 --dy -100
./hand-off type "hello world"
./hand-off key cmd+s

# Window management (AX backend)
./hand-off raise --pid 1234
./hand-off move --pid 1234 --to 100,100
./hand-off resize --pid 1234 --to 800,600

# App verbs (AppleScript backend)
./hand-off tell Safari 'open location "https://example.com"'

# Safety: see what would happen without doing it
./hand-off press --pid 1234 --role AXButton --title "Delete" --dry-run
```

## Architecture

Single file: `main.swift`. No SPM, no Xcode project, no external deps.

**Key frameworks:** ApplicationServices (AX API), CoreGraphics (CGEvent synthesis), Foundation (NSAppleScript).

**Backend dispatch is input-driven:**
- Element identity (pid + role + title) → AX backend
- Coordinates → CGEvent backend
- App verb → AppleScript backend

The caller never names a backend. hand-off figures it out from the input.

**No automatic fallback.** If AX can't find the element, hand-off returns an error. The orchestrator can re-perceive with side-eye and retry. Silent fallback hides failures.

## Shared Language with side-eye

side-eye emits `app_pid`, `role`, `title`, `bounds` (global CG). hand-off accepts the same fields as targeting input. An orchestrator pipes side-eye output into hand-off commands.

## JSON Output

All output is JSON. Success to stdout, errors to stderr with exit code 1.

```json
{"status": "success", "action": "press", "backend": "ax", "target": {"pid": 1234, "role": "AXButton", "title": "Save"}}
{"status": "success", "action": "click", "backend": "cgevent", "target": {"x": 450, "y": 320}}
{"error": "Element not found", "code": "ELEMENT_NOT_FOUND"}
```
