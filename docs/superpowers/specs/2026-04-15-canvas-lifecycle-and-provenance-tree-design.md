# Canvas Lifecycle and Provenance Tree

**Date:** 2026-04-15
**Session:** canvas-lifecycle-brainstorm
**Status:** Design — pending implementation plan

## Problem

The AOS daemon's canvas system has a binary lifecycle: create or destroy. Every
toggle of the Sigil avatar via the status item rebuilds the entire WKWebView +
Three.js scene from scratch — 5-7s of boot time (WKWebView cold start, 600KB
Three.js parse, 16 ES module loads, display_geometry await, birthplace
resolution). The prior `avatar-sub` binary avoided this by keeping the renderer
alive and showing/hiding it, but that binary was retired (#46) because corporate
AV blocks unsigned binaries. Only the main `aos` binary is trusted.

The daemon is now the only long-running host process. It needs lifecycle
primitives that let canvases be hidden and restored without destruction, and it
needs to understand parent-child relationships so lifecycle operations can
cascade through a canvas tree atomically.

## Goals

1. **Instant toggle.** Suspending and resuming a canvas tree should feel
   instantaneous (<50ms visual latency). Cold boot remains the fallback for
   first launch or daemon restart.
2. **General-purpose primitives.** The solution should be platform vocabulary,
   not Sigil-specific wiring. Any future agent-os app benefits from canvas
   trees and suspend/resume.
3. **Atomic multi-canvas transitions.** Hiding or showing a group of related
   canvases must happen in the same frame — no flicker from sequential
   round-trips.
4. **Simplify existing code.** The renderer's manual child-cleanup handler
   (`dismissed` behavior) and StatusItemManager's create/destroy cycle should
   become unnecessary.

## Non-Goals

- Memory pressure eviction (LRU, auto-destroy of long-suspended canvases). Not
  needed at current scale. Can be added later as a lifecycle policy.
- Formal canvas state machine (Booting/Active/Suspended/Destroyed as enforced
  states). Booting and Destroyed are already inferrable; formalizing them adds
  API surface without solving a current problem.
- WebGL resource disposal on suspend. v1 preserves CPU/battery by pausing rAF,
  not memory by disposing buffers. Disposing and rebuilding Three.js resources
  would reintroduce the boot latency this design eliminates.

## Design

### 1. Canvas Parent-Child Tree

#### The `parent` field

Every `Canvas` gains an optional `parent: String?` — the ID of its parent
canvas. Stored alongside existing fields (`trackTarget`, `scope`, etc.).

#### Implicit provenance

When a create request arrives through a canvas's `CanvasMessageHandler` (i.e., a
renderer called `postToHost('canvas.create', ...)`), the daemon automatically
sets `parent` to the source canvas ID. The source identity is already available
at the handler dispatch site — the daemon just needs to record it.

CLI-originated creates (`aos show create`) have no implicit parent.

#### Explicit override

`CanvasRequest` gains an optional `parent` field. Three cases:

| Request | Source is a canvas | Result |
|---|---|---|
| `parent` not specified | Yes | Implicit parent = source canvas ID |
| `parent` not specified | No (CLI/API) | No parent |
| `parent: "<id>"` | Either | Explicit parent (must exist, or `PARENT_NOT_FOUND` error) |
| `parent: null` | Either | Explicitly no parent (opts out of implicit) |

#### The `cascade` flag

Also on `CanvasRequest`, default `true`. Controls whether lifecycle operations
on the parent propagate to this child. When `cascade: false`, the child exists
in the tree (provenance is recorded for queries) but suspend/resume/remove on
the parent skip it.

**Orphan contract:** A canvas that sets `cascade: false` is responsible for its
own dismissal. If its parent is removed, the child's `parent` field is set to
`nil` and it continues living independently. The canvas must implement its own
exit path (e.g., a close button calling `postToHost('canvas.remove', { id: self })`)
or it will be stranded on screen.

#### Tree storage

No separate data structure. The tree is implicit in the `parent` fields of
`canvases: [String: Canvas]`. To collect children of X: filter where
`parent == "X"`. At current scale (single-digit canvas counts), linear scan is
fine.

#### Tree in `list` output

The `list` response gains `parent` and `cascade` fields per canvas entry, so
consumers can inspect the tree.

### 2. Suspend and Resume

#### Suspend

`CanvasRequest(action: "suspend")` with required `id`. Two phases:

**Phase 1 — Atomic hide (synchronous, main thread).** The daemon collects the
target canvas and all descendants where `cascade == true` (recursive tree walk).
It calls `window.orderOut(nil)` on every window in the set in a single
main-thread dispatch. Each canvas's `suspended` flag is set to `true`. No
round-trips, no flicker.

**Phase 2 — Renderer notification (async, best-effort).** After the windows are
hidden, the daemon sends a `lifecycle:suspend` message to each canvas's
WKWebView via the existing `headsup.receive` bridge (base64-encoded JSON). The
renderer uses this to pause rAF and reduce CPU/GPU utilization. No ACK required
on suspend — the windows are already invisible, so renderer response time has
no visual consequence.

Suspending an already-suspended canvas is a no-op (return success).

#### Resume

`CanvasRequest(action: "resume")` with required `id`. Reverse order — renderers
wake before windows appear:

**Phase 1 — Renderer wake (async, gated).** The daemon sends a
`lifecycle:resume` message to each suspended canvas in the tree (target +
cascade-eligible descendants). Each renderer is expected to restart rAF, render
at least one frame, and reply with a `lifecycle:ready` ACK via `postToHost`.

The daemon waits for all ACKs with a single **200ms timeout** (wall-clock from
the first resume message sent). All canvases are resumed in parallel; the gate
opens when every canvas has ACK'd or when the timeout fires, whichever comes
first. This is generous for a single rAF tick (~16ms) but bounded so a broken
renderer can't block the show path.

**If the timeout fires:** The daemon shows the window anyway and logs a warning
(`os_log .default` or equivalent). This ensures the user always gets a response
to their click. A stale frame is better than no frame. The warning makes the
failure diagnosable.

**Phase 2 — Atomic show (synchronous, main thread).** Once ACKs arrive (or
timeouts fire), the daemon calls `orderFront(nil)` on all windows in the tree
in a single main-thread dispatch. `suspended` flags flip to `false`.

Resuming a non-suspended canvas is a no-op (return success).

#### Why the asymmetry

Suspend is hide-then-notify because instant visual response on dismiss matters.
Resume is notify-then-show because flashing a stale frame is worse than a
sub-200ms delay. The user sees: click to dismiss is instant; click to summon
shows a current frame.

#### Edge cases

- **Suspending a canvas with `cascade: false` children:** Those children stay
  visible and active.
- **Creating a child of a suspended parent:** The child is created in suspended
  state (born hidden). Prevents a child from appearing while its parent tree is
  invisible.
- **Suspend during animation:** If StatusItemManager is mid-animation (e.g.,
  cold boot dot animation still playing), the `isAnimating` guard rejects the
  click. No conflict.

### 3. Cascade Remove

When `handleRemove` is called on a canvas that has children, the daemon walks
the tree and removes all descendants where `cascade == true`, bottom-up (leaves
first, then parents). Each canvas gets `close()` called and is removed from the
dictionary. `onCanvasLifecycle` fires for each removed canvas.

Children with `cascade: false` become orphans — their `parent` is set to `nil`.

This replaces the renderer's manual `dismissed` behavior handler. Today:

```js
// renderer/index.html — this code becomes dead
case 'behavior':
    if (msg.slot === 'dismissed') {
        postToHost('canvas.remove', { id: 'avatar-hit' });
        if (liveJs.workbenchVisible) {
            postToHost('canvas.remove', { id: 'sigil-workbench' });
        }
    }
```

The daemon handles cascade removal. The renderer doesn't need to know about its
children's lifecycle.

Remove on a suspended canvas works fine — the windows are already ordered out,
so `close()` tears down the WKWebView without visual flash.

### 4. Renderer Lifecycle Protocol

#### Messages from daemon to renderer

Delivered via the existing `headsup.receive` bridge (base64-encoded JSON):

```json
{ "type": "lifecycle", "action": "suspend" }
{ "type": "lifecycle", "action": "resume" }
```

#### ACK from renderer to daemon

Via `postToHost` (same channel as `canvas.create`, `canvas.remove`):

```js
postToHost('lifecycle.ready', { reason: 'resume' });
```

#### Renderer implementation

The renderer adds a `suspended` gate to its animation loop:

```js
let suspended = false;

function animate() {
    if (suspended) return;  // stop the loop
    requestAnimationFrame(animate);
    // ... existing render logic
}
```

On `lifecycle:suspend`: set `suspended = true`. The rAF loop stops at the next
frame. CPU/GPU utilization drops to zero. WebGL context and Three.js scene
remain allocated in memory — this is intentional. The warm scene is what makes
resume instant.

On `lifecycle:resume`: set `suspended = false`, call
`requestAnimationFrame(animate)` to restart the loop. After the first frame
renders, send the ACK:

```js
postToHost('lifecycle.ready', { reason: 'resume' });
```

#### Child canvases

Each canvas in the tree receives its own lifecycle messages independently. The
hit-area canvas (`hit-area.html`) handles suspend/resume on its own terms. The
workbench handles its own. Each renderer is autonomous.

#### No new message channel

This uses the existing `headsup.receive` / `postToHost` bridge. The renderer
adds one new `case` to its message handler:

```js
case 'lifecycle':
    if (msg.action === 'suspend') { /* pause rAF */ }
    if (msg.action === 'resume')  { /* restart rAF + ACK */ }
    break;
```

### 5. StatusItemManager Integration

#### Three-way toggle

`handleClick` changes from binary (exists/doesn't) to three-way:

| State | Action | Path |
|---|---|---|
| Canvas exists, active | `suspend` | Instant hide, daemon cascades to children |
| Canvas exists, suspended | `resume` | Wake renderers, ACK gate, instant show |
| Canvas doesn't exist | `create` | Cold boot with animation (first launch or post-restart) |

#### Animation only on cold boot

The dot animation (tracked canvases) and frame animation (fixed-position
canvases) only play on the create path. Suspend/resume are instant — no
animation.

The status item icon toggles between filled (active or animating) and unfilled
(suspended or absent).

#### Position persistence simplifies

With suspend, the canvas window stays in memory — position is trivially
preserved. File-based position persistence (`status-item-position.json`) becomes
a fallback for daemon restart only, not something that runs on every toggle.
`saveCurrentPosition()` moves from the dismiss path to the suspend path (or is
called less frequently, e.g., periodically while active).

#### Code removed

- The `dismissed` behavior eval in `dismissCanvas()` is removed.
- The animation-to-icon on dismiss is removed (suspend is instant).
- `summonCanvas()` gains an early check for suspended state before falling
  through to the create path.

## Scope

| File | Changes | Net LOC |
|---|---|---|
| `src/display/canvas.swift` | Parent field, tree walk helper, handleSuspend, handleResume, cascade in handleRemove, ACK tracking, suspended flag | ~+140 |
| `src/display/status-item.swift` | Three-way toggle, drop dismissed eval, drop dismiss animation, conditional create-vs-resume | ~-10 |
| `apps/sigil/renderer/index.html` | Lifecycle message handler, rAF suspend gate, ACK on resume, remove dismissed handler | ~+17 |
| `apps/sigil/renderer/hit-area.html` | Basic suspend/resume handling | ~+10 |
| `shared/` types (CanvasRequest) | `parent`, `cascade` fields | ~+5 |
| **Total** | | **~+162** |

## Migration

The renderer's child-creation calls require no changes — implicit provenance
handles parent tracking automatically. The only renderer-side additions are the
lifecycle message handler and rAF gate.

The workbench canvas, if it should survive independently of the avatar, adds
`cascade: false` to its create call. All other children inherit the default
(`cascade: true`) and propagate automatically.

The `dismissed` behavior slot and its handler are removed from both
StatusItemManager (the eval sender) and the renderer (the handler).
