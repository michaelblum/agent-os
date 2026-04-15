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

## Design Principle: Primitives First

Every fix and feature should be evaluated as: "what does this look like if it's
not a bandaid but an expression of agent-os primitives?" Solutions belong at the
right level of the stack:

- **Level 0 — Primitives** (`src/`): canvas lifecycle, perception, action,
  voice. These are the building blocks every app inherits.
- **Level 1 — Toolkit** (`packages/toolkit/`): reusable display/interaction
  patterns built on primitives.
- **Level 2 — Apps** (`apps/`, `packages/host/`): consumer surfaces like Sigil.

Build for the platform, not the app. If Sigil needs something, ask whether every
future app will need it too — and if so, push the solution down to the primitive
or toolkit layer. A slow canvas toggle doesn't get a Sigil-specific workaround;
it gets suspend/resume as a canvas lifecycle primitive.

New resource types (channels, state stores, etc.) inherit runtime mode isolation
and wiki namespace conventions. Don't invent new scoping models.

## Verb Vocabulary

The `aos` CLI uses an embodied verb metaphor. Know the verbs and what they cover:

| Verb | Role | Direction |
|------|------|-----------|
| `see` | Perception — screen, cursor, AX tree | Environment → agent |
| `do` | Action — click, type, press, AppleScript | Agent → environment |
| `say` | Voice — speak aloud to the human (TTS) | Agent → human |
| `show` | Display — canvases, overlays, render | Agent → human |
| `tell` | Coordination — message agents/channels | Agent → agents |
| `hear` | Coordination — receive from channels | Agents → agent |

`tell`/`hear` are the agent-to-agent counterparts of `say`/`listen`. See
`ARCHITECTURE.md` for the full rationale and the design spec at
`docs/superpowers/specs/2026-04-15-tell-hear-coordination-verbs-design.md`.

## Repo-Wide Methods

- `aos` CLI is the canonical interface for development inside agent-os. MCP tools
  exist as an optional adapter for external consumers, not for dev work.

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
