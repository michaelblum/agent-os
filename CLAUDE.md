# agent-os Monorepo

Ecosystem of macOS and web automation CLIs. Each package builds independently. See ARCHITECTURE.md for the full blueprint.

## Structure

```
packages/
  side-eye/       Swift CLI — OS perception (screenshots, AX tree)
  hand-off/       (planned) Swift CLI — OS action (mouse, keyboard)
  heads-up/       (planned) Swift CLI — OS projection (overlays, avatar)
  speak-up/       (planned) Swift CLI — Audio I/O (TTS, STT)
  tear-sheet/     (planned) Node.js CLI — Web artifact extraction
shared/
  schemas/        Cross-tool JSON contracts
```

## Build

Each package builds independently from its own directory:

```bash
# Swift packages
cd packages/side-eye && bash build.sh

# The binary lands in the package directory
./packages/side-eye/side-eye --help
```

## Key Files

- `ARCHITECTURE.md` — ecosystem design, philosophy, component roster, open questions
- `packages/side-eye/CLAUDE.md` — side-eye specific instructions
- `shared/schemas/` — JSON contracts shared across tools (spatial model, coordinate conventions)

## Cross-Tool Work

When working on a specific package, read ARCHITECTURE.md first to understand how it fits the ecosystem. If your work affects the interface between tools (JSON schemas, coordinate systems, output contracts), update `shared/schemas/` and note it in ARCHITECTURE.md Section 7.

## Related Repos

- `Findly-Inc/syborg` (`/Users/Michael/Documents/GitHub/syborg/`) — Chrome extension + chrome-harness. Separate repo (business IP).
- DRAW scrapyard (`/Users/Michael/Documents/DRAW_scavenger_bundle_5047887f/`) — historical capture code to mine for tear-sheet.
