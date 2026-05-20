# Work Card: design-tokens-extraction

**Issue:** (open a new issue for this — no existing issue number)  
**Status:** Landed with runtime caveat

## Goal

Move the `--aos-*` base token definitions out of `packages/toolkit/components/_base/theme.css` into a dedicated `packages/design-tokens/tokens.css` file. Re-export from the toolkit so all existing consumers continue to work with no changes. No npm package, no build step, no publish.

## Background

ADR-001 calls for absorbing the token concept as `packages/design-tokens` / `@agent-os/tokens`. This is Option A: the extraction and re-export step only. The package boundary (`package.json`, workspace alias, npm publish) is deferred to a future card.

Runtime caveat recorded after landing: live `aos://toolkit` pages are served
from the toolkit content root and cannot traverse to sibling package roots. The
toolkit `components/_base/theme.css` entry point must therefore remain
self-contained, with tests comparing it against `packages/design-tokens/tokens.css`
so the runtime re-export does not drift.

## Scope

1. Create `packages/design-tokens/tokens.css` — move all `--aos-*` custom property definitions here verbatim from `packages/toolkit/components/_base/theme.css`.
2. In `packages/toolkit/components/_base/theme.css`, keep a runtime re-export of
   the moved definitions. Do not reduce it to an import-only sibling-package
   wrapper unless the AOS content host can serve that sibling package for every
   toolkit consumer with no additional launch-script setup.
3. Verify `apps/sigil/theme/sigil-tokens.css` — its `--sigil-*` overrides reference `--aos-*` fallbacks. Confirm they still resolve correctly after the move. Adjust the import chain in Sigil if needed.
4. Do not rename, add, or remove any `--aos-*` tokens — definition move only.
5. Do not create a `package.json` inside `packages/design-tokens/` — that is Option B.
6. Do not touch any JS, bridge messages, or manifests.

## Out of Scope

- Adding new tokens.
- `package.json` / workspace alias / npm publish (Option B, future).
- Any changes to `--sigil-*` token values.
- Any surface or component changes.

## Key Files

- `packages/toolkit/components/_base/theme.css` — runtime token entry point for
  `aos://toolkit` pages; mirrors the design-token declarations
- `packages/design-tokens/tokens.css` — new home for `--aos-*` definitions (create this file)
- `apps/sigil/theme/sigil-tokens.css` — verify fallback chain still resolves

## Verification

- All `--aos-*` definitions exist in `packages/design-tokens/tokens.css`.
- `packages/toolkit/components/_base/theme.css` exposes the same custom-property
  declarations to live toolkit pages and stays covered by a no-drift test.
- `apps/sigil/theme/sigil-tokens.css` fallback chain resolves correctly (rg audit: no broken `var(--aos-*)` references).
- `node --test tests/toolkit/*.test.mjs` → all pass
- `bash tests/help-contract.sh` → passed
- Working tree clean; no unrelated dirty state

## Deliverable

PR with two changed files and one new file. Zero behavioral or visual change. Establishes `packages/design-tokens/` as the future home of the token layer.
