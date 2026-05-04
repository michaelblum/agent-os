# heads-up Channel Integration + Control Surfaces

**Date:** 2026-04-01
**Status:** Design spec — pending review
**Scope:** Channel-anchored canvases, auto-projection modes, ad hoc control surfaces for human→agent communication
**Depends on:** heads-up serve mode (built), focus channel protocol (Phase 2 of hand-off v2 spec), side-eye daemon (Phase 2)
**Related:** docs/superpowers/specs/2026-04-01-hand-off-v2-and-focus-channels.md (Sections 5.6 and 6.3)

---

## 1. Problem Statement

heads-up can render floating canvases anchored to windows. But the hand-off v2 + focus channel architecture introduces a richer coordination model:

1. **Channel-anchored canvases** — a canvas positioned relative to a focus channel's target, not just a raw window ID. The orchestrator shouldn't have to extract `window_id` from a channel file and pass it manually.

2. **Auto-projection** — built-in renderers that visualize channel state automatically (element highlights, focus borders, cursor trails). The orchestrator shouldn't have to manually update overlays every time the agent's focus changes.

3. **Ad hoc control surfaces** — the orchestrator creates interactive canvases on the fly that let the human talk back to the agent. Approval dialogs, action menus, stop buttons. This capability already exists (interactive canvases + messageHandler relay) but has no patterns, templates, or convenience mechanisms.

---

## 2. Changes to heads-up

### 2.1 Protocol Extension: `anchorChannel`

**Add to `CanvasRequest`:**
```swift
var anchorChannel: String?    // focus channel ID (alternative to anchorWindow)
```

When `anchorChannel` is set on a `create` or `update` request:
1. heads-up reads `~/.config/agent-os/channels/<id>.json`
2. Extracts `window_bounds` and `target.window_id`
3. Internally sets `anchorWindowID` to the channel's `window_id`
4. Applies `offset` relative to the channel's `window_bounds`
5. The existing 30fps anchor polling handles the rest — it already tracks window position via `CGWindowListCopyWindowInfo`

**Why not just use `anchorWindow`?** Because the orchestrator would have to:
1. Read the channel file
2. Extract `target.window_id`
3. Pass it to heads-up

That's the mechanical plumbing we're eliminating. `anchorChannel: "slack-msgs"` does it in one field.

**Request example:**
```json
{"action": "create", "id": "action-panel",
 "anchorChannel": "slack-msgs",
 "offset": [0, -40, 200, 30],
 "html": "<div id='panel'>...</div>",
 "interactive": true,
 "scope": "connection"}
```

**Response — add `anchorChannel` to `CanvasInfo`:**
```json
{
  "id": "action-panel",
  "at": [750, 260, 200, 30],
  "anchorChannel": "slack-msgs",
  "anchorWindow": 5678,
  "offset": [0, -40, 200, 30],
  "interactive": true,
  "scope": "connection"
}
```

Note: `anchorWindow` is auto-populated from the channel. Both are returned for transparency.

**Channel file re-read:** If the channel's `window_id` changes (e.g., the app restarts and gets a new window), the canvas should update. The anchor polling loop should re-read the channel file periodically (every 1s, not every frame) to detect `window_id` changes.

**Error handling:**
- `CHANNEL_NOT_FOUND` — channel file doesn't exist
- `CHANNEL_STALE` — channel file older than 10s (side-eye daemon may be down)

### 2.2 Auto-Projection Modes

Auto-projection canvases read channel data directly and render visualizations without orchestrator involvement. They update automatically when the channel file changes.

**Add to `CanvasRequest`:**
```swift
var autoProject: String?      // "highlight_focused", "label_elements", "cursor_trail"
```

`autoProject` requires `anchorChannel`. It creates a canvas with built-in rendering logic instead of loading user HTML.

#### `highlight_focused`

Draws a colored border around the channel's focused subtree bounds.

```json
{"action": "create", "id": "focus-border",
 "anchorChannel": "slack-msgs",
 "autoProject": "highlight_focused",
 "scope": "connection"}
```

Implementation:
- Reads channel file's `focus.subtree` and computes its bounding box from child elements' `bounds_global`
- Renders an HTML canvas with a 2px border at the subtree bounds, offset from the window
- Re-reads channel file every 500ms and updates the border if the subtree or bounds changed
- Default color: `rgba(59, 130, 246, 0.6)` (blue). Overridable via `--html` containing a CSS variable `--highlight-color`

#### `label_elements`

Renders numbered badges on all elements in the channel — a live version of `side-eye --label`.

```json
{"action": "create", "id": "live-labels",
 "anchorChannel": "slack-msgs",
 "autoProject": "label_elements",
 "scope": "connection"}
```

Implementation:
- Reads channel file's `elements` array
- For each element, renders a numbered badge at `bounds_global` position (offset from window)
- Re-reads channel file every 500ms and re-renders if elements changed
- Badge styling matches side-eye --label: small pill with ordinal number, role-based color
- Click-through (not interactive) — these are visual indicators

#### `cursor_trail`

Draws a fading trail that follows cursor movement. Does NOT require a channel — can work standalone.

```json
{"action": "create", "id": "cursor-trail",
 "autoProject": "cursor_trail",
 "scope": "connection"}
```

Implementation:
- Creates a full-screen transparent canvas (spans all displays)
- Polls `CGEvent(source: nil)?.location` at 30fps (same rate as anchor polling)
- Draws fading circles along the cursor path (last 500ms of movement)
- Trail color: `rgba(59, 130, 246, 0.4)` — semi-transparent blue
- Trail fades by reducing opacity over time

**Note:** `cursor_trail` is the simplest auto-projection — it's pure CGEvent polling + canvas rendering, no channel needed. Good candidate for first implementation.

### 2.3 Control Surface Patterns

The infrastructure for control surfaces already exists: `interactive: true` + messageHandler relay. What's missing is convenience for common patterns. Rather than building templates into heads-up (which would add opinions to a dumb display server), provide **pattern documentation and example HTML** that orchestrators can use.

**Pattern: Approval Dialog**
```json
{"action": "create", "id": "approve-delete",
 "at": [500, 300, 280, 120],
 "html": "<div style='background:#1e1e2e;border-radius:12px;padding:16px;font-family:system-ui;color:#cdd6f4'><p style='margin:0 0 12px'>Delete 3 files from Downloads?</p><div style='display:flex;gap:8px'><button onclick=\"headsup('approve')\" style='flex:1;padding:8px;border:none;border-radius:6px;background:#a6e3a1;color:#1e1e2e;cursor:pointer'>Approve</button><button onclick=\"headsup('deny')\" style='flex:1;padding:8px;border:none;border-radius:6px;background:#f38ba8;color:#1e1e2e;cursor:pointer'>Deny</button></div></div>",
 "interactive": true,
 "scope": "connection"}
```

Where the HTML includes a helper:
```javascript
function headsup(action) {
  window.webkit.messageHandlers.headsup.postMessage({action: action});
}
```

The orchestrator receives via subscribe:
```json
{"type": "event", "id": "approve-delete", "payload": {"action": "approve"}}
```

**Pattern: Action Menu**
```html
<div style="background:#1e1e2e;border-radius:12px;padding:8px;font-family:system-ui">
  <button onclick="headsup('reply')" style="...">Reply</button>
  <button onclick="headsup('scroll')" style="...">Scroll Down</button>
  <button onclick="headsup('type')" style="...">Type Message</button>
</div>
```

**Pattern: Stop Button**
```json
{"action": "create", "id": "stop-btn",
 "at": [20, 20, 60, 60],
 "html": "<button onclick=\"headsup('stop')\" style='width:60px;height:60px;border-radius:50%;background:#f38ba8;border:none;font-size:24px;cursor:pointer'>⏹</button>",
 "interactive": true,
 "scope": "connection"}
```

Floating stop button in the top-left corner. Connection-scoped so it disappears when the orchestrator disconnects.

**Pattern: Status Dashboard**
```json
{"action": "create", "id": "status",
 "at": [20, 80, 250, 400],
 "html": "...",
 "interactive": false,
 "scope": "connection",
 "ttl": 0}
```

Non-interactive, updated via `eval`:
```json
{"action": "eval", "id": "status", "js": "updateStatus({step: 3, total: 7, current: 'Uploading report'})"}
```

### 2.4 Implementation Notes

**What changes in code:**

| File | Change | Scope |
|---|---|---|
| `protocol.swift` | Add `anchorChannel: String?` and `autoProject: String?` to `CanvasRequest`. Add `anchorChannel` to `CanvasInfo`. | Small |
| `canvas.swift` | In `handleCreate`/`handleUpdate`: resolve `anchorChannel` → read channel file → extract `window_id` → set `anchorWindowID`. | Medium |
| `canvas.swift` | In `updateAnchoredCanvases`: periodically re-read channel file for channel-anchored canvases to detect `window_id` changes. | Small |
| `canvas.swift` | Add `autoProject` rendering: built-in HTML generators for `highlight_focused`, `label_elements`, `cursor_trail`. | Medium |
| `canvas.swift` | Add channel file polling for auto-projection canvases (500ms re-read, diff, re-render via eval). | Medium |
| `helpers.swift` | Add `readChannelFile(id:)` helper that reads and parses `~/.config/agent-os/channels/<id>.json`. | Small |

**What does NOT change:**
- Daemon socket protocol (ndjson, same as today)
- Render mode
- Window anchor polling mechanism (30fps `CGWindowListCopyWindowInfo`)
- Message handler relay
- Connection scoping, TTL, idle timeout
- CLI commands (client.swift just passes through `anchorChannel` and `autoProject`)

---

## 3. Testing

**Channel anchoring:**
- Create a channel file manually, create canvas with `anchorChannel`, verify it positions relative to the channel's window
- Move the window, verify canvas follows
- Delete the channel file, verify `CHANNEL_NOT_FOUND` on next poll
- Change `window_id` in channel file, verify canvas re-anchors

**Auto-projection:**
- `highlight_focused`: create channel with a subtree, create auto-projection, verify border appears at correct bounds
- `label_elements`: create channel with elements, verify badges appear at element positions, modify channel file, verify badges update
- `cursor_trail`: create trail canvas, move mouse, verify trail renders and fades

**Control surfaces:**
- Create interactive canvas with button, click button, verify event arrives on subscriber connection
- Test approval dialog pattern end-to-end: orchestrator creates dialog → user clicks → event relayed → orchestrator removes dialog

---

## 4. Open Questions

1. **Auto-projection refresh rate.** 500ms channel file re-read is a guess. Too slow for real-time element tracking, too fast if the channel rarely changes. Could be configurable per canvas.

2. **Channel file watching.** Polling the filesystem is simple but has latency. `FSEvents` / `DispatchSource.makeFileSystemObjectSource` could provide instant updates. More complex but lower latency. Worth considering for `label_elements` which benefits from snappy updates.

3. **Auto-projection customization.** Should `highlight_focused` accept style parameters (color, border width, opacity) via the create request? Or is eval-based customization sufficient?

4. **Multi-display auto-projection.** `cursor_trail` needs a canvas per display (macOS can't span a single window across displays with separate Spaces). The existing multi-display pattern (one canvas per display with viewport slicing) applies here.
