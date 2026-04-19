# Spatial Runtime And Governance

**Date:** 2026-04-19  
**Status:** fix-forward plan  
**Motivation:** recurring mixed-DPI / union / minimap / Sigil alignment regressions across Swift, toolkit, and app code

## Problem

agent-os already has a canonical spatial contract on paper:

- [shared/schemas/spatial-topology.md](../../../shared/schemas/spatial-topology.md)
- [src/shared/types.swift](../../../src/shared/types.swift)

But the implementation is still split across multiple local helper stacks:

- Swift/AppKit bridge:
  - [src/shared/types.swift](../../../src/shared/types.swift)
  - [src/display/canvas.swift](../../../src/display/canvas.swift)
- Toolkit minimap/layout math:
  - [packages/toolkit/components/canvas-inspector/index.js](../../../packages/toolkit/components/canvas-inspector/index.js)
  - [packages/toolkit/components/spatial-telemetry/model.js](../../../packages/toolkit/components/spatial-telemetry/model.js)
- Sigil stage/display math:
  - [apps/sigil/renderer/live-modules/display-utils.js](../../../apps/sigil/renderer/live-modules/display-utils.js)

This creates a predictable failure mode:

1. one layer gets fixed
2. another layer still re-derives the same transform with slightly different assumptions
3. later work appears to "regress" prior fixes because the system never had one enforced runtime

## Goal

Make spatial behavior auditable and boring:

- one canonical daemon/schema coordinate contract
- one canonical Swift transform layer for native window/screen bridging
- one canonical JS spatial runtime for toolkit + app consumers
- one governance surface that fails drift when fresh sessions add new ad hoc coordinate math

## Canonical Spaces

These spaces are valid and should be explicit:

1. **AppKit screen**
   - origin: bottom-left of main display
   - used only at the Swift/native boundary
2. **AOS global desktop**
   - origin: top-left of main display
   - logical points
   - canonical cross-surface space
3. **Union-local**
   - origin: top-left of the current display union
4. **Display-local**
   - origin: top-left of one display's bounds or visible bounds
5. **Canvas-local**
   - origin: top-left of one canvas rect
6. **Stage-local**
   - app-specific projection space derived from global or union-local

## Immediate Governance

The first step is not full consolidation. It is stopping the sprawl from expanding.

Add a tracked allowlist + audit:

- audit script:
  - `node scripts/spatial-audit.mjs --summary`
  - `node scripts/spatial-audit.mjs --check`
- tracked helper definitions:
  - Swift native transforms in `src/shared/types.swift`
  - toolkit minimap/layout helpers in toolkit-only modules
  - Sigil stage/display helpers in `apps/sigil/renderer/live-modules/display-utils.js`
- any new definition of a tracked coordinate helper outside the allowlist should fail tests

Fresh sessions doing coordinate work must start with:

1. `./aos status`
2. `bash tests/display-debug-battery.sh`
3. `node scripts/spatial-audit.mjs --summary`

## Runtime Consolidation Plan

### Phase 1 — Audit And Naming

- land the audit script + allowlist manifest
- document the canonical spaces and helper naming
- update session-start guidance to point spatial work at the audit + battery

### Phase 2 — Canonical JS Spatial Runtime

Create a shared JS runtime module that owns the common transforms instead of each surface rolling its own:

- display normalization
- union bounds
- point/rect translation
- point ownership by display
- parent-local / global rect resolution
- minimap projection helpers

Initial target API:

- `normalizeDisplays()`
- `computeUnionBounds()`
- `translatePoint()`
- `translateRect()`
- `findDisplayForPoint()`
- `ownerLabelForPoint()`
- `ownerLabelForRect()`
- `globalToUnionLocalPoint()`
- `globalToDisplayLocalPoint()`
- `globalToCanvasLocalPoint()`
- `resolveCanvasFrame()`
- `projectGlobalPointToMinimap()`

### Phase 3 — Toolkit Migration

Migrate:

- `canvas-inspector`
- `spatial-telemetry`
- related tests

Result:

- minimap projection logic lives in one shared runtime
- telemetry and inspector consume the same geometry helpers

### Phase 4 — Sigil Migration

Migrate Sigil display/stage math to the same JS runtime or to a thin Sigil wrapper over it.

Important constraint:

- the content-server root model must not require ad hoc path escapes or brittle per-surface import tricks
- if cross-root ES module reuse is awkward, introduce an explicit shared content root instead of copying helpers again

### Phase 5 — Shrink The Allowlist

Once toolkit + Sigil consume the canonical runtime:

- delete duplicate helper definitions
- reduce the audit allowlist to the canonical runtime + Swift boundary layer
- fail any new coordinate helper outside those files

## Enforcement Direction

The end state is stronger than a note in `AGENTS.md`.

We want:

1. **Schema enforcement**
   - `shared/schemas/spatial-topology.md` remains the canonical contract
2. **Code enforcement**
   - tracked helper allowlist test
   - future invariants/round-trip tests across Swift and JS
3. **Workflow enforcement**
   - session-start hook guidance
   - display-debug battery as the standard live verification path
4. **Review enforcement**
   - spatial PRs/issues explicitly call out touched coordinate spaces and transforms

## Success Criteria

- mixed-DPI window placement, minimap projection, hit-area alignment, and Sigil stage projection use the same named transforms
- fresh sessions can discover the current spatial authority immediately
- adding new coordinate helpers in random files becomes a test failure, not a future regression
