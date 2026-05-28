# Work Card: split-pane-workbench-adoption

**Issue:** #326  
**Status:** Ready  
**Blocked on:** nothing (unblocks after PR #329 merges)

## Goal

Retrofit four workbench surfaces to use the production-ready `createSplitPane` / `createFixedSidebarPane` APIs from `packages/toolkit/panel/layouts/split-pane.js` instead of any hand-rolled layout logic.

## Surfaces to Retrofit

- `markdown-workbench`
- `surface-zoom-inspector`
- `step-descriptor-workbench`
- `work-record-workbench`

## Scope

- Retrofit layout wiring only — no behavioral changes, no visual changes.
- Use `createSplitPane` for resizable two-pane layouts.
- Use `createFixedSidebarPane` for fixed-width sidebar layouts.
- Do not touch controls, bridge messages, or manifest declarations.

## Out of Scope

- Any new layout variants not already in `split-pane.js`.
- `surface-zoom-inspector` fold-in to `surface-inspector` (separate future card).
- Token layer work.

## Key Files

- `packages/toolkit/panel/layouts/split-pane.js` — `createSplitPane`, `createFixedSidebarPane`, `SplitPane`
- `packages/sigil/surfaces/markdown-workbench/`
- `packages/sigil/surfaces/surface-zoom-inspector/`
- `packages/toolkit/components/step-descriptor-workbench/`
- `packages/sigil/surfaces/work-record-workbench/`

## Verification

- `node --test tests/toolkit/*.test.mjs` → all pass
- `bash tests/help-contract.sh` → passed
- Working tree clean; no unrelated dirty state

## Deliverable

PR closing #326. Retrofit only. Stats expected: modest line-count reduction in each surface, zero new files.
