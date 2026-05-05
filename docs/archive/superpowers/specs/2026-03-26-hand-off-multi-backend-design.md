# hand-off: Multi-Backend Actuator Design

**Date:** 2026-03-26
**Session:** verb-layer-architecture
**Status:** Approved, implementing

## Problem

Agents need to act on macOS — click buttons, type text, move windows. Three action backends exist on macOS, each with different strengths:

- **AX API** (AXPerformAction): Semantic, no coordinates needed, works on background/occluded windows. Limited action set (~10 standard actions).
- **CGEvent**: Universal physical input simulation. Needs global coordinates and foreground window. Supports everything (drag, scroll, keyboard).
- **AppleScript**: App-specific verbs for scriptable apps (Finder, Safari, Mail). Fast for supported operations, fragile otherwise.

No single backend covers all cases. UFO2 (Microsoft) proved that hybrid backends behind a unified interface dramatically reduce action steps.

## Design Decision

**Input-driven dispatch.** The caller describes what they want to do. The input format determines which backend fires. The caller never names a backend.

- Element identity (pid + role + title) → AX backend
- Coordinates → CGEvent backend
- App verb → AppleScript backend

**No automatic fallback from AX to CGEvent.** A misclick on a shifted UI is worse than a reported failure. The orchestrator owns the retry loop: perceive → act → verify → re-perceive if failed.

## CLI Interface

```bash
# Semantic actions (AX)
hand-off press --pid <pid> --role <role> [--title <title>] [--index <n>]
hand-off set-value --pid <pid> --role <role> --value "text"
hand-off focus --pid <pid> --role <role>

# Physical actions (CGEvent)
hand-off click <x>,<y> [--right] [--double]
hand-off drag <x1>,<y1> <x2>,<y2>
hand-off scroll <x>,<y> --dy <pixels>
hand-off type "hello world"
hand-off key cmd+s

# Window management (AX)
hand-off raise --pid <pid> [--window <id>]
hand-off move --pid <pid> --to <x>,<y>
hand-off resize --pid <pid> --to <w>,<h>

# App verbs (AppleScript)
hand-off tell <app> <script-body>

# Safety
hand-off <any command> --dry-run
```

All coordinates are global CG (matching spatial-topology schema). JSON output follows the ecosystem contract.

## Shared Language with side-eye

side-eye already emits the fields hand-off needs: `app_pid`, `role`, `title`, `bounds` (global CG). No new shared schema required — just matching field names. Extract a formal element-reference schema when friction demands it.

## Architecture

Single-file Swift CLI (`main.swift`). Pure Apple frameworks: ApplicationServices (AX), CoreGraphics (CGEvent), Foundation (NSAppleScript). Zero external dependencies. Same build pattern as side-eye.

## What's Deferred

- Formal `element-reference.schema.json` — extract when second consumer appears
- Per-app profiles (UFO2's AppAgent concept) — not needed until we have evidence
- Action audit trail / undo — design when safety requirements are clearer
- `--scope` restrictions — design alongside policy model
