# agent-os Monorepo

Ecosystem of macOS and web automation CLIs. Each package builds independently. See ARCHITECTURE.md for the full blueprint.

## Layering

```
src/, shared/              primitives — unified `aos` binary (perceive, display, act, voice, daemon) + cross-tool schemas
  └─ packages/toolkit/     reusable WKWebView components + Content factory framework
       └─ apps/            consumer surfaces (sigil today; future chat, inspectors, etc.)
```

Not every directory under `packages/` is the middle layer. `packages/toolkit/` is the reusable-component layer between primitives and apps. `packages/gateway/` (MCP server) and `packages/host/` (agent host) are peers to `src/` — they consume primitives for different purposes (external tool surface, Anthropic SDK loop), not building blocks for apps.

Pointers: `ARCHITECTURE.md` for full architecture, `packages/toolkit/CLAUDE.md` for toolkit specifics, `apps/sigil/CLAUDE.md` for Sigil specifics.

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

The ecosystem has two explicit runtime modes, selected automatically by the executable's path:

| Mode | Binary location | When |
|------|----------------|------|
| **repo** | `./aos` (dev checkout) | Building/testing from source |
| **installed** | `~/Applications/AOS.app/Contents/MacOS/aos` | Packaged runtime |

Each mode gets its own state directory at `~/.config/aos/{mode}/` — daemon socket, config, permission-onboarding marker, and per-component logs (`daemon.log`, `sigil.log`, …) all live here. This prevents cross-mode contamination between repo builds and the installed app.

The live launchd label is `com.agent-os.aos.{mode}`. Legacy `com.agent-os.sigil*` labels from the avatar-sub retirement are unloaded by `aos reset`; no Sigil launchd service exists in the current model.

Operational details (`aos permissions setup`, `aos doctor`, `aos service install`, `aos reset`, etc.) live in `src/CLAUDE.md`.

## Build

Each package builds independently from its own directory:

```bash
# Unified binary (from repo root)
bash build.sh                    # Produces ./aos
```

## Key Files

- `ARCHITECTURE.md` — ecosystem design, philosophy, component roster
- `src/CLAUDE.md` — unified `aos` binary: commands, setup, config keys
- `packages/toolkit/CLAUDE.md` — reusable canvas components + Layer 1a/1b framework
- `packages/gateway/CLAUDE.md` — MCP server surface
- `apps/sigil/CLAUDE.md` — avatar presence system
- `shared/schemas/` — JSON contracts shared across tools (spatial model, coordinate conventions)

## Cross-Tool Work

When working on a specific package, read `ARCHITECTURE.md` first to understand how it fits the ecosystem. If your work affects the interface between tools (JSON schemas, coordinate systems, output contracts), update `shared/schemas/` and reflect it in `ARCHITECTURE.md §3 (Component Roster)` or `§4 (Communication & Data Flow)` as appropriate.

## Work Tracking

Work items, bugs, and enhancements are tracked in GitHub Issues. The session-start hook injects open issues into every session automatically.

- Log new work: `gh issue create --title "..." --body "..." --label enhancement|bug`
- Close completed work: `gh issue close <number> --reason completed`
- Don't create local task files — GitHub Issues is the single source of truth.

