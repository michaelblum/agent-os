# AOS Surface Transport and Fast-Signal Observations V0

Date: 2026-06-05

Context: review discussion around commit `8f9fafc8` (`Fix avatar compact panel UX`) on branch `gdi/avatar-compact-surface-ux-v0`.

This report is descriptive. It is intended to give an outside reviewer enough context to inspect the relevant code paths without rediscovering the current surface, transport, and performance concerns from scratch. It intentionally avoids prescribing a specific implementation.

## Product and Platform Principles

These principles should inform review of the current code paths and any future
changes in this area:

- Keep the privileged binary thin by extracting reusable UI, routing, and state
  logic into testable JavaScript modules. The native runtime should stay stable,
  privilege-scoped, and boring; product behavior should be easier to evolve
  outside the privileged boundary.
- Treat Sigil/Avatar as the first product built by, for, and on Agent OS. It
  should be a model and showcase for future developers building apps and
  experiences on the platform.
- Keep Sigil extensible. Developers should be able to extend or modify the Sigil
  experience without copying private patterns or reaching into native/runtime
  internals.
- Make the toolkit the normal way to build this kind of experience. Toolkit APIs
  should be coherent and familiar to developers who know Angular, React, Vue,
  Svelte, or similar UI frameworks, while staying simpler and more explicit than
  a full application framework.
- Borrow proven patterns such as component composition, model/view binding,
  reactive subscriptions, event phases, and owner-mediated state updates, but do
  not overfit to any one web framework.
- Treat performance as a platform requirement, not a polish task. Fast input,
  smooth rendering, bounded diagnostics, and predictable backpressure are part of
  the core developer experience.
- Agent OS is greenfield. Breaking and rebuilding owned contracts is acceptable
  when it makes the platform, toolkit, or Sigil more elegant, coherent,
  performant, and easier for future developers to understand.

## User-Facing Scenario Under Discussion

The concrete stacked scenario is:

1. Surface Inspector is visible.
2. Surface Inspector mini-map mouse event display is on.
3. Sigil avatar is visible.
4. Sigil avatar compact controls panel is visible.
5. User drags the form slider that controls the avatar/root model scale back and forth.

Desired observable behavior:

- Avatar render scales smoothly.
- Slider thumb tracks the mouse smoothly.
- Slider value label changes smoothly and stays visually in time with the mouse and avatar render.
- Surface Inspector mini-map mouse drag/vector rendering remains smooth and in time.

The concern is that several independent high-frequency paths may stack: pointer input, slider UI, cross-canvas panel messages, avatar model/render updates, panel snapshots, and Surface Inspector diagnostic rendering.

## Current High-Level Architecture Facts

The current system already has several AOS transport primitives:

- Canvas/WebView bridge receive/post plumbing in `apps/sigil/renderer/live-modules/host-runtime.js`.
- Canvas lifecycle and mutation requests such as `canvas.create`, `canvas.update`, `canvas.remove`, `canvas.suspend`, and `canvas.resume`.
- Pub/sub via `subscribe`/`unsubscribe` bridge messages.
- Cross-canvas `canvas.send` messages.
- Generic input event normalization in `packages/toolkit/runtime/input-events.js`.
- Resource/editor-adjacent messages such as `canvas_object.registry`, `canvas_object.transform.patch`, and `canvas_object.effects.patch`.

The current avatar compact panel uses many standard toolkit pieces:

- `mountPanel` and `Single` from toolkit panel.
- Toolkit panel defaults CSS.
- `createForm` for form rendering.
- Zag tabs/slider control adapters.
- `normalizeAgentUiTarget` control records.
- `bindVisualObjectForm` for the embedded compact surface path.

The current detached avatar panel also uses standard AOS transport (`canvas.send`, `canvas.suspend`, `aos.action`), but it wraps avatar panel behavior in a Sigil-specific message family: `sigil.avatar_panel.*`.

## File Map

| Path | Why It Matters |
| --- | --- |
| `apps/sigil/avatar-editor/panel.js` | Detached avatar panel entrypoint. Uses `mountPanel`, renders compact surface, sends `sigil.avatar_panel.*` messages to owner over `canvas.send`, suspends on close. |
| `apps/sigil/avatar-editor/compact-surface.js` | Shared compact avatar control surface. Uses toolkit tabs, buttons, forms, `normalizeAgentUiTarget`, and `bindVisualObjectForm`. |
| `apps/sigil/avatar-editor/model.js` | Builds compact avatar editor model and control descriptors from avatar state. Includes `visible_when`, descriptor ids, state paths, routes, and renderer sync metadata. |
| `apps/sigil/avatar-editor/surface-view-model.js` | Converts editor model into compact surface view model consumed by panel and embedded surface. |
| `apps/sigil/avatar-controls/surface.js` | Avatar controls owner-side coordinator. Opens/closes detached panel, sends panel updates, handles `sigil.avatar_panel.*`, routes descriptor changes into avatar state, handles embedded DOM hit testing. |
| `apps/sigil/avatar-controls/compact-surface-session.js` | Owner-side compact surface session wrapper. Caches values, routes changed controls, mounts embedded compact surface. |
| `apps/sigil/avatar-controls/descriptors.js` | Canonical avatar control descriptors and descriptor update behavior. Mutates owner `state`, applies compatibility behavior, and invokes renderer sync hooks. |
| `apps/sigil/avatar-controls/visual-object-binding.js` | Adapter from visual object descriptors into avatar control descriptor updates. |
| `apps/sigil/renderer/live-modules/main.js` | Sigil renderer owner. Creates avatar controls, subscribes to input/lifecycle/message streams, handles host messages, owns render scheduling and avatar state. |
| `apps/sigil/renderer/live-modules/input-message.js` | Sigil wrapper around toolkit input message normalization. |
| `apps/sigil/renderer/live-modules/host-runtime.js` | Sigil host bridge wrapper for post, request/reply, subscribe, canvas mutation, and input region APIs. |
| `packages/toolkit/runtime/input-events.js` | Normalizes raw input, routed input region events, and canvas-origin input messages. Important for Surface Inspector and Sigil input paths. |
| `packages/toolkit/panel/form.js` | Toolkit form. Emits `change`/`field-change`, computes current form values, and provides control records. |
| `packages/toolkit/controls/slider.js` | Toolkit slider. Updates local slider UI on value changes and emits change/commit events. |
| `packages/toolkit/panel/chrome.js` | Toolkit panel chrome and drag handling. Active drag paths call move/update logic from pointer/global input events. |
| `packages/toolkit/components/surface-inspector/index.js` | Surface Inspector component. Subscribes to lifecycle/input/resource streams, normalizes input, updates minimap/debug/annotation state. |
| `packages/toolkit/components/surface-inspector/index.html` | Surface Inspector panel mount. Uses standard `mountPanel`. |
| `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md` | Existing parked work card describing migration away from `sigil.avatar_panel.*` toward visual object/resource contracts. |

## Current Surface Inspector Mouse/Event Flow

Surface Inspector is a toolkit panel mounted with `mountPanel`:

- `packages/toolkit/components/surface-inspector/index.html`
- `packages/toolkit/components/surface-inspector/index.js`

Its manifest declares it accepts a broad set of streams, including:

- `bootstrap`
- `canvas_lifecycle`
- `canvas_geometry`
- `display_geometry`
- `input_event`
- `window_entered`
- `element_focused`
- `canvas_object.marks`
- `canvas_object.registry`
- `input_region`
- `canvas_inspector.semantic_targets`

Inside the component:

- Input messages are normalized through `normalizeCanvasInputMessage`.
- Native points are converted toward DesktopWorld coordinates.
- Cursor state and native cursor state are updated from input messages.
- If annotation mode is active, `mouse_moved` schedules an annotation hover refresh with `requestAnimationFrame`.
- There is also a dynamic minimap animation frame helper that schedules `syncMinimapDynamicLayer`.

Observed concern: Surface Inspector already has some animation-frame coalescing, but some changed paths still call `syncMinimapDynamicLayer`, `syncDebugState`, and overlay/control syncs directly after input processing. In a stacked scenario, this diagnostic work may compete with active editing/rendering unless the route and rendering priority are bounded.

## Current Detached Avatar Compact Panel Flow

The detached avatar compact panel is built as a toolkit panel:

```text
apps/sigil/avatar-editor/panel.js
  -> mountPanel(...)
  -> createSigilAvatarCompactControlSurface(...)
  -> toolkit createForm / slider / tabs / button controls
```

Panel-to-owner messages are sent with:

```text
post('canvas.send', {
  target: OWNER_CANVAS_ID,
  message
})
```

The message names are Sigil-specific:

- `sigil.avatar_panel.ready`
- `sigil.avatar_panel.update`
- `sigil.avatar_panel.snapshot`
- `sigil.avatar_panel.tab_change`
- `sigil.avatar_panel.control_change`
- `sigil.avatar_panel.projection_change`
- `sigil.avatar_panel.projection_action`
- `sigil.avatar_panel.close`

The Sigil renderer unwraps `canvas_message` payloads that start with `sigil.avatar_panel.` and forwards them to `avatarControls.handlePanelMessage(...)`.

Owner-side handling:

```text
apps/sigil/avatar-controls/surface.js
  handlePanelMessage(...)
    control_change/projection_change
      -> compactSurfaceSession.routeChangedControls(...)
      -> routeDescriptorUpdate(...)
      -> applyAvatarControlsDescriptorUpdate(...)
      -> mutate owner state
      -> renderer sync hooks
```

This means a slider drag does not ship the whole avatar model to the renderer. The owner renderer already holds the canonical state. The detached panel sends form/control change messages; the owner mutates local `state.avatar.*` and calls local renderer sync hooks.

However, the detached panel path is still cross-canvas and can be chatty during drag-rate changes:

- Toolkit slider emits change for each value change.
- Toolkit form change computes current values for the form.
- Detached panel sends `sigil.avatar_panel.control_change`.
- Detached panel queues a snapshot after control changes.
- Owner applies descriptor change and may trigger renderer sync work.

## Current Embedded Compact Surface Flow

When not using the detached panel, `surface.js` mounts the compact surface directly inside the renderer DOM and uses `createAvatarControlsCompactSurfaceSession`.

The embedded path uses:

- `createSigilAvatarCompactControlSurface`
- `visualObjectBinding`
- `bindVisualObjectForm`
- local DOM hit testing for pointer-to-control mapping
- local value cache to avoid duplicate descriptor routing

For slider dragging in the embedded path, pointer events can drive `updateCompactSliderAt(...)`, which updates the control during drag and emits/commits on the configured phase.

This path avoids cross-canvas panel messages but still has high-frequency UI and renderer work when a slider controls a live avatar attribute.

## Current Slider Behavior

Toolkit slider behavior in `packages/toolkit/controls/slider.js`:

- `onValueChange` updates internal slider values.
- It syncs thumbs and output.
- It schedules binding updates.
- It emits change unless suppressed.
- `onValueChangeEnd` emits commit unless suppressed.
- Programmatic `setValue(value, { emit: false })` can update control UI silently.

This is useful for loop prevention, but the detached panel currently sends owner-directed changes during active slider movement. There is no obvious central distinction in the current panel protocol between preview-rate updates and final reliable commit updates.

## Current Panel Drag Behavior

Toolkit panel chrome drag behavior in `packages/toolkit/panel/chrome.js`:

- Pointer down starts a drag transaction.
- Pointer move or global input events call `dragController.move(...)`.
- Move calls the configured move/update path with geometry cause `placement.drag`.
- Drag end emits a settled geometry update.

The drag path appears to process every active pointer/global input movement. Some parts may depend on daemon/global input to support cross-display or out-of-WebView drag continuity.

Observed concern: panel drag smoothness can be sensitive to bridge update frequency, daemon canvas update cost, and any competing input/render/debug consumers.

## Current Avatar Render Update Behavior

Avatar descriptor updates eventually call `applyAvatarControlsDescriptorUpdate(...)` in `apps/sigil/avatar-controls/descriptors.js`.

That function:

- Looks up a descriptor by id.
- Coerces the raw value.
- Applies compatibility behavior for some controls.
- Writes the value into owner state at the descriptor state path.
- Synchronizes avatar aliases from graph paths when needed.
- Calls renderer sync hooks listed on the descriptor.
- Calls appearance persistence callback for appearance-persisted controls.

Relevant renderer sync hooks include:

- `updateGeometry`
- `updatePrimaryStellation`
- `updatePrimaryAppearance`
- `updatePrimaryTesseronProportion`
- `updateOmegaGeometry`
- `updateAllColors`
- phenomenon/effect update hooks
- avatar window level change

The renderer schedules animation frames through `scheduleRenderFrame(...)`, which marks structural frame dirty unless called with options that avoid that. A central performance question is whether each high-frequency slider control maps to a cheap transform/uniform update or to more expensive geometry/material/resource work.

## Current Private Protocol Boundary

There are two separate facts that should not be conflated:

1. The detached avatar panel uses standard AOS transport: `canvas.send`, `canvas.suspend`, and owner `aos.action` requests.
2. The detached avatar panel still uses a private Sigil message vocabulary: `sigil.avatar_panel.*`.

The existing parked work card `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md` already records a possible future lane to migrate away from that private vocabulary toward existing resource/editor contracts. This report does not assume that card is ready to route; it is listed because it is directly relevant background.

## Two-Way Binding Discussion Framed As Current Requirements

The discussed desired behavior is a form of owner-mediated two-way binding:

```text
slider drag or 3D handle drag
  -> semantic edit intent / descriptor change
  -> owner model validates and applies
  -> owner render updates
  -> other views observe accepted state and update silently
```

For example, if an avatar drag handle changed root scale while the compact panel was visible, the matching slider thumb and value label should move in response without causing a feedback loop.

Important current primitives that support this shape:

- Control descriptors have ids, state paths, routes, and renderer sync metadata.
- Toolkit controls can be programmatically updated with suppressed emit behavior.
- `normalizeAgentUiTarget` and form control records expose semantic target/control metadata.
- Owner-side descriptor routing already centralizes state mutation for many avatar controls.

Open issue: the detached panel path currently does not appear to have a full owner-to-panel accepted-state refresh after every owner-applied detached panel edit. Panel updates are sent on open/ready, and snapshots flow panel-to-owner after changes. This may be enough for some controls but can drift for dependent controls, disabled states, side effects, or edits originating outside the panel.

## Performance and Data-Movement Questions For Review

These are the concrete questions an outside reviewer should be able to answer from this map:

1. During active slider drag, which operations are local-only, which cross the WebView/canvas bridge, and which enter daemon/native paths?
2. Does slider dragging generate one owner message per value change, and is that frequency bounded?
3. Does the detached panel snapshot-after-change path duplicate work during drag-rate slider movement?
4. Which avatar controls map to cheap render updates, and which trigger geometry/material/resource rebuilds?
5. Does `scheduleRenderFrame()` mark too much structural work dirty for high-frequency preview edits?
6. Does Surface Inspector minimap/debug work run at a lower priority than active interaction work?
7. Does panel drag use every pointer/global input event for `canvas.update`, or is movement coalesced?
8. Are Surface Inspector mouse rendering, panel drag, and avatar slider drag sharing any common backpressure or rate policy?
9. Are high-frequency messages distinguishable from reliable commit/final messages in the current contracts?
10. Does current identity metadata (`source_canvas_id`, `owner_canvas_id`, source origin, route, descriptor id) provide enough information to prevent feedback loops in multi-view binding?
11. Are current form/control payloads selector-like enough, or do they send broader form state than needed for high-frequency edits?
12. What is the actual bridge/daemon/render budget under the stacked scenario described above?

## Evidence Already Checked

The focused renderer test passed on the reviewed commit:

```bash
node --test tests/renderer/avatar-controls-hit-test.test.mjs
```

Result summary:

- 34 tests passed.
- The new detached panel coverage includes child panel input identity, suspend-on-close behavior, detached panel control routing through the compact session, panel frame snapshot hit bounds, and avatar panel avoidance behavior.

This test evidence is functional/regression coverage. It does not establish smoothness or stacked high-frequency performance under the Surface Inspector + avatar panel + slider drag scenario.

## Useful Search Starting Points

```bash
rg -n "sigil\\.avatar_panel|handlePanelMessage|sendPanelUpdate|routeChangedControls" apps/sigil
rg -n "createSlider|onValueChange|emitChange|onValueChangeEnd" packages/toolkit/controls packages/toolkit/panel
rg -n "left_mouse_dragged|mouse_moved|requestAnimationFrame|syncMinimapDynamicLayer" packages/toolkit/components/surface-inspector packages/toolkit/panel apps/sigil
rg -n "canvas_object\\.(registry|transform\\.patch|effects\\.patch|transform\\.result|effects\\.result)|visual_object_descriptors|bindVisualObjectForm" apps/sigil packages/toolkit tests
rg -n "scheduleRenderFrame|updateGeometry|updatePrimaryAppearance|updatePrimaryStellation|updatePrimaryTesseronProportion" apps/sigil/renderer/live-modules apps/sigil/avatar-controls
```

## Summary

The current codebase has most of the raw pieces needed for standard AOS surface communication: bridge requests, pub/sub, cross-canvas messages, input normalization, toolkit panels/forms, semantic target records, and avatar descriptors.

The current concerns are about composition under load:

- Several high-frequency paths can be active at the same time.
- Some paths are frame-coalesced, but not all work appears governed by a shared rate/priority policy.
- The detached avatar panel uses standard transport but a private app protocol.
- Slider drag does not send the entire avatar model to the renderer, but it can still send frequent cross-canvas messages, broader form values, queued snapshots, and potentially expensive owner render hooks.
- Surface Inspector diagnostics are useful but may compete with active interaction/render paths if not bounded in the stacked scenario.
