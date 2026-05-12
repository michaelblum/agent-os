# Toolkit Child Hit Surface Normalization Gate Correction V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #120 Add pointer source identity to input event contracts
- Related issues: #122 Toolkit-owned DesktopWorld hit-region controller, #305
  Sigil remodel
- Correction for:
  - `docs/design/work-cards/toolkit-child-hit-surface-source-identity-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Fix the child hit-surface identity slice so raw child `canvas_message` echoes do
not bypass Sigil's parent-side hit-canvas gate.

The source-identity helper is the right direction, but review found that
`normalizeMessage()` now normalizes a raw hit-area `canvas_message` before
`main.js` can dispatch it to `handleHitCanvasEvent()`. That bypasses the code
that intentionally preserves menu-closed ignoring, right-button daemon
authority, outside-menu checks, recent-daemon-echo suppression, and
parent-resolved DesktopWorld coordinates.

## Review Finding To Reproduce

Run from the repo root:

```bash
node --input-type=module - <<'EOF'
import { normalizeMessage } from './apps/sigil/renderer/live-modules/input-message.js'
const msg = normalizeMessage({
  type: 'canvas_message',
  id: 'sigil-hit-avatar-main',
  payload: {
    source: 'sigil-hit',
    source_origin: 'canvas',
    source_canvas_id: 'sigil-hit-avatar-main',
    owner_canvas_id: 'avatar-main',
    source_event: 'left_mouse_down',
    kind: 'left_mouse_down',
    pointer_id: 1,
    screenX: 100,
    screenY: 200,
    offsetX: 10,
    offsetY: 20,
  },
})
console.log(JSON.stringify({
  type: msg.type,
  envelope_type: msg.envelope_type,
  x: msg.x,
  y: msg.y,
  sourceOrigin: msg.sourceOrigin,
  sourceCanvasId: msg.sourceCanvasId,
}, null, 2))
EOF
```

Current bad result:

```json
{
  "type": "left_mouse_down",
  "envelope_type": "aos_routed_input",
  "x": 100,
  "y": 200,
  "sourceOrigin": "canvas",
  "sourceCanvasId": "sigil-hit-avatar-main"
}
```

That means `handleHostMessage()` no longer reaches:

```js
if (msg.type === 'canvas_message' && msg.id === hitTarget.hit.id) {
    handleHitCanvasEvent(msg.payload || {});
    return;
}
```

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/toolkit-child-hit-surface-source-identity-v0.md`
- `packages/toolkit/runtime/input-events.js`
- `apps/sigil/renderer/live-modules/input-message.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/hit-area.html`
- `tests/renderer/input-message.test.mjs`
- `tests/toolkit/runtime-input-events.test.mjs`

## Rediscover State

```bash
git status --short --branch
rg -n "normalizeCanvasOriginInputMessage|normalizeCanvasInputMessage|fromHitTarget|assumeInside|handleHitCanvasEvent|canvas_message" packages/toolkit/runtime apps/sigil tests/renderer tests/toolkit
./aos ready
```

## Required Behavior

### Preserve Raw Child Messages Until Parent Resolution

A raw child hit-area echo that has identity fields but does not already have
parent-resolved DesktopWorld coordinates must remain a `canvas_message` in
Sigil's `normalizeMessage()` path.

The parent renderer owns the conversion because it has:

- the current child native frame;
- display geometry;
- context-menu open/closed state;
- outside-menu and daemon-echo suppression state.

### Keep The Toolkit Helper

Do not revert the new toolkit canvas-origin input helper. It should still work
when the caller supplies complete facts, especially:

```js
normalizeCanvasOriginInputMessage({ type: 'canvas_message', id, payload }, {
  desktopWorld: point,
  sourceCanvasId,
  ownerCanvasId,
  sourceEvent: payload.kind,
  native,
})
```

Acceptable fixes include either:

- gate automatic `canvas_message` normalization in
  `normalizeCanvasInputMessage()` so it only fires when the message already has
  valid `desktop_world` / `desktopWorld` input or another explicit complete
  routed payload; or
- make Sigil's `normalizeMessage()` preserve child `canvas_message` envelopes
  and only call `normalizeCanvasOriginInputMessage()` from `handleHitCanvasEvent()`.

Prefer the toolkit-level gating if it keeps the contract clearer for future
apps. Do not make Sigil add another private identity folklore flag.

### Preserve Source Identity Cleanup

Keep the wins from the previous slice:

- do not reintroduce `fromHitTarget`;
- do not make Sigil pass `assumeInside`;
- keep `source_origin: "canvas"`, `source_canvas_id`, `owner_canvas_id`, source
  event, pointer id, local offsets, and scroll deltas in child payloads;
- keep `interaction-region.js` support for explicit source identity plus
  `regionId`;
- leave `assumeInside` only as toolkit compatibility.

### Tests

Add focused tests that fail on the current bad behavior:

- `normalizeMessage()` preserves a hit-area-like raw `canvas_message` with
  `source_origin: "canvas"` and no `desktop_world` as `type:
  "canvas_message"`;
- the same message still preserves id, payload kind, source canvas id, owner
  canvas id, local offsets, and scroll deltas;
- `normalizeCanvasOriginInputMessage()` with parent-supplied `desktopWorld`
  still returns normalized routed input;
- radial semantic `canvas_message` behavior remains unchanged;
- source guard still proves no `fromHitTarget` in `main.js` and no
  `assumeInside` in `apps/sigil/context-menu/menu.js`.

## Scope

This is a correction slice for toolkit runtime normalization and Sigil message
normalization tests. It should be small.

## Hard Boundaries / Non-Goals

- Do not undo the source identity helper.
- Do not reintroduce `fromHitTarget` or Sigil `assumeInside`.
- Do not redesign `handleHitCanvasEvent()`.
- Do not change daemon/native code.
- Do not run real mouse-input smoke without explicit idle keyboard/mouse
  handoff.

## Suggested Implementation Areas

- `packages/toolkit/runtime/input-events.js`
- `apps/sigil/renderer/live-modules/input-message.js`
- `tests/toolkit/runtime-input-events.test.mjs`
- `tests/renderer/input-message.test.mjs`
- docs only if the normalization gate changes public helper semantics

## Verification

Run:

```bash
git diff --check
node --check packages/toolkit/runtime/input-events.js
node --check apps/sigil/renderer/live-modules/input-message.js
node --test tests/toolkit/runtime-input-events.test.mjs
node --test tests/renderer/input-message.test.mjs
node --test tests/renderer/hit-target.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/sigil-input-regions.test.mjs
```

Also rerun the reproduction command from this card and report the corrected
shape. Expected corrected result for the raw hit-area message is:

```json
{
  "type": "canvas_message",
  "id": "sigil-hit-avatar-main"
}
```

If broader behavior changes, run:

```bash
node --test tests/renderer/*.test.mjs
node --test tests/toolkit/runtime-interaction-region.test.mjs
```

Report `./aos ready`. If ready with active tap, do not run real-input smoke
unless specifically assigned; Foreman will route Operator after this correction
is accepted.

## Completion Report

Include:

- files changed;
- exact fix chosen;
- corrected reproduction output;
- confirmation that raw hit-area messages reach `handleHitCanvasEvent()`;
- confirmation that `fromHitTarget` and Sigil `assumeInside` remain absent;
- tests run with exact pass/fail results;
- `./aos ready` status.
