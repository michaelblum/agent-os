# Status Item and Avatar Lifecycle — Design

**Date:** 2026-04-14
**Status:** Draft
**Scope:** Re-add the macOS menu bar status item as a generic daemon primitive; wire Sigil as the first consumer with avatar toggle, click behaviors, and workbench-on-right-click.

## Problem

The menu bar status item (`StatusItemManager`, 320 lines) was deleted in `79267e5` when the Swift avatar-sub binary was retired. Its sole purpose had been to spawn that binary, so it was removed with it. But the status item was the user's primary way to summon the avatar — and now there's no way to toggle Sigil on or off without running a shell command.

The old implementation was Sigil-coupled in two ways:
1. It directly managed a child process (`avatar-sub`) via `Process` start/stop/pgrep.
2. The toggle behavior was hardcoded to one canvas + one binary.

With the JS renderer, there's no process to manage. Canvases ARE the app. The status item needs to come back as a generic platform primitive that any app can configure.

## Design Principles

1. **The daemon toggles a canvas on and off.** That's the platform's job.
2. **The canvas decides what happens when you interact with it.** That's the app's job.
3. **Position persistence is a platform concern.** The daemon remembers where the canvas was.
4. **Icon appearance and toggle target are config-driven.** Any app can claim the status item.
5. **No app-specific code in the daemon.** The daemon doesn't know about Sigil, avatars, workbenches, or radial menus.

## Architecture

### Layer 0 — Daemon: Generic Status Item

**File:** `src/display/status-item.swift`

`StatusItemManager` manages an `NSStatusItem` in the macOS menu bar.

**Config keys** (in `AosConfig`):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `status_item.enabled` | bool | false | Show/hide the menu bar icon |
| `status_item.toggle_id` | string | "avatar" | Canvas ID to create/remove on click |
| `status_item.toggle_url` | string | "" | URL to load in the toggled canvas |
| `status_item.toggle_at` | [number] | [200,200,300,300] | Default frame [x,y,w,h] when no saved position exists |
| `status_item.toggle_track` | string | nil | Optional track target (e.g. "union") |
| `status_item.icon` | string | "hexagon" | Icon style. "hexagon" is the built-in default. Future: path to a template image. |

**Behavior — click:**

1. If the toggle canvas does not exist → **summon**:
   a. Read saved position from `~/.config/aos/{mode}/status-item-position.json`. If present, use it. Otherwise use `toggle_at` from config.
   b. Create the canvas at the icon position (small, alpha 0).
   c. Reveal (alpha 1) after a brief delay for WKWebView init.
   d. Animate frame from icon position to target position (easeOutCubic, ~0.5s).
   e. Update icon state (filled).

2. If the toggle canvas exists → **dismiss**:
   a. Save current canvas position to `~/.config/aos/{mode}/status-item-position.json`.
   b. Animate frame from current position to icon position (easeInBack, ~0.4s).
   c. Remove the canvas (and any child canvases scoped to it).
   d. Update icon state (unfilled).

**Position persistence file** (`status-item-position.json`):

```json
{
  "avatar": { "at": [500, 200, 300, 300] },
  "other-app-canvas": { "at": [100, 100, 400, 400] }
}
```

Keyed by canvas ID so multiple apps can persist independently if the status item is reconfigured.

**Icon rendering:**

The default icon is a hexagon with a center dot (the original design):
- Unfilled hexagon + small dot = canvas absent
- Filled hexagon + white dot = canvas present

The icon is drawn as an `NSImage(isTemplate: true)` so it respects light/dark menu bar automatically.

Future: `status_item.icon` can accept a path to a custom template image. For now, only `"hexagon"` is implemented.

**What the daemon does NOT do:**
- Handle avatar click behaviors (that's the canvas JS)
- Know about workbenches, radial menus, or parking (that's Sigil)
- Manage child processes (that was the old world)

### Layer 3 — Sigil: Avatar Click Behaviors

**File:** `apps/sigil/renderer/index.html` (state machine section)

The avatar renderer already has a 4-state machine: IDLE → PRESS → DRAG → GOTO. The changes are:

**Right-click repurposed (currently: cancel → IDLE):**

Old behavior: right-click anywhere cancels the current gesture.
New behavior: right-click is context-dependent.

| State | Right-click behavior |
|-------|---------------------|
| IDLE | If on avatar → show workbench. If off avatar → no-op (passthrough). |
| PRESS | Cancel gesture → IDLE (unchanged). |
| DRAG | Cancel gesture → IDLE (unchanged). |
| GOTO | Cancel goto → IDLE (unchanged). |

So right-click only shows the workbench from IDLE state when the click is on the avatar. During gestures, it still cancels.

**Show workbench (from right-click on avatar in IDLE):**

1. Save current avatar position as `preWorkbenchPos`.
2. Compute workbench frame: trailing 2/3 of the avatar's display, with margin.
3. Create the workbench canvas via `postToHost('canvas.create', {...})`:
   - `id: 'sigil-workbench'`
   - `url: 'aos://sigil/workbench/index.html'`
   - `at: [computed frame]`
   - `interactive: true`
   - `focus: true`
4. Auto-park: move avatar to the top-left nonant of the display (same logic as `launch.sh`'s `stage_avatar`).
5. Set `liveJs.workbenchVisible = true`.

**Dismiss workbench:**

The workbench is dismissed by:
- Right-clicking the avatar again while `workbenchVisible` (toggle behavior)
- Or: the workbench canvas being removed externally (detected via `canvas_lifecycle` event)

On dismiss:
1. Remove the workbench canvas via `postToHost('canvas.remove', { id: 'sigil-workbench' })`.
2. Restore avatar position from `preWorkbenchPos` (fast-travel animation).
3. Set `liveJs.workbenchVisible = false`.

**Workbench frame computation (JS, in renderer):**

The renderer already subscribes to `display_geometry` and knows all display bounds. It computes the frame the same way `launch.sh` does:

```
display = display containing the avatar
usable = display bounds inset by margin (32px x, 28px y)
w = max(480, round(usable.w * 2/3))
h = usable.h
x = usable.x + usable.w - w
y = usable.y
```

This keeps the geometry computation in the consumer layer, not the daemon.

**State machine summary (updated):**

```
IDLE
  left-click on avatar    → PRESS
  right-click on avatar   → toggle workbench (show or dismiss)
  right-click off avatar  → passthrough

PRESS
  move ≥ 6px              → DRAG
  mouseup (short click)   → GOTO ("attention" mode)
  right-click             → cancel → IDLE
  ESC                     → cancel → IDLE

DRAG
  release within 40px     → cancel → IDLE
  release outside 40px    → fast-travel to release point → IDLE
  (future: radial menu slice selection)
  right-click             → cancel → IDLE
  ESC                     → cancel → IDLE

GOTO
  click on avatar         → cancel → IDLE
  click off avatar        → fast-travel to click point → IDLE
  right-click             → cancel → IDLE
  ESC                     → cancel → IDLE
```

### Config Setup (one-time, by the user or a setup script)

```bash
aos set status_item.enabled true
aos set status_item.toggle_id avatar-main
aos set status_item.toggle_url "aos://sigil/renderer/index.html"
aos set status_item.toggle_track union
```

This is all Sigil-specific policy expressed as generic config. The daemon doesn't interpret it as "Sigil" — it's just a canvas ID, a URL, and a tracking mode.

## Implementation Scope

### Daemon changes (Swift)

1. **Re-add `src/display/status-item.swift`** — rewritten from the old 320-line version:
   - Remove all process management (`startSigilProcess`, `stopSigilProcess`, `isSigilRunning`, `resolveSigilBinary`)
   - Remove `isDismissing` flag and Sigil-specific cleanup (`avatar-hit-target`, `cursor-decor`)
   - Keep: icon rendering, click handler, ingress/egress animation, `statusItemCGPosition()`
   - Add: position persistence (read/write JSON file)
   - Add: `toggle_track` support (pass through to canvas create)
   - Re-add: `CanvasManager.setCanvasAlpha(_:_:)` (removed in `79267e5`, needed for ingress reveal)

2. **Update `src/shared/config.swift`** — add `StatusItemConfig` struct and `status_item` field to `AosConfig`.

3. **Update `src/commands/serve.swift`** — instantiate `StatusItemManager` from config, wire into daemon lifecycle.

4. **Update `setConfigValue`** — handle `status_item.*` keys.

### Sigil changes (JS)

5. **Update `apps/sigil/renderer/index.html`** — modify state machine:
   - Right-click on avatar in IDLE → toggle workbench
   - Workbench frame computation from display geometry
   - Auto-park / restore on workbench show/dismiss
   - Add `canvas_lifecycle` to the `subscribe()` call (currently only subscribes to `input_event`, `display_geometry`, `wiki_page_changed`) to detect external workbench removal
   - Handle `behavior/dismissed` message: clean up avatar-hit child canvas before parent is torn down
   - Add `liveJs.workbenchVisible` and `liveJs.preWorkbenchPos` state

### Not in scope

- Radial menu slice selection (existing placeholder, future work)
- Custom icon images (future — only "hexagon" for now)
- Multiple status items (one icon, one toggle target)
- Workbench bootstrap (debug tabs warm-up) — the workbench page handles its own initialization via `mountPanel`
- `launch.sh` changes — the launcher remains useful for development but the status item is the primary operator path

## Position Persistence Detail

**When to save:** Every time a canvas matching `toggle_id` is removed (whether by status item dismiss, `aos show remove`, or `aos clean`).

**When to read:** Every time the status item summons (creates) the toggle canvas.

**File location:** `~/.config/aos/{mode}/status-item-position.json`

**Scope:** The file stores positions for all canvas IDs that have ever been toggled. Old entries are harmless — they're only read when the matching ID is summoned.

**Race safety:** The daemon is single-threaded on main queue for all canvas operations, so no concurrent read/write risk.

## Animation Detail

Reuse the old animation approach (frame interpolation on a background queue):

**Ingress (summon):**
1. Create canvas at icon position, 40×40, alpha 0
2. Wait 350ms for WKWebView init
3. Set alpha 1
4. Animate frame: icon position → target position, 0.5s, easeOutCubic

**Egress (dismiss):**
1. Eval `headsup.receive(base64({ type: 'behavior', slot: 'dismissed' }))` — gives the canvas a chance to clean up children (e.g., avatar-hit) via `postToHost('canvas.remove', ...)` before the parent is torn down.
2. Animate frame: current position → icon position, 0.4s, easeInBack. The 400ms animation window is the canvas's cleanup budget.
3. Remove canvas.

The animation runs on a background queue with `DispatchQueue.main.async` for each frame update, same as the old implementation.

**Re-added daemon API:** `CanvasManager.setCanvasAlpha(_:_:)` was removed in `79267e5` because the status item was its only caller. It must be re-added for the ingress alpha=0→1 reveal.

## Acceptance Criteria

1. `aos set status_item.enabled true` shows a hexagonal icon in the menu bar.
2. Clicking the icon when no toggle canvas exists creates it at the last-known position (or default) with ingress animation.
3. Clicking the icon when the toggle canvas exists removes it with egress animation and saves position.
4. Relaunching the daemon and clicking the icon restores the canvas at its saved position.
5. Right-clicking the Sigil avatar in IDLE state toggles the workbench canvas.
6. The workbench appears in the trailing 2/3 of the avatar's display.
7. The avatar auto-parks to the top-left nonant when the workbench is visible.
8. Dismissing the workbench restores the avatar to its pre-workbench position.
9. No Sigil-specific code exists in `status-item.swift` or `config.swift`.

## Open Questions

1. Should the status item support a right-click menu on the icon itself (e.g., "Quit", "Settings")? Deferred for now — click-only toggle is sufficient.
2. Should egress remove child canvases (like `avatar-hit`)? No automatic parent-child cascade — the canvas protocol has no parent field. Instead, the `behavior/dismissed` message gives the canvas 400ms (the egress animation duration) to clean up its own children via `postToHost('canvas.remove', ...)`. Any orphans are caught by `aos clean`.
3. Should `aos clean` also clear saved positions? No — positions are user intent, not stale state.

## References

- Deleted `src/display/status-item.swift` (commit `79267e5`, retrievable via `git show 79267e5 -- src/display/status-item.swift`)
- Original feature commit: `e5ff178` ("feat: menu bar status item + avatar lifecycle transitions")
- Port to unified daemon: `23af79c` ("fix: port StatusItemManager to unified daemon")
- Current avatar state machine: `apps/sigil/renderer/index.html` lines 1275–1651
- Canvas protocol: `src/display/protocol.swift`
- Config system: `src/shared/config.swift`
