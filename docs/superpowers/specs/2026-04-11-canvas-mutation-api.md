# Spec: Canvas Mutation API from JS

**Session:** canvas-mutation-api
**Date:** 2026-04-11
**Status:** Approved
**Parent brief:** handoff `01KNZQ0A5WWFZ8G7B42FDF07QV` from `avatar-streamline`
**Predecessor spec:** `docs/superpowers/specs/2026-04-11-avatar-streamline-poc.md`
**Phase:** 1 of 5 in the avatar-sub elimination arc

## Problem

The PoC proved daemon→canvas event push is viable. The next enabler for the elimination arc is the reverse direction: JS code inside a canvas needs to create, mutate, and remove canvases without going through a separate Swift binary.

Today, canvas mutation is socket-only — `aos show create/update/remove` from a shell or from Swift code (`avatar-sub`). JS inside a WKWebView canvas has no way to spawn a helper canvas or resize itself. This blocks Phase 3 (hit-area canvas): the drawing canvas needs to create and drive a small interactive canvas that tracks the avatar body.

## Goal

Expose three mutation actions to JS via the existing `headsup` postMessage channel, reusing the daemon's existing `CanvasRequest` pipeline. No new transport, no duplicated canvas logic.

Success means a JS canvas can call `canvas.create`, `canvas.update`, and `canvas.remove` with the same effect as the equivalent CLI commands, subject to an ownership model designed for lifecycle hygiene.

## Non-goals

- `canvas.list`, `canvas.eval`, `canvas.to-front`, `canvas.remove-all` (speculative; add when a concrete consumer appears)
- Cross-canvas event subscription on behalf of another canvas
- Capability tokens or grant-based permissions
- Persistent `created_by` across daemon restart
- Three.js integration, state machine port (later phases)

## Architecture

### Transport

Same channel as `subscribe`/`unsubscribe` (shipped in the PoC): canvases post to the daemon via `window.webkit.messageHandlers.headsup.postMessage({type, payload})`. The daemon intercepts known types in `canvasManager.onEvent` before the `canvas_message` broadcast (see `src/daemon/unified.swift:98-130`).

This spec adds three new intercepted types to that block.

### Message schema (JS → daemon)

```js
{ type: "canvas.create", payload: { id, url, at: [x,y,w,h], interactive?: bool, request_id?: string } }
{ type: "canvas.update", payload: { id, frame?: [x,y,w,h], interactive?: bool } }
{ type: "canvas.remove", payload: { id, orphan_children?: bool, request_id?: string } }
```

Field semantics mirror the existing `CanvasRequest` (`src/display/canvas.swift`). The JS API uses `interactive` (not `ignoresMouseEvents`) so the mental model is identical to CLI; the daemon's existing path derives `ignoresMouseEvents = !interactive` at `canvas.swift:165`.

### Response model

- **`canvas.update`** is fire-and-forget. It is the 60Hz hot path for hit-area tracking in Phase 3; a response channel would only add cost. Errors are dropped silently (daemon logs them).
- **`canvas.create`** and **`canvas.remove`** emit an async response *only if* the caller supplied a `request_id`. The response is delivered back to the calling canvas via the same `headsup.receive` mechanism used for pushed events:

```js
// Delivered to the originating canvas's headsup.receive as base64 JSON:
{ type: "canvas.response", request_id, status: "ok" | "error", code?, message?, id? }
```

Reusing `headsup.receive` keeps the global surface area minimal — it was designed for pushed daemon messages and that is exactly what this is. JS dispatch differentiates by `type`.

- Omitting `request_id` makes create/remove fire-and-forget too.

### Error shape

Matches the existing daemon socket response format:

```json
{ "status": "error", "code": "<CODE>", "message": "<human readable>" }
```

Codes used by this API:

| Code | Meaning |
|------|---------|
| `ID_COLLISION` | `canvas.create` with an id that already exists |
| `NOT_FOUND` | `canvas.update`/`canvas.remove` target does not exist |
| `FORBIDDEN` | caller is not permitted to mutate the target (see ownership) |
| `INVALID_FRAME` | frame array malformed or invalid |
| `PARSE_ERROR` | payload shape invalid |

### Ownership & lifecycle

The daemon tracks canvas parentage as internal state — not for security (all code in this repo is trusted) but for **lifecycle hygiene**: parent→child cleanup and debugging observability.

**Data:**
- `createdBy: [String: String]` — child canvas ID → parent canvas ID
- `children: [String: Set<String>]` — inverse, maintained for cascade-remove

Both behind a single `NSLock` (same pattern as `canvasEventSubscriptions`).

**Population:**
- JS-originated `canvas.create` sets `createdBy[newID] = callerID`.
- CLI-originated creates leave both maps untouched (`createdBy[id] == nil`).

**Permission check (for `canvas.update` and `canvas.remove`):**

1. `targetID == callerID` → **allowed** (self-mutation)
2. `createdBy[targetID] == callerID` → **allowed** (child mutation)
3. `createdBy[targetID] == nil` (CLI-origin or orphaned) → **allowed** (debugging-friendly, explicit non-ownership)
4. else → **FORBIDDEN**

Rule 3 is an explicit design choice: CLI-made canvases are "public," so a debugging or inspection canvas made from the shell can be manipulated by any JS consumer. This favors predictability and debuggability over isolation. Acceptable given the trusted-code assumption.

**Cascade on remove:**
- `canvas.remove` removes all canvases in `children[targetID]` recursively before removing the target itself.
- If `orphan_children: true` is set, children are detached: `createdBy[child] = nil` (they become CLI-origin-like, mutable by anyone).

**On canvas crash / disconnect:** Children are removed (same as explicit remove, no orphan flag). This piggybacks on the existing `canvas_lifecycle` remove path, where the PoC already drops subscription entries.

### Daemon implementation sketch

All changes in `src/daemon/unified.swift`, extending the existing interception block at `canvasManager.onEvent` (lines 98–130):

1. **New state** next to `canvasEventSubscriptions`:
   ```swift
   var canvasCreatedBy: [String: String] = [:]
   var canvasChildren: [String: Set<String>] = [:]
   // Reuses the existing canvasSubscriptionLock — all four dicts are related
   // per-canvas state and serialized together.
   ```

2. **Intercept** `canvas.create` / `canvas.update` / `canvas.remove` types in `onEvent` before the `canvas_message` broadcast.

3. **Translate** each into the existing `CanvasRequest` struct and dispatch through `canvasManager.handle(request, connectionID:)` on the main thread — same code path as socket commands. Zero duplicated canvas logic.

4. **Ownership bookkeeping** wraps the `handle` call:
   - Before: permission check for update/remove; ID collision check for create (delegated to `handle`).
   - After (on success): update `createdBy` / `children` maps for create and remove.

5. **Cascade remove** walks `children[targetID]` and calls `handle(.remove(...))` for each before removing the target. Recursive; children-of-children are handled by recursion.

6. **Response dispatch** (when `request_id` present): encode `{type: "canvas.response", request_id, status, ...}` as JSON, base64, and call `canvasManager.evalAsync(canvasID: callerID, js: "headsup.receive('<b64>')")`. This is the exact mechanism shipped in the PoC.

**Estimated scope:** 100–150 lines including the two dicts, interception, permission check, cascade logic, and response dispatch.

## ID collision behavior

`canvas.create` with an `id` that already exists returns `ID_COLLISION` via the response channel (or logs and drops silently if no `request_id`). No silent clobber.

**Verify during implementation:** current CLI behavior for `aos show create --id <existing>`. If CLI clobbers, either align both to reject (preferred, explicit) or document the intentional asymmetry. A single explicit rule beats two subtly different rules.

## Dependencies

- PoC primitives: `CanvasManager.evalAsync`, `canvasEventSubscriptions`, interception block in `onEvent`, cleanup on `canvas_lifecycle` remove. All shipped.
- Existing `CanvasRequest` / `canvasManager.handle` pipeline. Unchanged.
- Existing `headsup.receive` contract on canvases. Unchanged; we dispatch a new `type` value through it.
- Content server serving JS canvases. Unchanged.

No new infrastructure. Entirely composed from existing mechanisms.

## Test plan

Manual tests, runnable with `aos show` and a minimal HTML test page at `apps/sigil/test-mutation/index.html`:

| Test | Setup | Expected |
|------|-------|----------|
| Child create + update + remove | Parent HTML calls `canvas.create` for a child, moves it via `canvas.update`, then `canvas.remove`s it | Child appears, moves, disappears. `canvas.response` (if request_id) reports `ok`. |
| Cascade on parent remove | Parent creates child, then parent is removed via CLI or by another canvas | Child is auto-removed. |
| Orphan on parent remove | Parent creates child, then `canvas.remove({id: parent, orphan_children: true})` | Child survives; `createdBy[child] == nil` afterward. |
| CLI-origin mutation is open | CLI creates canvas `foo`. Unrelated JS canvas calls `canvas.remove({id: "foo"})` | Succeeds (rule 3). |
| JS-origin mutation is locked | JS canvas A creates `bar`. JS canvas B (unrelated) calls `canvas.remove({id: "bar"})` | `FORBIDDEN` response. |
| ID collision | Two creates with same id | Second returns `ID_COLLISION`. |
| Self-update for Phase 3 readiness | Canvas calls `canvas.update({id: self, frame: [x,y,w,h]})` repeatedly at 60Hz | Canvas resizes/moves smoothly. No response traffic (fire-and-forget). |
| Fire-and-forget create | `canvas.create` without `request_id` | Canvas appears, no response. Errors logged to daemon but not delivered. |

## Failure modes

| Observation | Likely cause | Next step |
|-------------|--------------|-----------|
| Child not cleaned up on parent remove | `children` map not updated on create, or cascade loop broken | Log size of children map on every mutation during debugging. |
| `FORBIDDEN` on what looks like self-mutation | `callerID` resolution broken; depends on correct attribution of `onEvent` to the originating canvas ID | Verify `canvasManager.onEvent(canvasID, payload)` passes the right id — this is already load-bearing for the PoC, so a regression here breaks `subscribe` too. |
| Response never arrives | `evalAsync` delivered before `headsup.receive` listener installed, or wrong encoding | Confirm with console log; compare to PoC's `input_event` dispatch which already works. |
| Hot-path update stutters | Lock contention with create/remove | Measure. If real, split lock or adopt lock-free reads for update path. Not expected at Phase 1 traffic levels. |

## What this does not validate

- Hit-area canvas behavior (Phase 3)
- Display geometry event stream (Phase 2)
- Multi-display coordinate handoff (later)
- State machine correctness (later)

## Post-Phase-1 path (informational)

Per the elimination arc:

2. **Display geometry stream** — second event type through the same forwarding mechanism built in the PoC.
3. **Hit-area canvas + first state machine slice (follow-cursor)** — consumes this API to create and drive a helper canvas.
4. **Expand-on-mousedown for drag** — hit-area resizes during drag; snaps back on release. Consumes `canvas.update`.
5. **Retire avatar-sub binary** — port remaining behaviors; remove Swift files and launchd hooks.

## Open questions (for implementation, not blocking spec)

- Does CLI `aos show create --id <existing>` currently clobber or error? Answer informs whether Phase 1 needs to change CLI behavior for consistency.
- Should `canvas.update` return an error response when `request_id` is supplied, despite the "fire-and-forget" default? Leaning toward "no — update is always fire-and-forget, request_id is ignored." Cleaner rule.
- Should the response envelope be `{type: "canvas.response", ...}` or `{type: "response", target: "canvas.create", ...}`? Former is simpler; latter is more general if we add non-canvas RPCs later. Phase 1 uses the former; revisit if a second RPC family shows up.
