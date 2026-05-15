# Work Card: controls-html-render-helpers

**Issue:** #325  
**Status:** Redirected — narrow compatibility patch only  
**Blocked on:** PR #329 merge

## Goal

Narrow pass only: audit `surface-zoom-inspector` for `controlHtml()` workarounds, remove them, and add only the missing string render helpers that the workarounds prove are needed in `packages/toolkit/controls/`.

## Background

This issue was redirected by ADR-001. The original broader scope is cancelled. This card covers only the compatibility cleanup it revealed.

## Scope

- Audit `surface-zoom-inspector` for any `controlHtml()` calls or equivalent workarounds.
- Remove each workaround.
- For each removed workaround, determine if a proper render helper is missing from `packages/toolkit/controls/`.
- If a helper is provably missing (the workaround is the only evidence of the gap), add it to the controls layer with a focused test.
- Do not add speculative helpers — only helpers directly justified by a removed workaround.
- Do not change any behavior outside `surface-zoom-inspector` and `packages/toolkit/controls/`.

## Out of Scope

- Any controls work beyond what workaround removal directly requires.
- `surface-zoom-inspector` fold-in to `surface-inspector`.
- Any other surface.

## Key Files

- `packages/sigil/surfaces/surface-zoom-inspector/`
- `packages/toolkit/controls/` — add helpers here only if justified
- `packages/toolkit/controls/index.js` — export any new helpers

## Verification

- Zero `controlHtml()` calls remaining in `surface-zoom-inspector`.
- Any new helpers have focused unit tests.
- `node --test tests/toolkit/*.test.mjs` → all pass
- `bash tests/help-contract.sh` → passed
- Working tree clean; no unrelated dirty state

## Deliverable

PR closing #325. Small diff expected. No scope creep.
