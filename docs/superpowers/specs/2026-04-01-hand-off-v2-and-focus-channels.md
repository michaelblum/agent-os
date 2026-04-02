# hand-off v2 + Focus Channel Protocol

**Date:** 2026-04-01
**Status:** Design spec — pending review
**Scope:** hand-off session mode, behavioral profiles, context operator, AX targeting overhaul, focus channel protocol, side-eye integration points
**Implementers:** Agent team (parallel implementation across phases)
**Depends on:** hand-off v1 (packages/hand-off/main.swift), heads-up serve mode (packages/heads-up/), side-eye v3 (packages/side-eye/)
**Supersedes:** docs/superpowers/specs/2026-03-26-hand-off-multi-backend-design.md (v1 design)

---

## Table of Contents

1. [Design Target](#1-design-target)
2. [Architecture Overview](#2-architecture-overview)
3. [Implementation Phases](#3-implementation-phases)
4. [Phase 1: Session Mode + Profiles + Primitives](#4-phase-1)
5. [Phase 2: Focus Channel Protocol + Bind](#5-phase-2)
6. [Phase 3: Progressive Perception + Action Introspection](#6-phase-3)
7. [Shared Language Reference](#7-shared-language)
8. [File Locations and Discovery](#8-file-locations)
9. [Error Handling](#9-error-handling)
10. [Testing Strategy](#10-testing-strategy)
11. [Open Questions](#11-open-questions)

---

## 1. Design Target

An AI agent must be able to operate a Mac exactly the way a human would. The "broken hands" test: a user who cannot use their hands needs the agent to be their hands. This means:

- No instant cursor teleportation — mouse movement follows curves at natural speed
- No machine-speed typing — keystrokes at human cadence with variance
- Modifier key holds across multiple actions — CMD+TAB app switching, CMD+click multi-select, SHIFT+scroll for horizontal
- Compound interactions in a single process — hold CMD, tap TAB three times, add SHIFT, tap TAB twice, release all
- Profile-driven "feel" — timing, speed, jitter are configurable and durable, not hardcoded
- Zero coordinate math for the orchestrating agent — tools share spatial references, not raw numbers

The orchestrator is an LLM agent (Claude Code, Codex, any model with tool access). LLMs are bad at precise field extraction and coordinate math. The architecture must minimize mechanical burden on the orchestrator so it can focus on intent.

---

## 2. Architecture Overview

### Layer Model

```
┌─────────────────────────────────────────────────┐
│ Orchestrator (LLM Agent)                        │
│   Intent: "click the Reply button in Slack"     │
├─────────────────────────────────────────────────┤
│ Focus Channel Protocol (shared spatial refs)    │
│   ~/.config/agent-os/channels/<id>.json         │
├──────────┬──────────────────┬───────────────────┤
│ side-eye │    hand-off      │     heads-up      │
│ (sensor) │   (actuator)     │   (projector +    │
│          │                  │  control surface) │
│ daemon   │  session mode    │   serve mode      │
│ mode     │  stdin streaming │   Unix socket     │
├──────────┴──────────────────┴───────────────────┤
│ macOS (CGEvent, AX, AppleScript, WKWebView)     │
└─────────────────────────────────────────────────┘
```

### Four Communication Directions

| Direction | Tool | Mechanism |
|---|---|---|
| Computer → Agent | side-eye | Screenshots, AX tree, spatial topology |
| Agent → Computer | hand-off | CGEvent, AX actions, AppleScript |
| Agent → Human | heads-up | Floating overlays, highlights, status |
| Human → Agent | heads-up | Interactive canvases, messageHandler relay |

### Tool Independence

No tool imports, links, or directly communicates with another tool. The focus channel protocol is a filesystem-based shared data format. side-eye writes channel files. hand-off and heads-up read them. The orchestrator creates bindings. Tools conform to the protocol, not to each other.

---

## 3. Implementation Phases

Each phase ships a usable increment. Each phase's interfaces are designed to fit the whole, so no phase is throwaway.

| Phase | Deliverable | Can be implemented by | Depends on |
|---|---|---|---|
| **Phase 1** | hand-off session mode + profiles + context + primitives | Single agent, packages/hand-off/ only | hand-off v1 (exists) |
| **Phase 2** | Focus channel protocol + side-eye daemon + hand-off `bind` | Two agents in parallel: one on side-eye daemon, one on hand-off bind | Phase 1 (hand-off session mode) |
| **Phase 3** | Progressive perception graph + `actuator.list()` + heads-up channel binding | Three agents in parallel: side-eye graph, hand-off introspection, heads-up integration | Phase 2 (channels exist) |

**Phase 1 is self-contained.** It works with stateless side-eye CLI calls. The orchestrator does the field-copying work (setting context manually). Not ideal for LLMs, but functional.

**Phase 2 eliminates orchestrator plumbing.** The LLM says "focus on Slack" and "bind to that," and the tools handle coordinates, scale factors, and targeting automatically.

**Phase 3 adds intelligence.** The agent can ask "what can I do here?" and navigate the UI progressively instead of loading everything at once.

---

## 4. Phase 1: Session Mode + Profiles + Primitives

### 4.1 Session Mode

**Starting a session:**
```bash
hand-off session [--profile <name>]
```

Reads newline-delimited JSON from stdin. Emits newline-delimited JSON responses on stdout. Stays alive until stdin closes or `{"action": "end"}` is received.

**State maintained by session:**
- Current cursor position (updated after every move/click action)
- Active modifier keys (which keys are currently held down)
- Current context (pid, window_id, coordinate_space, scale_factor, subtree)
- Loaded profile (timing/behavior parameters)

**Session lifetime:** unlimited. No timeout. The session is the agent's hands for as long as the agent needs hands. A session can span multiple apps, Spaces, and displays.

### 4.2 Action Vocabulary

#### CGEvent Actions

**`move`** — Move cursor to position. Profile-driven path (Bezier curve, speed, jitter).
```json
{"action": "move", "x": 450, "y": 320}
```

**`click`** — Click at position. Includes move-to if cursor is not already there.
```json
{"action": "click", "x": 450, "y": 320}
{"action": "click", "x": 450, "y": 320, "button": "right"}
{"action": "click", "x": 450, "y": 320, "count": 2}
```
Fields: `x` (optional), `y` (optional — clicks at current cursor position if omitted), `button` ("left"|"right", default "left"), `count` (int, default 1).

**`drag`** — Drag from current position (or `from`) to target.
```json
{"action": "drag", "x": 600, "y": 400}
{"action": "drag", "x": 600, "y": 400, "from": {"x": 200, "y": 200}}
```

**`scroll`** — Scroll at position. At least one of `dx`/`dy` required.
```json
{"action": "scroll", "x": 450, "y": 320, "dy": -300}
{"action": "scroll", "x": 450, "y": 320, "dx": 100}
{"action": "scroll", "x": 450, "y": 320, "dx": 50, "dy": -100}
```
Profile's `scroll_momentum` breaks a single scroll intent into multiple CGEvent posts with deceleration.

**`key_down`** — Press and hold a key or modifier. State persists until `key_up`.
```json
{"action": "key_down", "key": "cmd"}
```

**`key_up`** — Release a held key or modifier.
```json
{"action": "key_up", "key": "cmd"}
```

**`key_tap`** — Press and release a key. Currently held modifiers are applied automatically.
```json
{"action": "key_tap", "key": "tab"}
{"action": "key_tap", "key": "ctrl+up"}
```

**`type`** — Type a string. Profile-driven cadence (WPM, variance, word pauses).
```json
{"action": "type", "text": "Hello, world"}
```

#### AX Actions

All AX actions accept element targeting fields: `pid` (required unless in context), `role`, `title`, `label`, `identifier`, `value`, `index`, `near`, `match`.

**`press`** — AXPerformAction(AXPress) on matched element.
```json
{"action": "press", "pid": 1234, "role": "AXButton", "title": "Save"}
{"action": "press", "role": "AXButton", "title": "Save"}
```
Second form: `pid` inherited from context.

**`set_value`** — Set AXValue on matched element.
```json
{"action": "set_value", "role": "AXTextField", "title": "Search", "value": "hello"}
```

**`focus`** — Set AXFocused=true on matched element.
```json
{"action": "focus", "role": "AXTextField", "title": "Search"}
```

**`raise`** — Raise window/app to front.
```json
{"action": "raise"}
{"action": "raise", "pid": 1234, "window_id": 5678}
```
First form: inherits from context.

#### AppleScript Actions

**`tell`** — Execute an app verb via AppleScript.
```json
{"action": "tell", "app": "Safari", "script": "open location \"https://example.com\""}
```
Raw AppleScript. No guardrails — the orchestrator is trusted by design.

#### Meta Actions

**`context`** — Set, update, or clear targeting context. See Section 4.4.
**`bind`** — Bind to a focus channel. Phase 2. See Section 5.4.
**`status`** — Report current session state.
**`end`** — Close session gracefully, releasing all held keys.

### 4.3 Response Format

Every action gets exactly one response on stdout, newline-terminated:

**Success:**
```json
{
  "status": "ok",
  "action": "click",
  "cursor": {"x": 450.0, "y": 320.0},
  "modifiers": ["cmd"],
  "context": {"pid": 1234, "app": "Slack", "window_id": 5678},
  "duration_ms": 230
}
```

**Error:**
```json
{
  "status": "error",
  "action": "press",
  "error": "Element not found: role=AXButton title=Save",
  "code": "ELEMENT_NOT_FOUND",
  "cursor": {"x": 450.0, "y": 320.0},
  "modifiers": ["cmd"]
}
```

Responses always include `cursor` and `modifiers` so the orchestrator (and heads-up, via the orchestrator) always knows current state. Errors do not kill the session.

**`status` response:**
```json
{
  "status": "ok",
  "action": "status",
  "cursor": {"x": 450.0, "y": 320.0},
  "modifiers": ["cmd", "shift"],
  "context": {"pid": 1234, "app": "Slack", "window_id": 5678, "coordinate_space": "window", "scale_factor": 2.0},
  "profile": "natural",
  "session_uptime_s": 125.3,
  "bound_channel": null
}
```

### 4.4 Context Operator

Context sets inherited defaults for subsequent actions. Fields set in context are inherited by all actions until changed. Explicit fields on an action override context.

**Setting context:**
```json
{"action": "context", "set": {
  "pid": 1234,
  "app": "Slack",
  "window_id": 5678,
  "coordinate_space": "window",
  "scale_factor": 2.0,
  "subtree": {"role": "AXScrollArea", "title": "Messages"}
}}
```

**Context fields:**

| Field | Type | Effect |
|---|---|---|
| `pid` | int | Default process ID for AX commands |
| `app` | string | Human-readable app name (informational, included in responses) |
| `window_id` | int | Default window for AX commands and raise. Enables `coordinate_space: "window"` |
| `coordinate_space` | "global" or "window" | Whether x,y coordinates are Global CG or relative to `window_id`'s origin. Default: "global" |
| `scale_factor` | float | Display scale factor (1.0, 2.0, etc.). When `coordinate_space` is "window", incoming coordinates are divided by this value to convert from pixel to CG point space |
| `subtree` | object | AX search starts from this element instead of app root. Object with targeting fields: `{role, title}` or `{identifier}`. Massively faster on deep trees |

**Coordinate conversion when `coordinate_space: "window"`:**

The session queries `CGWindowListCopyWindowInfo` to get the window's current Global CG origin on each action. Conversion:
```
cg_point_x = (input_x / scale_factor) + window_origin_x
cg_point_y = (input_y / scale_factor) + window_origin_y
```

This means side-eye --xray LCS pixel coordinates can be passed directly when context has the correct `window_id` and `scale_factor`. No orchestrator math.

**Clearing context:**
```json
{"action": "context", "clear": true}
```

**Partial updates:** only the fields present in `set` are changed. Unmentioned fields retain their current value.

### 4.5 AX Targeting Overhaul

`findElement` is rewritten to accept all identity fields side-eye emits and to support flexible matching.

**Targeting fields (any combination):**

| Field | Matches against | Required |
|---|---|---|
| `pid` | Process ID | Yes (or inherited from context) |
| `role` | kAXRoleAttribute | No (but strongly recommended) |
| `title` | kAXTitleAttribute | No |
| `label` | kAXDescriptionAttribute | No |
| `identifier` | kAXIdentifierAttribute | No |
| `value` | kAXValueAttribute | No |
| `index` | 0-based BFS match index | No |
| `near` | [x, y] — disambiguate by proximity to coordinate | No |
| `match` | "exact" (default), "contains", "regex" | No |

**Matching behavior:**
- All specified fields must match (AND logic)
- `title` and `label` use the mode set by `match`
- `match: "contains"` is case-insensitive substring
- `match: "regex"` uses Swift `Regex`
- `near` takes `[x, y]` and selects the match whose bounds center is closest to that coordinate (Global CG or window-relative depending on context)
- When multiple fields are specified, they all constrain the search. `{role: "AXButton", title: "Save", near: [450, 320]}` means: find AXButtons titled "Save", pick the one nearest (450, 320)

**Coordinate actions vs. element actions:** When an action includes `x`/`y` fields, it acts at those coordinates (CGEvent path). When an action includes targeting fields (`role`, `title`, `label`, `identifier`) without `x`/`y`, it resolves the element via AX and acts on it semantically. These are mutually exclusive targeting modes — coordinates are never used to resolve AX elements, and AX targeting never falls back to coordinates.

**Tree traversal controls:**

| Field/Flag | Default | Effect |
|---|---|---|
| `depth` / `--depth` | 20 | Maximum BFS depth. Prevents hangs on deep Electron trees |
| `timeout` / `--timeout` | 5000 | Wall-clock milliseconds. `findElement` aborts and returns error after this |

**Subtree scoping:** When context has a `subtree`, `findElement` first locates the subtree root element, then searches only within its children. This is both faster and more precise than searching the entire app.

### 4.6 Behavioral Profiles

A profile is a JSON file that defines what it feels like when the agent operates the computer.

**Location:** `~/.config/hand-off/profiles/<name>.json`

**Schema:**
```json
{
  "name": "natural",
  "description": "Default human-like feel — moderate speed, natural variance",
  "timing": {
    "keystroke_delay": {
      "min": 80,
      "max": 250,
      "distribution": "gaussian"
    },
    "typing_cadence": {
      "wpm": 65,
      "variance": 0.3,
      "pause_after_word": {"min": 30, "max": 150}
    },
    "click_dwell": {"min": 40, "max": 120},
    "action_gap": {"min": 100, "max": 400}
  },
  "mouse": {
    "pixels_per_second": 800,
    "curve": "bezier",
    "jitter": 2,
    "overshoot": 0.05
  },
  "scroll": {
    "events_per_action": 4,
    "deceleration": 0.7,
    "interval_ms": 30
  },
  "ax": {
    "depth": 20,
    "timeout": 5000
  }
}
```

**Profile fields explained:**

- `timing.keystroke_delay` — pause inserted between any two key events (key_down, key_up, key_tap). Distribution: "gaussian" (normal around midpoint) or "uniform" (flat random).
- `timing.typing_cadence` — character-by-character typing. `wpm` is the base rate. `variance` (0-1) is how much speed varies per keystroke. `pause_after_word` adds a longer pause after whitespace.
- `timing.click_dwell` — duration between mouse-down and mouse-up for a single click.
- `timing.action_gap` — default pause between unrelated actions. Applied when no explicit timing is specified.
- `mouse.pixels_per_second` — cursor movement speed.
- `mouse.curve` — path shape. "bezier" (natural curve with control points) or "linear" (straight line).
- `mouse.jitter` — random pixel offset on cursor target (Gaussian, simulates imprecise human aim).
- `mouse.overshoot` — fraction (0-1) of travel distance to overshoot then correct. 0.05 = 5% overshoot.
- `scroll.events_per_action` — number of CGEvent scroll posts per scroll action.
- `scroll.deceleration` — multiplier per event (0.7 = each event is 70% of previous). Creates momentum feel.
- `scroll.interval_ms` — milliseconds between scroll events.
- `ax.depth` — default BFS depth limit for AX commands.
- `ax.timeout` — default AX search timeout in ms.

**Loading profiles:**
```bash
# Session mode
hand-off session --profile natural

# CLI mode (single command)
hand-off --profile natural click 450,320
```

**Profile discovery:**
```bash
hand-off profiles           # list all profiles with names and descriptions
hand-off profiles show natural   # dump full JSON
```

**Profile override precedence:** explicit action fields > profile defaults > hardcoded defaults.

**Creating profiles:** agents write the JSON file directly. No special command needed. `hand-off profiles` discovers whatever is in the directory.

**Built-in profiles:** hand-off ships with one built-in profile, `natural`, embedded in the binary. User profiles at `~/.config/hand-off/profiles/` override built-ins with the same name.

### 4.7 New CLI Commands (Layer 1)

These work without session mode, as standalone CLI invocations:

**`hover`** — move cursor without clicking.
```bash
hand-off hover <x>,<y> [--dry-run]
```
Posts CGEvent.mouseMoved. In session mode, uses profile mouse speed/curve.

**Expanded `scroll`:**
```bash
hand-off scroll <x>,<y> --dy -100              # vertical (existing)
hand-off scroll <x>,<y> --dx 50                # horizontal (new)
hand-off scroll <x>,<y> --dx 50 --dy -100      # both (new)
```
At least one of `--dx`/`--dy` required. `--dy` is no longer required alone.

**Timing flags on existing commands:**
```bash
hand-off type "hello" --delay 20 --variance 5
hand-off drag 100,100 600,400 --steps 30 --speed 15
hand-off click 450,320 --dwell 80
```

**AX targeting flags on existing commands:**
```bash
hand-off press --pid 1234 --role AXButton --label "Save document" --match contains
hand-off press --pid 1234 --role AXButton --identifier saveBtn
hand-off press --pid 1234 --role AXButton --title Save --near 450,320
hand-off press --pid 1234 --role AXButton --title Save --depth 25 --timeout 3000
```

---

## 5. Phase 2: Focus Channel Protocol + Bind

### 5.1 What a Focus Channel Is

A focus channel is a live spatial reference — a file on disk that describes a region of the UI, maintained by side-eye's daemon mode, readable by any tool. It contains element identities, pre-computed coordinates in every space, and available actions. It is the shared data contract that eliminates coordinate conversion and field extraction from the orchestrator.

### 5.2 Channel File Location and Discovery

```
~/.config/agent-os/channels/<channel-id>.json
```

Any tool can discover available channels by listing this directory. Channel IDs are chosen by the orchestrator and must be filesystem-safe (alphanumeric, hyphens, underscores).

### 5.3 Channel Schema

```json
{
  "channel_id": "slack-msgs",
  "created_by": "side-eye",
  "created_at": "2026-04-01T14:30:00Z",
  "updated_at": "2026-04-01T14:30:05Z",
  "target": {
    "pid": 1234,
    "app": "Slack",
    "bundle_id": "com.tinyspeck.slackmacgap",
    "window_id": 5678,
    "display": 1,
    "scale_factor": 2.0
  },
  "focus": {
    "subtree": {"role": "AXScrollArea", "title": "Messages"},
    "depth": 3
  },
  "window_bounds": {"x": 750.0, "y": 300.0, "w": 800.0, "h": 600.0},
  "elements": [
    {
      "role": "AXButton",
      "title": "Reply",
      "label": null,
      "identifier": null,
      "value": null,
      "enabled": true,
      "actions": ["AXPress"],
      "bounds_pixel": {"x": 200, "y": 100, "w": 60, "h": 30},
      "bounds_window": {"x": 100.0, "y": 50.0, "w": 30.0, "h": 15.0},
      "bounds_global": {"x": 850.0, "y": 350.0, "w": 30.0, "h": 15.0}
    }
  ]
}
```

**Key properties:**

- **Triple coordinates** on every element: `bounds_pixel` (for screenshot annotation), `bounds_window` (for hand-off in window context), `bounds_global` (for hand-off absolute and heads-up). No consumer ever converts.
- **`actions` array** per element: extracted from `kAXActionNamesAttribute`. Enables Phase 3's `list()` introspection.
- **`target` block**: contains everything hand-off's context operator needs (pid, window_id, scale_factor). `bind` copies this directly into session context.
- **`focus` block**: describes how deep the channel's view goes. The orchestrator can request deeper focus; side-eye daemon updates the file.

### 5.4 hand-off `bind` Action

```json
{"action": "bind", "channel": "slack-msgs"}
```

hand-off reads `~/.config/agent-os/channels/slack-msgs.json` and:
1. Sets internal context from `target` (pid, window_id, scale_factor, coordinate_space → "window")
2. Sets subtree from `focus.subtree`
3. Loads the element list for action resolution
4. Re-reads the channel file before each subsequent action (to pick up side-eye updates)

After binding, the orchestrator can reference elements by identity without coordinates:
```json
{"action": "press", "title": "Reply"}
```

hand-off resolves "Reply" against the channel's element list, extracts `bounds_global`, and acts.

**Bind response:**
```json
{
  "status": "ok",
  "action": "bind",
  "channel": "slack-msgs",
  "context": {"pid": 1234, "app": "Slack", "window_id": 5678, "coordinate_space": "window", "scale_factor": 2.0},
  "elements_count": 12,
  "cursor": {"x": 450.0, "y": 320.0},
  "modifiers": []
}
```

**Unbinding:**
```json
{"action": "bind", "channel": null}
```

Clears the channel binding. Context reverts to whatever was set manually (or clears if none was set).

### 5.5 side-eye Daemon Requirements for Phase 2

side-eye needs a daemon mode (serve mode, following the heads-up pattern) that:

1. **Maintains a top-level spatial model.** Polls `CGWindowListCopyWindowInfo` and `NSScreen` periodically. Knows which windows are where, which app is focused, display geometry.
2. **Accepts focus-create commands.** Creates a named channel, targeting a window + optional subtree. Writes the channel file.
3. **Updates channel files.** When the targeted window moves, elements change, or focus shifts, rewrites the channel file with fresh data.
4. **Emits AXIdentifier.** (Already planned in electron-ax-gap task.) Required for the `identifier` targeting field.
5. **Emits triple coordinates.** Every element in a channel file gets `bounds_pixel`, `bounds_window`, and `bounds_global`.
6. **Emits available actions.** Reads `kAXActionNamesAttribute` per element. Includes in channel file.

**side-eye daemon protocol** (Unix socket at `~/.config/side-eye/sock`):

```json
{"action": "focus-create", "id": "slack-msgs", "window_id": 5678, "subtree": {"role": "AXScrollArea", "title": "Messages"}, "depth": 3}
{"action": "focus-update", "id": "slack-msgs", "subtree": {"role": "AXToolbar"}, "depth": 2}
{"action": "focus-remove", "id": "slack-msgs"}
{"action": "focus-list"}
{"action": "snapshot"}
{"action": "subscribe"}
```

`subscribe` registers the connection for change events:
```json
{"type": "channel_updated", "id": "slack-msgs", "updated_at": "2026-04-01T..."}
{"type": "window_moved", "window_id": 5678, "bounds": {"x": 800, "y": 300, "w": 800, "h": 600}}
{"type": "focus_changed", "pid": 5678, "app": "Safari"}
```

### 5.6 heads-up Channel Integration

heads-up can also read focus channels to create context-aware control surfaces:

```json
{"action": "create", "id": "action-panel", "channel": "slack-msgs",
 "html": "<div id='actions'></div>",
 "anchor": "channel", "offset": [0, -40, 200, 30]}
```

`anchor: "channel"` means the canvas is positioned relative to the channel's `window_bounds`. When the window moves, the canvas follows (same anchoring mechanism as `anchorWindow`, but driven by the channel's window_id).

The orchestrator can use `eval` to populate the panel with available actions from the channel:
```json
{"action": "eval", "id": "action-panel", "js": "renderActions(['Press Reply', 'Scroll Down', 'Type Message'])"}
```

When the user clicks an action, the messageHandler relay sends the event back to the orchestrator, which translates it into a hand-off action.

---

## 6. Phase 3: Progressive Perception + Action Introspection

### 6.1 Progressive Perception Graph

side-eye daemon maintains a spatial graph with progressive depth. The graph starts shallow and deepens where the agent focuses — like minesweeper.

**Levels:**
```
Level 0: Display Surface
  ├── Display 1 (main, 2560x1440, 2x, bounds)
  │   └── [N windows - collapsed]
  └── Display 2 (external, 1920x1080, 1x, bounds)
      └── [M windows - collapsed]

Level 1: Windows (expanded on focus)
  ├── Slack (pid 1234, window 5678, focused, bounds)
  ├── Terminal (pid 2345, window 6789, bounds)
  └── Safari (pid 3456, window 7890, bounds)

Level 2: Top-level AX children (expanded on focus)
  ├── AXToolbar [4 children]
  ├── AXSplitGroup [collapsed]
  └── AXScrollArea "Messages" [collapsed]

Level 3+: Subtree elements (expanded on focus)
  ├── AXButton "Reply" (all bounds, actions)
  ├── AXButton "React" (all bounds, actions)
  └── AXStaticText "Hello team" (all bounds)
```

**Navigation commands:**
```json
{"action": "graph-deepen", "id": "slack-msgs"}
{"action": "graph-deepen", "id": "slack-msgs", "subtree": {"role": "AXToolbar"}}
{"action": "graph-deepen", "id": "slack-msgs", "depth": 5}
{"action": "graph-collapse", "id": "slack-msgs"}
{"action": "graph-collapse", "id": "slack-msgs", "depth": 2}
```

Each `graph-deepen` command deepens the graph at the specified channel and writes/updates the corresponding channel file. `graph-collapse` reduces depth back to a summary (default depth 1).

### 6.2 Action Introspection

When hand-off is bound to a channel, the orchestrator can ask what actions are available:

```json
{"action": "list_actions"}
```

Response:
```json
{
  "status": "ok",
  "action": "list_actions",
  "channel": "slack-msgs",
  "available": [
    {"element": {"role": "AXButton", "title": "Reply"}, "actions": ["press", "click", "right_click"]},
    {"element": {"role": "AXButton", "title": "React"}, "actions": ["press", "click", "right_click"]},
    {"element": {"role": "AXStaticText", "title": "Hello team"}, "actions": ["click", "right_click"]},
    {"global": true, "actions": ["scroll", "key_tap", "key_down", "key_up", "type", "move"]}
  ],
  "cursor": {"x": 450.0, "y": 320.0},
  "modifiers": []
}
```

`actions` are derived from:
- AX elements: `kAXActionNamesAttribute` mapped to hand-off verbs ("AXPress" → "press")
- Global actions always available: scroll, keyboard, mouse movement

The orchestrator doesn't need to know AX role semantics. It asks "what can I do?" and gets back verbs.

### 6.3 Heads-up Auto-Projection

In Phase 3, the orchestrator can tell heads-up to auto-project from a channel:

```json
{"action": "create", "id": "focus-highlight",
 "channel": "slack-msgs",
 "auto_project": "highlight_focused",
 "scope": "connection"}
```

`auto_project` modes:
- `highlight_focused` — draw a border around the channel's focused subtree
- `label_elements` — render badges on all elements in the channel (like side-eye --label but live)
- `cursor_trail` — draw a fading trail following cursor movement

These are built-in renderers in heads-up that read channel data directly. The orchestrator doesn't have to manually update overlays as focus changes.

---

## 7. Shared Language Reference

Field name alignment across all three tools:

| Concept | side-eye emits | hand-off accepts | Channel file | heads-up uses |
|---|---|---|---|---|
| Process ID | `app_pid` (windows), `pid` (apps) | `pid` | `target.pid` | n/a |
| AX Role | `role` | `role` | `elements[].role` | n/a |
| Element Title | `title` | `title` | `elements[].title` | n/a |
| AX Description | `label` | `label` | `elements[].label` | n/a |
| AX Identifier | planned | `identifier` | `elements[].identifier` | n/a |
| AX Value | `value` | `value` | `elements[].value` | n/a |
| AX Actions | not emitted yet | `list_actions` response | `elements[].actions` | n/a |
| Pixel bounds | `bounds` (current) | via channel | `elements[].bounds_pixel` | n/a |
| Window-relative bounds | not emitted | `x,y` with window context | `elements[].bounds_window` | `offset` |
| Global CG bounds | not emitted per-element | `x,y` with global context | `elements[].bounds_global` | `at` |
| Window ID | `window_id` | `window_id` | `target.window_id` | `anchorWindow` |
| Scale factor | per display in topology | `scale_factor` in context | `target.scale_factor` | implicit |
| Display ordinal | `ordinal` | informational | `target.display` | n/a |
| App name | `app_name` (windows), `name` (apps) | `app` (informational) | `target.app` | n/a |
| Bundle ID | `bundle_id` | not used | `target.bundle_id` | n/a |

**The one normalization:** side-eye's `app_pid` (in window objects) becomes `pid` in the channel file and hand-off. side-eye's `pid` (in the apps array) already matches.

---

## 8. File Locations and Discovery

| Path | Purpose | Created by |
|---|---|---|
| `~/.config/hand-off/profiles/<name>.json` | Behavioral profiles | Agent or user |
| `~/.config/agent-os/channels/<id>.json` | Focus channel files | side-eye daemon |
| `~/.config/side-eye/sock` | side-eye daemon socket | side-eye serve |
| `~/.config/heads-up/sock` | heads-up daemon socket | heads-up serve |

All directories are created on first use by the respective tool. No setup required.

---

## 9. Error Handling

### Session errors
Errors do not kill the session. The orchestrator receives an error response and can retry or adjust.

**Error codes (extending v1):**

| Code | Meaning |
|---|---|
| `ELEMENT_NOT_FOUND` | AX element matching criteria not found |
| `AX_ACTION_FAILED` | AXPerformAction returned error |
| `AX_NOT_SETTABLE` | AXValue is not settable on element |
| `AX_TIMEOUT` | AX tree search exceeded timeout |
| `PERMISSION_DENIED` | Accessibility permission not granted |
| `CGEVENT_FAILED` | CGEvent creation failed |
| `APPLESCRIPT_FAILED` | AppleScript execution error |
| `INVALID_KEY` | Unknown key name in combo |
| `MISSING_ARG` | Required field not provided and not in context |
| `WINDOW_NOT_FOUND` | Window ID not found in window list |
| `CHANNEL_NOT_FOUND` | Focus channel file does not exist |
| `CHANNEL_STALE` | Channel file older than 10s (side-eye may be down) |
| `INVALID_CONTEXT` | Context fields are invalid (e.g., coordinate_space without window_id) |
| `PARSE_ERROR` | Invalid JSON input |
| `UNKNOWN_ACTION` | Unrecognized action string |

### Session end on fatal errors
Only truly unrecoverable conditions kill the session:
- stdin closes (pipe broken)
- Accessibility permission revoked mid-session
- Process receives SIGTERM/SIGINT

On SIGINT/SIGTERM, the session releases all held modifier keys before exiting (preventing stuck modifiers).

---

## 10. Testing Strategy

### Phase 1 Tests

**Unit tests (no GUI, no AX permission):**
- Profile loading: valid JSON → correct defaults, missing fields → hardcoded defaults, malformed → error
- Key combo parsing: all modifier combinations, unknown keys → error
- Coordinate conversion: window-relative with various scale factors
- Timing distribution: Gaussian/uniform within min/max ranges (statistical test)
- Context state: set/update/clear, field inheritance, override precedence

**Integration tests (require AX permission, GUI):**
- Session lifecycle: start, receive actions, get responses, end
- Modifier state: key_down cmd → key_tap tab → verify cmd flag on tab event → key_up cmd
- Context: set pid → press without pid → verify correct targeting
- AX targeting: find by role+title, by identifier, by label, with contains match, with near disambiguation, with depth limit
- Profile application: load profile → type text → verify inter-character timing is within profile range
- Hover: verify cursor position changes without click
- Scroll: verify dx/dy events posted

**CLI tests (existing commands with new flags):**
- `--depth`, `--timeout`, `--label`, `--identifier`, `--match`, `--near` on AX commands
- `--delay`, `--variance` on type
- `--dx` on scroll

### Phase 2 Tests

- Channel file write/read: valid schema, missing fields, concurrent access
- Bind: load context from channel, resolve element by title, verify correct global coordinates
- Channel staleness: channel file >10s old → CHANNEL_STALE warning
- side-eye daemon: create channel, update on window move, remove channel, list channels

### Phase 3 Tests

- list_actions: bound to channel → returns correct verbs for each element type
- Progressive focus: display → window → subtree → verify graph depth at each level
- heads-up auto-projection: channel update → highlight overlay repositions

---

## 11. Open Questions

1. **Channel update frequency.** How often should side-eye daemon re-scan the AX tree for an active channel? 1Hz? On-demand? Event-driven (AX notifications)? Trade-off: freshness vs. CPU cost.

2. **Multiple bound channels.** Can a hand-off session be bound to multiple channels simultaneously? (e.g., watching Slack in one channel and Safari in another, acting in whichever the orchestrator specifies per-action.) Current design: one binding at a time. Worth reconsidering.

3. **Profile inheritance.** Should profiles support `"extends": "natural"` to inherit from another profile and override specific fields? Keeps profiles DRY. Adds complexity.

4. **Trackpad gestures.** Some Mac interactions have no keyboard equivalent (e.g., force-click, specific trackpad gestures). Private CGS APIs could synthesize these but violate the "public APIs only" policy. Revisit if real use cases demand it.

5. **Session multiplexing.** Can one hand-off session serve multiple orchestrator "threads"? Or does each orchestrator open its own session? Current design: one session per orchestrator. Modifier state is inherently single-threaded (one set of hands).

6. **Channel file vs. socket.** The current design uses filesystem as IPC (side-eye writes, hand-off reads). Alternative: hand-off connects to side-eye daemon's socket directly and receives push updates. Trade-off: filesystem is simpler and preserves tool independence, socket is lower latency.

7. **Spaces representation.** macOS Spaces are per-display or system-wide. The spatial graph needs to represent which windows are on which Space without introducing a full Space management API. Current approach: only visible windows appear in the graph (matching CGWindowListCopyWindowInfo behavior). Switching Spaces is a keyboard action (ctrl+left/right), not a graph operation.
