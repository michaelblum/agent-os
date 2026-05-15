# Work Card: sigil-context-menu-theme-layer

**Issue:** #330  
**Status:** Ready after #329 merges  
**Blocked on:** PR #329 merge

## Goal

Extract the Sigil context menu's visual treatment into `--sigil-*` CSS custom property overrides, establishing the first proof-of-concept of the AOS token theming pattern defined in ADR-001.

## Scope

- Visual/theme changes only — zero behavior changes.
- Identify all hard-coded color, spacing, radius, shadow, and typography values in the Sigil context menu component.
- Replace them with `--sigil-*` token overrides that cascade from `--aos-*` base tokens defined in `packages/toolkit/components/_base/theme.css`.
- New `--sigil-*` tokens should be declared in a Sigil-scoped CSS file (e.g. `packages/sigil/theme/sigil-tokens.css` or equivalent).
- Do not create a `@agent-os/tokens` package — that is future work.

## Out of Scope

- Any interaction or behavior changes to the context menu.
- Zag.js integration (that is #331).
- Token packaging / npm publish.
- Any surface outside the Sigil context menu.

## Key Files

- `packages/toolkit/components/_base/theme.css` — `--aos-*` base token definitions
- `packages/sigil/` — Sigil product directory; locate the context menu component here
- ADR-001: `docs/decisions/ADR-001-toolkit-platform-strategy.md` — token layer spec

## Verification

- Context menu renders identically before/after (visual diff or manual check).
- No `--aos-*` values hard-coded inside Sigil files — only `--sigil-*` overrides.
- `node --test tests/toolkit/*.test.mjs` → all pass
- Working tree clean; no unrelated dirty state

## Deliverable

PR closing #330. Theme extraction only. Establishes `--sigil-*` override pattern for all future Sigil components.
