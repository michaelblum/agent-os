# Work Card: sigil-context-menu-zag-behavior

**Issue:** #331  
**Status:** Blocked  
**Blocked on:** #330

## Goal

Replace the Sigil context menu's hand-rolled interaction logic with a Zag.js menu state machine, and create `packages/toolkit/adapters/zag/menu.js` as the first official AOS/Zag adapter.

## Background

ADR-001 establishes Zag.js as the preferred adapter option for complex first-party primitives. The Sigil context menu is the first candidate. The adapter pattern isolates Zag from the vanilla toolkit core — surfaces import from `adapters/zag/` explicitly.

## Scope

- Create `packages/toolkit/adapters/zag/menu.js` — thin AOS wrapper around Zag.js `@zag-js/menu` machine.
- Wire the Sigil context menu to use `adapters/zag/menu.js` instead of its hand-rolled open/close/keyboard logic.
- The adapter must honor the existing bridge message contract — no changes to manifest or bridge messages.
- Keyboard navigation, focus trap, and ARIA state must be fully delegated to Zag.
- Export the adapter from `packages/toolkit/adapters/zag/index.js` (create if absent).

## Out of Scope

- Visual/theme changes (completed in #330).
- Any other Zag adapters (combobox, dialog, etc.) — those are future work.
- Mandatory Zag dependency for surfaces that don't opt in.

## Key Files

- `packages/toolkit/adapters/` — create `zag/` subdirectory here
- `packages/sigil/` — Sigil context menu component
- `packages/toolkit/runtime/bridge.js` — must remain unchanged
- ADR-001: `docs/decisions/ADR-001-toolkit-platform-strategy.md`

## Verification

- Context menu open/close/keyboard/ARIA behavior matches or improves on prior implementation.
- `node --test tests/toolkit/*.test.mjs` → all pass
- `bash tests/help-contract.sh` → passed
- Working tree clean; no unrelated dirty state

## Deliverable

PR closing #331. Introduces `packages/toolkit/adapters/zag/menu.js`. This is the reference implementation for all future Zag adapters in the platform.
