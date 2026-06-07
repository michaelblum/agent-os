# Display Ownership Pattern Note

Prepared from a review of the display-geometry helpers and the active Sigil/toolkit consumers that resolve display ownership and project points or rects into local space. This is a note to future self about what work I would prescribe next, based on the evidence and the architecture collective feedback.

## Handoff Context

Current product-direction context for this handoff: Selection Mode is intended to supersede the older annotation reticle path as the active user-facing annotation flow. The reticle line-drawing path is not the target end state. The remaining implementation work is to complete annotation surfacing in Selection Mode and the lineage bar. `annotation-reticle.js` remains in the repository and is still imported by some modules, so it is included in the evidence set here, but this note does not treat it as the intended final interaction path.

## Scope Reviewed

`packages/toolkit/runtime/spatial.js`
`packages/toolkit/panel/placement.js`
`packages/toolkit/panel/drag-transfer.js`
`packages/toolkit/components/spatial-telemetry/model.js`
`packages/toolkit/components/surface-inspector/index.js`
`packages/toolkit/components/surface-inspector/tree.js`
`apps/sigil/renderer/live-modules/selection-mode-runtime.js`
`apps/sigil/renderer/live-modules/selection-mode-lineage-bar.js`
`apps/sigil/renderer/live-modules/fast-travel.js`
`apps/sigil/renderer/live-modules/main.js`
`apps/sigil/renderer/live-modules/annotation-reticle.js`
`apps/sigil/renderer/live-modules/display-utils.js`

## Summary Of Observed Structure

- Display normalization is centralized in `packages/toolkit/runtime/spatial.js`.
- Display ownership selection is still performed in multiple consumers.
- The inspected consumers do not share a stateful resolver object for sticky ownership or seam hysteresis.
- Projection into local space generally happens after a display has already been chosen.
- Runtime display geometry can change after boot and is handled as an update event in multiple live surfaces.

## Findings

### 1. Shared geometry normalization exists.

- `normalizeDisplays` standardizes display entries and materializes `bounds`, `visibleBounds`, `native_bounds`, and related fields.
- `findDisplayForPoint` is the shared primitive that combines containment and optional nearest fallback.
- `findContainingDisplayForPoint`, `findContainingDisplayForRect`, `globalToDisplayLocalPoint`, `nativeToDesktopWorldPoint`, and `desktopWorldToNativePoint` are available as lower-level geometry helpers.
- `apps/sigil/renderer/live-modules/display-utils.js` re-exports `findDisplayForPoint` from `packages/toolkit/runtime/spatial.js` and does not add a separate ownership policy.

### 2. Ownership selection is repeated in multiple consumers.

- `selection-mode-runtime.js` resolves a display from the live pointer each time `displayCandidate` runs, then wraps it in `createDisplayAnnotationSubject`.
- `selection-mode-lineage-bar.js` defines its own `findDisplayForPoint` helper and chooses active display from `acquisitionPointer`, `cursor`, path center, then first display.
- `fast-travel.js` has a local `pointDisplay` helper that resolves a display from the point and falls back to the first display.
- `panel/placement.js` exposes `displayOwnerForPoint` and `displayOwnerForTopLeft` as wrappers over the shared primitive.
- `panel/drag-transfer.js` resolves target display with containment only and origin display with nearest fallback.
- `surface-inspector/tree.js` assigns canvases to the containing display and falls back to the first display when none contains the rect.
- `main.js` has a `mainDisplayVisibleBounds` helper that prefers `index === 0`, `is_main`, or `isMain`, then falls back to `displays[0]`.

### 3. The ownership rules differ by consumer.

- Some paths use nearest fallback by default.
- Some paths use containment only.
- Some paths use the first display as a fallback.
- Some paths use acquisition pointer priority.
- Some paths use path-derived geometry as a fallback.
- The codebase does not present one single ownership rule for all of these paths.

### 4. Projection happens immediately after ownership selection.

- `selection-mode-runtime.js` turns the chosen display and cursor into a display annotation subject.
- `selection-mode-lineage-bar.js` projects the chosen display bounds and node bounds through `projectPoint`.
- `fast-travel.js` ties display capture reuse to the resolved display.
- `panel/drag-transfer.js` projects the candidate frame into the target display, then into a desktop-world frame.
- `spatial-telemetry/model.js` labels points and cursor positions with display ownership after converting points into desktop-world coordinates.

### 5. Display geometry is updated after boot.

- `main.js` waits for first display geometry during boot, but also handles later `display_geometry` messages and replaces `liveJs.displays`.
- `main.js` subscribes to `display_geometry` as a runtime event source.
- `surface-inspector/index.js` also updates its local `displays` snapshot on bootstrap and on later `display_geometry` messages.
- Derived bounds are recomputed when display geometry changes in these live surfaces.

### 6. The display set is not treated as immutable for the whole daemon lifecycle.

- The code path supports initial discovery and later refresh of the same display list.
- The repeatable unit in the runtime is a display-geometry snapshot, not a full daemon lifetime.

### 7. `annotation-reticle` remains in the repository, but the active selection-mode paths do not depend on it for the main ownership logic.

- `selection-mode-runtime.js` imports `createDisplayAnnotationSubject` from `annotation-reticle.js`.
- `main.js` still references `annotationReticle` state and release handling.
- The live ownership paths reviewed for selection mode are in `selection-mode-runtime.js` and `selection-mode-lineage-bar.js`.

## Modules That Showed The Pattern

- `packages/toolkit/runtime/spatial.js`
- `packages/toolkit/panel/placement.js`
- `packages/toolkit/panel/drag-transfer.js`
- `packages/toolkit/components/spatial-telemetry/model.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/surface-inspector/tree.js`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-lineage-bar.js`
- `apps/sigil/renderer/live-modules/fast-travel.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/display-utils.js`

## Direct Evidence Pointers

- `packages/toolkit/runtime/spatial.js:482-507`
- `packages/toolkit/runtime/spatial.js:434-437`
- `packages/toolkit/runtime/spatial.js:466-501`
- `packages/toolkit/runtime/spatial.js:510-517`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js:511-517`
- `apps/sigil/renderer/live-modules/selection-mode-lineage-bar.js:111-120`
- `apps/sigil/renderer/live-modules/selection-mode-lineage-bar.js:343-375`
- `apps/sigil/renderer/live-modules/selection-mode-lineage-bar.js:419-459`
- `apps/sigil/renderer/live-modules/fast-travel.js:981-983`
- `apps/sigil/renderer/live-modules/fast-travel.js:1576-1582`
- `packages/toolkit/panel/placement.js:55-70`
- `packages/toolkit/panel/placement.js:81-92`
- `packages/toolkit/panel/drag-transfer.js:200-231`
- `packages/toolkit/panel/drag-transfer.js:316-323`
- `packages/toolkit/components/surface-inspector/tree.js:177-199`
- `apps/sigil/renderer/live-modules/main.js:883-887`
- `apps/sigil/renderer/live-modules/main.js:495-507`
- `apps/sigil/renderer/live-modules/main.js:3882-3894`
- `apps/sigil/renderer/live-modules/main.js:3960-3984`
- `packages/toolkit/components/surface-inspector/index.js:3249-3276`
- `packages/toolkit/components/surface-inspector/index.js:3316-3341`
- `apps/sigil/renderer/live-modules/annotation-reticle.js:65-70`
- `apps/sigil/renderer/live-modules/annotation-reticle.js:281-338`
- `apps/sigil/renderer/live-modules/annotation-reticle.js:468-520`
- `apps/sigil/renderer/live-modules/display-utils.js:1-45`

## What I Would Assign Next

If I were turning this into new work, I would start with the active Selection Mode path only, not the entire repo.

1. Keep `selection-mode-runtime.js` and `selection-mode-lineage-bar.js` as the first cleanup slice.
2. Make the chosen display explicit for the interaction, then carry that chosen display through projection instead of re-resolving ownership on every frame.
3. Treat `display_geometry` as the cache invalidation signal for the display snapshot and any derived lookup state.
4. Leave `panel/placement.js`, `panel/drag-transfer.js`, `fast-travel.js`, and `surface-inspector/tree.js` on separate paths for now, because their ownership rules are domain-specific and not yet shown to need a shared resolver.
5. Keep `annotation-reticle.js` as bridge evidence until Selection Mode and the lineage bar fully absorb the user-facing annotation flow.
6. Do not collapse the whole repo onto one ownership policy before the active annotation path has a clean owner/projection contract.

## Notes To Self

- The evidence supports one shared geometry layer plus fragmented ownership policy.
- The architecture board's conclusion is that the runtime boundary is a display-geometry epoch, not a daemon-lifetime cache.
- The narrowest evidence-backed cleanup scope is the active annotation path in Selection Mode and the lineage bar.
- The reticle path should be treated as legacy/bridge evidence while the active flow is completed.
