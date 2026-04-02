# hand-off

Multi-backend macOS actuator. Session mode with maintained state, behavioral profiles, and context-aware coordinate resolution. Pure Swift, zero dependencies.

## Build

```bash
./build.sh
# or manually:
swiftc -parse-as-library -O -o hand-off *.swift
```

Requires macOS 14+ and Accessibility permission for the calling terminal.

## Usage

### Session Mode

Long-running ndjson session over stdin/stdout. Maintains cursor position, held modifiers, behavioral profile, and app context across actions. Unlimited lifetime — exits on `end` action or stdin close.

```bash
# Start with default profile
hand-off session

# Start with a named profile
hand-off session --profile natural
```

Send JSON lines to stdin, read JSON responses from stdout. One request per line, one response per line.

#### Action Vocabulary

**CGEvent actions** (coordinate-based):

```json
{"action":"move","x":500,"y":300}
{"action":"click","x":450,"y":320}
{"action":"click","x":450,"y":320,"button":"right"}
{"action":"click","x":450,"y":320,"count":2}
{"action":"click"}
{"action":"drag","x":300,"y":400,"from":{"x":100,"y":200}}
{"action":"scroll","x":450,"y":320,"dy":-100}
{"action":"scroll","x":450,"y":320,"dx":50}
{"action":"scroll","x":450,"y":320,"dx":50,"dy":-100}
{"action":"key_down","key":"shift"}
{"action":"key_up","key":"shift"}
{"action":"key_tap","key":"cmd+s"}
{"action":"type","text":"hello world"}
```

`click` without coordinates clicks at the current cursor position. `drag` without `from` drags from the current cursor. `scroll` requires at least one of `dx` or `dy`.

**AX actions** (element-targeted, see Element Targeting below):

```json
{"action":"press","pid":1234,"role":"AXButton","title":"Save"}
{"action":"set_value","pid":1234,"role":"AXTextField","value":"hello"}
{"action":"focus","pid":1234,"role":"AXTextField","title":"Search"}
{"action":"raise","pid":1234}
{"action":"raise","pid":1234,"window_id":5678}
```

**AppleScript actions:**

```json
{"action":"tell","app":"Safari","script":"open location \"https://example.com\""}
```

**Meta actions:**

```json
{"action":"context","set":{"pid":1234,"app":"Finder","coordinate_space":"window","window_id":5678}}
{"action":"context","clear":true}
{"action":"status"}
{"action":"end"}
```

#### Session Response Format

Every response includes cursor position and held modifiers:

```json
{"action":"click","cursor":{"x":450,"y":320},"duration_ms":45,"modifiers":[],"status":"ok"}
{"action":"status","cursor":{"x":450,"y":320},"modifiers":["shift"],"profile":"natural","session_uptime_s":12.5,"status":"ok"}
{"action":"unknown","code":"PARSE_ERROR","cursor":{"x":0,"y":0},"error":"Failed to parse JSON request","modifiers":[],"status":"error"}
{"action":"banana","code":"UNKNOWN_ACTION","cursor":{"x":0,"y":0},"error":"Unknown action: \"banana\"","modifiers":[],"status":"error"}
```

On `end`, all held modifier keys are released before the session exits.

### CLI Mode

Stateless commands for one-shot actions. Backward compatible with v1. All coordinate commands accept `x,y` positional arguments. All commands support `--dry-run` to preview without executing.

```bash
# Physical actions (CGEvent backend)
hand-off click 450,320
hand-off click 450,320 --right
hand-off click 450,320 --double
hand-off hover 200,200
hand-off drag 100,200 300,400
hand-off scroll 450,320 --dy -100
hand-off scroll 450,320 --dx 50
hand-off scroll 450,320 --dx 50 --dy -100
hand-off type "hello world"
hand-off key cmd+s

# Semantic actions (AX backend)
hand-off press --pid 1234 --role AXButton --title "Save"
hand-off set-value --pid 1234 --role AXTextField --value "hello"
hand-off focus --pid 1234 --role AXTextField --title "Search"
hand-off raise --pid 1234

# AX targeting flags (all AX commands)
hand-off press --pid 1234 --role AXButton --label "Close" --match contains
hand-off press --pid 1234 --role AXButton --identifier "save-btn"
hand-off press --pid 1234 --role AXButton --near 500,300
hand-off press --pid 1234 --role AXButton --title "OK" --index 2
hand-off press --pid 1234 --role AXButton --depth 30 --timeout 10000

# Window management (AX backend)
hand-off raise --pid 1234
hand-off raise --pid 1234 --window-id 5678

# App verbs (AppleScript backend)
hand-off tell Safari 'open location "https://example.com"'

# Safety
hand-off click 450,320 --dry-run
```

CLI JSON output uses the v1 response format:

```json
{"action":"click","backend":"cgevent","status":"success","target":{"x":450,"y":320}}
{"action":"click","backend":"cgevent","status":"dry_run","target":{"x":450,"y":320}}
{"action":"press","backend":"ax","status":"success","target":{"pid":1234,"role":"AXButton","title":"Save"}}
```

### Profiles

Behavioral profiles control timing, mouse curves, scroll feel, and AX tree search parameters.

```bash
# List all profiles
hand-off profiles

# Show full profile JSON
hand-off profiles show natural
```

**Built-in:** `natural` — moderate speed, Bezier mouse curves, Gaussian keystroke timing, human-like variance.

**Custom profiles:** Place JSON files in `~/.config/hand-off/profiles/<name>.json`. User profiles override built-in profiles of the same name. Structure:

```json
{
  "name": "fast",
  "description": "Speed-optimized for automation",
  "timing": {
    "keystroke_delay": {"min": 10, "max": 30, "distribution": "uniform"},
    "typing_cadence": {"wpm": 200, "variance": 0.1},
    "click_dwell": {"min": 10, "max": 30},
    "action_gap": {"min": 20, "max": 50}
  },
  "mouse": {
    "pixels_per_second": 3000,
    "curve": "linear",
    "jitter": 0,
    "overshoot": 0
  },
  "scroll": {
    "events_per_action": 2,
    "deceleration": 0.5,
    "interval_ms": 10
  },
  "ax": {
    "depth": 20,
    "timeout": 5000
  }
}
```

### Context

Session-mode context sets a persistent app/window scope so every subsequent action inherits the target without repeating it.

```json
{"action":"context","set":{"pid":1234,"app":"Finder","window_id":5678,"coordinate_space":"window","scale_factor":2.0}}
```

**Fields:**
- `pid` — target process ID (inherited by AX actions)
- `app` — app name (informational, for orchestrator tracking)
- `window_id` — CGWindowID (used for `raise`, and for coordinate resolution in window space)
- `coordinate_space` — `"global"` (default) or `"window"`. Window space converts coordinates relative to the window origin using `window_id`.
- `scale_factor` — multiplier for window-relative coordinates (default 1.0, set to 2.0 for Retina if coordinates come from a 2x source)

**Validation:** Setting `coordinate_space` to `"window"` without a `window_id` returns `INVALID_CONTEXT`.

Clear all context: `{"action":"context","clear":true}`

Context fields merge — set only what changed. Clear resets everything to defaults.

### Element Targeting

AX actions find elements via BFS traversal of the accessibility tree. All fields are AND-matched.

| Field | Description |
|-------|-------------|
| `pid` | Process ID (required, or inherited from context) |
| `role` | AX role string (e.g. `AXButton`, `AXTextField`) |
| `title` | AX title attribute |
| `label` | AX description attribute |
| `identifier` | AX identifier attribute |
| `near` | `[x, y]` — disambiguate by proximity to a point |
| `index` | N-th match (0-based) when multiple elements match |
| `match` | `"exact"` (default), `"contains"`, `"regex"` |
| `depth` | Max AX tree depth to traverse (default from profile, typically 20) |
| `timeout` | Search timeout in milliseconds (default from profile, typically 5000) |

**Subtree scoping** (via context): Narrow the AX search to a subtree rooted at an element matching `subtree.role`, `subtree.title`, or `subtree.identifier`. Set via context:

```json
{"action":"context","set":{"pid":1234,"subtree":{"role":"AXGroup","identifier":"sidebar"}}}
```

## Architecture

Multi-file Swift: `main.swift` (entry + CLI dispatch), `cli.swift` (CLI command handlers), `session.swift` (ndjson session loop + action dispatch), `actions.swift` (all session action handlers), `models.swift` (request/response/state/profile types), `context.swift` (coordinate resolution + context action), `targeting.swift` (AX element search with BFS, multi-field matching, disambiguation), `profiles.swift` (profile loading + discovery + CLI subcommands), `helpers.swift` (JSON output, key codes, arg parsing, Bezier math, AX utilities). No SPM, no Xcode project.

**Key frameworks:** ApplicationServices (AX API), CoreGraphics (CGEvent synthesis), AppKit (NSRunningApplication for raise), Foundation (NSAppleScript, JSON, process).

**Backend dispatch is input-driven:** element identity (pid + role + title) goes to AX, coordinates go to CGEvent, app verbs go to AppleScript. The caller never names a backend.

**No automatic fallback.** If AX can't find the element, hand-off returns an error. The orchestrator re-perceives with side-eye and retries. Silent fallback hides failures.

**Session state:** cursor position (initialized from actual CGEvent position), held modifiers (released on `end` or stdin close), context (pid, app, window, coordinate space), profile. All responses echo current cursor and modifiers.

**Behavioral profiles:** control mouse movement (Bezier curves with jitter and overshoot), keystroke timing (Gaussian or uniform delay ranges), scroll deceleration, and AX search depth/timeout. The `natural` profile is built-in; custom profiles load from `~/.config/hand-off/profiles/`.

## JSON Output

**Session mode:** Every response is a JSON line to stdout. Always includes `status`, `action`, `cursor`, `modifiers`. Errors add `error` and `code` fields. Status adds `profile` and `session_uptime_s`. Parse errors return `PARSE_ERROR` without killing the session.

**CLI mode:** Success and dry-run responses go to stdout with v1 format (`status`, `action`, `backend`, `target`). Errors go to stderr with exit code 1 (`error`, `code`).

**Error codes:** `PARSE_ERROR`, `UNKNOWN_ACTION`, `INVALID_COORDS`, `MISSING_ARG`, `INVALID_KEY`, `ELEMENT_NOT_FOUND`, `AX_TIMEOUT`, `PERMISSION_DENIED`, `AX_ACTION_FAILED`, `AX_NOT_SETTABLE`, `APP_NOT_FOUND`, `CGEVENT_FAILED`, `APPLESCRIPT_FAILED`, `INVALID_CONTEXT`, `PROFILE_NOT_FOUND`.
