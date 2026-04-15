# agent-os Shared Agent Contract

This is the canonical repo-wide guidance for agent work in `agent-os`.
Provider-specific surfaces should stay thin and align to this file instead of
creating separate workflows.

## Progressive Disclosure

- Keep this root file limited to repo-wide rules and methods.
- Put specialized guidance in the nearest subtree-specific markdown file.
- Prefer provider-neutral docs when adding new instructions. During migration,
  some subtree-specific details still live in nearby `CLAUDE.md` files; treat
  those as local detail, not root policy.

## Repo Model

- `src/` and `shared/` hold the unified `aos` binary and shared schemas.
- `packages/toolkit/` is the reusable display/toolkit layer between primitives
  and apps.
- `packages/gateway/` and `packages/host/` are peer consumers of the
  primitives, not the middle layer.
- `apps/` contains consumer surfaces such as Sigil.
- Runtime mode is path-selected: `./aos` is repo mode, the packaged app is
  installed mode, and state is isolated under `~/.config/aos/{mode}/`.

## Repo-Wide Methods

- Use `aos` as the real host when verifying display or toolkit behavior. Prefer
  `aos://...` canvases over raw browser pages unless the problem is purely DOM
  debugging.
- Use `aos see` for visual verification before asking the user to inspect a
  canvas manually.
- If display work starts from stale daemons or orphaned canvases, run
  `aos clean` first and report what was cleaned.
- Treat `_dev` demos as non-canonical.

## Shared Surfaces

When work changes cross-tool contracts or consumer-facing behavior, update the
source of truth at the interface boundary:

- `shared/schemas/`
- `docs/api/`
- `ARCHITECTURE.md`

## Follow-On Detail

- `ARCHITECTURE.md` for system architecture
- nearest subtree markdown file for package or app specifics
- today, many of those local files are still named `CLAUDE.md`
