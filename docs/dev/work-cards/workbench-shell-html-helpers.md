# Work Card: workbench-shell-html-helpers

**Issue:** #327  
**Status:** Ready  
**Was blocked on:** Token layer (#330, now merged) and split-pane adoption (#326, now merged)

## Goal

Add HTML render helpers for workbench shell chrome elements — the structural scaffolding that wraps split-pane layouts inside a workbench surface (headers, toolbars, status bars, section titles, and similar shell-level elements). These are distinct from interactive controls (buttons, fields) and from layout primitives (split-pane).

## Background

Now that:
- `createSplitPane` / `createFixedSidebarPane` are adopted across workbench surfaces (PR #332)
- `--sigil-*` token override pattern is established (PR #333)
- Controls render helpers are extended (PR #335)

...the remaining hand-rolled shell chrome in workbench surfaces is the last layer without a shared helper pattern.

## Scope

1. Audit the four retrofitted workbench surfaces for hand-rolled shell chrome HTML strings:
   - `markdown-workbench`
   - `surface-zoom-inspector`
   - `playbook-workbench`
   - `work-record-workbench`
2. Identify recurring shell chrome patterns (e.g. workbench header, toolbar row, section label, status bar).
3. Add render helpers to `packages/toolkit/controls/` (or a new `packages/toolkit/shell/` module if the patterns are structurally distinct from controls — use judgment).
4. Each helper must:
   - Accept a props object with content and optional rawAttributes.
   - Return an HTML string.
   - Be exported from the module's `index.js`.
   - Have a focused unit test.
5. Apply the `--aos-*` token pattern to any new CSS introduced — no hard-coded values.
6. Replace the hand-rolled shell chrome in the four surfaces with the new helpers.
7. Do not change split-pane wiring, bridge messages, or manifests.

## Out of Scope

- Interactive controls (already in `packages/toolkit/controls/`).
- Layout primitives (already in `packages/toolkit/panel/layouts/`).
- Any surface not in the four listed above.
- `@agent-os/tokens` packaging (future work).

## Key Files

- `packages/toolkit/controls/` — existing controls layer; add here or alongside
- `packages/toolkit/panel/layouts/split-pane.js` — layout layer (read-only reference)
- `packages/toolkit/components/_base/theme.css` — `--aos-*` token definitions
- The four workbench surfaces in `packages/toolkit/components/` or `apps/`

## Verification

- No recurring hand-rolled shell chrome HTML strings remain in the four surfaces.
- All new helpers have focused unit tests.
- `node --test tests/toolkit/*.test.mjs` → all pass
- `bash tests/help-contract.sh` → passed
- Any new CSS uses `--aos-*` tokens only — no hard-coded values.
- Working tree clean; no unrelated dirty state

## Deliverable

PR closing #327. Establishes the shell chrome helper layer as the final piece of the workbench surface pattern.
