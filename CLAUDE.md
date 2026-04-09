# agent-os Monorepo

Ecosystem of macOS and web automation CLIs. Each package builds independently. See ARCHITECTURE.md for the full blueprint.

## Structure

```
src/              AOS unified binary source (perception, display, action, voice)
packages/
  side-eye/       (merged into aos — see MOVED.md)
  hand-off/       Swift CLI — OS action (mouse, keyboard)
  speak-up/       (planned) Swift CLI — Audio I/O (TTS, STT)
  tear-sheet/     (planned) Node.js CLI — Web artifact extraction
  toolkit/        Reusable components built on agent-os primitives (components/, patterns/)
  gateway/        Node.js MCP server — typed script execution + cross-harness coordination
apps/
  sigil/          Avatar presence system (Track 2 consumer of display subsystem)
shared/
  schemas/        Cross-tool JSON contracts
tools/
  dogfood/        Development/testing scripts (agent helpers, chat overlay, xray)
```

## Runtime Model

AOS has two explicit runtime modes:

| Mode | Binary location | When |
|------|----------------|------|
| **repo** | `./aos` (dev checkout) | Building/testing from source |
| **installed** | `~/Applications/AOS.app/Contents/MacOS/aos` | Packaged runtime |

Detection is automatic (executable path containing `.app/Contents/MacOS/` → installed, else repo).

**Each mode gets its own state directory** under `~/.config/aos/{mode}/`:
- `sock` — daemon Unix socket
- `config.json` — live-reloaded daemon config
- `permissions-onboarding.json` — setup marker
- `daemon.log`, `sigil.log` — logs

This prevents cross-mode contamination between repo builds and the installed app.

**Launchd labels are also mode-scoped:**
- `com.agent-os.aos.repo` / `com.agent-os.aos.installed`
- `com.agent-os.sigil.repo` / `com.agent-os.sigil.installed`

Legacy labels (`com.agent-os.aos`, `com.agent-os.sigil`, `com.agent-os.heads-up`) are cleaned up by `aos reset`.

### First-Time Setup

Before interactive commands work, run the permission onboarding flow:

```bash
aos permissions setup --once     # Prompts for Accessibility + Screen Recording
aos doctor --json                # Verify everything is healthy
```

Interactive commands (`aos do`, `aos see cursor/observe/capture`, `aos inspect`) will exit early with `PERMISSIONS_SETUP_REQUIRED` if onboarding hasn't been completed for the current runtime mode.

### Key Operational Commands

```bash
aos doctor [--json]              # Full runtime health diagnostic
aos runtime status [--json]      # Runtime identity and signing info
aos service install [--mode repo|installed]  # Install launch agent
aos service status [--json]      # Launch agent state
aos reset --mode current|repo|installed|all  # Deterministic cleanup
```

## Build

Each package builds independently from its own directory:

```bash
# Unified binary (from repo root)
bash build.sh                    # Produces ./aos
```

## Key Files

- `ARCHITECTURE.md` — ecosystem design, philosophy, component roster, open questions
- `src/CLAUDE.md` — unified binary commands and usage
- `apps/sigil/CLAUDE.md` — avatar presence system
- `shared/schemas/` — JSON contracts shared across tools (spatial model, coordinate conventions)

## Cross-Tool Work

When working on a specific package, read ARCHITECTURE.md first to understand how it fits the ecosystem. If your work affects the interface between tools (JSON schemas, coordinate systems, output contracts), update `shared/schemas/` and note it in ARCHITECTURE.md Section 7.

## Related Repos

- `Findly-Inc/syborg` (`/Users/Michael/Documents/GitHub/syborg/`) — Chrome extension + chrome-harness. Separate repo (business IP).
- DRAW scrapyard (`/Users/Michael/Documents/DRAW_scavenger_bundle_5047887f/`) — historical capture code to mine for tear-sheet.
