# agent-os Monorepo

Ecosystem of macOS and web automation CLIs. Each package builds independently. See ARCHITECTURE.md for the full blueprint.

## Structure

```
src/              AOS unified binary source
  perceive/       `aos see` — screenshots, AX tree, focus channels, graph nav
  display/        `aos show` — WKWebView canvases, overlays, render mode
  act/            `aos do` — AX + CGEvent + AppleScript actuator
  voice/          `aos say` — TTS, daemon announcements (STT planned)
  daemon/         `aos serve` — unified daemon, one socket, one CGEventTap
packages/
  toolkit/        Reusable WKWebView components for apps
  gateway/        Node.js MCP server — external consumer surface
  host/           Node.js agent host — Anthropic SDK loop, session store
apps/
  sigil/          Avatar presence system (Track 2 consumer of display subsystem)
shared/
  schemas/        Cross-tool JSON contracts
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

Retired Sigil service labels (`com.agent-os.sigil`, `com.agent-os.sigil.repo`, `com.agent-os.sigil.installed`) from the avatar-sub retirement are unloaded by `aos reset`.

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

When working on a specific package, read ARCHITECTURE.md first to understand how it fits the ecosystem. If your work affects the interface between tools (JSON schemas, coordinate systems, output contracts), update `shared/schemas/` and reflect it in ARCHITECTURE.md §3 (Component Roster) or §5 (Communication & Data Flow) as appropriate. §7 is the Scrapyard archaeology map — don't confuse with it.

## Work Tracking

Work items, bugs, and enhancements are tracked in GitHub Issues. The session-start hook injects open issues into every session automatically.

- Log new work: `gh issue create --title "..." --body "..." --label enhancement|bug`
- Close completed work: `gh issue close <number> --reason completed`
- Don't create local task files — GitHub Issues is the single source of truth.

